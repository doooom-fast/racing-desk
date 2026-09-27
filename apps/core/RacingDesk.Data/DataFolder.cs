using System;
using System.Collections.Generic;
using System.IO;

namespace RacingDesk.Data
{
    /// <summary>
    /// Where the local data lives: <c>%LOCALAPPDATA%\Racing Desk</c> — the store, the host's settings, the
    /// schedule PDFs, recordings and track outlines.
    ///
    /// Until 2026-09-27 it was <c>%LOCALAPPDATA%\RaceCor</c> with the store as <c>prodrive.db</c>. The first host
    /// to run under the new name moves that folder's contents across, item by item, because the app may already
    /// have created the new folder (for <c>host.log</c>) before the host runs. A file that is in use — a host from
    /// before the rename still running — stays where it is, and the store falls back to reading it there rather
    /// than starting empty.
    /// </summary>
    public static class DataFolder
    {
        public const string Name = "Racing Desk";
        public const string DbFileName = "racing-desk.db";

        private const string OldName = "RaceCor";
        private const string OldDbFileName = "prodrive.db";

        private static string LocalAppData =>
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

        public static string Path => System.IO.Path.Combine(LocalAppData, Name);

        public static string OldPath => System.IO.Path.Combine(LocalAppData, OldName);

        /// <summary>The store: the new location once it exists, the RaceCor-era file while it is the only one.</summary>
        public static string DbPath
        {
            get
            {
                string current = System.IO.Path.Combine(Path, DbFileName);
                if (File.Exists(current)) return current;
                string old = System.IO.Path.Combine(OldPath, OldDbFileName);
                return File.Exists(old) ? old : current;
            }
        }

        /// <summary>
        /// Move the RaceCor-era folder's contents into the new one. Returns one line per item for the log; an
        /// empty list means there was nothing to do.
        /// </summary>
        public static IReadOnlyList<string> Migrate()
        {
            var notes = new List<string>();
            if (!Directory.Exists(OldPath)) return notes;

            Directory.CreateDirectory(Path);
            foreach (string source in Directory.EnumerateFileSystemEntries(OldPath))
            {
                string name = System.IO.Path.GetFileName(source);
                string target = System.IO.Path.Combine(Path, RenameDb(name));
                if (File.Exists(target) || Directory.Exists(target))
                {
                    notes.Add($"{name}: already present under {Name}, left in {OldName}");
                    continue;
                }
                try
                {
                    if (Directory.Exists(source)) Directory.Move(source, target);
                    else File.Move(source, target);
                    notes.Add($"{name} → {System.IO.Path.GetFileName(target)}");
                }
                catch (IOException ex)
                {
                    // In use, or on another volume: leave it, say so, and DbPath keeps reading it where it is.
                    notes.Add($"{name}: not moved ({ex.Message.Trim()})");
                }
                catch (UnauthorizedAccessException ex)
                {
                    notes.Add($"{name}: not moved ({ex.Message.Trim()})");
                }
            }

            try
            {
                if (Directory.Exists(OldPath) && Directory.GetFileSystemEntries(OldPath).Length == 0)
                {
                    Directory.Delete(OldPath);
                    notes.Add($"{OldName} folder removed — everything is under {Name} now");
                }
            }
            catch (IOException) { /* something still holds it; harmless */ }
            return notes;
        }

        // The store and SQLite's sidecars follow the product name; nothing else was named after the old one.
        private static string RenameDb(string name) =>
            name.StartsWith(OldDbFileName, StringComparison.OrdinalIgnoreCase)
                ? DbFileName + name.Substring(OldDbFileName.Length)
                : name;
    }
}
