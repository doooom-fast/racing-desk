using System;
using System.Globalization;
using System.Linq;

namespace RacingDesk.Data.Restore
{
    /// <summary>
    /// Taking back what Racing Desk changed, on his word ("Undo what Racing Desk changed", Settings → Cars), and the height
    /// self-check's put-back:
    /// <list type="bullet">
    /// <item>SmartControl: F24's binding and its link, and the rows Racing Desk made, by the ids it kept — his own profiles,
    /// presets and keys stay. Only with the SmartControl editor closed (it would save its own copy back), and backed up first.
    /// Racing Desk's switch profile is left in place once F24 has ever been sent, because the pedals may be on it: SmartControl
    /// would show a profile it does not have. One sentence says what to pick in SmartControl to finish. Live forgets F24 when it
    /// next starts.</item>
    /// <item>The view files, by value: a camera file's cockpit Z (and vertical shift) is set to what it held before Racing Desk
    /// wrote it — the same four bytes, nothing else of the file — and only while those four bytes are still what Racing Desk
    /// wrote; app.ini's seat height and horizon the same, one value at a time. What he has saved or changed since is his, and is
    /// left as it is, said with the path of the copy Racing Desk took before it first wrote. The whole-file copies are for
    /// recovering by hand, and are never put back by Racing Desk itself. Only with the sim closed.</item>
    /// </list>
    /// </summary>
    public static class RestoreUndo
    {
        /// <summary>Everything: SmartControl's part and the view files' part, each on its own (one that cannot be done now does not stop the other).</summary>
        public static RestoreResult Everything(RestoreContext ctx)
        {
            var r = new RestoreResult { Action = "undo", Ok = true };
            Brakes(ctx, r);
            Heights(ctx, r, iniToo: true);
            if (r.Did.Count == 0 && r.Saw.Count == 0) r.Saw.Add("Racing Desk had changed nothing");
            ctx.Say(null, "undo", r.Ok ? "done" : "failed", "Undo: " + r.Text);
            return r;
        }

        internal static void Brakes(RestoreContext ctx, RestoreResult r)
        {
            using var store = ctx.OpenStore();
            if (!store.HasRestoreTables) return;
            var sw = store.SmartControlSwitchRow();
            var cars = store.CarSmartControls();
            if (sw == null && cars.Count == 0) return;
            if (ctx.Probe.EditorRunning())
            {
                r.Ok = false;
                r.Saw.Add("SmartControl was left as it is: close the SmartControl editor, then press undo again");
                return;
            }
            string notCopied = ctx.BackUpBeforeWrite("undo");
            if (notCopied != null)
            {
                r.Ok = false;
                r.Saw.Add("SmartControl was left as it is: its database couldn't be copied first (" + notCopied + ")");
                return;
            }
            var ours = store.RacingDeskProfileIds();
            var writer = ctx.Writer;
            foreach (var car in cars)
            {
                var gone = writer.DeleteProfile(car.ProfileId, ours);
                if (!gone.Ok) { r.Ok = false; r.Saw.Add($"SmartControl's profile '{car.ProfileName}': {gone.Why}"); continue; }
                store.ForgetCarSmartControl(car.CarPath);
                r.Did.Add($"SmartControl's profile '{car.ProfileName}' removed");
            }
            if (sw == null) return;
            if (sw.BindingId.HasValue)
            {
                var unbound = writer.Unbind(sw.BindingId.Value, sw.LinkId, ours);
                if (!unbound.Ok) { r.Ok = false; r.Saw.Add($"the {sw.Key} key: {unbound.Why}"); return; }
                r.Did.Add($"the {sw.Key} key taken out of SmartControl Live");
                sw.BindingId = null;
                sw.LinkId = null;
                store.SaveSmartControlSwitch(sw);
            }
            if (sw.SentAtUtc.HasValue)
            {
                // The pedals may be on it: taking it away would leave them on a profile SmartControl does not have. It is his now.
                store.ForgetSmartControlSwitch();
                r.Saw.Add($"To finish, pick one of your own profiles in SmartControl, then delete the profile '{sw.ProfileName}' there");
                return;
            }
            var removed = writer.DeleteProfile(sw.ProfileId, ours);
            if (!removed.Ok) { r.Ok = false; r.Saw.Add($"SmartControl's profile '{sw.ProfileName}': {removed.Why}"); return; }
            store.ForgetSmartControlSwitch();
            r.Did.Add($"SmartControl's profile '{sw.ProfileName}' removed");
        }

        /// <summary>
        /// Every car's camera file put back by value, and app.ini's values too where <paramref name="iniToo"/>; the one-time move
        /// of his earlier heights is then owed again, should the height part be turned on again.
        /// </summary>
        internal static void Heights(RestoreContext ctx, RestoreResult r, bool iniToo)
        {
            using var store = ctx.OpenStore();
            if (!store.HasRestoreTables) return;
            var rows = store.CarViewKeeps().ToList();
            var b = store.ViewBaselineRow();
            bool ini = iniToo && b != null && (b.IniOriginal != null || b.VanishYOriginal != null);
            if (rows.Count == 0 && !ini) return;
            if (ctx.Probe.SimRunning())
            {
                r.Ok = false;
                r.Saw.Add("The seat heights were left as they are: close iRacing, then press undo again");
                return;
            }
            bool allBack = true;
            foreach (var keep in rows) allBack &= PutBackCam(ctx, store, keep, r);
            if (ini) PutBackIni(ctx, store, r);
            if (allBack && b?.MigratedAtUtc != null) store.NoteHeightsMoved(null);
        }

