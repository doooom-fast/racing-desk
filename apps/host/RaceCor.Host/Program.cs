using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Threading;
using Newtonsoft.Json;
using RaceCorProDrive.Plugin;
using RaceCorProDrive.Plugin.IRacing;

namespace RaceCor.Host
{
    internal static class Program
    {
        private const string Usage = @"RaceCor.Host — Pro Drive without SimHub

  RaceCor.Host                         follow live iRacing, serve :8889 / :8890
  RaceCor.Host --ibt <file>            replay a recorded .ibt through the same pipeline

Options:
  --http-port <n>      JSON contract port (default 8889)
  --ws-port <n>        WebSocket port (default 8890)
  --speed <x>          .ibt playback speed (default 1)
  --seek <seconds>     .ibt start offset
  --loop               restart the .ibt at the end
  --exit-after <s>     stop after this many seconds (for scripted checks)
  --no-hardware        don't open Moza serial, pedal profiles or screen sampling
                       (always off in --ibt mode)
  --data-dir <dir>     settings + pedal data (default %LOCALAPPDATA%\RaceCor)";

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
            });

            using var stop = new ManualResetEventSlim();
            Console.CancelKeyPress += (_, e) => { e.Cancel = true; stop.Set(); };
            if (o.ExitAfterSeconds > 0)
                new Timer(_ => stop.Set(), null, TimeSpan.FromSeconds(o.ExitAfterSeconds), Timeout.InfiniteTimeSpan);

            runtime.Start();
            try
            {
                if (replay) PlayIbt(o, runtime, stop);
                else RunLive(runtime, stop);
            }
            finally
            {
                runtime.Stop();
                SaveSettings(settingsPath, runtime.Settings);
                Log.Info("[RaceCor.Host] stopped");
            }
            return 0;
        }

        // Live: tick on every SDK telemetry frame while connected; when iRacing isn't running, keep ticking
        // at ~60 Hz with an empty frame, as SimHub does, so idle and demo state stay current.
        private static void RunLive(ProDriveRuntime runtime, ManualResetEventSlim stop)
        {
            using var raw = new SdkRawTelemetry();
            var source = new IRacingTelemetrySource(raw);
            var gate = new object();

            raw.TelemetryData += () =>
            {
                lock (gate) { source.Update(); runtime.Tick(source); }
            };
            raw.Connected += () => Log.Info("[RaceCor.Host] iRacing connected");
            raw.Disconnected += () => Log.Info("[RaceCor.Host] iRacing disconnected");
            raw.Start();
            Log.Info("[RaceCor.Host] waiting for iRacing (Ctrl+C to stop)");

            while (!stop.Wait(16))
            {
                if (raw.IsConnected) continue;
                lock (gate) { runtime.Tick(source); }
            }
            raw.Stop();
        }

        private static void PlayIbt(HostOptions o, ProDriveRuntime runtime, ManualResetEventSlim stop)
        {
            using var file = new IbtFile(o.IbtPath);
            var raw = new IbtRawTelemetry(file);
            var source = new IRacingTelemetrySource(raw);
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

                    double due = (i - start + 1) * frameMs - clock.Elapsed.TotalMilliseconds;
                    if (due > 1 && stop.Wait(TimeSpan.FromMilliseconds(due))) break;
                    if ((i - start) % (file.TickRate * 30) == 0)
                        Log.Info($"[RaceCor.Host] t={i / (double)file.TickRate:F0}s frame {i}/{file.RecordCount}");
                }
                start = 0;
            } while (o.Loop && !stop.IsSet);

            if (!o.Loop && !stop.IsSet)
            {
                Log.Info("[RaceCor.Host] end of file — holding last frame (Ctrl+C to stop)");
                stop.Wait();
            }
        }

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
        public string IbtPath;
        public double Speed = 1;
        public double SeekSeconds;
        public bool Loop;
        public int HttpPort = 8889;
        public int WsPort = 8890;
        public bool NoHardware;
        public string DataDir;
        public double ExitAfterSeconds;
        public bool Help;

        public static HostOptions Parse(string[] args)
        {
            var o = new HostOptions();
            for (int i = 0; i < args.Length; i++)
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
                    case "--http-port": o.HttpPort = (int)Num(); break;
                    case "--ws-port": o.WsPort = (int)Num(); break;
                    case "--no-hardware": o.NoHardware = true; break;
                    case "--data-dir": o.DataDir = Next(); break;
                    case "--exit-after": o.ExitAfterSeconds = Num(); break;
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
