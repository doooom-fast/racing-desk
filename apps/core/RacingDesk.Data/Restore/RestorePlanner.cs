using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using RacingDesk.Data.Pedals;

namespace RacingDesk.Data.Restore
{
    /// <summary>What would be kept in one car's camera file, or why nothing would.</summary>
    public sealed class ViewPlan
    {
        public string Car { get; set; }
        public string Name { get; set; }
        public string CamFile { get; set; }
        public bool FromLastCarSet { get; set; }
        public bool HasFile { get; set; }
        public bool Writable { get; set; }
        public string Why { get; set; }

        /// <summary>The cockpit Z the file holds now, and the one it would be given.</summary>
        public double? FileZ { get; set; }
        public double? NewZ { get; set; }

        /// <summary>The height he chose in the car (app.ini's, when he drove it), and the Z the file had then.</summary>
        public double? ChosenHeight { get; set; }
        public double? DrivenZ { get; set; }
        public bool Chosen { get; set; }

        /// <summary>The height he would have in the car: S in app.ini plus the file's Z.</summary>
        public double? Effective { get; set; }

        /// <summary>"would-move", "already", "kept", "no-file", "not-writable", "beyond", "inherited", "nothing".</summary>
        public string State { get; set; }

        /// <summary>The line the desk's View panel shows.</summary>
        public string Words { get; set; }
    }

    /// <summary>What a car's own SmartControl profile would be, or why there would be none.</summary>
    public sealed class BrakesPlan
    {
        public string Car { get; set; }
        public string Name { get; set; }
        public string BaseName { get; set; }
        public string BaseId { get; set; }
        public double? BaseKg { get; set; }
        public double? StoredKg { get; set; }
        public int? Kg { get; set; }

        /// <summary>"stored" (the force his keys last set in the car) or "base" (his decision for a car he never set one in).</summary>
        public string KgFrom { get; set; }
        public string ProfileName { get; set; }
        public string ProfileId { get; set; }

        /// <summary>"would-make", "made", "none" (his choice), "no-base", "gone", "refused".</summary>
        public string State { get; set; }
        public string Why { get; set; }

        /// <summary>The line the desk's Pedals panel shows.</summary>
        public string Words { get; set; }
    }

    public sealed class RestorePlan
    {
        public double StartHeight { get; set; }
        public double? AppIniHeight { get; set; }
        public string AppIniWords { get; set; }
        public bool SmartControlFound { get; set; }
        public List<ViewPlan> Views { get; } = new List<ViewPlan>();
        public List<BrakesPlan> Brakes { get; } = new List<BrakesPlan>();

        /// <summary>The dry run, as lines: the heights first (the one-time move is what trial lists first), then the profiles.</summary>
        public List<string> Lines { get; } = new List<string>();
        public DateTime MadeAtUtc { get; set; }
    }

