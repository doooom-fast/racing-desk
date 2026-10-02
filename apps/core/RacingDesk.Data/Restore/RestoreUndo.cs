using System;
using System.Collections.Generic;
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
    /// <item>"Undo everything Racing Desk changed" for heights, one car or all: a camera file Racing Desk last wrote is put back
    /// from its first original; one he has saved himself since keeps his save, less the height Racing Desk added; and, for
    /// all, app.ini's height goes back to what it held before Racing Desk first wrote it. Only with the sim closed.</item>
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

        /// <summary>One car's height (<paramref name="car"/>), or every car's and app.ini's (null).</summary>
        public static StepResult Heights(RestoreContext ctx, string car = null)
        {
            string action = car == null ? "undo-heights" : "undo-height";
            if (ctx.Probe.SimRunning()) return StepResult.No(action, "iRacing is running: its files are put back only while it is closed");
            var r = new StepResult { Action = action, Ok = true };
            using var store = ctx.OpenStore();
            var rows = car == null ? store.CarViewKeeps().ToList() : new[] { store.CarViewKeepOf(car) }.Where(k => k != null).ToList();
            foreach (var keep in rows)
            {
                string full = Path.Combine(ctx.Files.Documents, keep.CamFile);
                byte[] now = ViewFiles.ReadShared(full);
                if (now == null) { store.ForgetCarViewKeep(keep.CarPath); r.Saw.Add($"{keep.CarPath}: its camera file is not there any more"); continue; }
                if (ViewFiles.Sha(now) == keep.WrittenSha && keep.OriginalBackup != null && File.Exists(keep.OriginalBackup))
                {
                    var put = ctx.Files.Restore(keep.CamFile, keep.OriginalBackup);
                    if (!put.Ok) { r.Ok = false; r.Saw.Add($"{keep.CarPath}: {put.Why}"); continue; }
                    r.Did.Add($"{keep.CarPath}: its camera file is as it was before Racing Desk");
                }
                else
                {
                    // He saved the file himself since: his save stays, less what Racing Desk added on top.
                    var state = ctx.Files.Cam(keep.CarPath);
                    if (state == null || !state.Writable || state.Z == null) { r.Ok = false; r.Saw.Add($"{keep.CarPath}: its camera file is not one Racing Desk writes ({state?.Why})"); continue; }
                    if (Math.Abs(keep.AddedZ) >= RestorePolicy.SmallestChange || Math.Abs(keep.AddedVerticalShift) > 1e-6)
                    {
                        var change = new ViewChange
                        {
                            CarPath = keep.CarPath,
                            CockpitZ = Math.Abs(keep.AddedZ) >= RestorePolicy.SmallestChange ? state.Z.Value - keep.AddedZ : (double?)null,
                            CockpitShift = Math.Abs(keep.AddedVerticalShift) > 1e-6 && state.VerticalShift.HasValue ? state.VerticalShift.Value - keep.AddedVerticalShift : (double?)null,
                            Why = "undo: the height Racing Desk added",
                        };
                        var put = ctx.Files.Apply(change);
                        if (!put.Ok) { r.Ok = false; r.Saw.Add($"{keep.CarPath}: {put.Why}"); continue; }
                        r.Did.Add($"{keep.CarPath}: you saved its camera file since, so only the height Racing Desk added was taken off");
                    }
                    else r.Saw.Add($"{keep.CarPath}: you saved its camera file since and Racing Desk had added nothing to it");
                }
                store.ForgetCarViewKeep(keep.CarPath);
            }
            if (car == null)
            {
                var baseline = store.ViewBaselineRow();
                if (baseline?.IniOriginal != null)
                {
                    var ini = ctx.Files.Apply(new ViewChange { IniHeight = baseline.IniOriginal.Value, Why = "undo: app.ini's height as it was" });
                    if (ini.Ok) r.Did.Add($"app.ini's height is {Plugin.IRacing.AppIniEditor.Format(baseline.IniOriginal.Value)} again, as before Racing Desk");
                    else { r.Ok = false; r.Saw.Add("app.ini: " + ini.Why); }
                }
            }
            if (r.Did.Count == 0 && r.Saw.Count == 0) r.Saw.Add(car == null ? "Racing Desk had changed no height" : "Racing Desk had changed nothing of this car's");
            ctx.Say(car, "undo", r.Ok ? "done" : "failed", (car == null ? "Heights: " : "Height: ") + r.Text);
            return r;
        }
    }
}
