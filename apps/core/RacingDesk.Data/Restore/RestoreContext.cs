using System;
using System.IO;
using System.Text.Json;
using RacingDesk.Data.Pedals;

namespace RacingDesk.Data.Restore
{
    /// <summary>The three switches of Settings → Cars, as the host keeps them (restore.json beside its settings).</summary>
    public sealed class RestoreSwitches
    {
        /// <summary>"Put back each car's driver height": on, in trial.</summary>
        public bool Height { get; set; } = true;

        /// <summary>"A brake profile for each car": on, in trial.</summary>
        public bool Brakes { get; set; } = true;

        /// <summary>The horizon kept per car as well: off, until the first run shows the cockpit's vertical shift adds to it.</summary>
        public bool Horizon { get; set; }

        public RestoreSwitches Copy() => new RestoreSwitches { Height = Height, Brakes = Brakes, Horizon = Horizon };

        public static RestoreSwitches Load(string path)
        {
            try
            {
                if (path != null && File.Exists(path)) return JsonSerializer.Deserialize<RestoreSwitches>(File.ReadAllText(path)) ?? new RestoreSwitches();
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is JsonException) { }
            return new RestoreSwitches();
        }

        public bool Save(string path)
        {
            if (path == null) return false;
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                string temp = path + ".tmp";
                File.WriteAllText(temp, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
                File.Move(temp, path, overwrite: true);
                return true;
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                return false;
            }
        }
    }

    /// <summary>What the director, the first run and undo all work with: the store, the files, SmartControl, the machine.</summary>
    public sealed class RestoreContext
    {
        /// <summary>The store (racing-desk.db); each use opens its own connection, as the host's other writers do.</summary>
        public string StorePath { get; set; }

        /// <summary>iRacing's view files.</summary>
        public ViewFiles Files { get; set; }

        /// <summary>SmartControl's database; null for where SmartControl keeps it.</summary>
        public string SmartControlDb { get; set; }

        /// <summary>Where copies go: <c>%LOCALAPPDATA%\Racing Desk\backups</c> (with <c>view\</c> and <c>smartcontrol\</c> under it).</summary>
        public string Backups { get; set; }

        public IRigProbe Probe { get; set; }
        public IKeySender Keys { get; set; }

        /// <summary>The force the pedals recorder follows from Live's keys, and how many it has seen pressed in this run.</summary>
        public Func<BrakeForceNow> Force { get; set; } = () => null;
        public Func<int> PressesThisRun { get; set; } = () => 0;

        /// <summary>The telemetry's last word on where he is (for B2's flags).</summary>
        public Func<SeatFacts> LastFacts { get; set; } = () => null;

        public Func<RestoreSwitches> Switches { get; set; } = () => new RestoreSwitches();

        public Action<string> Log { get; set; } = _ => { };
        public Func<DateTime> Now { get; set; } = () => DateTime.UtcNow;

        /// <summary>How long after his click a key is sent: time to put Notepad (A4–A6) or iRacing (B2) in front.</summary>
        public TimeSpan SendDelay { get; set; } = TimeSpan.FromSeconds(5);
        public Action<TimeSpan> Sleep { get; set; } = d => System.Threading.Thread.Sleep(d);

        public double StartHeight { get; set; } = RestorePolicy.StartHeight;

        public SmartControlWriter Writer => new SmartControlWriter(SmartControlDb);

        public SmartControlSnapshot ReadSmartControl()
        {
            try { return SmartControl.Read(SmartControlDb); }
            catch (Exception ex) { Log("restore: SmartControl could not be read — " + ex.Message.Trim()); return null; }
        }

        public RacingDeskStore OpenStore() => new RacingDeskStore(StorePath);

        public string SmartControlBackups => Path.Combine(Backups, "smartcontrol");

        /// <summary>The copy of SmartControl's database taken before Racing Desk first wrote it, kept for ever.</summary>
        public string BeforeRacingDesk => Path.Combine(SmartControlBackups, "before-racing-desk.db");

        /// <summary>Writes a line of what was done to the store (the desk, the HUD) and to host.log.</summary>
        public RestoreEvent Say(string car, string what, string state, string text, bool hud = false)
        {
            var e = new RestoreEvent { AtUtc = Now(), CarPath = car, What = what, State = state, Text = text, Hud = hud };
            Log("restore: " + (car != null ? car + " — " : "") + text);
            try
            {
                using var store = OpenStore();
                store.AddRestoreEvent(e);
            }
            catch (Exception ex) when (ex is Microsoft.Data.Sqlite.SqliteException || ex is IOException || ex is InvalidOperationException)
            {
                Log("restore: the line was not kept — " + ex.Message.Trim());
            }
            return e;
        }
    }
}