    /// <summary>
    /// What trial says it would do, worked out from the store, iRacing's files and SmartControl's database — all read, nothing
    /// written (docs/view-and-pedals-plan.md). The heights: each car with a view he chose and a camera file would have its
    /// height kept in the file (new Z = the height he chose + the Z he drove it with − S), and app.ini would hold S for every
    /// car. The brakes: each car with a base would get its own profile, from that base, at the force his keys last set in it,
    /// or, where he never set one, at the base's own force (his decision of 2026-10-02: LightBrake 45 kg, Default 80 kg).
    /// </summary>
    public static class RestorePlanner
    {
        public static RestorePlan Plan(RacingDeskStore store, ViewFiles files, SmartControlSnapshot smartControl, double startHeight = RestorePolicy.StartHeight, DateTime? now = null)
        {
            var plan = new RestorePlan { StartHeight = startHeight, MadeAtUtc = now ?? DateTime.UtcNow, SmartControlFound = smartControl != null };
            var names = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (store != null) foreach (var car in store.Cars()) names[car.CarPath] = car.Name;
            string NameOf(string car) => names.TryGetValue(car, out var n) && !string.IsNullOrWhiteSpace(n) ? n.Trim() : car;

            // ── Heights ──
            plan.AppIniHeight = files?.AppIniHeight();
            plan.AppIniWords = plan.AppIniHeight == null ? "app.ini's height could not be read"
                : Math.Abs(plan.AppIniHeight.Value - startHeight) < RestorePolicy.SmallestChange ? $"app.ini holds {Words.Cm(startHeight)}, the starting height every car launches with"
                : $"app.ini holds {Words.Cm(plan.AppIniHeight.Value)}; it would be put back to {Words.Cm(startHeight)}, the starting height every car launches with";

            var keeps = store?.CarViewKeeps().ToDictionary(k => k.CarPath, StringComparer.OrdinalIgnoreCase) ?? new Dictionary<string, CarViewKeep>(StringComparer.OrdinalIgnoreCase);
            var views = store?.CarViewsList() ?? new List<CarView>();
            foreach (var view in views.OrderBy(v => NameOf(v.CarPath), StringComparer.OrdinalIgnoreCase))
                plan.Views.Add(PlanView(view, NameOf(view.CarPath), files, startHeight, keeps.TryGetValue(view.CarPath, out var k) ? k : null));

            // ── Brakes ──
            if (store != null)
            {
                var facts = store.CarPedalFactsList().ToDictionary(f => f.CarPath, StringComparer.OrdinalIgnoreCase);
                var made = store.CarSmartControls().ToDictionary(c => c.CarPath, StringComparer.OrdinalIgnoreCase);
                var pedals = store.CarPedalsList();
                var taken = new List<string>(smartControl?.Profiles.Select(p => p.Name) ?? Enumerable.Empty<string>());
                foreach (var bound in pedals.OrderBy(p => NameOf(p.CarPath), StringComparer.OrdinalIgnoreCase))
                {
                    facts.TryGetValue(bound.CarPath, out var f);
                    made.TryGetValue(bound.CarPath, out var mine);
                    var b = PlanBrakes(bound, f, mine, NameOf(bound.CarPath), smartControl, taken);
                    if (b.ProfileName != null && b.State == "would-make") taken.Add(b.ProfileName);
                    plan.Brakes.Add(b);
                }
                // A car he chose to have no profile: said, so the list is whole.
                foreach (var f in facts.Values.Where(f => f.GivenBy == "none" && !pedals.Any(p => string.Equals(p.CarPath, f.CarPath, StringComparison.OrdinalIgnoreCase))))
                    plan.Brakes.Add(new BrakesPlan { Car = f.CarPath, Name = NameOf(f.CarPath), State = "none", StoredKg = f.ForceKg, Words = "You chose that this car has no profile of its own: Racing Desk makes none and switches nothing." });
            }

            // ── The dry run in words ──
            plan.Lines.Add("Height: " + plan.AppIniWords + ".");
            foreach (var v in plan.Views) plan.Lines.Add($"Height, {v.Name}: {v.Words}");
            if (!plan.SmartControlFound) plan.Lines.Add("Brakes: SmartControl's database could not be read, so no profile would be made.");
            else if (store?.SmartControlSwitchRow() == null)
                plan.Lines.Add($"Brakes: once, in the first run (A2), with the SmartControl editor and Live closed: the profile '{RestorePolicy.SwitchProfileName}' "
                               + $"(a copy of Default) and {RestorePolicy.SwitchKey} · Set profile in Live's {RestorePolicy.LivePresetName} preset. Your own profiles, presets and keys stay as they are.");
            foreach (var b in plan.Brakes) plan.Lines.Add($"Brakes, {b.Name}: {b.Words}");
            return plan;
        }

