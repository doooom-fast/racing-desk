using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading;
using Newtonsoft.Json;
using RaceCor.Data;
using RaceCorProDrive.Plugin;
using RaceCorProDrive.Plugin.IRacing;

namespace RaceCor.Host
{
    internal static class Program
    {
        private const string Usage = @"RaceCor.Host — Pro Drive without SimHub

  RaceCor.Host                      follow live iRacing: serve :8889 / :8890, record sessions,
                                    backfill new .ibt files in the background
  RaceCor.Host --ibt <file>         replay a recorded .ibt through the same pipeline
  RaceCor.Host ingest               backfill the local store from .ibt history
  RaceCor.Host sessions             list stored sessions

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

Data options:
  --db <path>          store (default %LOCALAPPDATA%\RaceCor\prodrive.db)
  --data-dir <dir>     settings, pedal data, track-map cache (default %LOCALAPPDATA%\RaceCor)
  --dir <dir>          ingest: telemetry folder (default Documents\iRacing\telemetry)
  --limit <n>          ingest: at most n files; sessions: rows to show (default 20)
  --step <n>           ingest: read every nth frame (default 3 = 20 Hz)
  --force              ingest: re-read files already stored
  --now                ingest: don't wait for iRacing to close first
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

            Log.Sink = (level, message) =>
                Console.WriteLine($"{DateTime.Now:HH:mm:ss.fff} {level,-5} {message}");

            switch (o.Command)
            {
                case "ingest": return Ingest(o);
                case "sessions": return Sessions(o);
                default: return Serve(o);
            }
        }

        private static int Serve(HostOptions o)
        {
            string dataDir = o.DataDir ?? Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RaceCor");
            Directory.CreateDirectory(dataDir);
            string settingsPath = Path.Combine(dataDir, "settings.json");

            bool replay = o.IbtPath != null;
            var runtime = new ProDriveRuntime(LoadSettings(settingsPath), new ProDriveRuntime.Options
            {
                AssemblyDirectory = AppContext.BaseDirectory,
                PluginsDataDirectory = dataDir,
                HttpPort = o.HttpPort,
                WsPort = o.WsPort,
                EnableHardware = !replay && !o.NoHardware,
                EnableSdkBridge = !replay,
                TrackOutline = File.Exists(o.Db ?? ProDriveStore.DefaultPath)
                    ? new TrackOutlines(o.Db ?? ProDriveStore.DefaultPath).ForTrack
                    : null,
            });

            bool record = replay ? o.Record : !o.NoRecord;
            using var store = record || (!replay && !o.NoIngest) ? new ProDriveStore(o.Db ?? ProDriveStore.DefaultPath) : null;

            using var stop = new ManualResetEventSlim();
            Console.CancelKeyPress += (_, e) => { e.Cancel = true; stop.Set(); };
            if (o.ExitAfterSeconds > 0)
                new Timer(_ => stop.Set(), null, TimeSpan.FromSeconds(o.ExitAfterSeconds), Timeout.InfiniteTimeSpan);

            runtime.Start();
            try
            {
                if (replay) PlayIbt(o, runtime, record ? store : null, stop);
                else RunLive(o, runtime, store, stop);
            }
            finally
            {
                runtime.Stop();
                SaveSettings(settingsPath, runtime.Settings);
                Log.Info("[RaceCor.Host] stopped");
            }
            return 0;
        }

        // Live: tick on every SDK telemetry frame while connected; when iRacing isn't running, keep ticking at
        // ~60 Hz with an empty frame, as SimHub does, so idle and demo state stay current.
        private static void RunLive(HostOptions o, ProDriveRuntime runtime, ProDriveStore store, ManualResetEventSlim stop)
        {
            using var raw = new SdkRawTelemetry();
            var source = new IRacingTelemetrySource(raw);
            var recorder = store != null && !o.NoRecord
                ? new LiveRecorder(store, "live", _ => DateTime.UtcNow, m => Log.Info("[RaceCor.Host] " + m))
                : null;
            var gate = new object();

            raw.TelemetryData += () =>
            {
                lock (gate)
                {
                    source.Update();
                    runtime.Tick(source);
                    recorder?.Feed(raw);
                }
            };
            raw.Connected += () => Log.Info("[RaceCor.Host] iRacing connected");
            raw.Disconnected += () =>
            {
                Log.Info("[RaceCor.Host] iRacing disconnected");
                lock (gate) recorder?.Flush();
            };
            raw.Start();
            Log.Info("[RaceCor.Host] waiting for iRacing (Ctrl+C to stop)");

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
            lock (gate) recorder?.Flush();
        }

