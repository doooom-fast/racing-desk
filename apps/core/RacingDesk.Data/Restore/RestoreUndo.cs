using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

namespace RacingDesk.Data.Restore
{
    /// <summary>
    /// Taking back what Racing Desk changed, on his word (Settings → Cars, and a car's View panel):
    /// <list type="bullet">
    /// <item>"Remove the brake profiles Racing Desk made": the cars' profiles, the switch profile, F24's binding and its link,
    /// by the ids Racing Desk kept — his six profiles and five keys stay. Only with the SmartControl editor closed (it would
    /// save its own copy back). Live keeps F24 in memory until it next starts, and then it does nothing.</item>
    /// <item>"Undo everything Racing Desk changed" for heights, one car or all: put back by value. A camera file's cockpit Z
    /// (and vertical shift) is set to what it held before Racing Desk wrote it — the same four bytes, nothing else of the file —
    /// and only while those four bytes are still what Racing Desk wrote; app.ini's driver height and horizon the same, one
    /// value at a time. What he has saved or changed since is his, and is left as it is, said with the path of the copy
    /// Racing Desk took before it first wrote. The whole-file copies are for recovering by hand, and are never put back by
    /// Racing Desk itself. Only with the sim closed.</item>
    /// </list>
    /// </summary>
    public static class RestoreUndo
    {
        public static StepResult Brakes(RestoreContext ctx)
        {
            if (ctx.Probe.EditorRunning()) return StepResult.No("undo-brakes", "close the SmartControl editor first: it would save its own copy of a profile back");
            var r = new StepResult { Action = "undo-brakes", Ok = true };
            using var store = ctx.OpenStore();
            var ours = store.RacingDeskProfileIds();
            var writer = ctx.Writer;
            foreach (var car in store.CarSmartControls())
            {
                var gone = writer.DeleteProfile(car.ProfileId, ours);
                if (!gone.Ok) { r.Ok = false; r.Saw.Add($"{car.ProfileName}: {gone.Why}"); continue; }
                store.ForgetCarSmartControl(car.CarPath);
                r.Did.Add($"profile '{car.ProfileName}' removed" + (gone.Why != null ? $" ({gone.Why})" : ""));
            }
            var sw = store.SmartControlSwitchRow();
            if (sw != null)
            {
                if (sw.BindingId.HasValue)
                {
                    var unbound = writer.Unbind(sw.BindingId.Value, sw.LinkId, ours);
                    if (!unbound.Ok) { r.Ok = false; r.Saw.Add($"{sw.Key}: {unbound.Why}"); }
                    else r.Did.Add($"{sw.Key}'s binding removed");
                }
                var gone = writer.DeleteProfile(sw.ProfileId, ours);
                if (!gone.Ok) { r.Ok = false; r.Saw.Add($"'{sw.ProfileName}': {gone.Why}"); }
                else
                {
                    store.ForgetSmartControlSwitch();
                    r.Did.Add($"the switch profile '{sw.ProfileName}' removed");
                    r.Saw.Add("If SmartControl shows an unknown profile as the one in use, pick one of yours there; Live forgets F24 when it next starts.");
                }
            }
            if (r.Did.Count == 0 && r.Saw.Count == 0) r.Saw.Add("Racing Desk had made no profiles");
            ctx.Say(null, "undo", r.Ok ? "done" : "failed", "Brake profiles: " + r.Text);
            return r;
        }

        /// <summary>One car's height (<paramref name="car"/>), or every car's and app.ini's (null), put back by value.</summary>
        public static StepResult Heights(RestoreContext ctx, string car = null)
        {
            string action = car == null ? "undo-heights" : "undo-height";
            if (ctx.Probe.SimRunning()) return StepResult.No(action, "iRacing is running: its files are put back only while it is closed");
            var r = new StepResult { Action = action, Ok = true };
            using var store = ctx.OpenStore();
            var rows = car == null ? store.CarViewKeeps().ToList() : new[] { store.CarViewKeepOf(car) }.Where(k => k != null).ToList();
            foreach (var keep in rows) PutBackCam(ctx, store, keep, r);
            if (car == null) PutBackIni(ctx, store, r);
            if (r.Did.Count == 0 && r.Saw.Count == 0) r.Saw.Add(car == null ? "Racing Desk had changed no height" : "Racing Desk had changed nothing of this car's");
            ctx.Say(car, "undo", r.Ok ? "done" : "failed", (car == null ? "Heights: " : "Height: ") + r.Text);
            return r;
        }

