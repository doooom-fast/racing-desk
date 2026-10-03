using System;
using System.IO;
using System.Text.Json;
using RacingDesk.Data.Pedals;

namespace RacingDesk.Data.Restore
{
    /// <summary>
    /// The two switches of Settings → Cars, as the host keeps them (restore.json beside its settings), and what a part that
    /// turned itself off said of why. The host's file is the only place they are kept: the desk asks the host for them.
    /// </summary>
    public sealed class RestoreSwitches
    {
        /// <summary>"Brakes put back for each car": on unless he turns it off, or it turns itself off (<see cref="BrakesOffWhy"/>).</summary>
        public bool Brakes { get; set; } = true;

        /// <summary>"Seat height put back for each car": on unless he turns it off, or the self-check does (<see cref="HeightOffWhy"/>).</summary>
        public bool Height { get; set; } = true;

        /// <summary>Why a part turned itself off, in a sentence; null when he turned it off, or it is on.</summary>
        public string BrakesOffWhy { get; set; }
        public string HeightOffWhy { get; set; }
        public DateTime? BrakesOffAtUtc { get; set; }
        public DateTime? HeightOffAtUtc { get; set; }

        /// <summary>
        /// When he last turned the height part on: a write of app.ini Racing Desk made before then is not what the self-check holds
        /// app.ini to (he turned it back on, and it gets a fresh start).
        /// </summary>
        public DateTime? HeightOnSinceUtc { get; set; }

        /// <summary>The self-check turned the height part off with iRacing running: each car's camera file is put back once it closes.</summary>
        public bool HeightPutBackOwed { get; set; }

        public RestoreSwitches Copy() => (RestoreSwitches)MemberwiseClone();

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

    /// <summary>What the director and undo work with: the store, the files, SmartControl, the machine.</summary>
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

        /// <summary>
        /// iRacing's telemetry folder (one .ibt file per session): looked at for names and times alone, never opened. Null: not known,
        /// and <see cref="SessionSince"/> finds none.
        /// </summary>
        public string TelemetryDir { get; set; }

        public IRigProbe Probe { get; set; }
        public IKeySender Keys { get; set; }

        /// <summary>How many of Live's force keys he has pressed in the car being followed: his key wins over a switch not yet made.</summary>
        public Func<int> PressesThisRun { get; set; } = () => 0;

        /// <summary>
        /// Whether he is parked now, by the parked rule on the newest frame (the director keeps it up to date on every frame); null
        /// before a frame, and after the sim has gone. Asked right before a key is sent, on facts that are fresh.
        /// </summary>
        public Func<ParkedNow> Parked { get; set; } = () => null;

        /// <summary>
        /// Told when F24 has put a car's brakes on the pedals: the force his keys are followed from is the car's now, so that his
        /// +5 and -5 count from it (his decision, docs/view-and-pedals-plan.md D6). The car's folder, and the force.
        /// </summary>
        public Action<string, double> ForceIs { get; set; } = (_, _) => { };

        public Action<string> Log { get; set; } = _ => { };
        public Func<DateTime> Now { get; set; } = () => DateTime.UtcNow;

        public double StartHeight { get; set; } = RestorePolicy.StartHeight;

        public SmartControlWriter Writer => new SmartControlWriter(SmartControlDb);

        /// <summary>A test's own stand-in for the copy before a write; null takes the real one (<see cref="BackUpBeforeWrite"/>).</summary>
        public Func<string, string> BackUpSmartControl { get; set; }

        /// <summary>
        /// Takes SmartControl's database aside before Racing Desk writes it, to a timestamped file in Racing Desk's own backup
        /// folder (SQLite's online backup, checked to open and to hold what the database holds; the last
        /// <see cref="RestorePolicy.BackupsKept"/> are kept). The first copy ever is also kept for good, as
        /// <c>before-racing-desk.db</c>. Null when the copy is made and has checked out; else why not, and nothing is written.
        /// </summary>
        public string BackUpBeforeWrite(string why)
        {
            if (BackUpSmartControl != null) return BackUpSmartControl(why);
            var writer = Writer;
            if (!File.Exists(BeforeRacingDesk))
            {
                string first = writer.Backup(BeforeRacingDesk);
                if (first != null) return first;
            }
            return writer.BackUpBeforeWrite(SmartControlBackups, why, Now(), RestorePolicy.BackupsKept);
        }

        public SmartControlSnapshot ReadSmartControl()
        {
            try { return SmartControl.Read(SmartControlDb); }
            catch (Exception ex) { Log("restore: SmartControl could not be read — " + ex.Message.Trim()); return null; }
        }

        public RacingDeskStore OpenStore() => new RacingDeskStore(StorePath);

        /// <summary>
        /// The newest session file in the telemetry folder that is newer than <paramref name="sinceUtc"/> (its name and time, the
        /// later of when it was made and when it was last written, as the folder lists them); null when there is none, or the
        /// folder cannot be listed. A session iRacing ran since a time left its file after it.
        /// </summary>
        public (string Name, DateTime AtUtc)? SessionSince(DateTime sinceUtc)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(TelemetryDir) || !Directory.Exists(TelemetryDir)) return null;
                (string, DateTime)? newest = null;
                foreach (var f in new DirectoryInfo(TelemetryDir).EnumerateFiles("*.ibt"))
                {
                    DateTime at = f.CreationTimeUtc > f.LastWriteTimeUtc ? f.CreationTimeUtc : f.LastWriteTimeUtc;
                    if (at > sinceUtc && (newest == null || at > newest.Value.Item2)) newest = (f.Name, at);
                }
                return newest;
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                return null;
            }
        }

        public string SmartControlBackups => Path.Combine(Backups, "smartcontrol");

        /// <summary>The copy of SmartControl's database taken before Racing Desk first wrote it, kept for ever.</summary>
        public string BeforeRacingDesk => Path.Combine(SmartControlBackups, "before-racing-desk.db");

        /// <summary>Writes a line of what was done to the store and to host.log.</summary>
        public RestoreEvent Say(string car, string what, string state, string text)
        {
            var e = new RestoreEvent { AtUtc = Now(), CarPath = car, What = what, State = state, Text = text };
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
