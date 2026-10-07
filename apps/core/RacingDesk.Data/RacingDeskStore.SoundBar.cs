using System;
using System.Collections.Generic;

namespace RacingDesk.Data
{
    /// <summary>
    /// One value of iRacing's app.ini that Racing Desk switched off while the sound bar was the default playback device, kept so
    /// that it can be put back: what the file held before (<see cref="Original"/>), what Racing Desk wrote (<see cref="Written"/>),
    /// and whether the write is known to have gone through (<see cref="WrittenOk"/>: false from the moment it was decided until the
    /// file has been read back, so that a stop in between is not taken for his own change).
    /// </summary>
    public sealed class SoundBarKeep
    {
        /// <summary>Section and key: <c>Audio.xa2_mixToLFE</c>.</summary>
        public string Setting { get; set; }
        public string Original { get; set; }
        public string Written { get; set; }
        public bool WrittenOk { get; set; }
        public DateTime AtUtc { get; set; }
    }

    /// <summary>
    /// The sound bar's LFE switch (Settings → Sound): what was in app.ini before Racing Desk's first change. One table of its own,
    /// made the first time a value is kept, so the store's schema version is not touched and an earlier build opens the store as it
    /// was. A store without it, or opened read-only, keeps nothing.
    /// </summary>
    public sealed partial class RacingDeskStore
    {
        private const string SoundBarSchema = @"
CREATE TABLE IF NOT EXISTS soundbar_lfe_keep (
  setting TEXT PRIMARY KEY COLLATE NOCASE,
  original TEXT NOT NULL, written TEXT NOT NULL, written_ok INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL
)";

        public IReadOnlyList<SoundBarKeep> SoundBarKeeps()
        {
            var list = new List<SoundBarKeep>();
            if (!HasTable("soundbar_lfe_keep")) return list;
            using var cmd = Cmd("SELECT setting, original, written, written_ok, at FROM soundbar_lfe_keep ORDER BY setting");
            using var r = cmd.ExecuteReader();
            while (r.Read())
                list.Add(new SoundBarKeep { Setting = r.GetString(0), Original = r.GetString(1), Written = r.GetString(2), WrittenOk = r.GetInt64(3) != 0, AtUtc = Utc(r.GetString(4)) });
            return list;
        }

        /// <summary>Keeps a value as given, whole (the first time it is made, the table too). False for a row that names nothing.</summary>
        public bool SaveSoundBarKeep(SoundBarKeep row)
        {
            if (row == null || string.IsNullOrWhiteSpace(row.Setting) || row.Original == null || row.Written == null) return false;
            Exec(SoundBarSchema);
            Exec(@"
INSERT INTO soundbar_lfe_keep (setting, original, written, written_ok, at) VALUES ($s, $o, $w, $ok, $at)
ON CONFLICT(setting) DO UPDATE SET original = excluded.original, written = excluded.written, written_ok = excluded.written_ok, at = excluded.at", null,
                ("$s", row.Setting.Trim()), ("$o", row.Original), ("$w", row.Written), ("$ok", row.WrittenOk ? 1 : 0),
                ("$at", Iso(row.AtUtc == default ? DateTime.UtcNow : row.AtUtc)));
            return true;
        }

        /// <summary>Takes a value away: it has been put back, or is his now.</summary>
        public bool ForgetSoundBarKeep(string setting)
        {
            if (string.IsNullOrWhiteSpace(setting) || !HasTable("soundbar_lfe_keep")) return false;
            using var cmd = Cmd("DELETE FROM soundbar_lfe_keep WHERE setting = $s");
            P(cmd, "$s", setting.Trim());
            return cmd.ExecuteNonQuery() > 0;
        }
    }
}