        /// <summary>
        /// A car's camera file back to what it held before Racing Desk wrote it, value by value and only where the file still
        /// holds what Racing Desk wrote. The row is let go once that is done, or the file is his now; a write that failed leaves
        /// it, and answers false. The file is the one Racing Desk wrote (the row's), never one found again by camera.ini.
        /// </summary>
        internal static bool PutBackCam(RestoreContext ctx, RacingDeskStore store, CarViewKeep keep, RestoreResult r)
        {
            string car = keep.CarPath;
            string name = RestorePlanner.NameOf(store, car);
            if (!string.IsNullOrEmpty(keep.Intent))
            {
                r.Saw.Add($"{name}: a write of its camera file was cut short, and is put right when Racing Desk next starts; the file is left as it is until then");
                return false;
            }
            string rel = ViewFiles.SafeRelative(keep.CamFile);
            var state = rel == null ? null : ctx.Files.CamAt(rel);
            if (state == null || !state.Exists)
            {
                store.ForgetCarViewKeep(car);
                r.Saw.Add($"{name}: its camera file isn't there any more");
                return true;
            }
            if (!state.Writable)
            {
                r.Ok = false;
                r.Saw.Add($"{name}: its camera file isn't one Racing Desk writes ({state.Why}); it is left as it is");
                return false;
            }

            var change = new ViewChange { CarPath = car, CamFile = state.RelativePath, Restoring = true, Why = "undo: its camera file's cockpit as it was" };
            bool hisNow = false;
            void Put(double? own, double? wrote, double? now, Action<double, double> set)
            {
                if (!own.HasValue || !wrote.HasValue || ViewFiles.SameFloat(own.Value, wrote.Value)) return;   // Racing Desk added nothing here
                if (ViewFiles.HoldsFloat(now, wrote.Value)) set(own.Value, wrote.Value);                       // still what it wrote
                else if (!ViewFiles.HoldsFloat(now, own.Value)) hisNow = true;                                 // not that, nor what it was: his save since
            }
            Put(keep.OwnZ, keep.WrittenZ, state.Z, (own, wrote) => { change.CockpitZ = own; change.ExpectCockpitZ = wrote; });
            Put(keep.OwnVerticalShift, keep.WrittenVerticalShift, state.VerticalShift, (own, wrote) => { change.CockpitShift = own; change.ExpectCockpitShift = wrote; });

            if (change.CockpitZ.HasValue || change.CockpitShift.HasValue)
            {
                var put = ctx.Files.Apply(change);
                if (!put.Ok) { r.Ok = false; r.Saw.Add($"{name}: {put.Why}"); return false; }
                r.Did.Add($"{name}: its camera file's " + string.Join(" and ", new[]
                {
                    change.CockpitZ.HasValue ? "cockpit Z is " + Words.Cm(change.CockpitZ.Value) : null,
                    change.CockpitShift.HasValue ? "vertical shift is " + change.CockpitShift.Value.ToString("0.###", CultureInfo.InvariantCulture) : null,
                }.Where(s => s != null)) + " again, as before Racing Desk");
            }
            if (hisNow)
                r.Saw.Add($"{name}: you saved its camera file since Racing Desk wrote it, so it is left as it is" + (keep.OriginalBackup != null ? $"; the copy from before Racing Desk is at {keep.OriginalBackup}" : ""));
            store.ForgetCarViewKeep(car);
            return true;
        }

        /// <summary>
        /// app.ini's seat height and horizon back to what they held before Racing Desk first wrote them, each only while it still
        /// holds what Racing Desk last wrote. Once that is done what was kept of them is let go.
        /// </summary>
        internal static void PutBackIni(RestoreContext ctx, RacingDeskStore store, RestoreResult r)
        {
            var b = store.ViewBaselineRow();
            if (b == null || (b.IniOriginal == null && b.VanishYOriginal == null)) return;
            var change = new ViewChange { Restoring = true, Why = "undo: app.ini as it was" };
            void One(string label, string key, Func<double, string> say, double? original, double? wrote, Action<double, double> set)
            {
                if (!original.HasValue) return;
                double? now = ctx.Files.AppIniValue(key);
                if (!now.HasValue) { r.Saw.Add($"app.ini's {label} couldn't be read, so it is left as it is"); return; }
                if (Math.Abs(now.Value - original.Value) < ViewFiles.IniTolerance) return;          // as it was before Racing Desk already
                if (wrote.HasValue && Math.Abs(now.Value - wrote.Value) < ViewFiles.IniTolerance) { set(original.Value, wrote.Value); return; }
                r.Saw.Add($"app.ini's {label} is {say(now.Value)} now, not what Racing Desk wrote: it was changed since (by iRacing, or you), so it is left as it is");
            }
            One("seat height", ViewFiles.HeightKey, Words.Cm, b.IniOriginal, b.IniHeightWritten, (own, wrote) => { change.IniHeight = own; change.ExpectIniHeight = wrote; });
            One("horizon", ViewFiles.VanishYKey, Horizon, b.VanishYOriginal, b.VanishYWritten, (own, wrote) => { change.IniVanishY = own; change.ExpectIniVanishY = wrote; });
            if (change.IniHeight.HasValue || change.IniVanishY.HasValue)
            {
                var ini = ctx.Files.Apply(change);
                if (!ini.Ok) { r.Ok = false; r.Saw.Add("app.ini: " + ini.Why); return; }
                r.Did.Add("app.ini's " + string.Join(" and ", new[]
                {
                    change.IniHeight.HasValue ? "seat height is " + Words.Cm(change.IniHeight.Value) : null,
                    change.IniVanishY.HasValue ? "horizon is " + Horizon(change.IniVanishY.Value) : null,
                }.Where(s => s != null)) + " again, as before Racing Desk");
            }
            store.ForgetIniValues();
        }

        private static string Horizon(double v) => v.ToString("0.000", CultureInfo.InvariantCulture);
    }
}
