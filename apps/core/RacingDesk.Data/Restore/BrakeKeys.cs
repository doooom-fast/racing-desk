using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using RacingDesk.Data.Pedals;

namespace RacingDesk.Data.Restore
{
    /// <summary>One of his set-force keys as Racing Desk moved it: its row, what the row holds, and its first key before and after.</summary>
    public sealed class BrakeKeyRow
    {
        public long BindingId { get; set; }
        public long PresetId { get; set; }
        public int ActionType { get; set; } = 8;

        /// <summary>The force as the row stores it ("30").</summary>
        public string ActionValue { get; set; }

        /// <summary>The key itself ("F1"), which stays.</summary>
        public string SecondKey { get; set; }

        /// <summary>The first key as it was before Racing Desk moved it (<c>ZOOM</c>, Live's "none"): what undo puts back.</summary>
        public string Before { get; set; }

        /// <summary>The first key Racing Desk wrote (<c>RCONTROL</c>).</summary>
        public string After { get; set; }
    }

    /// <summary>
    /// What Racing Desk has done with his brake-force keys, kept in <c>brake-keys.json</c> beside <c>restore.json</c>: whether the
    /// one move has been made, the rows it changed and what each held, and when it last wrote them.
    /// </summary>
    public sealed class BrakeKeysRecord
    {
        public const string Moving = "moving", Moved = "moved", Undoing = "undoing", Undone = "undone";

        /// <summary>The move has been made once, or was found not to be needed or possible: it is never made again by itself.</summary>
        public bool Done { get; set; }

        /// <summary>
        /// Null (not moved), <see cref="Moved"/> or <see cref="Undone"/>. <see cref="Moving"/> and <see cref="Undoing"/> are written
        /// before the database is, and settled from what the database holds at the next look.
        /// </summary>
        public string State { get; set; }

        /// <summary>The rows Racing Desk moved, each with what it held: undo puts back exactly that.</summary>
        public List<BrakeKeyRow> Rows { get; set; } = new List<BrakeKeyRow>();

        public DateTime? MovedAtUtc { get; set; }
        public DateTime? UndoneAtUtc { get; set; }

        /// <summary>Racing Desk's last write of the keys (the move or its undo): a SmartControl Live started before it has the keys of before it.</summary>
        public DateTime? WrittenAtUtc { get; set; }

        /// <summary>Why the move was not made, a sentence for the desk; null when it was made, or is still to be.</summary>
        public string Note { get; set; }

        public BrakeKeysRecord Copy() => JsonSerializer.Deserialize<BrakeKeysRecord>(JsonSerializer.Serialize(this));

