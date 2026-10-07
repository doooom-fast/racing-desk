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
    /// app.ini is written first, the camera file after; a host that stops between them puts app.ini back, by its value,
    /// at its next start (<see cref="ViewFiles.Settle"/>) — the step was cut short, and is not finished behind his back.
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

        /// <summary>
        /// The values of app.ini the write changes, as they were and as they were to be: what a cut-short write is put back
        /// by. (Whole-file copies are kept for a recovery by hand, and are never put back by Racing Desk itself.)
        /// </summary>
        public double? IniHeightBefore { get; set; }
        public double? IniVanishYBefore { get; set; }
        public double? IniHeightAfter { get; set; }
        public double? IniVanishYAfter { get; set; }
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

        /// <summary>
        /// The camera file itself, by its path under <c>Documents\iRacing</c>, when it is known (undo, a settling): that file and
        /// no other, and camera.ini's LastCarSet is not asked again. Null looks the car's file up as iRacing would.
        /// </summary>
        public string CamFile { get; set; }

        /// <summary>
        /// Write a value only while the file still holds exactly this: what Racing Desk wrote there. A value that is something
        /// else was changed since (by iRacing, or him), is his, and is refused, with nothing written for it.
        /// </summary>
        public double? ExpectIniHeight { get; set; }
        public double? ExpectIniVanishY { get; set; }
        public double? ExpectCockpitZ { get; set; }
        public double? ExpectCockpitShift { get; set; }

        /// <summary>
        /// A value is being put back to what it was before Racing Desk wrote it: the limits of a write (|Z| of 5 cm, the
        /// horizon's) do not apply to a value that was in the file already, only that it reads as a camera tool's.
        /// </summary>
        public bool Restoring { get; set; }
    }

    /// <summary>One value of app.ini, spelled as the file spells it, to be set (<see cref="ViewFiles.ApplyIniText"/>).</summary>
    public sealed class IniTextChange
    {
        public string Section { get; set; }
        public string Key { get; set; }

        /// <summary>The new spelling: <c>0</c>, or <c>1</c>.</summary>
        public string Text { get; set; }

        /// <summary>Write only while the file holds exactly this (ignoring case); null writes whatever is there.</summary>
        public string Expect { get; set; }
    }

    /// <summary>What <see cref="ViewFiles.Settle"/> found of one write that a stop had cut short, for the desk and host.log.</summary>
    public sealed class SettleNote
    {
        public string Car { get; set; }
        public string Text { get; set; }

        /// <summary>"info" (nothing to be done, log only), "done" (app.ini put back), "left" (the files had changed since), "failed".</summary>
        public string State { get; set; }
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
    /// iRacing's view files, read, and written only with the sim closed — by the director once the sim has gone (a car's seat
    /// height into its camera file, app.ini back to S), and by undo: <c>Documents\iRacing\app.ini</c> (one value of [View] at
    /// a time) and a car's camera file (its cockpit Z; the vertical shift only ever put back). The rules
    /// (docs/view-and-pedals-plan.md):
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
    /// either (critique H1). A step that is cut short is put back, by value, never finished.</item>
    /// <item>Put back means value by value: a camera file's cockpit Z (four bytes) or one value of app.ini is set to what it
    /// was, and only while it still holds what Racing Desk wrote. A file he has saved since is his and is left as it is. The
    /// whole-file copies are for recovering by hand, and Racing Desk never puts one back itself.</item>
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
            return CamAt(rel, fromLast);
        }

        /// <summary>
        /// A camera file as it is now, by its path under <c>Documents\iRacing</c>; nothing is looked up. Null for a path that
        /// is not a file of iRacing's folder. Undo and a settling go by the file Racing Desk wrote, not by one found again.
        /// </summary>
        public CamFileState CamAt(string relativePath, bool fromLastCarSet = false)
        {
            string rel = SafeRelative(relativePath);
            if (rel == null) return null;
            var state = new CamFileState { RelativePath = rel, FullPath = Path.Combine(_documents, rel), FromLastCarSet = fromLastCarSet };
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

        /// <summary>The two values of app.ini's [View] that Racing Desk changes, and how close a read value is to a written one.</summary>
        public const string HeightKey = "driverHeightAdj", VanishYKey = "DrivingVanishY";
        public const double IniTolerance = 1e-6;

        /// <summary>
        /// Makes a change to the view files: app.ini first, then the car's camera file, each backed up, swapped in and read
        /// back, with the intent kept in the store before either when both are changed. Refused, with nothing written, while
        /// the sim runs, for a camera file laid out another way, for a Z beyond the limit (unless it is being put back), and
        /// for a value that is not what Racing Desk wrote where the change says it should still be.
        /// </summary>
        public ViewWriteResult Apply(ViewChange change)
        {
            lock (IniWrites) return ApplyLocked(change);
        }

        /// <summary>
        /// One writer of app.ini at a time in this process: the seat height's put-back and the sound bar's LFE switch both read the file,
        /// change a value and swap it in, and two of them at once (both run when the sim has closed) would lose one of the two edits.
        /// </summary>
        private static readonly object IniWrites = new object();

        private ViewWriteResult ApplyLocked(ViewChange change)
        {
            var result = new ViewWriteResult();
            if (change == null) { result.Why = "nothing to change"; return result; }
            if (_probe.SimRunning()) { result.Why = "iRacing is running: its files are written only while it is closed"; return result; }

            bool ini = change.IniHeight.HasValue || change.IniVanishY.HasValue;
            bool cam = change.CockpitZ.HasValue || change.CockpitShift.HasValue;
            if (!ini && !cam) { result.Why = "nothing to change"; return result; }

            // What each file is to become, worked out before anything is written: a change that cannot be made leaves both.
            byte[] iniBefore = null, iniAfter = null;
            double? heightBefore = null, vanishBefore = null;
            if (ini)
            {
                iniBefore = ReadAppIni();
                if (iniBefore == null) { result.Why = "there is no app.ini"; return result; }
                heightBefore = ReadIni(iniBefore, HeightKey);
                vanishBefore = ReadIni(iniBefore, VanishYKey);
                if (change.ExpectIniHeight.HasValue && !Holds(heightBefore, change.ExpectIniHeight.Value))
                { result.Why = "app.ini's driverHeightAdj is no longer what Racing Desk wrote: it is left as it is"; return result; }
                if (change.ExpectIniVanishY.HasValue && !Holds(vanishBefore, change.ExpectIniVanishY.Value))
                { result.Why = "app.ini's DrivingVanishY is no longer what Racing Desk wrote: it is left as it is"; return result; }
                iniAfter = iniBefore;
                if (change.IniHeight.HasValue && !AppIniEditor.TrySetValue(iniAfter, "View", HeightKey, change.IniHeight.Value, out iniAfter, out string why1))
                { result.Why = "app.ini: " + why1; return result; }
                if (change.IniVanishY.HasValue && !AppIniEditor.TrySetValue(iniAfter, "View", VanishYKey, change.IniVanishY.Value, out iniAfter, out string why2))
                { result.Why = "app.ini: " + why2; return result; }
            }

            CamFileState camState = null;
            byte[] camBefore = null, camAfter = null;
            if (cam)
            {
                camState = change.CamFile != null ? CamAt(change.CamFile) : Cam(change.CarPath);
                if (camState == null) { result.Why = "the car's name is not one a camera file is kept under"; return result; }
                if (!camState.Exists) { result.Why = "the car has no camera file: save one (" + RestorePolicy.SaveACameraFile + ")"; return result; }
                if (!camState.Writable) { result.Why = "its camera file is not one Racing Desk writes: " + camState.Why; return result; }
                camBefore = ReadShared(camState.FullPath);
                if (change.ExpectCockpitZ.HasValue && !HoldsFloat(camState.Z, change.ExpectCockpitZ.Value))
                { result.Why = "its camera file's cockpit Z is no longer what Racing Desk wrote: you saved the file since, and it is left as it is"; return result; }
                if (change.ExpectCockpitShift.HasValue && !HoldsFloat(camState.VerticalShift, change.ExpectCockpitShift.Value))
                { result.Why = "its camera file's vertical shift is no longer what Racing Desk wrote: you saved the file since, and it is left as it is"; return result; }
                camAfter = camBefore;
                if (change.CockpitZ.HasValue)
                {
                    if (!change.Restoring && Math.Abs(change.CockpitZ.Value) > RestorePolicy.MaxCockpitZ + 1e-9)
                    { result.Why = $"a cockpit Z of {Metres(change.CockpitZ.Value)} is beyond the ±{Metres(RestorePolicy.MaxCockpitZ)} kept to until a test shows more"; return result; }
                    if (!CarCamFile.TryWriteCockpitZ(camAfter, (float)change.CockpitZ.Value, out camAfter, out string why3)) { result.Why = "camera file: " + why3; return result; }
                }
                if (change.CockpitShift.HasValue)
                {
                    if (!change.Restoring && Math.Abs(change.CockpitShift.Value) > RestorePolicy.MaxVerticalShift + 1e-9)
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

            // Both files: what is to be done is kept before either is touched, with the values app.ini is to be put back by.
            var intent = ini && cam ? new ViewIntent
            {
                Car = change.CarPath, CamFile = camState.RelativePath,
                IniBefore = Sha(iniBefore), IniAfter = Sha(iniAfter), IniBackup = result.IniBackup,
                CamBefore = Sha(camBefore), CamAfter = Sha(camAfter), CamBackup = result.CamBackup,
                NewZ = change.CockpitZ, NewShift = change.CockpitShift, Why = change.Why,
                IniHeightBefore = change.IniHeight.HasValue ? heightBefore : null,
                IniVanishYBefore = change.IniVanishY.HasValue ? vanishBefore : null,
                IniHeightAfter = change.IniHeight.HasValue ? ReadIni(iniAfter, HeightKey) : null,
                IniVanishYAfter = change.IniVanishY.HasValue ? ReadIni(iniAfter, VanishYKey) : null,
            } : null;
            if (intent != null) KeepIntent(intent);

            if (ini)
            {
                if (_probe.SimRunning()) { result.Why = "iRacing started: nothing was written"; ForgetIntent(intent); return result; }
                // What app.ini held, kept before Racing Desk's first write of each value: it is what undo puts back.
                if (!NoteIni(change.IniHeight.HasValue ? heightBefore : null, null, change.IniVanishY.HasValue ? vanishBefore : null, null))
                { result.Why = "what app.ini holds could not be kept in the store first, so nothing was written"; ForgetIntent(intent); return result; }
                if (!Swap(AppIni, iniAfter, out string why)) { result.Why = "app.ini was not written: " + why; ForgetIntent(intent); return result; }
                if (!NoteIni(null, change.IniHeight.HasValue ? ReadIni(iniAfter, HeightKey) : null, null, change.IniVanishY.HasValue ? ReadIni(iniAfter, VanishYKey) : null))
                    result.Did.Add("(what was written could not be kept in the store, so undo will leave app.ini's values as they are)");
                result.Did.Add("app.ini " + string.Join(", ", new[]
                {
                    change.IniHeight.HasValue ? HeightKey + " " + AppIniEditor.Format(change.IniHeight.Value) : null,
                    change.IniVanishY.HasValue ? VanishYKey + " " + AppIniEditor.Format(change.IniVanishY.Value) : null,
                }.Where(s => s != null)));
            }
            if (cam)
            {
                bool simUp = _probe.SimRunning();
                string whySwap = null;
                if (simUp || !Swap(camState.FullPath, camAfter, out whySwap))
                {
                    // The step is cut short: app.ini has been written and the camera file has not. app.ini is put back by its value,
                    // so that the next run in this car does not get the change twice — if nothing has written it since, and the sim
                    // is not up. If that cannot be done now, the next start of Racing Desk does it (Settle), on the same terms.
                    simUp = simUp || _probe.SimRunning();      // asked again: the swap itself refuses when the sim has started
                    string whyCam = simUp ? "iRacing started before the camera file was written" : "the camera file was not written (" + whySwap + ")";
                    if (!ini) { result.Why = whyCam; return result; }
                    string notBack = null;
                    if (!simUp && PutIniValuesBack(intent.IniHeightBefore, intent.IniVanishYBefore, intent.IniAfter, out notBack))
                    {
                        ForgetIntent(intent);
                        result.Did.Add("app.ini put back");
                        result.Why = whyCam + "; app.ini was put back to what it held, and the step stopped there";
                    }
                    else
                    {
                        result.Why = whyCam + "; app.ini could not be put back now" + (notBack != null ? " (" + notBack + ")" : "")
                                     + ". When Racing Desk next starts it puts app.ini back to what it held, if nothing else has written app.ini by then "
                                     + "(iRacing rewrites it when it exits), and says so on the desk";
                    }
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
        /// Sets values of app.ini that are spelled as they stand (a switch, <c>1</c> and <c>0</c>), each in its own section, with the
        /// sim closed: the same care as <see cref="Apply"/> takes. Nothing is written for a value that is not what the change says it
        /// should be (<see cref="IniTextChange.Expect"/>): it was changed since, and is left. The file is backed up before it is touched,
        /// the new one is swapped in and read back, and each value is read from the file again. Refused, with nothing written, while
        /// the sim runs, for a key that is not in the file once, or a value that does not fit its line.
        /// </summary>
        public ViewWriteResult ApplyIniText(IReadOnlyList<IniTextChange> changes)
        {
            lock (IniWrites) return ApplyIniTextLocked(changes);
        }

        private ViewWriteResult ApplyIniTextLocked(IReadOnlyList<IniTextChange> changes)
        {
            var result = new ViewWriteResult();
            if (changes == null || changes.Count == 0) { result.Why = "nothing to change"; return result; }
            if (_probe.SimRunning()) { result.Why = "iRacing is running: its files are written only while it is closed"; return result; }

            byte[] before = ReadAppIni();
            if (before == null) { result.Why = "there is no app.ini"; return result; }
            byte[] after = before;
            foreach (var change in changes)
            {
                if (!AppIniEditor.TryReadText(after, change.Section, change.Key, out string now))
                { result.Why = $"app.ini: {change.Key} is not in [{change.Section}] once"; return result; }
                if (change.Expect != null && !string.Equals(now, change.Expect, StringComparison.OrdinalIgnoreCase))
                { result.Why = $"app.ini's {change.Key} is no longer what Racing Desk saw: it is left as it is"; return result; }
                if (!AppIniEditor.TrySetText(after, change.Section, change.Key, change.Text, out after, out string whySet))
                { result.Why = "app.ini: " + whySet; return result; }
            }
            if (after.AsSpan().SequenceEqual(before)) { result.Ok = true; return result; }

            result.IniBackup = Backup(AppIni, "app.ini", Stamp(), before, out string whyBackup);
            if (result.IniBackup == null) { result.Why = whyBackup; return result; }
            if (_probe.SimRunning()) { result.Why = "iRacing started: nothing was written"; return result; }
            if (!Swap(AppIni, after, out string why)) { result.Why = "app.ini was not written: " + why; return result; }

            byte[] back = ReadAppIni();
            foreach (var change in changes)
            {
                if (back == null || !AppIniEditor.TryReadText(back, change.Section, change.Key, out string read) || !string.Equals(read, change.Text.Trim(), StringComparison.OrdinalIgnoreCase))
                { result.Why = $"app.ini's {change.Key} did not read back as written"; return result; }
                result.Did.Add($"app.ini [{change.Section}] {change.Key} {change.Text.Trim()}");
            }
            result.Ok = true;
            return result;
        }

        private static double? ReadIni(byte[] file, string key) =>
            file != null && AppIniEditor.TryReadValue(file, "View", key, out double v) ? v : (double?)null;

        private static bool Holds(double? now, double wrote) => now.HasValue && Math.Abs(now.Value - wrote) < IniTolerance;

        /// <summary>A camera file's value as a float holds exactly what was written: the four bytes there are the same.</summary>
        internal static bool HoldsFloat(double? now, double wrote) => now.HasValue && SameFloat(now.Value, wrote);

        /// <summary>Two values are the same four bytes in a camera file (as floats; 0 and -0 are one).</summary>
        internal static bool SameFloat(double a, double b) => (float)a == (float)b;

        /// <summary>
        /// Puts the values of app.ini back by value — one value at a time, in the width it had — and only while the file is
        /// still exactly <paramref name="onlyIfSha"/> (what was written): a file that is anything else was changed since, by
        /// iRacing or him, and is left as it is. The sim is asked again right before the swap.
        /// </summary>
        private bool PutIniValuesBack(double? height, double? vanishY, string onlyIfSha, out string why)
        {
            lock (IniWrites) return PutIniValuesBackLocked(height, vanishY, onlyIfSha, out why);
        }

        private bool PutIniValuesBackLocked(double? height, double? vanishY, string onlyIfSha, out string why)
        {
            why = null;
            byte[] now = ReadAppIni();
            if (now == null) { why = "there is no app.ini"; return false; }
            if (onlyIfSha != null && Sha(now) != onlyIfSha) { why = "app.ini is no longer what was written"; return false; }
            byte[] edited = now;
            if (height.HasValue && !AppIniEditor.TrySetValue(edited, "View", HeightKey, height.Value, out edited, out why)) return false;
            if (vanishY.HasValue && !AppIniEditor.TrySetValue(edited, "View", VanishYKey, vanishY.Value, out edited, out why)) return false;
            if (_probe.SimRunning()) { why = "iRacing started"; return false; }
            if (!Swap(AppIni, edited, out why)) return false;
            // What app.ini holds now is Racing Desk's own last write of it: the check at the sim's next start holds it to this.
            NoteIni(null, height, null, vanishY);
            why = null;
            return true;
        }

        /// <summary>Keeps what Racing Desk has done to app.ini's values (see <see cref="RacingDeskStore.NoteIniValues"/>); true where there is no store to keep it in.</summary>
        private bool NoteIni(double? heightBefore, double? heightWritten, double? vanishBefore, double? vanishWritten)
        {
            if (_storePath == null) return true;
            try
            {
                using var store = new RacingDeskStore(_storePath);
                return store.NoteIniValues(heightBefore, heightWritten, vanishBefore, vanishWritten, _now());
            }
            catch (Exception ex) when (ex is Microsoft.Data.Sqlite.SqliteException || ex is IOException)
            {
                return false;
            }
        }

        /// <summary>
        /// At the host's start, with the sim closed: a two-file write that was cut short is put back, not finished (critique
        /// H1). app.ini written and the camera file not: app.ini's value is put back to what it was, by value, and the camera
        /// file is not touched. Both written: the record is let go. Neither: the record is let go. app.ini holding neither what
        /// was written nor what it was, or the camera file changed since: nothing is touched, and it is said. The camera file
        /// is the one the write named and no other: camera.ini's LastCarSet is not asked again.
        /// </summary>
        public IReadOnlyList<SettleNote> Settle()
        {
            var notes = new List<SettleNote>();
            if (_storePath == null || !File.Exists(_storePath)) return notes;
            if (_probe.SimRunning()) return notes;
            List<CarViewKeep> pending;
            using (var store = new RacingDeskStore(_storePath))
                pending = store.CarViewKeeps().Where(k => !string.IsNullOrEmpty(k.Intent)).ToList();
            foreach (var keep in pending)
            {
                string car = keep.CarPath;
                ViewIntent intent;
                try { intent = JsonSerializer.Deserialize<ViewIntent>(keep.Intent); }
                catch (JsonException) { intent = null; }
                if (intent == null)
                {
                    ClearIntent(car);
                    notes.Add(new SettleNote { Car = car, State = "info", Text = "a write's record could not be read; let go" });
                    continue;
                }
                string camRel = SafeRelative(intent.CamFile);
                string ini = Sha(ReadAppIni());
                string cam = camRel == null ? null : Sha(ReadShared(Path.Combine(_documents, camRel)));

                if (ini == intent.IniAfter && cam == intent.CamAfter)
                {
                    notes.Add(new SettleNote { Car = car, State = "info", Text = "the write was done; its record let go" });
                }
                else if (ini == intent.IniBefore && cam == intent.CamBefore)
                {
                    notes.Add(new SettleNote { Car = car, State = "info", Text = "the write was not begun; its record let go" });
                }
                else if (ini != null && ini == intent.IniAfter && cam != null && cam == intent.CamBefore)
                {
                    // Cut short: app.ini was written and the camera file was not. Put back, never finished.
                    double? h = intent.IniHeightBefore, v = intent.IniVanishYBefore;
                    if (!h.HasValue && !v.HasValue) (h, v) = ValuesToPutBackFrom(intent.IniBackup);
                    if (!h.HasValue && !v.HasValue)
                    {
                        notes.Add(new SettleNote { Car = car, State = "failed", Text = $"a step for {car} was cut short, and app.ini could not be put back: Racing Desk has no record of what it held. Its copy from before is at {intent.IniBackup}" });
                        ClearIntent(car);
                        continue;
                    }
                    if (PutIniValuesBack(h, v, intent.IniAfter, out string why))
                    {
                        string put = string.Join(", ", new[] { h.HasValue ? "driver height " + Words.Cm(h.Value) : null, v.HasValue ? "horizon " + v.Value.ToString("0.000", CultureInfo.InvariantCulture) : null }.Where(s => s != null));
                        notes.Add(new SettleNote
                        {
                            Car = car, State = "done",
                            Text = $"A step for {car} was cut short: Racing Desk was stopped after it wrote app.ini and before it wrote the car's camera file. app.ini was put back ({put}); the camera file was not touched.",
                        });
                    }
                    else
                    {
                        // Not put back: the record stays, and the next start tries again (or finds app.ini changed, and lets it go).
                        notes.Add(new SettleNote
                        {
                            Car = car, State = "failed",
                            Text = $"A step for {car} was cut short, and app.ini could not be put back ({why}). Racing Desk tries again at its next start. Its copy from before is at {intent.IniBackup}",
                        });
                        continue;
                    }
                }
                else
                {
                    notes.Add(new SettleNote
                    {
                        Car = car, State = "left",
                        Text = $"A step for {car} was cut short, and app.ini and its camera file have changed since (iRacing, or by hand): both are left as they are. Racing Desk's copies from before are at {intent.IniBackup} and {intent.CamBackup}",
                    });
                }
                ClearIntent(car);
            }
            return notes;
        }

        /// <summary>The two values as a backup of app.ini holds them: for a record that kept none of its own.</summary>
        private (double? Height, double? VanishY) ValuesToPutBackFrom(string backupPath)
        {
            byte[] backup = ReadShared(backupPath);
            byte[] now = ReadAppIni();
            if (backup == null || now == null) return (null, null);
            double? Differs(string key)
            {
                double? was = ReadIni(backup, key), is_ = ReadIni(now, key);
                return was.HasValue && is_.HasValue && Math.Abs(was.Value - is_.Value) >= IniTolerance ? was : null;
            }
            return (Differs(HeightKey), Differs(VanishYKey));
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

        /// <summary>
        /// The write is done, or given up: its record goes. A row that was made only to hold the record — nothing was kept in
        /// it — goes with it, so that a write that was refused leaves no row for undo to find.
        /// </summary>
        private void ClearIntent(string car)
        {
            if (_storePath == null) return;
            using var store = new RacingDeskStore(_storePath);
            var row = store.CarViewKeepOf(car);
            if (row == null) return;
            row.Intent = null;
            row.IntentAtUtc = null;
            if (KeepsAnything(row)) store.SaveCarViewKeep(row);
            else store.ForgetCarViewKeep(car);
        }

        /// <summary>Whether a row keeps anything of a written height, beside the record of a write.</summary>
        private static bool KeepsAnything(CarViewKeep k) =>
            k.WrittenSha != null || k.WrittenAtUtc.HasValue || k.OwnZ.HasValue || k.OwnVerticalShift.HasValue || k.WrittenZ.HasValue
            || k.WrittenVerticalShift.HasValue || k.OriginalBackup != null || k.PendingD.HasValue || k.AddedZ != 0 || k.AddedVerticalShift != 0;

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
