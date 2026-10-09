using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Microsoft.Data.Sqlite;

namespace RacingDesk.Data.Pedals
{
    /// <summary>What a write of SmartControl's database did, or why it did nothing.</summary>
    public sealed class SmartControlWrite
    {
        public bool Ok { get; set; }
        public string Why { get; set; }
        public string ProfileId { get; set; }
        public long BindingId { get; set; }
        public long LinkId { get; set; }

        /// <summary>SHA-256 of the bytes that were written and read back.</summary>
        public string Sha { get; set; }

        public static SmartControlWrite No(string why) => new SmartControlWrite { Why = why };
    }

    /// <summary>One of his brake-force keys to be moved: its row, what the row holds as stored, and its first key before and after.</summary>
    public sealed class BrakeKeyChange
    {
        public long BindingId { get; set; }

        /// <summary>Live's action: 8, set the brake force. No other is moved.</summary>
        public int ActionType { get; set; } = 8;

        /// <summary>The force as the row stores it ("30").</summary>
        public string ActionValue { get; set; }

        /// <summary>The key itself ("F1"), which stays.</summary>
        public string SecondKey { get; set; }

        public string From { get; set; }
        public string To { get; set; }
    }

    /// <summary>
    /// Heusinkveld SmartControl's database, written — only the rows Racing Desk makes, and only as SmartControl itself writes
    /// them (its own statements, from LibHeusinkveld): a profile is <c>INSERT INTO [profile_sim_device] (id, name, data)</c> and
    /// <c>UPDATE profile_sim_device SET name, data WHERE id</c>, a key is <c>INSERT INTO [keyboard_binding] (action_type,
    /// action_value, first_key, second_key) … RETURNING id</c> and its link to a Live preset
    /// <c>INSERT INTO [profile_smartcontrol_live_keyboard_binding] …</c>. The rules (docs/view-and-pedals-plan.md):
    /// <list type="bullet">
    /// <item>The database must be the one SmartControl 26.02 keeps (<c>database_version</c> 1): any other is refused.</item>
    /// <item>A row Racing Desk did not make — his six profiles, his presets, his keys — is never updated or deleted:
    /// every such call names the ids Racing Desk made, and anything else is refused, whatever was asked. The one exception is his
    /// own decision of 2026-10-09: the first key of his set-force keys F1–F4, moved to Right Ctrl and back
    /// (<see cref="SetBrakeKeysFirstKey"/>), that column of those rows and nothing else.</item>
    /// <item>One short transaction with a 2-second busy timeout, foreign keys on as SmartControl has them, and the journal mode
    /// never touched (SmartControl's is the rollback journal).</item>
    /// <item>What was written is read back and compared, byte for byte.</item>
    /// <item>A backup first: before Racing Desk writes (<see cref="BackUpBeforeWrite"/>) SQLite's own online backup
    /// (<see cref="Backup"/>) is taken to a timestamped file in Racing Desk's own backup folder — it reads the database
    /// consistently while SmartControl or Live may have it open — and checked to open and to hold what the database holds; the
    /// write is refused if it does not check out, and the last ten such copies are kept. (The first copy ever is also kept for
    /// good, as <c>before-racing-desk.db</c>: RestoreContext.BackUpBeforeWrite.)</item>
    /// </list>
    /// Nothing here talks to the pedals; nothing here is SmartControl's Apply, Save or Restore, the only paths to EEPROM.
    /// </summary>
    public sealed class SmartControlWriter
    {
        private readonly string _path;

        /// <summary>How long a write waits for SmartControl or Live to let go of the database.</summary>
        public static readonly TimeSpan BusyTimeout = TimeSpan.FromSeconds(2);

        public SmartControlWriter(string databasePath = null)
        {
            _path = databasePath ?? SmartControl.DefaultDatabasePath;
        }

        public string DatabasePath => _path;