        public static ViewPlan PlanView(CarView view, string name, ViewFiles files, double startHeight, CarViewKeep keep = null)
        {
            var p = new ViewPlan { Car = view.CarPath, Name = name, Chosen = view.Chosen, ChosenHeight = view.DriverHeight, DrivenZ = view.SeatZ };
            var cam = files?.Cam(view.CarPath);
            if (cam != null)
            {
                p.CamFile = cam.RelativePath;
                p.FromLastCarSet = cam.FromLastCarSet;
                p.HasFile = cam.Exists;
                p.Writable = cam.Writable;
                p.Why = cam.Why;
                p.FileZ = cam.Z;
            }

            if (keep != null && keep.WrittenZ.HasValue)
            {
                p.State = "kept";
                p.Effective = startHeight + keep.WrittenZ.Value;
                p.Words = $"Height {Words.Cm(p.Effective.Value)}, kept in its camera file — iRacing puts it back when you get in.";
                return p;
            }
            if (!view.Chosen)
            {
                p.State = "inherited";
                p.Words = "Its view was carried over from the car driven before it, and not changed in this one: nothing is kept for it. "
                          + (p.HasFile ? $"With app.ini at {Words.Cm(startHeight)} it would start at {Words.Cm(startHeight + (p.FileZ ?? 0))}."
                                       : $"It would start at {Words.Cm(startHeight)}.");
                return p;
            }
            if (view.DriverHeight == null)
            {
                p.State = "nothing";
                p.Words = "Its height was not recorded.";
                return p;
            }
            if (!p.HasFile)
            {
                p.State = "no-file";
                p.Words = $"Trial: {Words.Cm(view.DriverHeight.Value)} is kept here, and iRacing cannot put it back until this car has a camera file: "
                          + "save one once in the car (Ctrl+F12, Save Car, keep the name car.cam).";
                return p;
            }
            if (!p.Writable)
            {
                p.State = "not-writable";
                p.Words = $"Trial: its camera file is not one Racing Desk writes ({p.Why}); {Words.Cm(view.DriverHeight.Value)} is kept here only.";
                return p;
            }
            double driven = view.SeatZ ?? p.FileZ ?? 0;
            double newZ = Math.Round(view.DriverHeight.Value + driven - startHeight, 4);
            p.NewZ = newZ;
            p.Effective = startHeight + newZ;
            if (Math.Abs(newZ) > RestorePolicy.MaxCockpitZ + 1e-9)
            {
                p.State = "beyond";
                p.Words = $"Trial: its height would need a cockpit Z of {Words.Cm(newZ)}, beyond the ±{Words.Cm(RestorePolicy.MaxCockpitZ)} kept to until a test shows more: nothing would be written.";
                return p;
            }
            if (p.FileZ.HasValue && Math.Abs(newZ - p.FileZ.Value) < RestorePolicy.SmallestChange)
            {
                p.State = "already";
                p.Words = $"Height {Words.Cm(p.Effective.Value)}: its camera file already holds it with app.ini at {Words.Cm(startHeight)}; nothing would change.";
                return p;
            }
            p.State = "would-move";
            p.Words = $"Trial: would keep the height you chose in it, {Words.Cm(view.DriverHeight.Value + driven)} in all "
                      + $"(app.ini {Words.Cm(view.DriverHeight.Value)}, its camera file {Words.Cm(driven)}), in its camera file: "
                      + $"cockpit Z {Words.Cm(p.FileZ ?? 0)} → {Words.Cm(newZ)}, with app.ini at {Words.Cm(startHeight)} for every car.";
            return p;
        }