        /// <summary>
        /// A car's camera file back to what it held before Racing Desk wrote it, value by value and only where the file still
        /// holds what Racing Desk wrote. The row is let go once that is done, or the file is his now; a write that failed
        /// leaves it. The file is the one Racing Desk wrote (the row's), never one found again by camera.ini.
        /// </summary>
        internal static void PutBackCam(RestoreContext ctx, RacingDeskStore store, CarViewKeep keep, StepResult r)
        {
            string car = keep.CarPath;
            if (!string.IsNullOrEmpty(keep.Intent))
            {
                r.Saw.Add($"{car}: a step for it was cut short, and is put right when Racing Desk next starts; its camera file is left as it is until then");
                return;
            }
            string rel = ViewFiles.SafeRelative(keep.CamFile);
            var state = rel == null ? null : ctx.Files.CamAt(rel);
            if (state == null || !state.Exists)
            {
                store.ForgetCarViewKeep(car);
                r.Saw.Add($"{car}: its camera file is not there any more");
                return;
            }
            if (!state.Writable)
            {
                r.Ok = false;
                r.Saw.Add($"{car}: its camera file is not one Racing Desk writes ({state.Why}); it is left as it is");
                return;
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
                if (!put.Ok) { r.Ok = false; r.Saw.Add($"{car}: {put.Why}"); return; }
                r.Did.Add($"{car}: its camera file's " + string.Join(" and ", new[]
                {
                    change.CockpitZ.HasValue ? "cockpit Z is " + Words.Cm(change.CockpitZ.Value) : null,
                    change.CockpitShift.HasValue ? "vertical shift is " + change.CockpitShift.Value.ToString("0.###", CultureInfo.InvariantCulture) : null,
                }.Where(s => s != null)) + " again, as before Racing Desk");
            }
            else if (!hisNow) r.Saw.Add($"{car}: its camera file already holds what it held before Racing Desk");
            if (hisNow)
                r.Saw.Add($"{car}: you saved its camera file since Racing Desk wrote it; it is left as it is" + (keep.OriginalBackup != null ? $". The copy from before Racing Desk is at {keep.OriginalBackup}" : ""));
            store.ForgetCarViewKeep(car);
        }

        /// <summary>
        /// app.ini's driver height and horizon back to what they held before Racing Desk first wrote them, whichever step wrote
        /// them, each only while it still holds what Racing Desk last wrote. Once that is done what was kept of them is let go.
        /// </summary>
        internal static void PutBackIni(RestoreContext ctx, RacingDeskStore store, StepResult r)
        {
            var b = store.ViewBaselineRow();
            if (b == null || (b.IniOriginal == null && b.VanishYOriginal == null)) return;
            var change = new ViewChange { Restoring = true, Why = "undo: app.ini as it was" };
            void One(string label, string key, Func<double, string> say, double? original, double? wrote, Action<double, double> set)
            {
                if (!original.HasValue) return;
                double? now = ctx.Files.AppIniValue(key);
                if (!now.HasValue) { r.Saw.Add($"app.ini's {label} could not be read: it is left as it is"); return; }
                if (Math.Abs(now.Value - original.Value) < ViewFiles.IniTolerance) { r.Saw.Add($"app.ini's {label} is {say(original.Value)}, as it was before Racing Desk"); return; }
                if (wrote.HasValue && Math.Abs(now.Value - wrote.Value) < ViewFiles.IniTolerance) { set(original.Value, wrote.Value); return; }
                r.Saw.Add($"app.ini's {label} is {say(now.Value)} now, not what Racing Desk wrote: it was changed since (iRacing, or you), and is left as it is");
            }
            One("driver height", ViewFiles.HeightKey, Words.Cm, b.IniOriginal, b.IniHeightWritten, (own, wrote) => { change.IniHeight = own; change.ExpectIniHeight = wrote; });
            One("horizon", ViewFiles.VanishYKey, Horizon, b.VanishYOriginal, b.VanishYWritten, (own, wrote) => { change.IniVanishY = own; change.ExpectIniVanishY = wrote; });
            if (change.IniHeight.HasValue || change.IniVanishY.HasValue)
            {
                var ini = ctx.Files.Apply(change);
                if (!ini.Ok) { r.Ok = false; r.Saw.Add("app.ini: " + ini.Why); return; }
                r.Did.Add("app.ini's " + string.Join(" and ", new[]
                {
                    change.IniHeight.HasValue ? "driver height is " + Words.Cm(change.IniHeight.Value) : null,
                    change.IniVanishY.HasValue ? "horizon is " + Horizon(change.IniVanishY.Value) : null,
                }.Where(s => s != null)) + " again, as before Racing Desk");
            }
            store.ForgetIniValues();
        }

        private static string Horizon(double v) => v.ToString("0.000", CultureInfo.InvariantCulture);
    }
}