        private SqliteConnection Open()
        {
            var c = new SqliteConnection(new SqliteConnectionStringBuilder
            {
                DataSource = _path,
                Mode = SqliteOpenMode.ReadWrite,      // never creates: a database that is not there is not written into being
                Pooling = false,                       // no handle on SmartControl's file outlives the call
                DefaultTimeout = (int)BusyTimeout.TotalSeconds,
            }.ToString());
            c.Open();
            using (var cmd = c.CreateCommand())
            {
                cmd.CommandText = "PRAGMA busy_timeout = " + (int)BusyTimeout.TotalMilliseconds + "; PRAGMA foreign_keys = ON;";
                cmd.ExecuteNonQuery();
            }
            return c;
        }

        /// <summary>The database's version as SmartControl keeps it; null when it cannot be read.</summary>
        public long? DatabaseVersion()
        {
            try
            {
                if (!File.Exists(_path)) return null;
                using var c = OpenReadOnly();
                using var cmd = c.CreateCommand();
                cmd.CommandText = "SELECT version_number FROM database_version";
                var v = cmd.ExecuteScalar();
                return v == null || v is DBNull ? (long?)null : Convert.ToInt64(v, CultureInfo.InvariantCulture);
            }
            catch (SqliteException)
            {
                return null;
            }
        }

        private SqliteConnection OpenReadOnly()
        {
            var c = new SqliteConnection(new SqliteConnectionStringBuilder
            {
                DataSource = _path, Mode = SqliteOpenMode.ReadOnly, Pooling = false, DefaultTimeout = 1,
            }.ToString());
            c.Open();
            return c;
        }

        private string Refusal()
        {
            if (!File.Exists(_path)) return "SmartControl's database is not there";
            long? version = DatabaseVersion();
            if (version != Restore.RestorePolicy.SmartControlDatabaseVersion)
                return version == null ? "SmartControl's database could not be read" : $"SmartControl's database is version {version}, and only version 1 is known";
            return null;
        }

        // ── Backups ──

