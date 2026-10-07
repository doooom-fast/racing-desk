using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using RacingDesk.Data.Restore;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Data.Audio
{
    /// <summary>
    /// The sound bar's switch as the host keeps it (soundbar.json beside restore.json): on unless he turns it off, which playback
    /// device is the sound bar (none chosen means the one whose name has SineAudio in it), and what Racing Desk did last, and when.
    /// </summary>
    public sealed class SoundBarSettings
    {
        /// <summary>"Turn iRacing's LFE off on the sound bar": on by default.</summary>
        public bool Enabled { get; set; } = true;

        /// <summary>The device he chose from the list; null or empty means the one named for <see cref="SoundBarLfe.DefaultDeviceName"/>.</summary>
        public string DeviceId { get; set; }
        public string DeviceName { get; set; }

        /// <summary>What Racing Desk did last to iRacing's LFE settings, in a sentence, and when; null before it did anything.</summary>
        public string LastText { get; set; }
        public DateTime? LastAtUtc { get; set; }

        public SoundBarSettings Copy() => (SoundBarSettings)MemberwiseClone();

        public static SoundBarSettings Load(string path)
        {
            try
            {
                if (path != null && File.Exists(path)) return JsonSerializer.Deserialize<SoundBarSettings>(File.ReadAllText(path)) ?? new SoundBarSettings();
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is JsonException) { }
            return new SoundBarSettings();
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

    /// <summary>What the desk shows of the sound bar's switch.</summary>
    public sealed class SoundBarView
    {
        public bool Enabled { get; set; }

        /// <summary>The device taken for the sound bar; null when none is chosen and none has SineAudio in its name.</summary>
        public AudioDevice Device { get; set; }

        /// <summary>Whether Windows lists the chosen device now (a Bluetooth sound bar that is away is not listed).</summary>
        public bool Connected { get; set; }

        public IReadOnlyList<AudioDevice> Devices { get; set; } = new List<AudioDevice>();

        /// <summary>The sound bar is the default playback device at this moment.</summary>
        public bool OnSoundBar { get; set; }

        /// <summary>"working" (the LFE is off for the sound bar), "waiting" (for iRacing to close), "problem", "idle".</summary>
        public string State { get; set; } = "idle";

        /// <summary>What it did last, in a sentence with no time; null before it did anything.</summary>
        public string Last { get; set; }
        public DateTime? LastAtUtc { get; set; }

        /// <summary>What it waits for, or what went wrong: a sentence; null when neither.</summary>
        public string Waiting { get; set; }
        public string Problem { get; set; }
    }

    /// <summary>One value of app.ini that carries iRacing's LFE: a section and a key.</summary>
    public sealed class SoundBarKey
    {
        public SoundBarKey(string section, string key) { Section = section; Key = key; }
        public string Section { get; }
        public string Key { get; }
        public string Setting => Section + "." + Key;
    }

    /// <summary>
    /// iRacing's LFE off while the sound bar is the default playback device, and back as it was for anything else.
    ///
    /// The default playback device is watched through Windows' own change call (<see cref="IAudioDevices.Changed"/>), not on a
    /// timer. When the sound bar becomes the default, the two values of app.ini that send iRacing's sound to an LFE channel are
    /// set to 0 — <c>[Audio] xa2_mixToLFE</c> (the game's sound mixed into the LFE channel in addition to the normal ones) and
    /// <c>[BassShaker] LFEEnabled</c> (the bass shaker effect on its LFE device) — and what they held is kept in the store first.
    /// When anything else becomes the default, or the switch is turned off, or the host starts with another device, the values
    /// Racing Desk changed are put back. The rest of the LFE keys are left alone: <c>devLFEAPI</c>, <c>devLFEId</c> and
    /// <c>devLFEName</c> choose which device the bass shaker plays to, <c>loudnessLFE</c>, <c>enableLFEBKAmpCut</c>,
    /// <c>enableGameEffects</c> and <c>enablePysEffects</c> only shape an effect that <c>LFEEnabled</c> already stops, and the
    /// iRacing choices they hold are not Racing Desk's to change.
    ///
    /// The file is written only through <see cref="ViewFiles.ApplyIniText"/>: with both of the sim's processes closed, after a copy
    /// aside, one value at a time in the line's own form, and read back. If the sim runs, the change waits until it has closed. A
    /// value he changed himself since Racing Desk set it is his: it is left, and what is kept for it becomes his value.
    /// </summary>
    public sealed class SoundBarLfe : IDisposable
    {
        /// <summary>The name that picks the sound bar when he has chosen no device.</summary>
        public const string DefaultDeviceName = "SineAudio";

        public static readonly SoundBarKey[] Keys =
        {
            new SoundBarKey("Audio", "xa2_mixToLFE"),
            new SoundBarKey("BassShaker", "LFEEnabled"),
        };

        public const string TurnedOff = "Turned iRacing's LFE off for the sound bar.";
        public const string PutBack = "Put iRacing's LFE back as it was.";
        public const string LeftAlone = "Left iRacing's LFE as you set it.";

        private readonly IAudioDevices _devices;
        private readonly ViewFiles _files;
        private readonly IRigProbe _probe;
        private readonly string _storePath, _settingsFile;
        private readonly Action<string> _log;
        private readonly Func<DateTime> _now;
        private readonly object _gate = new object();       // the settings and the state said to the desk
        private readonly object _run = new object();        // one pass at a time
        private SoundBarSettings _settings;
        private Task _work = Task.CompletedTask;
        private int _queued;
        private string _waiting, _problem;
        private Timer _simWatch;
        private bool _started, _disposed;

        /// <summary>How often a change that waits for iRacing to close looks again (the sim's two processes; nothing else is looked at).</summary>
        public TimeSpan SimWatchEvery { get; set; } = TimeSpan.FromSeconds(5);

        /// <param name="settingsFile">soundbar.json; null keeps the settings in memory (a test's).</param>
        public SoundBarLfe(IAudioDevices devices, ViewFiles files, IRigProbe probe, string storePath, string settingsFile, Action<string> log = null, Func<DateTime> now = null)
        {
            _devices = devices ?? throw new ArgumentNullException(nameof(devices));
            _files = files ?? throw new ArgumentNullException(nameof(files));
            _probe = probe ?? throw new ArgumentNullException(nameof(probe));
            _storePath = storePath ?? throw new ArgumentNullException(nameof(storePath));
            _settingsFile = settingsFile;
            _log = log ?? (_ => { });
            _now = now ?? (() => DateTime.UtcNow);
            _settings = SoundBarSettings.Load(settingsFile);
            _simWatch = new Timer(_ => Reconcile(), null, Timeout.Infinite, Timeout.Infinite);
        }

        // ── Starting, and the queue ──

        /// <summary>
        /// Listens for the default device changing, and looks once now (the host's start). <paramref name="after"/> is work the host
        /// queued first (a write of the view files that a stop cut short is put back by it): the first look waits for it, for a while.
        /// </summary>
        public void Start(Task after = null)
        {
            lock (_gate)
            {
                if (_started || _disposed) return;
                _started = true;
            }
            _devices.Changed += OnChanged;
            Queue(() =>
            {
                if (after != null) { try { after.Wait(TimeSpan.FromSeconds(20)); } catch (AggregateException) { } }
                ReconcileNow();
            });
        }

        private void OnChanged() => Reconcile();

        /// <summary>Waits for what has been queued so far (tests, and the host's stop).</summary>
        public Task Settled()
        {
            lock (_gate) return _work;
        }

        private void Queue(Action work)
        {
            lock (_gate)
            {
                if (_disposed) return;
                _work = _work.ContinueWith(_ =>
                {
                    try { work(); }
                    catch (Exception ex) { _log("soundbar: " + ex.GetType().Name + " — " + ex.Message.Trim()); }
                }, TaskScheduler.Default);
            }
        }

        /// <summary>A look at the default device and app.ini, on the worker; asking again while one is waiting asks once.</summary>
        public void Reconcile()
        {
            if (Interlocked.Exchange(ref _queued, 1) == 1) return;
            Queue(() =>
            {
                Interlocked.Exchange(ref _queued, 0);
                ReconcileNow();
            });
        }

        /// <summary>The sim has stopped sending: a change that waited for it to close is looked at again.</summary>
        public void SimGone() => Reconcile();

        public void Dispose()
        {
            lock (_gate)
            {
                if (_disposed) return;
                _disposed = true;
            }
            _devices.Changed -= OnChanged;
            _simWatch.Dispose();
            // The service owns what it was given: Windows' call to it is let go with it.
            try { _devices.Dispose(); } catch (Exception ex) { _log("soundbar: Windows' audio was not let go cleanly — " + ex.Message.Trim()); }
        }

        // ── The switch and the device ──

        public SoundBarSettings Settings
        {
            get { lock (_gate) return _settings.Copy(); }
        }

        public void SetEnabled(bool on)
        {
            lock (_gate)
            {
                if (_settings.Enabled == on) return;
                _settings.Enabled = on;
                _settings.Save(_settingsFile);
            }
            Reconcile();
        }

        /// <summary>
        /// Chooses the playback device that is the sound bar, by its id from the list; an empty id goes back to the one with SineAudio
        /// in its name. False for an id Windows does not list now.
        /// </summary>
        public bool SetDevice(string id)
        {
            string name = null;
            if (!string.IsNullOrWhiteSpace(id))
            {
                AudioDevice found;
                try { found = _devices.Active().FirstOrDefault(d => string.Equals(d.Id, id.Trim(), StringComparison.OrdinalIgnoreCase)); }
                catch (Exception) { return false; }
                if (found == null) return false;
                id = found.Id;
                name = found.Name;
            }
            else id = null;
            lock (_gate)
            {
                _settings.DeviceId = id;
                _settings.DeviceName = name;
                _settings.Save(_settingsFile);
            }
            Reconcile();
            return true;
        }

        /// <summary>The sound bar is this device by what he has set: its id or name, or SineAudio in the name when he chose none.</summary>
        internal static bool Matches(AudioDevice device, SoundBarSettings s)
        {
            if (device == null) return false;
            if (!string.IsNullOrWhiteSpace(s.DeviceId))
                return string.Equals(device.Id, s.DeviceId, StringComparison.OrdinalIgnoreCase)
                    || (!string.IsNullOrWhiteSpace(s.DeviceName) && string.Equals(device.Name, s.DeviceName, StringComparison.OrdinalIgnoreCase));
            return device.Name != null && device.Name.IndexOf(DefaultDeviceName, StringComparison.OrdinalIgnoreCase) >= 0;
        }

        /// <summary>For the desk: the switch, the list, the device taken for the sound bar, and how it stands.</summary>
        public SoundBarView View()
        {
            var s = Settings;
            var view = new SoundBarView { Enabled = s.Enabled, Last = s.LastText, LastAtUtc = s.LastAtUtc };
            lock (_gate)
            {
                view.Waiting = _waiting;
                view.Problem = _problem;
            }
            IReadOnlyList<AudioDevice> active;
            AudioDevice current;
            try
            {
                active = _devices.Active();
                current = _devices.Default();
            }
            catch (Exception ex)
            {
                _log("soundbar: the devices could not be listed — " + ex.Message.Trim());
                view.Problem = view.Problem ?? "Windows didn't list the playback devices.";
                view.State = "problem";
                return view;
            }
            view.Devices = active;
            if (!string.IsNullOrWhiteSpace(s.DeviceId))
            {
                var found = active.FirstOrDefault(d => Matches(d, s));
                view.Device = found ?? new AudioDevice(s.DeviceId, string.IsNullOrWhiteSpace(s.DeviceName) ? s.DeviceId : s.DeviceName);
                view.Connected = found != null;
            }
            else
            {
                view.Device = active.FirstOrDefault(d => Matches(d, s));
                view.Connected = view.Device != null;
            }
            view.OnSoundBar = Matches(current, s);
            bool off = Kept().Any(k => k.WrittenOk);
            view.State = view.Problem != null ? "problem" : view.Waiting != null ? "waiting" : off ? "working" : "idle";
            return view;
        }

        // ── The pass ──

        private IReadOnlyList<SoundBarKeep> Kept()
        {
            try
            {
                if (!File.Exists(_storePath)) return new List<SoundBarKeep>();
                using var store = new RacingDeskStore(_storePath);
                return store.SoundBarKeeps();
            }
            catch (Exception ex) when (ex is Microsoft.Data.Sqlite.SqliteException || ex is IOException)
            {
                return new List<SoundBarKeep>();
            }
        }

        private sealed class Op
        {
            public SoundBarKey Key;
            public string Cur;

            /// <summary>The value to write; null when nothing is to be written for this one.</summary>
            public string WriteTo;

            /// <summary>Kept before the write (or at once, when nothing is written); null keeps nothing new.</summary>
            public SoundBarKeep KeepFirst;

            /// <summary>After the write has read back: the row is let go, or marked as written.</summary>
            public bool ForgetAfter, MarkWritten;
            public string Said;
        }

        /// <summary>One look at the default device and app.ini, and what follows from it. On the caller's thread; one at a time.</summary>
        public void ReconcileNow()
        {
            lock (_run)
            {
                if (_disposed) return;
                try { Pass(); }
                catch (Exception ex)
                {
                    _log("soundbar: " + ex.GetType().Name + " — " + ex.Message.Trim());
                    Say(problem: "Something went wrong, and nothing more was changed; it's in host.log.");
                }
            }
        }

        private void Say(string problem = null, string waiting = null)
        {
            lock (_gate)
            {
                _problem = problem;
                _waiting = waiting;
            }
            try
            {
                if (waiting == null) _simWatch.Change(Timeout.Infinite, Timeout.Infinite);
                else _simWatch.Change(SimWatchEvery, Timeout.InfiniteTimeSpan);
            }
            catch (ObjectDisposedException) { /* stopped meanwhile */ }
        }

        private void Pass()
        {
            var s = Settings;
            AudioDevice current;
            try { current = _devices.Default(); }
            catch (Exception ex)
            {
                _log("soundbar: the default device could not be asked — " + ex.Message.Trim());
                Say(problem: "Windows didn't say which speakers are the default, so nothing was changed.");
                return;
            }
            // No default playback device at all: nothing is known of where the sound goes, so nothing is changed.
            if (current == null) { Say(); return; }

            bool want = s.Enabled && Matches(current, s);
            var keeps = Kept();
            byte[] file = _files.ReadAppIni();
            if (file == null)
            {
                // Nothing to switch, or nothing to put back into: said only when there was something to do.
                if (want || keeps.Count > 0) Say(problem: "iRacing's app.ini wasn't found, so nothing was changed.");
                else Say();
                return;
            }

            var ops = new List<Op>();
            foreach (var key in Keys)
            {
                var keep = keeps.FirstOrDefault(k => string.Equals(k.Setting, key.Setting, StringComparison.OrdinalIgnoreCase));
                if (!AppIniEditor.TryReadText(file, key.Section, key.Key, out string cur))
                {
                    // Not in the file once: nothing to switch. A kept value with no line to put back into is let go.
                    if (keep != null && !want) ops.Add(new Op { Key = key, ForgetAfter = true });
                    continue;
                }
                var op = want ? Switch(key, cur, keep) : Put(key, cur, keep);
                if (op != null) ops.Add(op);
            }

            if (ops.Count == 0) { Say(); return; }

            // Anything to do waits for the sim: its two processes are asked, and the sim writes app.ini itself when it closes.
            if (_probe.SimRunning())
            {
                string waits = want ? "Waiting for iRacing to close, to turn its LFE off for the sound bar." : "Waiting for iRacing to close, to put its LFE back.";
                Say(waiting: waits);
                return;
            }

            // His values are kept in the store first. A store that will not take them means nothing is written.
            try
            {
                using var store = new RacingDeskStore(_storePath);
                foreach (var op in ops.Where(o => o.KeepFirst != null))
                    if (!store.SaveSoundBarKeep(op.KeepFirst)) throw new IOException("the row was not kept");
                foreach (var op in ops.Where(o => o.KeepFirst == null && o.WriteTo == null && o.ForgetAfter))
                    store.ForgetSoundBarKeep(op.Key.Setting);
            }
            catch (Exception ex) when (ex is Microsoft.Data.Sqlite.SqliteException || ex is IOException || ex is InvalidOperationException)
            {
                _log("soundbar: what app.ini holds could not be kept first — " + ex.Message.Trim());
                Say(problem: "What iRacing's LFE was set to couldn't be kept first, so nothing was changed.");
                return;
            }

            var changes = ops.Where(o => o.WriteTo != null).Select(o => new IniTextChange { Section = o.Key.Section, Key = o.Key.Key, Text = o.WriteTo, Expect = o.Cur }).ToList();
            if (changes.Count > 0)
            {
                var wrote = _files.ApplyIniText(changes);
                if (!wrote.Ok)
                {
                    _log("soundbar: app.ini was not written — " + wrote.Why);
                    Say(problem: "iRacing's LFE couldn't be changed: " + wrote.Why + ".");
                    return;
                }
                foreach (string did in wrote.Did) _log("soundbar: " + did);
            }

            try
            {
                using var store = new RacingDeskStore(_storePath);
                foreach (var op in ops.Where(o => o.WriteTo != null))
                {
                    if (op.ForgetAfter) store.ForgetSoundBarKeep(op.Key.Setting);
                    else if (op.MarkWritten && op.KeepFirst != null) { op.KeepFirst.WrittenOk = true; store.SaveSoundBarKeep(op.KeepFirst); }
                }
            }
            catch (Exception ex) when (ex is Microsoft.Data.Sqlite.SqliteException || ex is IOException || ex is InvalidOperationException)
            {
                _log("soundbar: the store was not updated after the write — " + ex.Message.Trim());
            }

            string said = ops.Select(o => o.Said).FirstOrDefault(t => t == TurnedOff) ?? ops.Select(o => o.Said).FirstOrDefault(t => t == PutBack) ?? ops.Select(o => o.Said).FirstOrDefault(t => t != null);
            Say();
            if (said != null)
            {
                lock (_gate)
                {
                    _settings.LastText = said;
                    _settings.LastAtUtc = _now();
                    _settings.Save(_settingsFile);
                }
                _log("soundbar: " + said);
            }
        }

        /// <summary>The sound bar is the default: this value goes to 0, and what it held is kept first.</summary>
        private Op Switch(SoundBarKey key, string cur, SoundBarKeep keep)
        {
            string off = Off(cur);
            if (off == null) return null;       // not a number the sim writes for a switch: not ours to change
            if (keep != null && keep.WrittenOk && !Same(cur, keep.Written))
            {
                // He changed it since Racing Desk set it: his value stands, and is the one kept to put back.
                if (Same(cur, keep.Original)) return null;
                keep.Original = cur;
                keep.AtUtc = _now();
                return new Op { Key = key, Cur = cur, KeepFirst = keep, Said = LeftAlone };
            }
            if (keep != null && keep.WrittenOk) return null;        // set already, and still as set
            if (Same(cur, off))
            {
                // Off already. A row that was meant to write it is let go if the file never held anything else; kept as it is if Racing Desk did.
                if (keep == null) return null;
                keep.WrittenOk = true;
                keep.Written = cur;
                return new Op { Key = key, Cur = cur, KeepFirst = keep };
            }
            var row = new SoundBarKeep { Setting = key.Setting, Original = cur, Written = off, WrittenOk = false, AtUtc = _now() };
            return new Op { Key = key, Cur = cur, WriteTo = off, KeepFirst = row, MarkWritten = true, Said = TurnedOff };
        }

        /// <summary>Anything else is the default (or the switch is off): what Racing Desk changed is put back, unless it is his now.</summary>
        private Op Put(SoundBarKey key, string cur, SoundBarKeep keep)
        {
            if (keep == null) return null;
            if (Same(cur, keep.Original)) return new Op { Key = key, Cur = cur, ForgetAfter = true };         // as it was already
            if (Same(cur, keep.Written))
                return new Op { Key = key, Cur = cur, WriteTo = keep.Original, ForgetAfter = true, Said = PutBack };
            // Changed by him since (or never written, and something else holds it): it is his, and nothing is put back over it.
            return new Op { Key = key, Cur = cur, ForgetAfter = true, Said = keep.WrittenOk ? LeftAlone : null };
        }

        // ── Values ──

        /// <summary>A switch's off in the spelling the file has: 0, or 0.000000 where the sim wrote decimals; null for anything that is not a number.</summary>
        internal static string Off(string cur)
        {
            if (!double.TryParse(cur, NumberStyles.Float, CultureInfo.InvariantCulture, out double v) || double.IsNaN(v) || double.IsInfinity(v)) return null;
            int dot = cur.IndexOf('.');
            return dot < 0 ? "0" : "0." + new string('0', cur.Length - dot - 1);
        }

        /// <summary>Two spellings of one value: the same number, or the same word.</summary>
        internal static bool Same(string a, string b)
        {
            if (a == null || b == null) return a == b;
            if (double.TryParse(a, NumberStyles.Float, CultureInfo.InvariantCulture, out double x) && double.TryParse(b, NumberStyles.Float, CultureInfo.InvariantCulture, out double y))
                return Math.Abs(x - y) < 1e-9;
            return string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);
        }
    }
}