        public static BrakeKeysRecord Load(string path)
        {
            try
            {
                if (path != null && File.Exists(path)) return JsonSerializer.Deserialize<BrakeKeysRecord>(File.ReadAllText(path)) ?? new BrakeKeysRecord();
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is JsonException) { }
            return new BrakeKeysRecord();
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

    /// <summary>How his brake-force keys stand, for Settings → Cars.</summary>
    public sealed class BrakeKeysStatus
    {
        /// <summary>moved, undone, left (not moved, and not to be by itself), waiting (to be moved), unknown (SmartControl not read).</summary>
        public string State { get; set; }

        /// <summary>Which keys set the brake force now, in a sentence: the keys SmartControl Live acts on.</summary>
        public string Text { get; set; }

        /// <summary>Until Live has started again after Racing Desk's last write of the keys: what restarting it brings. Null otherwise.</summary>
        public string Restart { get; set; }

        /// <summary>What the move waits for, or why it was not made; null when there is nothing to say.</summary>
        public string Said { get; set; }

        /// <summary>Undo can put back what Racing Desk moved.</summary>
        public bool Undo { get; set; }

        /// <summary>The move can be made on his word (it was undone, or not made by itself).</summary>
        public bool Move { get; set; }
    }

    /// <summary>
    /// His brake-force keys moved to Right Ctrl (his decision of 2026-10-09: Assetto Corsa's F1, F2 and F3 cameras are built into
    /// the game, so "Move brake keys to Right Ctrl+F1..F4"). Racing Desk does it once, by itself, at the host's start or when the
    /// SmartControl editor closes, and marks it done; Undo on Settings → Cars puts the keys back exactly as they were:
    /// <list type="bullet">
    /// <item>Only with the SmartControl editor closed (it would save its own copy of the keys over the change). Live may run: it
    /// reads its keys when it starts, so until it has started again the desk says to restart it, and the key follower goes by the
    /// keys Live started with (<see cref="AsLiveHasThem(SmartControlSnapshot)"/>).</item>
    /// <item>A copy of the database first (SQLite's online backup, checked to open and to hold what the database holds; the last ten
    /// kept), then the change through <see cref="SmartControlWriter.SetBrakeKeysFirstKey"/>, then a read-back of every key and
    /// profile.</item>
    /// <item>Only the set-force keys F1–F4 (action 8) of Live's Default preset whose first key is Live's "none" (<c>ZOOM</c>); their
    /// first key becomes Live's <c>RCONTROL</c>. Up and Down, his other keys, his profiles, his presets and Racing Desk's F24 are
    /// never touched.</item>
    /// <item>What each row held is kept (<see cref="BrakeKeysRecord"/>) before the database is written, so that undo puts back
    /// exactly that, and only on rows that still hold what Racing Desk wrote.</item>
    /// </list>
    /// Nothing here talks to the pedals or sends a key.
    /// </summary>
    public sealed class BrakeKeyMove
    {
        private readonly RestoreContext _ctx;
        private readonly string _file;
        private readonly object _gate = new object();
        private BrakeKeysRecord _memory = new BrakeKeysRecord();     // without a file (a test's)

        /// <param name="file">brake-keys.json, beside restore.json; null keeps the record in memory (a test's).</param>
        public BrakeKeyMove(RestoreContext ctx, string file)
        {
            _ctx = ctx ?? throw new ArgumentNullException(nameof(ctx));
            _file = file;
        }

        public string File => _file;

        /// <summary>The last look waited for the SmartControl editor to close, and this is what it said; null when it did not.</summary>
        public string WaitingForEditor { get; private set; }

        /// <summary>What the last look waited for that was not the editor (the database could not be read or copied); null when none.</summary>
        public string Waiting { get; private set; }

        public BrakeKeysRecord Record()
        {
            lock (_gate) return _file == null ? _memory.Copy() : BrakeKeysRecord.Load(_file);
        }

        private bool Keep(BrakeKeysRecord record)
        {
            lock (_gate)
            {
                if (_file != null) return record.Save(_file);
                _memory = record.Copy();
                return true;
            }
        }

        // ── The move ──

        /// <summary>
        /// Moves his set-force keys F1–F4 to Right Ctrl + F1–F4, once: by itself (<paramref name="asked"/> false) only while it has not
        /// been done, on his word from the desk whenever they are not moved. Null when there was nothing to do by itself.
        /// </summary>
        public RestoreResult Move(bool asked)
        {
            var record = Settle(Record());
            if (record.State == BrakeKeysRecord.Moved && (!asked || StillWritten(record, _ctx.ReadSmartControl())))
            {
                WaitingForEditor = Waiting = null;
                return asked ? new RestoreResult { Action = "keys", Ok = true, Saw = { "The brake-force keys are on Right Ctrl + F1–F4 already" } } : null;
            }
            if (record.Done && !asked) return null;

            var writer = _ctx.Writer;
            if (!System.IO.File.Exists(writer.DatabasePath)) return Wait("SmartControl isn't on this PC, so there are no keys to move", asked);
            long? version = writer.DatabaseVersion();
            if (version == null) return Wait("SmartControl's database couldn't be read, so the keys weren't moved", asked);
            if (version != RestorePolicy.SmartControlDatabaseVersion)
                return Leave(record, $"SmartControl's database is version {version}, which Racing Desk doesn't know, so the brake-force keys were left on F1–F4");
            if (_ctx.Probe.EditorRunning())
            {
                Waiting = null;
                WaitingForEditor = "Waiting for the SmartControl editor to close, to move the brake-force keys to Right Ctrl + F1–F4.";
                return RestoreResult.No("keys", asked ? "SmartControl was left as it is: close the SmartControl editor, then press it again" : WaitingForEditor);
            }
            WaitingForEditor = null;

            var before = _ctx.ReadSmartControl();
            if (before == null) return Wait("SmartControl's database couldn't be read, so the keys weren't moved", asked);
            var (move, already) = Plan(before);
            if (move.Count == 0)
            {
                Waiting = null;
                record.Done = true;
                record.Note = already > 0 ? null : "SmartControl Live has no keys F1–F4 that set the brake force in its Default preset, so nothing was moved";
                Keep(record);
                string seen = already > 0 ? "The brake-force keys are on Right Ctrl already, so nothing was moved" : record.Note;
                _ctx.Log("restore: keys — " + seen);
                return new RestoreResult { Action = "keys", Ok = already > 0, Saw = { seen } };
            }

            string notCopied = _ctx.BackUpBeforeWrite("brake-keys");
            if (notCopied != null) return Wait("SmartControl's database couldn't be copied first, so nothing was written (" + notCopied + ")", asked);

            // What each row holds is kept before the database is written: undo puts back exactly that.
            record.State = BrakeKeysRecord.Moving;
            record.Rows = move;
            record.Note = null;
            if (!Keep(record)) return Wait("brake-keys.json couldn't be written, so the keys weren't moved", asked);

            var written = writer.SetBrakeKeysFirstKey(Changes(move, toAfter: true), RestorePolicy.LivePreset, RestorePolicy.LivePresetName);
            if (!written.Ok)
            {
                record.State = null;
                record.Rows = new List<BrakeKeyRow>();
                Keep(record);
                if (Passing(written.Why)) return Wait("the keys weren't moved: " + written.Why, asked);
                return Leave(record, "The brake-force keys were left on F1–F4: " + written.Why);
            }

            var after = _ctx.ReadSmartControl();
            DateTime at = _ctx.Now();
            record.State = BrakeKeysRecord.Moved;
            record.Done = true;
            record.MovedAtUtc = record.WrittenAtUtc = at;
            Keep(record);
            Waiting = null;
            string wrong = ReadBack(before, after, move, toAfter: true);
            if (wrong != null) _ctx.Say(null, "keys", "failed", "SmartControl: " + wrong + " after Racing Desk moved the brake-force keys; its backups are in " + _ctx.SmartControlBackups + ".");
            string restart = LiveHasIt(at) ? null : RestorePolicy.BrakeKeysRestart;
            _ctx.Say(null, "keys", "done", "Racing Desk moved SmartControl Live's brake-force keys F1–F4 to Right Ctrl + F1–F4; Up and Down stay as they are." + (restart != null ? " " + restart : ""));
            var r = new RestoreResult { Action = "keys", Ok = true, Did = { "the brake-force keys moved to Right Ctrl + F1–F4" } };
            if (restart != null) r.Saw.Add(restart);
            return r;
        }

        /// <summary>
        /// Undo: each row Racing Desk moved gets back the first key it held before, exactly — only where the row still holds what
        /// Racing Desk wrote; one he has changed since is his, left as it is, and said. The same rules as the move: the editor closed,
        /// a copy first, a read-back. Never made again by itself afterwards.
        /// </summary>
        public RestoreResult Undo()
        {
            var record = Settle(Record());
            if (record.State != BrakeKeysRecord.Moved || record.Rows.Count == 0) return RestoreResult.No("keys", "Racing Desk hasn't moved the brake-force keys, so there is nothing to undo");
            if (_ctx.Probe.EditorRunning()) return RestoreResult.No("keys", "SmartControl was left as it is: close the SmartControl editor, then press Undo again");
            var writer = _ctx.Writer;
            long? version = writer.DatabaseVersion();
            if (version != RestorePolicy.SmartControlDatabaseVersion)
                return RestoreResult.No("keys", version == null ? "SmartControl's database couldn't be read" : $"SmartControl's database is version {version}, which Racing Desk doesn't know");
            var before = _ctx.ReadSmartControl();
            if (before == null) return RestoreResult.No("keys", "SmartControl's database couldn't be read");

            var back = new List<BrakeKeyRow>();
            var r = new RestoreResult { Action = "keys", Ok = true };
            foreach (var row in record.Rows)
            {
                var now = before.Keys.FirstOrDefault(k => k.BindingId == row.BindingId);
                if (now == null) { r.Saw.Add($"The key for {Words.Kg(Kg(row))} ({row.SecondKey}) isn't in SmartControl Live any more, so it was left"); continue; }
                if (now.Action == LiveAction.SetBrakeForce && now.ActionValue == row.ActionValue && now.FirstKey == row.After && now.SecondKey == row.SecondKey && now.PresetId == row.PresetId)
                    back.Add(row);
                else
                    r.Saw.Add($"The key for {Words.Kg(Kg(row))} ({row.SecondKey}) was changed in SmartControl Live since, so it was left as you set it");
            }
            if (back.Count == 0)
            {
                record.State = BrakeKeysRecord.Undone;
                record.UndoneAtUtc = _ctx.Now();
                Keep(record);
                r.Ok = false;
                r.Why = "Nothing was put back";
                _ctx.Say(null, "keys", "left", "Undo of the brake-force keys: " + r.Text);
                return r;
            }

            string notCopied = _ctx.BackUpBeforeWrite("brake-keys-undo");
            if (notCopied != null) return RestoreResult.No("keys", "SmartControl was left as it is: its database couldn't be copied first (" + notCopied + ")");
            record.State = BrakeKeysRecord.Undoing;
            if (!Keep(record)) return RestoreResult.No("keys", "brake-keys.json couldn't be written, so nothing was put back");

            var written = writer.SetBrakeKeysFirstKey(Changes(back, toAfter: false), RestorePolicy.LivePreset, RestorePolicy.LivePresetName);
            if (!written.Ok)
            {
                record.State = BrakeKeysRecord.Moved;
                Keep(record);
                return RestoreResult.No("keys", "SmartControl was left as it is: " + written.Why);
            }
            var after = _ctx.ReadSmartControl();
            DateTime at = _ctx.Now();
            record.State = BrakeKeysRecord.Undone;
            record.UndoneAtUtc = record.WrittenAtUtc = at;
            Keep(record);
            string wrong = ReadBack(before, after, back, toAfter: false);
            if (wrong != null) _ctx.Say(null, "keys", "failed", "SmartControl: " + wrong + " after Racing Desk put the brake-force keys back; its backups are in " + _ctx.SmartControlBackups + ".");
            r.Did.Insert(0, back.Count == record.Rows.Count ? "the brake-force keys are on F1–F4 again, as before Racing Desk moved them" : "the other brake-force keys are as before Racing Desk moved them");
            if (!LiveHasIt(at)) r.Saw.Add(RestorePolicy.BrakeKeysRestartUndone);
            _ctx.Say(null, "keys", "done", "Undo of the brake-force keys: " + r.Text);
            return r;
        }

        /// <summary>The rows to move: his set-force keys F1–F4 in Live's Default preset whose first key is Live's "none"; and how many are on Right Ctrl already.</summary>
        internal static (List<BrakeKeyRow> Move, int Already) Plan(SmartControlSnapshot snapshot)
        {
            var force = snapshot.Keys.Where(k => k.Action == LiveAction.SetBrakeForce && k.PresetId == RestorePolicy.LivePreset
                                                 && RestorePolicy.BrakeKeysMoved.Contains(k.SecondKey ?? "", StringComparer.Ordinal)).ToList();
            var move = force.Where(k => k.FirstKey == LiveKeyWatcher.NoKey).Select(k => new BrakeKeyRow
            {
                BindingId = k.BindingId, PresetId = k.PresetId, ActionType = 8, ActionValue = k.ActionValue, SecondKey = k.SecondKey,
                Before = k.FirstKey, After = RestorePolicy.BrakeKeysHeld,
            }).ToList();
            return (move, force.Count(k => k.FirstKey == RestorePolicy.BrakeKeysHeld));
        }

        private static List<BrakeKeyChange> Changes(IEnumerable<BrakeKeyRow> rows, bool toAfter) => rows.Select(r => new BrakeKeyChange
        {
            BindingId = r.BindingId, ActionType = r.ActionType, ActionValue = r.ActionValue, SecondKey = r.SecondKey,
            From = toAfter ? r.Before : r.After, To = toAfter ? r.After : r.Before,
        }).ToList();

        /// <summary>
        /// Every key and profile read back after a write: the rows written hold what was written, and everything else is as it was
        /// before. Null when it all holds; else what does not.
        /// </summary>
        internal static string ReadBack(SmartControlSnapshot before, SmartControlSnapshot after, IReadOnlyList<BrakeKeyRow> rows, bool toAfter)
        {
            if (after == null) return "SmartControl's database could not be read back";
            var written = rows.ToDictionary(r => r.BindingId);
            string Key(LiveKey k, string first) => $"{k.BindingId}|{k.Action}|{k.ActionValue}|{k.ProfileId}|{first}|{k.SecondKey}|{k.PresetId}";
            var expected = before.Keys.Select(k => Key(k, written.TryGetValue(k.BindingId, out var r) ? (toAfter ? r.After : r.Before) : k.FirstKey)).ToList();
            var now = after.Keys.Select(k => Key(k, k.FirstKey)).ToList();
            if (!expected.SequenceEqual(now)) return "the keys did not read back as written";
            foreach (var p in before.Profiles)
            {
                var q = after.Profiles.FirstOrDefault(x => x.Id == p.Id);
                if (q == null || q.Name != p.Name || !q.Data.AsSpan().SequenceEqual(p.Data)) return $"the profile '{p.Name}' changed";
            }
            if (after.Profiles.Count != before.Profiles.Count) return "the profiles changed";
            return null;
        }

        /// <summary>A record left moving or undoing by a stop: settled from what the database holds (each write is all its rows or none).</summary>
        private BrakeKeysRecord Settle(BrakeKeysRecord record)
        {
            if (record.State != BrakeKeysRecord.Moving && record.State != BrakeKeysRecord.Undoing) return record;
            var s = _ctx.ReadSmartControl();
            if (s == null || record.Rows.Count == 0) return record;
            bool All(Func<BrakeKeyRow, string> first) => record.Rows.All(r => s.Keys.Any(k => k.BindingId == r.BindingId && k.FirstKey == first(r)));
            DateTime at = _ctx.Now();
            if (All(r => r.After))
            {
                bool wasMoving = record.State == BrakeKeysRecord.Moving;
                record.State = BrakeKeysRecord.Moved;
                record.Done = true;
                if (wasMoving) { record.MovedAtUtc = record.WrittenAtUtc = at; }
            }
            else if (All(r => r.Before))
            {
                if (record.State == BrakeKeysRecord.Moving) { record.State = null; record.Rows = new List<BrakeKeyRow>(); }
                else { record.State = BrakeKeysRecord.Undone; record.UndoneAtUtc = record.WrittenAtUtc = at; }
            }
            else
            {
                return record;      // a row changed by hand since: left to the desk's undo to say
            }
            Keep(record);
            _ctx.Log("restore: keys — a write that a stop cut short was settled from what SmartControl holds: " + (record.State ?? "not moved"));
            return record;
        }

        private RestoreResult Wait(string why, bool asked)
        {
            Waiting = why + ".";
            _ctx.Log("restore: keys — " + why);
            return asked ? RestoreResult.No("keys", why) : null;
        }

        private RestoreResult Leave(BrakeKeysRecord record, string why)
        {
            Waiting = null;
            record.Done = true;
            record.Note = why.TrimEnd('.') + ".";
            Keep(record);
            _ctx.Say(null, "keys", "left", record.Note);
            return new RestoreResult { Action = "keys", Ok = false, Why = why };
        }

        // A write that found the database held by another program: tried again later. Anything else the writer refuses stands.
        private static bool Passing(string why) => why != null && why.StartsWith("SmartControl's database was not written", StringComparison.Ordinal);

        private static double Kg(BrakeKeyRow row) =>
            double.TryParse(row.ActionValue, NumberStyles.Float, CultureInfo.InvariantCulture, out double kg) ? kg : 0;

        /// <summary>Live is running and started at or after <paramref name="writtenUtc"/>, or is not running (it reads the keys when it starts).</summary>
        private bool LiveHasIt(DateTime writtenUtc) => !_ctx.Probe.LiveRunning() || RestorePolicy.LiveHasWrite(_ctx.Probe.LiveStartedAtUtc(), writtenUtc);

        // ── What Live acts on, and the desk's line ──

        /// <summary>
        /// The keys SmartControl Live acts on now: what its database holds, except where Racing Desk wrote a key after Live started —
        /// Live reads its keys when it starts, so it still has the key of before. The key follower goes by these.
        /// </summary>
        public SmartControlSnapshot AsLiveHasThem(SmartControlSnapshot snapshot)
        {
            if (snapshot == null) return null;
            try
            {
                return new SmartControlSnapshot { DatabasePath = snapshot.DatabasePath, Profiles = snapshot.Profiles, Keys = AsLiveHasThem(snapshot.Keys, Record(), _ctx.Probe) };
            }
            catch (Exception ex)
            {
                _ctx.Log("restore: keys — " + ex.Message.Trim());
                return snapshot;
            }
        }

        internal static IReadOnlyList<LiveKey> AsLiveHasThem(IReadOnlyList<LiveKey> keys, BrakeKeysRecord record, IRigProbe probe)
        {
            if (keys == null || record?.WrittenAtUtc == null || record.Rows.Count == 0) return keys;
            if (record.State != BrakeKeysRecord.Moved && record.State != BrakeKeysRecord.Undone) return keys;
            if (!probe.LiveRunning()) return keys;          // it reads what the database holds when it starts
            DateTime? started = probe.LiveStartedAtUtc();
            if (started == null || RestorePolicy.LiveHasWrite(started, record.WrittenAtUtc.Value)) return keys;
            bool moved = record.State == BrakeKeysRecord.Moved;
            return keys.Select(k =>
            {
                var row = record.Rows.FirstOrDefault(r => r.BindingId == k.BindingId);
                if (row == null || k.FirstKey != (moved ? row.After : row.Before) || k.SecondKey != row.SecondKey) return k;
                return new LiveKey
                {
                    Action = k.Action, Value = k.Value, ActionValue = k.ActionValue, ProfileId = k.ProfileId, BindingId = k.BindingId, PresetId = k.PresetId,
                    FirstKey = moved ? row.Before : row.After, SecondKey = k.SecondKey,
                };
            }).ToList();
        }

        /// <summary>How the keys stand, for Settings → Cars: which keys set the force now, whether Live must start again, undo.</summary>
        public BrakeKeysStatus Status()
        {
            var record = Record();
            var status = new BrakeKeysStatus();
            var snapshot = _ctx.ReadSmartControl();
            if (snapshot == null)
            {
                status.State = "unknown";
                status.Text = System.IO.File.Exists(_ctx.Writer.DatabasePath) ? "SmartControl Live's keys couldn't be read." : "SmartControl isn't on this PC.";
                return status;
            }
            status.Text = KeysSentence(AsLiveHasThem(snapshot.Keys, record, _ctx.Probe));
            if ((record.State == BrakeKeysRecord.Moved || record.State == BrakeKeysRecord.Undone) && record.WrittenAtUtc.HasValue && !LiveHasIt(record.WrittenAtUtc.Value))
                status.Restart = record.State == BrakeKeysRecord.Moved ? RestorePolicy.BrakeKeysRestart : RestorePolicy.BrakeKeysRestartUndone;
            bool written = StillWritten(record, snapshot);
            status.State = record.State == BrakeKeysRecord.Moved ? (written ? "moved" : "changed") : record.State == BrakeKeysRecord.Undone ? "undone" : record.Done ? "left" : "waiting";
            status.Said = record.State == BrakeKeysRecord.Moved && !written ? "The brake-force keys were changed in SmartControl since Racing Desk moved them."
                        : record.Done ? record.Note : WaitingForEditor ?? Waiting;
            status.Undo = written;
            status.Move = record.Done && !written && Plan(snapshot).Move.Count > 0;
            return status;
        }

        /// <summary>Racing Desk moved the keys, and at least one row still holds what it wrote: there is something for undo to put back.</summary>
        private static bool StillWritten(BrakeKeysRecord record, SmartControlSnapshot snapshot) =>
            record.State == BrakeKeysRecord.Moved && snapshot != null
            && record.Rows.Any(r => snapshot.Keys.Any(k => k.BindingId == r.BindingId && k.FirstKey == r.After && k.SecondKey == r.SecondKey));

        private static readonly Dictionary<string, string> KeyNames = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["RCONTROL"] = "Right Ctrl", ["LCONTROL"] = "Left Ctrl", ["CONTROL"] = "Ctrl",
            ["RSHIFT"] = "Right Shift", ["LSHIFT"] = "Left Shift", ["SHIFT"] = "Shift",
            ["RMENU"] = "Right Alt", ["LMENU"] = "Left Alt", ["MENU"] = "Alt",
            ["UP"] = "Up", ["DOWN"] = "Down", ["LEFT"] = "Left", ["RIGHT"] = "Right",
            ["PRIOR"] = "Page Up", ["NEXT"] = "Page Down", ["PAUSE"] = "Pause", ["HOME"] = "Home", ["END"] = "End",
            ["INSERT"] = "Insert", ["DELETE"] = "Delete", ["SCROLL"] = "Scroll Lock",
        };

        /// <summary>A key by the name on its keycap: <c>RCONTROL</c> is Right Ctrl, <c>NUMPAD4</c> Numpad 4.</summary>
        public static string KeyName(string name)
        {
            string n = (name ?? "").Trim();
            if (n.StartsWith("VK_", StringComparison.OrdinalIgnoreCase)) n = n.Substring(3);
            if (KeyNames.TryGetValue(n, out string said)) return said;
            if (n.StartsWith("NUMPAD", StringComparison.OrdinalIgnoreCase) && n.Length == 7) return "Numpad " + n.Substring(6);
            return n.ToUpperInvariant();
        }

        /// <summary>A binding's keys: the one held, if any, and the one pressed. Live's "none" (<c>ZOOM</c>) is no key.</summary>
        private static (string Held, string Pressed) Keys(LiveKey k)
        {
            string first = LiveKeyWatcher.IsNoKey(k.FirstKey) ? null : k.FirstKey?.Trim();
            string second = LiveKeyWatcher.IsNoKey(k.SecondKey) ? null : k.SecondKey?.Trim();
            if (string.IsNullOrEmpty(second)) return (null, first);
            if (string.IsNullOrEmpty(first)) return (null, second);
            return (first, second);
        }

        private static string Number(double kg) => kg.ToString("0.#", CultureInfo.InvariantCulture);

        /// <summary>
        /// Which keys set the brake force, in a sentence: "Right Ctrl + F1, F2, F3, F4 set 30, 50, 80, 100 kg; Up adds 5 kg; Down takes
        /// off 5 kg." Live's Default preset's keys (and those in no preset).
        /// </summary>
        public static string KeysSentence(IEnumerable<LiveKey> keys)
        {
            var force = (keys ?? Enumerable.Empty<LiveKey>())
                .Where(k => k != null && LiveKeyWatcher.IsForceKey(k.Action) && (k.PresetId == 0 || k.PresetId == RestorePolicy.LivePreset))
                .ToList();
            if (force.Count == 0) return "SmartControl Live has no keys for the brake force.";
            var parts = new List<string>();
            foreach (var group in force.Where(k => k.Action == LiveAction.SetBrakeForce).GroupBy(k => Keys(k).Held ?? "", StringComparer.OrdinalIgnoreCase))
            {
                var set = group.OrderBy(k => LiveKeyWatcher.VirtualKey(Keys(k).Pressed) ?? int.MaxValue).ToList();
                string held = group.Key.Length > 0 ? KeyName(group.Key) + " + " : "";
                parts.Add(held + string.Join(", ", set.Select(k => KeyName(Keys(k).Pressed))) + (set.Count == 1 ? " sets " : " set ")
                          + string.Join(", ", set.Select(k => Number(k.Value))) + " kg");
            }
            string Chord(LiveKey k) { var (h, p) = Keys(k); return (h != null ? KeyName(h) + " + " : "") + KeyName(p); }
            foreach (var k in force.Where(k => k.Action == LiveAction.RaiseBrakeForce)) parts.Add($"{Chord(k)} adds {Number(k.Value)} kg");
            foreach (var k in force.Where(k => k.Action == LiveAction.LowerBrakeForce)) parts.Add($"{Chord(k)} takes off {Number(k.Value)} kg");
            return string.Join("; ", parts) + ".";
        }
    }
}