        /// <summary>
        /// SQLite's online backup of the database to <paramref name="to"/>, then checked: it opens, passes its integrity check, and
        /// has the same profiles, keys and presets as the database. Returns null when all of that holds, else why not.
        /// </summary>
        public string Backup(string to)
        {
            try
            {
                if (!File.Exists(_path)) return "SmartControl's database is not there";
                Directory.CreateDirectory(Path.GetDirectoryName(to));
                string temp = to + ".partial";
                if (File.Exists(temp)) File.Delete(temp);
                using (var source = OpenReadOnly())
                using (var target = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = temp, Pooling = false }.ToString()))
                {
                    target.Open();
                    source.BackupDatabase(target);
                }
                string bad = Check(temp);
                if (bad != null) { File.Delete(temp); return "the backup did not check out: " + bad; }
                File.Move(temp, to, overwrite: true);
                return null;
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is SqliteException)
            {
                return "the backup could not be made: " + ex.Message.Trim();
            }
        }

        /// <summary>The name of a copy taken before a write: <c>before-write-&lt;time&gt;-&lt;what&gt;.db</c>.</summary>
        public const string StepBackupPrefix = "before-write-";

        /// <summary>
        /// A copy of the database before Racing Desk writes it (<see cref="Backup"/>, checked to open and to hold what the database
        /// holds) in <paramref name="folder"/>, named for the time and what the write is; the newest <paramref name="keep"/> of these
        /// are kept and older ones go. Null when the copy is made and has checked out; else why not, and the caller writes nothing.
        /// </summary>
        public string BackUpBeforeWrite(string folder, string step, DateTime atUtc, int keep = 10)
        {
            string tag = new string((step ?? "").Where(char.IsLetterOrDigit).ToArray());
            string stamp = atUtc.ToLocalTime().ToString("yyyy-MM-dd_HHmmss_fff", CultureInfo.InvariantCulture);
            string bad = Backup(Path.Combine(folder, StepBackupPrefix + stamp + "-" + tag + ".db"));
            if (bad != null) return bad;
            try
            {
                var copies = Directory.GetFiles(folder, StepBackupPrefix + "*.db").OrderBy(f => Path.GetFileName(f), StringComparer.Ordinal).ToList();
                foreach (string old in copies.Take(Math.Max(0, copies.Count - Math.Max(1, keep)))) File.Delete(old);
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                // The copy that matters is made; an old one that would not go is not a reason to refuse the write.
            }
            return null;
        }

        /// <summary>Whether a backup holds what the database holds: null when it does, else why not.</summary>
        public string Check(string backup)
        {
            using var b = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = backup, Mode = SqliteOpenMode.ReadOnly, Pooling = false }.ToString());
            b.Open();
            using (var cmd = b.CreateCommand())
            {
                cmd.CommandText = "PRAGMA integrity_check";
                string ok = Convert.ToString(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
                if (ok != "ok") return "its integrity check says " + ok;
            }
            using var d = OpenReadOnly();
            foreach (string table in new[] { "database_version", "profile_sim_device", "keyboard_binding", "profile_smartcontrol_live", "profile_smartcontrol_live_keyboard_binding" })
                if (Contents(b, table) != Contents(d, table)) return $"its {table} differs from the database's";
            return null;
        }

        /// <summary>A table's rows, every column, in rowid order, a blob by its SHA-256: two tables that say the same are the same.</summary>
        private static string Contents(SqliteConnection c, string table)
        {
            try
            {
                using var cmd = c.CreateCommand();
                cmd.CommandText = $"SELECT * FROM \"{table}\" ORDER BY rowid";
                using var r = cmd.ExecuteReader();
                var all = new System.Text.StringBuilder();
                while (r.Read())
                {
                    for (int i = 0; i < r.FieldCount; i++)
                    {
                        object v = r.GetValue(i);
                        all.Append(v is byte[] blob ? "#" + Restore.ViewFiles.Sha(blob) : Convert.ToString(v, CultureInfo.InvariantCulture)).Append('\u001f');
                    }
                    all.Append('\u001e');
                }
                return all.ToString();
            }
            catch (SqliteException)
            {
                return "(no such table)";
            }
        }

        // ── Profiles ──

        /// <summary>A new profile row with a new id (32 lower-case hex, SmartControl's <c>{0:N}</c>), its bytes read back.</summary>
        public SmartControlWrite InsertProfile(string name, byte[] data)
        {
            string refused = Refusal();
            if (refused != null) return SmartControlWrite.No(refused);
            if (string.IsNullOrWhiteSpace(name)) return SmartControlWrite.No("a profile needs a name");
            if (data == null || data.Length == 0) return SmartControlWrite.No("a profile needs its data");
            string id = Guid.NewGuid().ToString("N");
            try
            {
                using var c = Open();
                using (var tx = c.BeginTransaction())
                {
                    using (var exists = c.CreateCommand())
                    {
                        exists.Transaction = tx;
                        exists.CommandText = "SELECT 1 FROM profile_sim_device WHERE id = $id";
                        exists.Parameters.AddWithValue("$id", id);
                        if (exists.ExecuteScalar() != null) return SmartControlWrite.No("a profile with that id is there already");
                    }
                    using (var cmd = c.CreateCommand())
                    {
                        cmd.Transaction = tx;
                        cmd.CommandText = "INSERT INTO [profile_sim_device] (id, name, data) VALUES (@id, @name, @data)";
                        cmd.Parameters.AddWithValue("@id", id);
                        cmd.Parameters.AddWithValue("@name", name.Trim());
                        cmd.Parameters.Add("@data", SqliteType.Blob).Value = data;
                        cmd.ExecuteNonQuery();
                    }
                    tx.Commit();
                }
                return ReadBack(c, id, name.Trim(), data);
            }
            catch (SqliteException ex)
            {
                return SmartControlWrite.No("SmartControl's database was not written: " + ex.Message.Trim());
            }
        }

        /// <summary>
        /// Rewrites one of Racing Desk's own profile rows: refused unless <paramref name="id"/> is among <paramref name="ours"/>,
        /// the ids Racing Desk made, and the row is there.
        /// </summary>
        public SmartControlWrite UpdateProfile(string id, string name, byte[] data, ISet<string> ours)
        {
            string refused = Refusal() ?? NotOurs(id, ours);
            if (refused != null) return SmartControlWrite.No(refused);
            if (string.IsNullOrWhiteSpace(name) || data == null || data.Length == 0) return SmartControlWrite.No("a profile needs a name and its data");
            try
            {
                using var c = Open();
                using (var tx = c.BeginTransaction())
                using (var cmd = c.CreateCommand())
                {
                    cmd.Transaction = tx;
                    cmd.CommandText = "UPDATE profile_sim_device SET name = @name, data = @data WHERE id = @id";
                    cmd.Parameters.AddWithValue("@id", id);
                    cmd.Parameters.AddWithValue("@name", name.Trim());
                    cmd.Parameters.Add("@data", SqliteType.Blob).Value = data;
                    if (cmd.ExecuteNonQuery() != 1) return SmartControlWrite.No("the profile is not there any more");
                    tx.Commit();
                }
                return ReadBack(c, id, name.Trim(), data);
            }
            catch (SqliteException ex)
            {
                return SmartControlWrite.No("SmartControl's database was not written: " + ex.Message.Trim());
            }
        }

        /// <summary>Deletes one of Racing Desk's own profile rows; refused for any other id.</summary>
        public SmartControlWrite DeleteProfile(string id, ISet<string> ours)
        {
            string refused = Refusal() ?? NotOurs(id, ours);
            if (refused != null) return SmartControlWrite.No(refused);
            try
            {
                using var c = Open();
                using var tx = c.BeginTransaction();
                using var cmd = c.CreateCommand();
                cmd.Transaction = tx;
                cmd.CommandText = "DELETE FROM `profile_sim_device` WHERE id = @id";
                cmd.Parameters.AddWithValue("@id", id);
                int n = cmd.ExecuteNonQuery();
                tx.Commit();
                return new SmartControlWrite { Ok = true, ProfileId = id, Why = n == 0 ? "it was not there" : null };
            }
            catch (SqliteException ex)
            {
                return SmartControlWrite.No("SmartControl's database was not written: " + ex.Message.Trim());
            }
        }

        /// <summary>A profile's row as it is now: its name and bytes; null when it is not there.</summary>
        public (string Name, byte[] Data)? ReadProfile(string id)
        {
            if (string.IsNullOrWhiteSpace(id) || !File.Exists(_path)) return null;
            using var c = OpenReadOnly();
            using var cmd = c.CreateCommand();
            cmd.CommandText = "SELECT name, data FROM [profile_sim_device] WHERE id = @id";
            cmd.Parameters.AddWithValue("@id", id);
            using var r = cmd.ExecuteReader();
            if (!r.Read()) return null;
            return (r.IsDBNull(0) ? "" : r.GetString(0), r.IsDBNull(1) ? Array.Empty<byte>() : (byte[])r.GetValue(1));
        }

        // ── The key ──

        /// <summary>
        /// Binds <paramref name="key"/> to SetProfile (action 1) of Racing Desk's own switch profile in a Live preset, the vendor's
        /// way: the binding row, then its link to the preset, in one transaction. Refused when the profile is not Racing Desk's,
        /// the preset is not there or not named as expected, or the key is bound already in that preset.
        /// </summary>
        public SmartControlWrite BindProfileKey(string profileId, string key, long presetId, string presetName, ISet<string> ours)
        {
            string refused = Refusal() ?? NotOurs(profileId, ours);
            if (refused != null) return SmartControlWrite.No(refused);
            if (string.IsNullOrWhiteSpace(key)) return SmartControlWrite.No("no key");
            try
            {
                using var c = Open();
                using var tx = c.BeginTransaction();
                using (var preset = c.CreateCommand())
                {
                    preset.Transaction = tx;
                    preset.CommandText = "SELECT name FROM [profile_smartcontrol_live] WHERE id = @id";
                    preset.Parameters.AddWithValue("@id", presetId);
                    string name = preset.ExecuteScalar() as string;
                    if (name == null) return SmartControlWrite.No($"Live has no preset {presetId}");
                    if (presetName != null && !string.Equals(name.Trim(), presetName, StringComparison.Ordinal)) return SmartControlWrite.No($"Live's preset {presetId} is \"{name}\", not \"{presetName}\"");
                }
                using (var taken = c.CreateCommand())
                {
                    taken.Transaction = tx;
                    taken.CommandText = @"SELECT COUNT(*) FROM [keyboard_binding] k JOIN [profile_smartcontrol_live_keyboard_binding] l ON l.fk_keyboard_binding_id = k.id
WHERE l.fk_profile_smartcontrol_live_id = @preset AND UPPER(k.first_key) = UPPER(@key) AND COALESCE(k.second_key, '') = ''";
                    taken.Parameters.AddWithValue("@preset", presetId);
                    taken.Parameters.AddWithValue("@key", key);
                    if (Convert.ToInt64(taken.ExecuteScalar(), CultureInfo.InvariantCulture) > 0) return SmartControlWrite.No($"{key} is bound already in that preset");
                }
                long bindingId, linkId;
                using (var cmd = c.CreateCommand())
                {
                    cmd.Transaction = tx;
                    cmd.CommandText = "INSERT INTO [keyboard_binding] (action_type, action_value, first_key, second_key) VALUES (@Type, @Value, @FirstKey, @SecondKey) RETURNING id;";
                    cmd.Parameters.AddWithValue("@Type", 1);
                    cmd.Parameters.AddWithValue("@Value", profileId);
                    cmd.Parameters.AddWithValue("@FirstKey", key);
                    cmd.Parameters.AddWithValue("@SecondKey", "");
                    bindingId = Convert.ToInt64(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
                }
                using (var cmd = c.CreateCommand())
                {
                    cmd.Transaction = tx;
                    cmd.CommandText = "INSERT INTO [profile_smartcontrol_live_keyboard_binding] (fk_profile_smartcontrol_live_id, fk_keyboard_binding_id) VALUES (@fk_profile_smartcontrol_live_id, @fk_keyboard_binding_id); SELECT last_insert_rowid();";
                    cmd.Parameters.AddWithValue("@fk_profile_smartcontrol_live_id", presetId);
                    cmd.Parameters.AddWithValue("@fk_keyboard_binding_id", bindingId);
                    linkId = Convert.ToInt64(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
                }
                tx.Commit();

                // Read back: the binding is what was written, and in the preset.
                using var check = c.CreateCommand();
                check.CommandText = @"SELECT k.action_type, k.action_value, k.first_key, COALESCE(k.second_key, ''), l.fk_profile_smartcontrol_live_id
FROM [keyboard_binding] k JOIN [profile_smartcontrol_live_keyboard_binding] l ON l.fk_keyboard_binding_id = k.id WHERE k.id = @id AND l.id = @link";
                check.Parameters.AddWithValue("@id", bindingId);
                check.Parameters.AddWithValue("@link", linkId);
                using var r = check.ExecuteReader();
                if (!r.Read() || r.GetInt64(0) != 1 || r.GetString(1) != profileId || r.GetString(2) != key || r.GetString(3) != "" || r.GetInt64(4) != presetId)
                    return SmartControlWrite.No("the binding did not read back as written");
                return new SmartControlWrite { Ok = true, ProfileId = profileId, BindingId = bindingId, LinkId = linkId };
            }
            catch (SqliteException ex)
            {
                return SmartControlWrite.No("SmartControl's database was not written: " + ex.Message.Trim());
            }
        }

        /// <summary>
        /// Takes Racing Desk's binding away: its link and then its row, by the ids Racing Desk kept — and only a binding that is
        /// still SetProfile of one of Racing Desk's profiles.
        /// </summary>
        public SmartControlWrite Unbind(long bindingId, long? linkId, ISet<string> ours)
        {
            string refused = Refusal();
            if (refused != null) return SmartControlWrite.No(refused);
            try
            {
                using var c = Open();
                using var tx = c.BeginTransaction();
                using (var read = c.CreateCommand())
                {
                    read.Transaction = tx;
                    read.CommandText = "SELECT action_type, action_value FROM [keyboard_binding] WHERE id = @id";
                    read.Parameters.AddWithValue("@id", bindingId);
                    using var r = read.ExecuteReader();
                    if (!r.Read()) return new SmartControlWrite { Ok = true, Why = "the binding was not there", BindingId = bindingId };
                    if (r.GetInt64(0) != 1 || ours == null || !ours.Contains(r.GetString(1)))
                        return SmartControlWrite.No("that binding is not Racing Desk's: it is left as it is");
                }
                using (var link = c.CreateCommand())
                {
                    link.Transaction = tx;
                    link.CommandText = "DELETE FROM `profile_smartcontrol_live_keyboard_binding` WHERE fk_keyboard_binding_id = @id";
                    link.Parameters.AddWithValue("@id", bindingId);
                    link.ExecuteNonQuery();
                }
                using (var row = c.CreateCommand())
                {
                    row.Transaction = tx;
                    row.CommandText = "DELETE FROM `keyboard_binding` WHERE id = @id";
                    row.Parameters.AddWithValue("@id", bindingId);
                    row.ExecuteNonQuery();
                }
                tx.Commit();
                return new SmartControlWrite { Ok = true, BindingId = bindingId, LinkId = linkId ?? 0 };
            }
            catch (SqliteException ex)
            {
                return SmartControlWrite.No("SmartControl's database was not written: " + ex.Message.Trim());
            }
        }

        // ── His brake-force keys: the first key, and nothing else ──

        /// <summary>The first keys a brake-force binding may be moved between: Live's "no first key" and Right Ctrl, as Live names them.</summary>
        public static readonly IReadOnlyCollection<string> MovableFirstKeys = new[] { LiveKeyWatcher.NoKey, Restore.RestorePolicy.BrakeKeysHeld };

        /// <summary>
        /// The one change he asked Racing Desk to make to rows of his (2026-10-09, "Move brake keys to Right Ctrl+F1..F4"): the first key
        /// of his own set-force bindings (action 8), from <see cref="BrakeKeyChange.From"/> to <see cref="BrakeKeyChange.To"/>, both of
        /// <see cref="MovableFirstKeys"/>, and nothing else of the row. Each row must be in Live's preset <paramref name="presetId"/> and no
        /// other, and hold just what it held when Racing Desk read it (action, force, both keys); the chord it moves to must be free in
        /// that preset. One transaction with the vendor's own <c>UPDATE keyboard_binding … WHERE id</c>, every row or none, then read
        /// back. Any other row, a profile, a preset, F24's binding, the raise and lower keys: refused, whatever is asked.
        /// </summary>
        public SmartControlWrite SetBrakeKeysFirstKey(IReadOnlyList<BrakeKeyChange> changes, long presetId, string presetName)
        {
            string refused = Refusal();
            if (refused != null) return SmartControlWrite.No(refused);
            if (changes == null || changes.Count == 0) return SmartControlWrite.No("no keys named");
            foreach (var change in changes)
            {
                if (change == null || change.BindingId <= 0) return SmartControlWrite.No("a key without its row");
                if (change.ActionType != 8) return SmartControlWrite.No("only the keys that set the brake force are moved");
                if (!MovableFirstKeys.Contains(change.From) || !MovableFirstKeys.Contains(change.To))
                    return SmartControlWrite.No($"a first key is moved between {string.Join(" and ", MovableFirstKeys)} and no other");
                if (string.IsNullOrWhiteSpace(change.SecondKey) || LiveKeyWatcher.IsNoKey(change.SecondKey)) return SmartControlWrite.No("a key moved keeps its own key");
            }
            if (changes.Select(c => c.BindingId).Distinct().Count() != changes.Count) return SmartControlWrite.No("a row is named twice");
            var ids = new HashSet<long>(changes.Select(c => c.BindingId));
            try
            {
                using var c = Open();
                using (var tx = c.BeginTransaction())
                {
                    using (var preset = c.CreateCommand())
                    {
                        preset.Transaction = tx;
                        preset.CommandText = "SELECT name FROM [profile_smartcontrol_live] WHERE id = @id";
                        preset.Parameters.AddWithValue("@id", presetId);
                        string name = preset.ExecuteScalar() as string;
                        if (name == null) return SmartControlWrite.No($"Live has no preset {presetId}");
                        if (presetName != null && !string.Equals(name.Trim(), presetName, StringComparison.Ordinal)) return SmartControlWrite.No($"Live's preset {presetId} is \"{name}\", not \"{presetName}\"");
                    }
                    foreach (var change in changes)
                    {
                        long type;
                        object value, second;
                        string first;
                        using (var read = c.CreateCommand())
                        {
                            read.Transaction = tx;
                            read.CommandText = "SELECT action_type, action_value, first_key, second_key FROM [keyboard_binding] WHERE id = @id";
                            read.Parameters.AddWithValue("@id", change.BindingId);
                            using var r = read.ExecuteReader();
                            if (!r.Read()) return SmartControlWrite.No($"the key in row {change.BindingId} is not there any more");
                            type = r.IsDBNull(0) ? -1 : r.GetInt64(0);
                            value = r.GetValue(1);
                            first = r.IsDBNull(2) ? null : r.GetString(2);
                            second = r.GetValue(3);
                        }
                        string secondText = second is DBNull ? null : Convert.ToString(second, CultureInfo.InvariantCulture);
                        string valueText = value is DBNull ? null : Convert.ToString(value, CultureInfo.InvariantCulture);
                        if (type != change.ActionType || valueText != change.ActionValue || first != change.From || secondText != change.SecondKey)
                            return SmartControlWrite.No($"the key in row {change.BindingId} is not as Racing Desk read it; it is left as it is");
                        using (var links = c.CreateCommand())
                        {
                            links.Transaction = tx;
                            links.CommandText = "SELECT fk_profile_smartcontrol_live_id FROM [profile_smartcontrol_live_keyboard_binding] WHERE fk_keyboard_binding_id = @id";
                            links.Parameters.AddWithValue("@id", change.BindingId);
                            using var r = links.ExecuteReader();
                            var presets = new List<long>();
                            while (r.Read()) presets.Add(r.GetInt64(0));
                            if (presets.Count != 1 || presets[0] != presetId) return SmartControlWrite.No($"the key in row {change.BindingId} is not in Live's {presetName ?? presetId.ToString(CultureInfo.InvariantCulture)} preset alone; it is left as it is");
                        }
                        using (var taken = c.CreateCommand())
                        {
                            taken.Transaction = tx;
                            taken.CommandText = @"SELECT k.id FROM [keyboard_binding] k JOIN [profile_smartcontrol_live_keyboard_binding] l ON l.fk_keyboard_binding_id = k.id
WHERE l.fk_profile_smartcontrol_live_id = @preset AND UPPER(k.first_key) = UPPER(@first) AND UPPER(COALESCE(k.second_key, '')) = UPPER(@second)";
                            taken.Parameters.AddWithValue("@preset", presetId);
                            taken.Parameters.AddWithValue("@first", change.To);
                            taken.Parameters.AddWithValue("@second", change.SecondKey);
                            using var r = taken.ExecuteReader();
                            while (r.Read())
                                if (!ids.Contains(r.GetInt64(0)))
                                    return SmartControlWrite.No((LiveKeyWatcher.IsNoKey(change.To) ? "" : Restore.BrakeKeyMove.KeyName(change.To) + " + ")
                                        + $"{Restore.BrakeKeyMove.KeyName(change.SecondKey)} is bound already in SmartControl Live's {presetName ?? "own"} preset");
                        }
                        using (var cmd = c.CreateCommand())
                        {
                            // The vendor's own statement, with the row's own action, force and second key: only the first key differs.
                            cmd.Transaction = tx;
                            cmd.CommandText = "UPDATE keyboard_binding SET action_type = @action_type, action_value = @action_value, first_key = @first_key, second_key = @second_key WHERE id = @id";
                            cmd.Parameters.AddWithValue("@action_type", type);
                            cmd.Parameters.AddWithValue("@action_value", value);
                            cmd.Parameters.AddWithValue("@first_key", change.To);
                            cmd.Parameters.AddWithValue("@second_key", second);
                            cmd.Parameters.AddWithValue("@id", change.BindingId);
                            if (cmd.ExecuteNonQuery() != 1) return SmartControlWrite.No($"the key in row {change.BindingId} was not written");
                        }
                    }
                    tx.Commit();
                }

                // Read back: each row is what was written, and still in the preset alone.
                foreach (var change in changes)
                {
                    using var check = c.CreateCommand();
                    check.CommandText = @"SELECT k.action_type, k.action_value, k.first_key, k.second_key, l.fk_profile_smartcontrol_live_id
FROM [keyboard_binding] k JOIN [profile_smartcontrol_live_keyboard_binding] l ON l.fk_keyboard_binding_id = k.id WHERE k.id = @id";
                    check.Parameters.AddWithValue("@id", change.BindingId);
                    using var r = check.ExecuteReader();
                    if (!r.Read() || r.GetInt64(0) != change.ActionType || Convert.ToString(r.GetValue(1), CultureInfo.InvariantCulture) != change.ActionValue
                        || r.GetString(2) != change.To || (r.IsDBNull(3) ? null : r.GetString(3)) != change.SecondKey || r.GetInt64(4) != presetId || r.Read())
                        return SmartControlWrite.No($"the key in row {change.BindingId} did not read back as written");
                }
                return new SmartControlWrite { Ok = true };
            }
            catch (SqliteException ex)
            {
                return SmartControlWrite.No("SmartControl's database was not written: " + ex.Message.Trim());
            }
        }

        private static string NotOurs(string id, ISet<string> ours)
        {
            if (string.IsNullOrWhiteSpace(id)) return "no profile named";
            if (ours == null || !ours.Contains(id.Trim())) return "that profile is not one Racing Desk made: it is left as it is";
            return null;
        }

        private SmartControlWrite ReadBack(SqliteConnection c, string id, string name, byte[] data)
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = "SELECT id, name, data FROM [profile_sim_device] WHERE id = @id";
            cmd.Parameters.AddWithValue("@id", id);
            using var r = cmd.ExecuteReader();
            if (!r.Read()) return SmartControlWrite.No("the profile did not read back");
            byte[] back = r.IsDBNull(2) ? Array.Empty<byte>() : (byte[])r.GetValue(2);
            if (r.GetString(1) != name || !back.AsSpan().SequenceEqual(data)) return SmartControlWrite.No("the profile did not read back as written");
            return new SmartControlWrite { Ok = true, ProfileId = id, Sha = Restore.ViewFiles.Sha(back) };
        }
    }
}