        public static BrakesPlan PlanBrakes(CarPedals bound, CarPedalFacts facts, CarSmartControl mine, string name, SmartControlSnapshot smartControl, IEnumerable<string> takenNames)
        {
            var p = new BrakesPlan { Car = bound.CarPath, Name = name, BaseName = bound.ProfileName?.Trim(), BaseId = bound.ProfileId, StoredKg = facts?.ForceKg };
            if (facts?.GivenBy == "none")
            {
                p.State = "none";
                p.Words = "You chose that this car has no profile of its own: Racing Desk makes none and switches nothing.";
                return p;
            }
            if (mine != null)
            {
                p.ProfileId = mine.ProfileId;
                p.ProfileName = mine.ProfileName;
                p.Kg = (int)Math.Round(mine.WaitingKg ?? mine.WrittenKg);
                if (mine.State == "gone")
                {
                    p.State = "gone";
                    p.Words = $"Its profile '{mine.ProfileName}' was deleted in SmartControl: it has none until you ask for one again.";
                    return p;
                }
                p.State = "made";
                p.Words = $"Its own SmartControl profile '{mine.ProfileName}' (from {mine.BaseName}), {p.Kg} kg — switched to when you get in, parked.";
                return p;
            }
            var from = smartControl?.Profiles.FirstOrDefault(x => x.Id == bound.ProfileId)
                       ?? smartControl?.Profiles.FirstOrDefault(x => string.Equals(x.Name?.Trim(), p.BaseName, StringComparison.OrdinalIgnoreCase));
            if (from == null)
            {
                p.State = "no-base";
                p.Words = smartControl == null ? "Trial: SmartControl could not be read, so its profile could not be made."
                                               : $"Trial: SmartControl has no '{p.BaseName}' to make its profile from.";
                return p;
            }
            p.BaseId = from.Id;
            p.BaseName = from.Name?.Trim();
            if (SmartControlProfileEditor.TryReadForce(from.Data, out double baseKg)) p.BaseKg = baseKg;
            int? stored = Usable(facts?.ForceKg);
            if (stored.HasValue) { p.Kg = stored; p.KgFrom = "stored"; }
            else
            {
                // His decision for a car whose force he never set: its base's own force.
                int? own = Usable(p.BaseKg) ?? (RestorePolicy.BaseForces.TryGetValue(p.BaseName ?? "", out int kg) ? kg : (int?)null);
                p.Kg = own;
                p.KgFrom = "base";
            }
            if (p.Kg == null)
            {
                p.State = "refused";
                p.Why = $"no force within {SmartControlProfileEditor.MinKg}–{SmartControlProfileEditor.MaxKg} kg";
                p.Words = $"Trial: its profile could not be made: {p.Why}.";
                return p;
            }
            p.ProfileName = SmartControlProfileEditor.UniqueName(name, takenNames);
            if (!SmartControlProfileEditor.TryEdit(from.Data, p.Kg.Value, SmartControlProfileEditor.DescriptionFor(name, p.BaseName), out _, out string why))
            {
                p.State = "refused";
                p.Why = why;
                p.Words = $"Trial: its profile could not be made from {p.BaseName}: {why}.";
                return p;
            }
            p.State = "would-make";
            p.Words = $"Trial: would make its own SmartControl profile '{p.ProfileName}' from {p.BaseName} at {p.Kg} kg"
                      + (p.KgFrom == "base" ? $" ({p.BaseName}'s own force: you have not set one in this car)" : " (the force you last set in it)")
                      + ", and switch to it when you get in, parked.";
            return p;
        }

        /// <summary>A force Racing Desk would write: whole kilograms within SmartControl's limits; null for anything else.</summary>
        public static int? Usable(double? kg)
        {
            if (kg == null || double.IsNaN(kg.Value) || double.IsInfinity(kg.Value)) return null;
            int whole = (int)Math.Round(kg.Value);
            if (Math.Abs(whole - kg.Value) > 0.01) return null;
            return whole >= SmartControlProfileEditor.MinKg && whole <= SmartControlProfileEditor.MaxKg ? whole : (int?)null;
        }
    }

    /// <summary>Numbers as the desk and the HUD say them.</summary>
    public static class Words
    {
        /// <summary>Metres as centimetres to one place, signed with a real minus: -0.02 is "−2.0 cm".</summary>
        public static string Cm(double metres)
        {
            double cm = Math.Round(metres * 100, 1);
            if (Math.Abs(cm) < 0.05) return "0.0 cm";
            return (cm > 0 ? "+" : "−") + Math.Abs(cm).ToString("0.0", CultureInfo.InvariantCulture) + " cm";
        }

        public static string Kg(double kg) => kg.ToString("0.#", CultureInfo.InvariantCulture) + " kg";
    }
}
