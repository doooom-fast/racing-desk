using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading;
using Newtonsoft.Json;
using RacingDesk.Data;
using RacingDesk.Data.Pedals;
using RacingDesk.Data.Schedule;
using RacingDesk.Plugin;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Host
{
    internal static class Program
    {
        private const string Usage = @"RacingDesk.Host — Racing Desk without SimHub

  RacingDesk.Host                      follow live iRacing: serve :8889 / :8890, record sessions,
                                    backfill new .ibt files in the background; the local store is
                                    readable at :8889/racing-desk/data/{status,sessions,session?id=,schedule,cars}
  RacingDesk.Host --ibt <file>         replay a recorded .ibt through the same pipeline
  RacingDesk.Host ingest               backfill the local store from .ibt history
  RacingDesk.Host sessions             list stored sessions
  RacingDesk.Host cars                 list the cars the store can name: name, folder, driven, seen (--scan to
                                    read the names out of the .ibt files ingested before it kept them)
  RacingDesk.Host sql ""<select>""       run a read-only query against the store, print JSON
  RacingDesk.Host schedule             parse iRacing's season schedule PDF (--store to save it, --fetch to
                                    download it first)

Serve options:
  --http-port <n>      JSON contract port (default 8889)
  --ws-port <n>        WebSocket port (default 8890)
  --speed <x>          .ibt playback speed (default 1)
  --seek <seconds>     .ibt start offset
  --loop               restart the .ibt at the end
  --record             also capture the replayed .ibt as a session (source 'replay')
  --no-record          live mode: don't write sessions
  --no-ingest          live mode: don't backfill .ibt files
  --exit-after <s>     stop after this many seconds (for scripted checks)
  --no-hardware        don't open Moza serial, pedal profiles or screen sampling
                       (always off in --ibt mode)
  --parent-pid <n>     stop when that process exits (the app that started this host)

Data options:
  --db <path>          store (default %LOCALAPPDATA%\RacingDesk\racing-desk.db)
  --data-dir <dir>     settings, pedal data, track-map cache (default %LOCALAPPDATA%\RacingDesk)
  --dir <dir>          ingest: telemetry folder (default Documents\iRacing\telemetry)
  --limit <n>          ingest: at most n files; sessions: rows to show (default 20)
  --step <n>           ingest: read every nth frame (default 3 = 20 Hz)
  --force              ingest: re-read files already stored
  --now                ingest, cars --scan: don't wait for iRacing to close first
  --scan               cars: read the headers of ingested .ibt files not yet read for their cars (no frames;
                       seconds for the whole history), then list
  --pdf <file>         schedule: read this PDF instead of the newest in %LOCALAPPDATA%\RacingDesk\schedule
  --dump               schedule: print the PDF's laid-out text
  --series <text>      schedule: print the parsed detail of series matching this text
  --json <file>        schedule: write the parsed schedule as JSON
  --store              schedule: save the parsed schedule into the local store
  --fetch              schedule: download the season PDF if it changed, then parse and store it
  --url <url>          schedule: the PDF to fetch (default: settings.json's scheduleUrl)
  --json <file>        schedule: write the parsed schedule as JSON
  --out <file>         schedule: write output to a file instead of stdout
  --type <t>           sessions: filter by session type, e.g. Race
  --laps <id>          sessions: show laps for a session id";

        private static int Main(string[] args)
        {
            HostOptions o;
            try { o = HostOptions.Parse(args); }
            catch (ArgumentException ex)
            {
                Console.Error.WriteLine(ex.Message);
                Console.Error.WriteLine(Usage);
                return 2;
            }
            if (o.Help) { Console.WriteLine(Usage); return 0; }

            try { Console.OutputEncoding = System.Text.Encoding.UTF8; } catch { /* redirected output */ }

            Log.Sink = (level, message) =>
                Console.WriteLine($"{DateTime.Now:HH:mm:ss.fff} {level,-5} {message}");

            // The RaceCor-era data folder moves across once, before any command opens the store.
            foreach (string note in DataFolder.Migrate())
                Log.Info($"[RacingDesk.Host] data folder: {note}");

            switch (o.Command)
            {
                case "ingest": return Ingest(o);
                case "sessions": return Sessions(o);
                case "cars": return CarsCommand.Run(o);
                case "sql": return Sql(o);
                case "schedule": return ScheduleCommand.Run(o);
                default: return Serve(o);
            }
        }

        private static int Serve(HostOptions o)
        {
            string dataDir = o.DataDir ?? DataFolder.Path;
            Directory.CreateDirectory(dataDir);
            string settingsPath = Path.Combine(dataDir, "settings.json");

            bool replay = o.IbtPath != null;
            string dbPath = o.Db ?? RacingDeskStore.DefaultPath;
            var runtime = new RacingDeskRuntime(LoadSettings(settingsPath), new RacingDeskRuntime.Options
            {
                AssemblyDirectory = AppContext.BaseDirectory,
                PluginsDataDirectory = dataDir,
                HttpPort = o.HttpPort,
                WsPort = o.WsPort,
                EnableHardware = !replay && !o.NoHardware,
                EnableSdkBridge = !replay,
                TrackOutline = File.Exists(dbPath) ? new TrackOutlines(dbPath).ForTrack : null,
                ExtraRoutes = new LocalDataApi(dbPath).TryHandle,
            });

            bool record = replay ? o.Record : !o.NoRecord;
            using var store = record || (!replay && !o.NoIngest) ? new RacingDeskStore(dbPath) : null;

            // Not disposed: the schedule, ingest and parent-watch threads may still look at it after Serve has returned,
            // while the process is ending, and a wait on a disposed one throws on a thread nothing catches on.
            var stop = new ManualResetEventSlim();
            // However the stop is asked for, the process ends within a few seconds of it: see HostStop.
            var stopping = new HostStop(stop, HostStop.DefaultGrace, m => Log.Info("[RacingDesk.Host] " + m), m => Log.Warn("[RacingDesk.Host] " + m));
            Console.CancelKeyPress += (_, e) => { e.Cancel = true; stopping.Ask("Ctrl+C"); };
            using var exitAfter = o.ExitAfterSeconds > 0
                ? new Timer(_ => stopping.Ask($"--exit-after {o.ExitAfterSeconds} s"), null, TimeSpan.FromSeconds(o.ExitAfterSeconds), Timeout.InfiniteTimeSpan)
                : null;
            // Started by the app, with no console to send Ctrl+C to: stop when it goes away, however it went, so the
            // orderly shutdown below (flush the lap being recorded, release the serial port) still runs.
            if (o.ParentPid > 0) stopping.WatchParent(o.ParentPid);

            runtime.Start();
            try
            {
                // Another host, or SimHub, got the port first. A host that serves nothing must not sit on the
                // hardware and record beside it; exiting lets the app see that instead of a silent process.
                if (!runtime.HttpListening)
                {
                    Log.Warn($"[RacingDesk.Host] :{o.HttpPort} is taken — stopping");
                    return 1;
                }
                if (replay) PlayIbt(o, runtime, record ? store : null, stop);
                else RunLive(o, runtime, store, stop);
            }
            finally
            {
                runtime.Stop();
                SaveSettings(settingsPath, runtime.Settings);
                Log.Info("[RacingDesk.Host] stopped");
                stopping.Stopped();
            }
            return 0;
        }

        // Live: tick on every SDK telemetry frame while connected; when iRacing isn't running, keep ticking at
        // ~60 Hz with an empty frame, as SimHub does, so idle and demo state stay current.
        private static void RunLive(HostOptions o, RacingDeskRuntime runtime, RacingDeskStore store, ManualResetEventSlim stop)
        {
            using var raw = new SdkRawTelemetry();
            var source = new IRacingTelemetrySource(raw);
            var recorder = store != null && !o.NoRecord
                ? new LiveRecorder(store, "live", _ => DateTime.UtcNow, m => Log.Info("[RacingDesk.Host] " + m))
                : null;
            // The view each car is driven with. iRacing's files are read once the sim has gone, and never written.
            var views = store != null
                ? new CarViewRecorder(null, BackgroundIo.SimRunning, view => SaveCarView(o, view), m => Log.Info("[RacingDesk.Host] " + m))
                : null;
            // The pedals each car is driven with. The brake force is followed from SmartControl Live's own keys —
            // those keys and no others, and only while the sim is sending — because nothing on the PC records it.
            // SmartControl's files are read and never written.
            var pedals = store != null
                ? new CarPedalsRecorder(() => SmartControl.Read(), seen => SavePedals(o, seen), m => Log.Info("[RacingDesk.Host] " + m))
                : null;
            // What the check of the car list says of each car, kept for the desk. It is queued on the telemetry thread
            // and written on another, through a connection of its own; a store that will not take it is logged and
            // goes no further. The SimHub plugin has no store, and says it to its log alone.
            using var remarks = store != null
                ? new CarListRemarkKeeper(o.Db ?? RacingDeskStore.DefaultPath, m => Log.Warn("[RacingDesk.Host] " + m))
                : null;
            var follower = RacingDesk.Plugin.Engine.TelemetryCapture.Cars;
            Action<RacingDesk.Core.Cars.CarRemark> keepRemark = remarks != null ? remarks.Keep : null;
            if (keepRemark != null) follower.Said += keepRemark;
            var gate = new object();

            raw.TelemetryData += () =>
            {
                lock (gate)
                {
                    source.Update();
                    runtime.Tick(source);
                    recorder?.Feed(raw);
                }
                // What follows the car is a nicety. Nothing thrown by it may end the telemetry, which an
                // exception out of this handler would.
                try
                {
                    views?.SeeCar(source.CarPath);
                    pedals?.See(source.CarPath, source.HasAbsSetting, source.AbsWorking, source.LapsCompleted, source.Driving,
                        source.HasPrototypeControls);
                }
                catch (Exception ex)
                {
                    Log.Warn("[RacingDesk.Host] the car was not followed on this frame: " + ex.Message);
                }
            };
            raw.Connected += () => Log.Info("[RacingDesk.Host] iRacing connected");
            raw.Disconnected += () =>
            {
                Log.Info("[RacingDesk.Host] iRacing disconnected");
                lock (gate) recorder?.Flush();
                views?.SimGone();
                pedals?.SimGone();
            };
            // Returns at once (SdkStart). IRSDKSharper's own Start() could wait for ever, and then the loop below, which
            // is what hears the stop, was never reached.
            raw.Start();
            Log.Info("[RacingDesk.Host] waiting for iRacing (Ctrl+C to stop)");

            if (store != null && !o.NoIngest)
            {
                var schedule = new Thread(() => BackgroundSchedule(o, runtime.Settings, stop))
                {
                    IsBackground = true, Priority = ThreadPriority.BelowNormal, Name = "schedule",
                };
                schedule.Start();
            }

            Thread ingest = null;
            if (store != null && !o.NoIngest)
            {
                ingest = new Thread(() => BackgroundIngest(o, stop)) { IsBackground = true, Priority = ThreadPriority.BelowNormal, Name = "ibt-ingest" };
                ingest.Start();
            }

            while (!stop.Wait(16))
            {
                if (raw.IsConnected) continue;
                lock (gate) { runtime.Tick(source); }
            }
            raw.Stop();
            if (keepRemark != null) follower.Said -= keepRemark;
            lock (gate) recorder?.Flush();
            // The host is going with the sim still up — the desk was closed first. The run's force is the car's
            // all the same, and stopping says nothing of the sim having gone.
            pedals?.SimGone();
        }

        // Its own connection, as ingest has: this runs when the sim has closed, on a thread of its own.
        private static void SaveCarView(HostOptions o, CarView view)
        {
            try
            {
                using var store = new RacingDeskStore(o.Db ?? RacingDeskStore.DefaultPath);
                store.SaveCarView(view);
            }
            catch (Exception ex)
            {
                Log.Warn("[RacingDesk.Host] view not stored: " + ex.Message);
            }
        }

        // Its own connection, as the view's has. When the sim goes the session the run was is saved before this
        // is called, so the store has the car by now; on a change of car in mid-run it may not, and says so.
        private static void SavePedals(HostOptions o, PedalsSeen seen)
        {
            try
            {
                using var store = new RacingDeskStore(o.Db ?? RacingDeskStore.DefaultPath);
                string kept = CarPedalsKeeper.Keep(store, () => SmartControl.Read(), seen);
                if (kept != null) Log.Info("[RacingDesk.Host] " + kept);
            }
            catch (Exception ex)
            {
                Log.Warn("[RacingDesk.Host] pedals not stored: " + ex.Message);
            }
        }

        // Its own connection: SQLite serialises writers, and ingest must never stall the telemetry thread for long.
        internal static void BackgroundIngest(HostOptions o, ManualResetEventSlim stop)
        {
            using var cts = new CancellationTokenSource();
            using var reg = new Timer(_ => { if (stop.IsSet) cts.Cancel(); }, null, 500, 500);
            try
            {
                using var store = new RacingDeskStore(o.Db ?? RacingDeskStore.DefaultPath);
                var ingest = new IbtIngest(store, m => Log.Info("[RacingDesk.Host] ingest: " + m));
                // Car names first: seconds, once, and the Paints page is waiting for them. They are a nicety, though:
                // whatever goes wrong with them, the new files are still ingested.
                try
                {
                    var scan = ingest.ScanCars(cts.Token, BackgroundIo.SimRunning);
                    if (scan.FilesScanned > 0 || scan.FilesFailed > 0 || scan.FilesMissing > 0)
                        Log.Info("[RacingDesk.Host] ingest: " + CarsCommand.Describe(scan));
                }
                catch (Exception ex)
                {
                    Log.Warn("[RacingDesk.Host] car names not read: " + ex.Message);
                }
                var summary = ingest
                    .Run(o.TelemetryDir ?? IbtIngest.DefaultTelemetryDirectory, o.Step, int.MaxValue, cts.Token, pause: BackgroundIo.SimRunning);
                if (summary.FilesIngested > 0 || summary.FilesFailed > 0)
                    Log.Info($"[RacingDesk.Host] ingest: {summary.FilesIngested} new files, {summary.Sessions} sessions, {summary.FilesFailed} unreadable, {summary.Elapsed.TotalSeconds:F0}s");
            }
            catch (Exception ex)
            {
                Log.Warn("[RacingDesk.Host] background ingest stopped: " + ex.Message);
            }
        }

        // The season schedule changes once a quarter and gets revised a few times; a daily look is plenty, and
        // it waits for the sim to close so a fetch and parse never competes with a race.
        private static void BackgroundSchedule(HostOptions o, Settings settings, ManualResetEventSlim stop)
        {
            string url = o.ScheduleUrl ?? settings.ScheduleUrl ?? ScheduleCommand.DefaultUrl;
            string directory = o.ScheduleDir ?? ScheduleCommand.DefaultDirectory;
            while (!stop.IsSet)
            {
                try
                {
                    while (BackgroundIo.SimRunning() && !stop.IsSet) stop.Wait(TimeSpan.FromMinutes(5));
                    if (stop.IsSet) return;
                    using var store = new RacingDeskStore(o.Db ?? RacingDeskStore.DefaultPath);
                    using var lowIo = BackgroundIo.Enter();
                    Log.Info("[RacingDesk.Host] schedule: " + ScheduleFetcher.Refresh(store, url, directory, m => Log.Info("[RacingDesk.Host] " + m)));
                }
                catch (Exception ex)
                {
                    Log.Warn("[RacingDesk.Host] schedule refresh failed: " + ex.Message);
                }
                stop.Wait(TimeSpan.FromHours(24));
            }
        }

        private static void PlayIbt(HostOptions o, RacingDeskRuntime runtime, RacingDeskStore store, ManualResetEventSlim stop)
        {
            using var file = new IbtFile(o.IbtPath);
            var raw = new IbtRawTelemetry(file);
            var source = new IRacingTelemetrySource(raw);
            var recorder = store != null
                ? new LiveRecorder(store, "replay", t => IbtIngest.SessionClock(file, t), m => Log.Info("[RacingDesk.Host] " + m))
                : null;
            var wi = file.SessionInfo?.WeekendInfo;
            Log.Info($"[RacingDesk.Host] replaying {Path.GetFileName(file.Path)} — {wi?.TrackDisplayName} {wi?.TrackConfigName}, " +
                     $"{file.RecordCount} frames @ {file.TickRate} Hz, {o.Speed}x");

            int start = Math.Clamp((int)(o.SeekSeconds * file.TickRate), 0, Math.Max(0, file.RecordCount - 1));
            double frameMs = 1000.0 / file.TickRate / o.Speed;
            do
            {
                var clock = Stopwatch.StartNew();
                for (int i = start; i < file.RecordCount && !stop.IsSet; i++)
                {
                    if (!raw.Seek(i)) break;
                    source.Update();
                    runtime.Tick(source);
                    recorder?.Feed(raw);

                    double due = (i - start + 1) * frameMs - clock.Elapsed.TotalMilliseconds;
                    if (due > 1 && stop.Wait(TimeSpan.FromMilliseconds(due))) break;
                    if ((i - start) % (file.TickRate * 30) == 0)
                        Log.Info($"[RacingDesk.Host] t={i / (double)file.TickRate:F0}s frame {i}/{file.RecordCount}");
                }
                recorder?.Flush();
                start = 0;
            } while (o.Loop && !stop.IsSet);

            if (!o.Loop && !stop.IsSet)
            {
                Log.Info("[RacingDesk.Host] end of file — holding last frame (Ctrl+C to stop)");
                stop.Wait();
            }
        }

        private static int Ingest(HostOptions o)
        {
            string dir = o.TelemetryDir ?? IbtIngest.DefaultTelemetryDirectory;
            using var store = new RacingDeskStore(o.Db ?? RacingDeskStore.DefaultPath);
            using var cts = new CancellationTokenSource();
            Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };
            Log.Info($"[ingest] {dir} → {store.Path} (every {o.Step} frames)");
            var s = new IbtIngest(store, m => Log.Info("[ingest] " + m)).Run(dir, o.Step, o.Limit ?? int.MaxValue, cts.Token, o.Force, o.Now ? null : BackgroundIo.SimRunning);
            Log.Info($"[ingest] done: {s.FilesIngested} ingested, {s.FilesSkipped} already stored, {s.FilesFailed} unreadable; " +
                     $"{s.Sessions} sessions, {s.Laps} laps, {s.GeometryUpdates} track outlines; {s.BytesRead / 1e9:F1} GB in {s.Elapsed.TotalSeconds:F0}s");
            return 0;
        }

        private static int Sessions(HostOptions o)
        {
            using var store = new RacingDeskStore(o.Db ?? RacingDeskStore.DefaultPath);
            if (o.LapsFor.HasValue)
            {
                foreach (var l in store.Laps(o.LapsFor.Value))
                    Console.WriteLine($"lap {l.Lap,3}  {Fmt(l.LapTimeSeconds)}  {(l.Clean ? "clean" : "     ")}  inc {l.Incidents}  fuel {l.FuelUsedLiters,5:F2} L  P{l.Position}{(l.Pitted ? "  pit" : "")}");
                return 0;
            }
            Console.WriteLine($"{store.Scalar<long>("SELECT COUNT(*) FROM sessions")} sessions, {store.Scalar<long>("SELECT COUNT(*) FROM laps")} laps, " +
                              $"{store.Scalar<long>("SELECT COUNT(*) FROM track_geometry")} track outlines in {store.Path}");
            foreach (var s in store.RecentSessions(o.Limit ?? 20, o.Type))
            {
                string result = s.SessionType == "Race" && s.FinishPosition > 0 ? $"P{s.StartPosition}->P{s.FinishPosition}/{s.FieldSize} SoF {s.StrengthOfField}" : $"{s.FieldSize} cars";
                Console.WriteLine($"{s.Id,6}  {s.StartedAtUtc.ToLocalTime():yyyy-MM-dd HH:mm}  {s.Source,-6} {s.SessionType,-12} {Trim(s.TrackDisplayName, 28),-28} " +
                                  $"{Trim(s.CarScreenName, 24),-24} {s.LapsCompleted,3} laps  best {Fmt(s.BestLapSeconds)}  {s.Incidents,2}x  {result}");
            }
            return 0;
        }

        private static int Sql(HostOptions o)
        {
            using var store = RacingDeskStore.OpenReadOnly(o.Db ?? RacingDeskStore.DefaultPath);
            using var stdout = Console.OpenStandardOutput();
            using (var json = new System.Text.Json.Utf8JsonWriter(stdout, new System.Text.Json.JsonWriterOptions { Indented = true }))
                store.WriteJson(json, o.Sql);
            Console.WriteLine();
            return 0;
        }

        private static string Fmt(double seconds) =>
            seconds > 0 && seconds < 86400 ? TimeSpan.FromSeconds(seconds).ToString(seconds >= 60 ? @"m\:ss\.fff" : @"ss\.fff", CultureInfo.InvariantCulture) : "   —    ";

        private static string Trim(string s, int n) => string.IsNullOrEmpty(s) ? "" : s.Length <= n ? s : s.Substring(0, n - 1) + "…";

        private static Settings LoadSettings(string path)
        {
            try
            {
                if (File.Exists(path))
                    return JsonConvert.DeserializeObject<Settings>(File.ReadAllText(path)) ?? new Settings();
            }
            catch (Exception ex)
            {
                Log.Warn($"[RacingDesk.Host] settings unreadable ({ex.Message}) — using defaults");
            }
            return new Settings();
        }

        private static void SaveSettings(string path, Settings settings)
        {
            try
            {
                string tmp = path + ".tmp";
                File.WriteAllText(tmp, JsonConvert.SerializeObject(settings, Formatting.Indented));
                File.Move(tmp, path, overwrite: true);
            }
            catch (Exception ex)
            {
                Log.Warn($"[RacingDesk.Host] settings not saved: {ex.Message}");
            }
        }
    }

    internal sealed class HostOptions
    {
        public string Command;
        public string Sql;
        public string IbtPath;
        public double Speed = 1;
        public double SeekSeconds;
        public bool Loop;
        public bool Record;
        public bool NoRecord;
        public bool NoIngest;
        public int HttpPort = 8889;
        public int WsPort = 8890;
        public bool NoHardware;
        public int ParentPid;
        public string DataDir;
        public double ExitAfterSeconds;
        public string Db;
        public string TelemetryDir;
        public int? Limit;
        public int Step = 3;
        public string Type;
        public string Pdf;
        public string ScheduleDir;
        public string Out;
        public bool Dump;
        public string Series;
        public string Json;
        public bool Store;
        public bool Fetch;
        public string ScheduleUrl;
        public bool Force;
        public bool Now;
        public bool Scan;
        public long? LapsFor;
        public bool Help;

        public static HostOptions Parse(string[] args)
        {
            var o = new HostOptions();
            int start = 0;
            if (args.Length > 0 && !args[0].StartsWith("-", StringComparison.Ordinal))
            {
                o.Command = args[0];
                start = 1;
                if (o.Command != "ingest" && o.Command != "sessions" && o.Command != "cars" && o.Command != "sql" && o.Command != "schedule") throw new ArgumentException($"unknown command {o.Command}");
                if (o.Command == "sql")
                {
                    o.Sql = args.Length > 1 ? args[1] : throw new ArgumentException("sql needs a query");
                    start = 2;
                }
            }
            for (int i = start; i < args.Length; i++)
            {
                string a = args[i];
                string Next() => i + 1 < args.Length ? args[++i] : throw new ArgumentException($"{a} needs a value");
                double Num() => double.TryParse(Next(), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : throw new ArgumentException($"{a} needs a number");
                switch (a)
                {
                    case "--ibt": o.IbtPath = Next(); break;
                    case "--speed": o.Speed = Num(); break;
                    case "--seek": o.SeekSeconds = Num(); break;
                    case "--loop": o.Loop = true; break;
                    case "--record": o.Record = true; break;
                    case "--no-record": o.NoRecord = true; break;
                    case "--no-ingest": o.NoIngest = true; break;
                    case "--http-port": o.HttpPort = (int)Num(); break;
                    case "--ws-port": o.WsPort = (int)Num(); break;
                    case "--no-hardware": o.NoHardware = true; break;
                    case "--parent-pid": o.ParentPid = (int)Num(); break;
                    case "--data-dir": o.DataDir = Next(); break;
                    case "--exit-after": o.ExitAfterSeconds = Num(); break;
                    case "--db": o.Db = Next(); break;
                    case "--dir": o.TelemetryDir = Next(); break;
                    case "--limit": o.Limit = (int)Num(); break;
                    case "--step": o.Step = Math.Max(1, (int)Num()); break;
                    case "--type": o.Type = Next(); break;
                    case "--pdf": o.Pdf = Next(); break;
                    case "--schedule-dir": o.ScheduleDir = Next(); break;
                    case "--out": o.Out = Next(); break;
                    case "--dump": o.Dump = true; break;
                    case "--series": o.Series = Next(); break;
                    case "--json": o.Json = Next(); break;
                    case "--store": o.Store = true; break;
                    case "--fetch": o.Fetch = true; break;
                    case "--url": o.ScheduleUrl = Next(); break;
                    case "--force": o.Force = true; break;
                    case "--now": o.Now = true; break;
                    case "--scan": o.Scan = true; break;
                    case "--laps": o.LapsFor = (long)Num(); break;
                    case "-h": case "--help": o.Help = true; break;
                    default: throw new ArgumentException($"unknown argument {a}");
                }
            }
            if (o.IbtPath != null && !File.Exists(o.IbtPath)) throw new ArgumentException($"no such file: {o.IbtPath}");
            if (o.Speed <= 0) throw new ArgumentException("--speed must be positive");
            return o;
        }
    }
}