        // Its own connection: SQLite serialises writers, and ingest must never stall the telemetry thread for long.
        private static void BackgroundIngest(HostOptions o, ManualResetEventSlim stop)
        {
            using var cts = new CancellationTokenSource();
            using var reg = new Timer(_ => { if (stop.IsSet) cts.Cancel(); }, null, 500, 500);
            try
            {
                using var store = new ProDriveStore(o.Db ?? ProDriveStore.DefaultPath);
                var summary = new IbtIngest(store, m => Log.Info("[RaceCor.Host] ingest: " + m))
                    .Run(o.TelemetryDir ?? IbtIngest.DefaultTelemetryDirectory, o.Step, int.MaxValue, cts.Token, pause: BackgroundIo.SimRunning);
                if (summary.FilesIngested > 0 || summary.FilesFailed > 0)
                    Log.Info($"[RaceCor.Host] ingest: {summary.FilesIngested} new files, {summary.Sessions} sessions, {summary.FilesFailed} unreadable, {summary.Elapsed.TotalSeconds:F0}s");
            }
            catch (Exception ex)
            {
                Log.Warn("[RaceCor.Host] background ingest stopped: " + ex.Message);
            }
        }

        private static void PlayIbt(HostOptions o, ProDriveRuntime runtime, ProDriveStore store, ManualResetEventSlim stop)
        {
            using var file = new IbtFile(o.IbtPath);
            var raw = new IbtRawTelemetry(file);
            var source = new IRacingTelemetrySource(raw);
            var recorder = store != null
                ? new LiveRecorder(store, "replay", t => IbtIngest.SessionClock(file, t), m => Log.Info("[RaceCor.Host] " + m))
                : null;
            var wi = file.SessionInfo?.WeekendInfo;
            Log.Info($"[RaceCor.Host] replaying {Path.GetFileName(file.Path)} — {wi?.TrackDisplayName} {wi?.TrackConfigName}, " +
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
                        Log.Info($"[RaceCor.Host] t={i / (double)file.TickRate:F0}s frame {i}/{file.RecordCount}");
                }
                recorder?.Flush();
                start = 0;
            } while (o.Loop && !stop.IsSet);

            if (!o.Loop && !stop.IsSet)
            {
                Log.Info("[RaceCor.Host] end of file — holding last frame (Ctrl+C to stop)");
                stop.Wait();
            }
        }

        private static int Ingest(HostOptions o)
        {
            string dir = o.TelemetryDir ?? IbtIngest.DefaultTelemetryDirectory;
            using var store = new ProDriveStore(o.Db ?? ProDriveStore.DefaultPath);
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
            using var store = new ProDriveStore(o.Db ?? ProDriveStore.DefaultPath);
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
                Log.Warn($"[RaceCor.Host] settings unreadable ({ex.Message}) — using defaults");
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
                Log.Warn($"[RaceCor.Host] settings not saved: {ex.Message}");
            }
        }
    }

    internal sealed class HostOptions
    {
        public string Command;
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
        public string DataDir;
        public double ExitAfterSeconds;
        public string Db;
        public string TelemetryDir;
        public int? Limit;
        public int Step = 3;
        public string Type;
        public bool Force;
        public bool Now;
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
                if (o.Command != "ingest" && o.Command != "sessions") throw new ArgumentException($"unknown command {o.Command}");
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
                    case "--data-dir": o.DataDir = Next(); break;
                    case "--exit-after": o.ExitAfterSeconds = Num(); break;
                    case "--db": o.Db = Next(); break;
                    case "--dir": o.TelemetryDir = Next(); break;
                    case "--limit": o.Limit = (int)Num(); break;
                    case "--step": o.Step = Math.Max(1, (int)Num()); break;
                    case "--type": o.Type = Next(); break;
                    case "--force": o.Force = true; break;
                    case "--now": o.Now = true; break;
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
