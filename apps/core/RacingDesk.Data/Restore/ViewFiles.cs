using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Data.Restore
{
    /// <summary>A car's camera file as it is now, and whether Racing Desk may write it.</summary>
    public sealed class CamFileState
    {
        /// <summary>From <c>Documents\iRacing</c>: <c>cameras\cars\porsche963gtp\car.cam</c>.</summary>
        public string RelativePath { get; set; }
        public string FullPath { get; set; }

        /// <summary>The file camera.ini's LastCarSet names for the car, when it names one: the one iRacing loads.</summary>
        public bool FromLastCarSet { get; set; }
        public bool Exists { get; set; }
        public bool Writable { get; set; }

        /// <summary>Why it may not be written, in words; null when it may.</summary>
        public string Why { get; set; }
        public double? Z { get; set; }
        public double? X { get; set; }
        public double? VerticalShift { get; set; }
        public string Sha { get; set; }
    }

    /// <summary>
    /// What one write of iRacing's view files was to do, kept in the store before either file is touched (critique H1):
    /// app.ini is written first, the camera file after; a host that stops between them finishes the write, or puts the
    /// files back, at its next start (<see cref="ViewFiles.Settle"/>).
    /// </summary>
    public sealed class ViewIntent
    {
        public string Car { get; set; }
        public string CamFile { get; set; }
        public string IniBefore { get; set; }
        public string IniAfter { get; set; }
        public string IniBackup { get; set; }
        public string CamBefore { get; set; }
        public string CamAfter { get; set; }
        public string CamBackup { get; set; }
        public double? NewZ { get; set; }
        public double? NewShift { get; set; }
        public string Why { get; set; }
    }

    /// <summary>One change to the view files: app.ini's values and the camera file's, either of them, or both.</summary>
    public sealed class ViewChange
    {
        public string CarPath { get; set; }

        /// <summary>app.ini [View] driverHeightAdj, metres; null leaves it.</summary>
        public double? IniHeight { get; set; }

        /// <summary>app.ini [View] DrivingVanishY; null leaves it.</summary>
        public double? IniVanishY { get; set; }

        /// <summary>The car's camera file: its cockpit Z and vertical shift; null leaves each.</summary>
        public double? CockpitZ { get; set; }
        public double? CockpitShift { get; set; }

        /// <summary>What the change is for, said in the log and kept with the intent.</summary>
        public string Why { get; set; }
    }

    public sealed class ViewWriteResult
    {
        public bool Ok { get; set; }
        public string Why { get; set; }
        public List<string> Did { get; } = new List<string>();
        public string IniBackup { get; set; }
        public string CamBackup { get; set; }
        public string CamSha { get; set; }
    }

    /// <summary>
    /// iRacing's view files, read and — only on his click in the first run, or by undo — written: <c>Documents\iRacing\app.ini</c>
    /// (one value of [View] at a time) and a car's camera file (its cockpit Z, and the vertical shift behind its own
    /// switch). The rules (docs/view-and-pedals-plan.md):
    /// <list type="bullet">
    /// <item>Never while the sim runs: both of its names are asked again right before each write.</item>
    /// <item>A copy aside first, under <c>%LOCALAPPDATA%\Racing Desk\backups\view\&lt;time&gt;\</c>; the first original of each
    /// file is kept for ever under <c>…\view\original\</c>. A backup that does not read back as the file is no backup, and
    /// nothing is written after it.</item>
    /// <item>The new file is written beside the old one and swapped in, then read back and compared, byte for byte.</item>
    /// <item>One value in app.ini (the line's width kept), one float in a camera file (two with the horizon); a camera file
    /// laid out any other way than the rig's 1,668-byte version 14 or 15 is refused, and so is a cockpit Z beyond
    /// ±0.05 m (critique H7).</item>
    /// <item>Where camera.ini's LastCarSet names a file for the car, that file and no other (critique H5).</item>
    /// <item>Both files changed together are written app.ini first, with what is to be done kept in the store before
    /// either (critique H1).</item>
    /// </list>
    /// </summary>
    public sealed class ViewFiles
    {
        private readonly string _documents;
        private readonly string _backups;
        private readonly IRigProbe _probe;
        private readonly Func<DateTime> _now;
        private readonly string _storePath;

        /// <param name="documents"><c>Documents\iRacing</c>, or a folder of a test's.</param>
        /// <param name="backups">Where copies go: <c>%LOCALAPPDATA%\Racing Desk\backups\view</c>.</param>
        /// <param name="storePath">The store the intent of a two-file write is kept in; null keeps none (a test's).</param>
        public ViewFiles(string documents, string backups, IRigProbe probe, string storePath = null, Func<DateTime> now = null)
        {
            _documents = documents ?? throw new ArgumentNullException(nameof(documents));
            _backups = backups ?? throw new ArgumentNullException(nameof(backups));
            _probe = probe ?? throw new ArgumentNullException(nameof(probe));
            _storePath = storePath;
            _now = now ?? (() => DateTime.UtcNow);
        }

        public string Documents => _documents;
        public string AppIni => Path.Combine(_documents, "app.ini");
        public string CameraIni => Path.Combine(_documents, "camera.ini");
        public string BackupFolder => _backups;

        // ── Reading ──

        public byte[] ReadAppIni() => ReadShared(AppIni);

        public double? AppIniValue(string key)
        {
            var bytes = ReadAppIni();
            return bytes != null && AppIniEditor.TryReadValue(bytes, "View", key, out double v) ? v : (double?)null;
        }

        public double? AppIniHeight() => AppIniValue("driverHeightAdj");

        /// <summary>
        /// The camera file iRacing loads for a car: the one camera.ini's LastCarSet names (relative to <c>cameras\</c>), else
        /// <c>cameras\cars\&lt;car folders&gt;\car.cam</c>. Null for a car path that is not a plain folder name.
        /// </summary>
        public CamFileState Cam(string carPath)
        {
            string rel = DefaultCamFile(carPath);
            if (rel == null) return null;
            bool fromLast = false;
            string named = LastCarSet(carPath);
            if (!string.IsNullOrWhiteSpace(named))
            {
                string candidate = SafeRelative(Path.Combine("cameras", named.Trim()));
                if (candidate != null) { rel = candidate; fromLast = true; }
            }
            var state = new CamFileState { RelativePath = rel, FullPath = Path.Combine(_documents, rel), FromLastCarSet = fromLast };
            byte[] bytes = ReadShared(state.FullPath);
            state.Exists = bytes != null;
            if (!state.Exists) { state.Why = "it has no camera file"; return state; }
            state.Sha = Sha(bytes);
            state.Writable = CarCamFile.IsWritable(bytes, out string why);
            state.Why = why;
            if (CarCamFile.TryReadCockpit(bytes, out var seat)) { state.Z = seat.Z; state.X = seat.X; }
            if (CarCamFile.TryReadCockpitVerticalShift(bytes, out float shift)) state.VerticalShift = shift;
            return state;
        }

        /// <summary><c>cameras\cars\mx5\mx52016\car.cam</c> for "mx5 mx52016"; null for a name that is not plain folders.</summary>
        public static string DefaultCamFile(string carPath)
        {
            if (string.IsNullOrWhiteSpace(carPath)) return null;
            var parts = carPath.Trim().Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            foreach (string part in parts)
                if (part == "." || part == ".." || part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) return null;
            return Path.Combine(new[] { "cameras", "cars" }.Concat(parts).Concat(new[] { "car.cam" }).ToArray());
        }

        /// <summary>camera.ini's LastCarSet for the car's section, <c>[cars\mx5\mx52016]</c>; null when there is none or it is empty.</summary>
        public string LastCarSet(string carPath)
        {
            byte[] bytes = ReadShared(CameraIni);
            if (bytes == null || string.IsNullOrWhiteSpace(carPath)) return null;
            string want = "cars\\" + string.Join("\\", carPath.Trim().Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries));
            string section = null;
            foreach (string raw in Encoding.Latin1.GetString(bytes).Split('\n'))
            {
                string line = raw.Trim();
                if (line.StartsWith("[", StringComparison.Ordinal) && line.EndsWith("]", StringComparison.Ordinal)) { section = line.Substring(1, line.Length - 2); continue; }
                if (section == null || !string.Equals(section, want, StringComparison.OrdinalIgnoreCase)) continue;
                int eq = line.IndexOf('=');
                if (eq > 0 && string.Equals(line.Substring(0, eq).Trim(), "LastCarSet", StringComparison.OrdinalIgnoreCase))
                {
                    string value = line.Substring(eq + 1).Trim();
                    return value.Length == 0 ? null : value;
                }
            }
            return null;
        }

        /// <summary>Every car's camera file under <c>cameras\cars</c>, by the car's path ("mx5 mx52016").</summary>
        public IReadOnlyList<string> CarsWithCamFiles()
        {
            var list = new List<string>();
            string root = Path.Combine(_documents, "cameras", "cars");
            if (!Directory.Exists(root)) return list;
            foreach (string file in Directory.EnumerateFiles(root, "car.cam", SearchOption.AllDirectories))
            {
                string dir = Path.GetDirectoryName(file);
                string rel = Path.GetRelativePath(root, dir);
                list.Add(string.Join(" ", rel.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)));
            }
            list.Sort(StringComparer.OrdinalIgnoreCase);
            return list;
        }

        // ── Writing ──

        /// <summary>
        /// Makes a change to the view files: app.ini first, then the car's camera file, each backed up, swapped in and read
        /// back, with the intent kept in the store before either when both are changed. Refused, with nothing written, while
        /// the sim runs, for a camera file laid out another way, or for a Z beyond the limit.
        /// </summary>
        public ViewWriteResult Apply(ViewChange change)
        {
            var result = new ViewWriteResult();
            if (change == null) { result.Why = "nothing to change"; return result; }
            if (_probe.SimRunning()) { result.Why = "iRacing is running: its files are written only while it is closed"; return result; }

            bool ini = change.IniHeight.HasValue || change.IniVanishY.HasValue;
            bool cam = change.CockpitZ.HasValue || change.CockpitShift.HasValue;
            if (!ini && !cam) { result.Why = "nothing to change"; return result; }

            // What each file is to become, worked out before anything is written: a change that cannot be made leaves both.
            byte[] iniBefore = null, iniAfter = null;
            if (ini)
            {
                iniBefore = ReadAppIni();
                if (iniBefore == null) { result.Why = "there is no app.ini"; return result; }
                iniAfter = iniBefore;
                if (change.IniHeight.HasValue && !AppIniEditor.TrySetValue(iniAfter, "View", "driverHeightAdj", change.IniHeight.Value, out iniAfter, out string why1))
                { result.Why = "app.ini: " + why1; return result; }
                if (change.IniVanishY.HasValue && !AppIniEditor.TrySetValue(iniAfter, "View", "DrivingVanishY", change.IniVanishY.Value, out iniAfter, out string why2))
                { result.Why = "app.ini: " + why2; return result; }
            }

            CamFileState camState = null;
            byte[] camBefore = null, camAfter = null;
            if (cam)
            {
                camState = Cam(change.CarPath);
                if (camState == null) { result.Why = "the car's name is not one a camera file is kept under"; return result; }
                if (!camState.Exists) { result.Why = "the car has no camera file: save one in the car once (Ctrl+F12, Save Car, name car.cam)"; return result; }
                if (!camState.Writable) { result.Why = "its camera file is not one Racing Desk writes: " + camState.Why; return result; }
                camBefore = ReadShared(camState.FullPath);
                camAfter = camBefore;
                if (change.CockpitZ.HasValue)
                {
                    if (Math.Abs(change.CockpitZ.Value) > RestorePolicy.MaxCockpitZ + 1e-9)
                    { result.Why = $"a cockpit Z of {Metres(change.CockpitZ.Value)} is beyond the ±{Metres(RestorePolicy.MaxCockpitZ)} kept to until a test shows more"; return result; }
                    if (!CarCamFile.TryWriteCockpitZ(camAfter, (float)change.CockpitZ.Value, out camAfter, out string why3)) { result.Why = "camera file: " + why3; return result; }
                }
                if (change.CockpitShift.HasValue)
                {
                    if (Math.Abs(change.CockpitShift.Value) > RestorePolicy.MaxVerticalShift + 1e-9)
                    { result.Why = $"a vertical shift of {change.CockpitShift.Value:0.###} is beyond ±{RestorePolicy.MaxVerticalShift:0.##}"; return result; }
                    if (!CarCamFile.TryWriteCockpitVerticalShift(camAfter, (float)change.CockpitShift.Value, out camAfter, out string why4)) { result.Why = "camera file: " + why4; return result; }
                }
            }

            // Copies aside first; a backup that does not read back stops everything.
            string stamp = Stamp();
            if (ini)
            {
                result.IniBackup = Backup(AppIni, "app.ini", stamp, iniBefore, out string whyBackup);
                if (result.IniBackup == null) { result.Why = whyBackup; return result; }
            }
            if (cam)
            {
                result.CamBackup = Backup(camState.FullPath, camState.RelativePath, stamp, camBefore, out string whyBackup);
                if (result.CamBackup == null) { result.Why = whyBackup; return result; }
            }

            // Both files: what is to be done is kept before either is touched.
            var intent = ini && cam ? new ViewIntent
            {
                Car = change.CarPath, CamFile = camState.RelativePath,
                IniBefore = Sha(iniBefore), IniAfter = Sha(iniAfter), IniBackup = result.IniBackup,
                CamBefore = Sha(camBefore), CamAfter = Sha(camAfter), CamBackup = result.CamBackup,
                NewZ = change.CockpitZ, NewShift = change.CockpitShift, Why = change.Why,
            } : null;
            if (intent != null) KeepIntent(intent);

            if (ini)
            {
                if (_probe.SimRunning()) { result.Why = "iRacing started: nothing was written"; ForgetIntent(intent); return result; }
                if (!Swap(AppIni, iniAfter, out string why)) { result.Why = "app.ini was not written: " + why; ForgetIntent(intent); return result; }
                result.Did.Add("app.ini " + string.Join(", ", new[]
                {
                    change.IniHeight.HasValue ? "driverHeightAdj " + AppIniEditor.Format(change.IniHeight.Value) : null,
                    change.IniVanishY.HasValue ? "DrivingVanishY " + AppIniEditor.Format(change.IniVanishY.Value) : null,
                }.Where(s => s != null)));
            }
            if (cam)
            {
                if (_probe.SimRunning() || !Swap(camState.FullPath, camAfter, out string why))
                {
                    // app.ini has been written and the camera file has not: put app.ini back, so the next run in this car does
                    // not get the change twice. Whatever cannot be put back now is put right at the next start (Settle).
                    string whyCam = _probe.SimRunning() ? "iRacing started" : "the camera file was not written";
                    if (ini && !_probe.SimRunning() && Swap(AppIni, iniBefore, out _)) { result.Did.Add("app.ini put back"); ForgetIntent(intent); }
                    result.Why = whyCam + (ini ? (result.Did.Contains("app.ini put back") ? "; app.ini was put back" : "; app.ini is put back at the next start") : "");
                    return result;
                }
                result.CamSha = Sha(camAfter);
                result.Did.Add($"{camState.RelativePath} " + string.Join(", ", new[]
                {
                    change.CockpitZ.HasValue ? "cockpit Z " + Metres(change.CockpitZ.Value) : null,
                    change.CockpitShift.HasValue ? "vertical shift " + change.CockpitShift.Value.ToString("0.###", CultureInfo.InvariantCulture) : null,
                }.Where(s => s != null)));
            }
            ForgetIntent(intent);
            result.Ok = true;
            return result;
        }

        /// <summary>
        /// Puts a file back from a backup: the backup must be a camera file or app.ini of the rig's layout, and the sim closed.
        /// The file as it is now is backed up first, like any other write.
        /// </summary>
        public ViewWriteResult Restore(string relativePath, string backupPath)
        {
            var result = new ViewWriteResult();
            string rel = SafeRelative(relativePath);
            if (rel == null) { result.Why = "not a file of iRacing's view"; return result; }
            if (_probe.SimRunning()) { result.Why = "iRacing is running: its files are written only while it is closed"; return result; }
            byte[] backup = ReadShared(backupPath);
            if (backup == null) { result.Why = "the backup is not there"; return result; }
            bool isCam = rel.EndsWith(".cam", StringComparison.OrdinalIgnoreCase);
            if (isCam && !CarCamFile.IsWritable(backup, out string whyCam)) { result.Why = "the backup is not a camera file of the rig's layout: " + whyCam; return result; }
            if (!isCam && !string.Equals(rel, "app.ini", StringComparison.OrdinalIgnoreCase)) { result.Why = "only app.ini and camera files are put back"; return result; }
            string full = Path.Combine(_documents, rel);
            byte[] now = ReadShared(full);
            if (now != null && now.AsSpan().SequenceEqual(backup)) { result.Ok = true; result.Did.Add(rel + " is already as the backup"); return result; }
            if (now != null)
            {
                result.CamBackup = Backup(full, rel, Stamp(), now, out string whyBackup);
                if (result.CamBackup == null) { result.Why = whyBackup; return result; }
            }
            if (_probe.SimRunning() || !Swap(full, backup, out string why)) { result.Why = rel + " was not put back: " + (_probe.SimRunning() ? "iRacing started" : "it could not be written"); return result; }
            result.Ok = true;
            result.CamSha = Sha(backup);
            result.Did.Add(rel + " put back");
            return result;
        }

        /// <summary>
        /// At the host's start, with the sim closed: a two-file write that was cut short is finished or put back (critique
        /// H1). app.ini written and the camera file not: the camera file is written now, if it is still as it was. Neither
        /// written: the intent is let go. Files changed since by somebody else: left as they are, and said.
        /// </summary>
        public IReadOnlyList<string> Settle()
        {
            var said = new List<string>();
            if (_storePath == null || !File.Exists(_storePath)) return said;
            if (_probe.SimRunning()) return said;
            List<CarViewKeep> pending;
            using (var store = new RacingDeskStore(_storePath))
                pending = store.CarViewKeeps().Where(k => !string.IsNullOrEmpty(k.Intent)).ToList();
            foreach (var keep in pending)
            {
                ViewIntent intent;
                try { intent = JsonSerializer.Deserialize<ViewIntent>(keep.Intent); }
                catch (JsonException) { intent = null; }
                if (intent == null) { ClearIntent(keep.CarPath); said.Add($"view: {keep.CarPath} — a write's record could not be read; let go"); continue; }
                string ini = Sha(ReadAppIni());
                var camPath = Path.Combine(_documents, intent.CamFile ?? "");
                byte[] camNow = ReadShared(camPath);
                string cam = Sha(camNow);
                if (ini == intent.IniAfter && cam == intent.CamAfter)
                    said.Add($"view: {keep.CarPath} — the write was done; its record let go");
                else if (ini == intent.IniBefore && cam == intent.CamBefore)
                    said.Add($"view: {keep.CarPath} — the write was not begun; its record let go");
                else if (ini == intent.IniAfter && cam == intent.CamBefore)
                {
                    // Finish it: the camera file is written as it was to be.
                    var change = new ViewChange { CarPath = intent.Car, CockpitZ = intent.NewZ, CockpitShift = intent.NewShift, Why = "finishing a write cut short" };
                    var done = Apply(change);
                    said.Add(done.Ok ? $"view: {keep.CarPath} — a write cut short was finished ({string.Join("; ", done.Did)})"
                                     : $"view: {keep.CarPath} — a write cut short could not be finished: {done.Why}; app.ini put back from its backup" +
                                       (Restore("app.ini", intent.IniBackup).Ok ? "" : " — and that failed too"));
                }
                else
                    said.Add($"view: {keep.CarPath} — the files changed since a write was cut short (iRacing, or by hand): left as they are");
                ClearIntent(keep.CarPath);
            }
            return said;
        }

        private void KeepIntent(ViewIntent intent)
        {
            if (intent == null || _storePath == null) return;
            using var store = new RacingDeskStore(_storePath);
            var row = store.CarViewKeepOf(intent.Car) ?? new CarViewKeep { CarPath = intent.Car, CamFile = intent.CamFile, SeenAtUtc = _now() };
            row.CamFile = intent.CamFile;
            row.Intent = JsonSerializer.Serialize(intent);
            row.IntentAtUtc = _now();
            store.SaveCarViewKeep(row);
        }

        private void ForgetIntent(ViewIntent intent)
        {
            if (intent == null || _storePath == null) return;
            ClearIntent(intent.Car);
        }

        private void ClearIntent(string car)
        {
            if (_storePath == null) return;
            using var store = new RacingDeskStore(_storePath);
            var row = store.CarViewKeepOf(car);
            if (row == null) return;
            row.Intent = null;
            row.IntentAtUtc = null;
            store.SaveCarViewKeep(row);
        }

        // ── Backups ──

        /// <summary>
        /// Copies the file aside and reads the copy back; keeps the first original for ever. Returns the copy's path, or null
        /// with why.
        /// </summary>
        public string Backup(string fullPath, string relativePath, string stamp, byte[] bytes, out string why)
        {
            why = null;
            try
            {
                string rel = SafeRelative(relativePath) ?? Path.GetFileName(fullPath);
                string original = Path.Combine(_backups, "original", rel);
                if (!File.Exists(original)) WriteChecked(original, bytes);
                string copy = Path.Combine(_backups, stamp, rel);
                WriteChecked(copy, bytes);
                return copy;
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                why = "the backup could not be made: " + ex.Message.Trim();
                return null;
            }
        }

        /// <summary>The first original of a file, kept for ever; null when Racing Desk never backed it up.</summary>
        public string Original(string relativePath)
        {
            string rel = SafeRelative(relativePath);
            if (rel == null) return null;
            string original = Path.Combine(_backups, "original", rel);
            return File.Exists(original) ? original : null;
        }

        private static void WriteChecked(string path, byte[] bytes)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllBytes(path, bytes);
            if (!File.ReadAllBytes(path).AsSpan().SequenceEqual(bytes)) throw new IOException("the copy does not read back as the file");
        }

        // ── The swap ──

        private bool Swap(string path, byte[] bytes, out string why)
        {
            why = null;
            string temp = Path.Combine(Path.GetDirectoryName(path), Path.GetFileName(path) + ".rd-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".tmp");
            try
            {
                File.WriteAllBytes(temp, bytes);
                if (!File.ReadAllBytes(temp).AsSpan().SequenceEqual(bytes)) { why = "the new file did not read back"; return false; }
                // Asked once more, right before the file is replaced: the sim starting a moment ago would read a half-made view.
                if (_probe.SimRunning()) { why = "iRacing started"; return false; }
                if (File.Exists(path)) File.Replace(temp, path, null, ignoreMetadataErrors: true);
                else File.Move(temp, path);
                byte[] back = ReadShared(path);
                if (back == null || !back.AsSpan().SequenceEqual(bytes)) { why = "the file did not read back as written"; return false; }
                return true;
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                why = ex.Message.Trim();
                return false;
            }
            finally
            {
                try { if (File.Exists(temp)) File.Delete(temp); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            }
        }

        // ── Helpers ──

        /// <summary>A path under <c>Documents\iRacing</c>, relative, with no way out of it; null for anything else.</summary>
        internal static string SafeRelative(string rel)
        {
            if (string.IsNullOrWhiteSpace(rel)) return null;
            rel = rel.Trim().Replace('/', '\\');
            if (Path.IsPathRooted(rel) || rel.Contains(':')) return null;
            var parts = rel.Split('\\', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0 || parts.Any(p => p == "." || p == ".." || p.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)) return null;
            return Path.Combine(parts);
        }

        /// <summary>Read without standing in the way of the sim or the iRacing UI, which write these files; null when not there.</summary>
        internal static byte[] ReadShared(string path)
        {
            try
            {
                if (string.IsNullOrEmpty(path) || !File.Exists(path)) return null;
                using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                using var buffer = new MemoryStream();
                stream.CopyTo(buffer);
                return buffer.ToArray();
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                return null;
            }
        }

        public static string Sha(byte[] bytes)
        {
            if (bytes == null) return null;
            using var sha = SHA256.Create();
            return Convert.ToHexString(sha.ComputeHash(bytes));
        }

        private string Stamp() => _now().ToLocalTime().ToString("yyyy-MM-dd_HHmmss_fff", CultureInfo.InvariantCulture);

        internal static string Metres(double m) => m.ToString("+0.000;-0.000;0.000", CultureInfo.InvariantCulture) + " m";
    }
}
