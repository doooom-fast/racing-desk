using System;
using System.Collections.Generic;
using System.IO;

namespace RacingDesk.Plugin.Engine
{
    /// <summary>
    /// The track maps recorded by earlier builds — CSV outlines dead-reckoned from velocity and yaw during a first
    /// lap, which started wherever the car was and bent wherever it spun — are moved out of the folders the map used
    /// to read them from, so that nothing reads them again. Moved, never deleted: into a dated folder the driver can
    /// see, under <c>%LOCALAPPDATA%\Racing Desk\track-maps-set-aside\</c>. A move that fails (a file held open) is
    /// logged and tried again at the next start. Nothing of SimHub's own is touched.
    /// </summary>
    public static class TrackMapSetAside
    {
        /// <summary>The folders a runtime read maps from: by the assembly's folder and the writable data folder.</summary>
        public static IEnumerable<string> FoldersOf(string assemblyDirectory, string pluginsDataDirectory)
        {
            if (!string.IsNullOrEmpty(assemblyDirectory))
            {
                yield return Path.Combine(assemblyDirectory, "racingdesk-data", "trackmaps");
                yield return Path.Combine(assemblyDirectory, "trackmaps");
            }
            if (!string.IsNullOrEmpty(pluginsDataDirectory))
                yield return Path.Combine(pluginsDataDirectory, "TrackMaps");
        }

        /// <summary>Where set-aside maps go: beside the app's own data.</summary>
        public static string DefaultRoot =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Racing Desk", "track-maps-set-aside");

        /// <summary>yyyy-mm-dd_hhmmss, local time: the name of the folder one start's set-aside files go into.</summary>
        public static string Stamp(DateTime local) => local.ToString("yyyy-MM-dd_HHmmss", System.Globalization.CultureInfo.InvariantCulture);

        /// <summary>
        /// Moves every <c>*.csv</c> in <paramref name="folders"/> (not their subfolders) into
        /// <c>&lt;root&gt;\&lt;stamp&gt;\&lt;who&gt;\&lt;folder&gt;\</c>, where the folder's name is its path under its
        /// parent with separators made underscores (<c>racingdesk-data_trackmaps</c>, <c>TrackMaps</c>). Returns the
        /// sentences for the log: one for what was moved, and one for each file that could not be; none when there
        /// was nothing to move.
        /// </summary>
        public static IReadOnlyList<string> Run(string who, IEnumerable<string> folders, string root, DateTime localNow)
        {
            var said = new List<string>();
            int moved = 0;
            string destination = null;
            foreach (string folder in folders)
            {
                string[] files;
                try
                {
                    if (!Directory.Exists(folder)) continue;
                    files = Directory.GetFiles(folder, "*.csv", SearchOption.TopDirectoryOnly);
                }
                catch (Exception ex)
                {
                    said.Add($"old track maps in {folder} not looked at: {ex.Message}");
                    continue;
                }
                if (files.Length == 0) continue;
                string leaf = LeafName(folder);
                string target = Path.Combine(root, Stamp(localNow), who, leaf);
                foreach (string file in files)
                {
                    try
                    {
                        Directory.CreateDirectory(target);
                        string to = Path.Combine(target, Path.GetFileName(file));
                        if (File.Exists(to)) to = Path.Combine(target, Path.GetFileNameWithoutExtension(file) + "_" + Guid.NewGuid().ToString("N").Substring(0, 6) + ".csv");
                        File.Move(file, to);
                        moved++;
                        destination = destination ?? Path.Combine(root, Stamp(localNow), who);
                    }
                    catch (Exception ex)
                    {
                        said.Add($"old track map {Path.GetFileName(file)} in {folder} could not be moved and is tried again at the next start: {ex.Message}");
                    }
                }
            }
            if (moved > 0) said.Insert(0, $"{moved} old track map{(moved == 1 ? "" : "s")} set aside, out of the folders the map used to read, into {destination}");
            return said;
        }

        // The folder's name under its parent — and the parent's too where the leaf alone would clash (racingdesk-data\trackmaps and trackmaps).
        private static string LeafName(string folder)
        {
            string full = Path.GetFullPath(folder).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string leaf = Path.GetFileName(full);
            string parent = Path.GetFileName(Path.GetDirectoryName(full) ?? "");
            return string.Equals(parent, "racingdesk-data", StringComparison.OrdinalIgnoreCase) ? parent + "_" + leaf : leaf;
        }
    }
}
