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

    /// <summary>
    /// Heusinkveld SmartControl's database, written — only the rows Racing Desk makes, and only as SmartControl itself writes
    /// them (its own statements, from LibHeusinkveld): a profile is <c>INSERT INTO [profile_sim_device] (id, name, data)</c> and
    /// <c>UPDATE profile_sim_device SET name, data WHERE id</c>, a key is <c>INSERT INTO [keyboard_binding] (action_type,
    /// action_value, first_key, second_key) … RETURNING id</c> and its link to a Live preset
    /// <c>INSERT INTO [profile_smartcontrol_live_keyboard_binding] …</c>. The rules (docs/view-and-pedals-plan.md):
    /// <list type="bullet">
    /// <item>The database must be the one SmartControl 26.02 keeps (<c>database_version</c> 1): any other is refused.</item>
    /// <item>A row Racing Desk did not make — his six profiles, his presets, his five keys — is never updated or deleted:
    /// every such call names the ids Racing Desk made, and anything else is refused, whatever was asked.</item>
    /// <item>One short transaction with a 2-second busy timeout, foreign keys on as SmartControl has them, and the journal mode
    /// never touched (SmartControl's is the rollback journal).</item>
    /// <item>What was written is read back and compared, byte for byte.</item>
    /// <item>A backup first: before the first write of each step of the first run (<see cref="BackUpBeforeWrite"/>) SQLite's own
    /// online backup (<see cref="Backup"/>) is taken to a timestamped file in Racing Desk's own backup folder — it reads the
    /// database consistently while SmartControl or Live may have it open — and checked to open and to hold what the database
    /// holds; the write is refused if it does not check out, and the last ten such copies are kept. (Before the first write ever,
    /// 0b keeps a copy for good.)</item>
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

        /// <summary>The name of a copy taken before a step's write: <c>before-write-&lt;time&gt;-&lt;step&gt;.db</c>.</summary>
        public const string StepBackupPrefix = "before-write-";

        /// <summary>
        /// A copy of the database before a step writes it (<see cref="Backup"/>, checked to open and to hold what the database holds)
        /// in <paramref name="folder"/>, named for the time and the step; the newest <paramref name="keep"/> of these are kept and older
        /// ones go. Null when the copy is made and has checked out; else why not, and the caller writes nothing.
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
