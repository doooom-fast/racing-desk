using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using RacingDesk.Core.Cars;
using RacingDesk.Data.Pedals;

namespace RacingDesk.Data.Restore
{
    /// <summary>A car's seat height as Racing Desk keeps it, or why it cannot.</summary>
    public sealed class ViewPlan
    {
        public string Car { get; set; }
        public string Name { get; set; }
        public string CamFile { get; set; }
        public bool FromLastCarSet { get; set; }
        public bool HasFile { get; set; }
        public bool Writable { get; set; }
        public string Why { get; set; }

        /// <summary>The cockpit Z the file holds now, and the one the one-time move would give it.</summary>
        public double? FileZ { get; set; }
        public double? NewZ { get; set; }

        /// <summary>The height he chose in the car (app.ini's, when he drove it).</summary>
        public double? ChosenHeight { get; set; }
        public bool Chosen { get; set; }

        /// <summary>The height he would have in the car: S in app.ini plus the file's Z.</summary>
        public double? Effective { get; set; }

        /// <summary>
        /// "kept" (Racing Desk keeps it in the camera file), "to-move" (a height he chose before this build, not in the file yet:
        /// the one-time move), "already", "no-file", "not-writable", "beyond", "not-chosen", "nothing".
        /// </summary>
        public string State { get; set; }

        /// <summary>A sentence for the Cars page where there is something he needs to know (no camera file, one it cannot write, a height beyond the limit); else null.</summary>
        public string Words { get; set; }
    }

    /// <summary>The brakes Racing Desk puts on when he gets in a car: its base at its force, as the bytes of a profile, or why none.</summary>
    public sealed class BrakesPlan
    {
        public string Car { get; set; }
        public string Name { get; set; }
        public string BaseName { get; set; }
        public string BaseId { get; set; }

        /// <summary>"store" (the profile the car was given, by the rule or by him) or "list" (the rule, by the car list, before it was given one).</summary>
        public string BaseFrom { get; set; }
        public int? Kg { get; set; }

        /// <summary>"saved" (the force his keys last set in the car) or "base" (his decision for a car he never set one in: 45 or 80).</summary>
        public string KgFrom { get; set; }

        /// <summary>"on", "none" (his choice), "no-base", "refused".</summary>
        public string State { get; set; }
        public string Why { get; set; }

        /// <summary>The profile's bytes, the base's with the force, its hash and the Description changed; and their SHA-256.</summary>
        public byte[] Bytes { get; set; }
        public string Sha { get; set; }

        /// <summary>The sentence the Cars page's Pedals panel shows.</summary>
        public string Words { get; set; }
    }

    public sealed class RestorePlan
    {
        public double StartHeight { get; set; }
        public double? AppIniHeight { get; set; }
        public bool SmartControlFound { get; set; }
        public List<ViewPlan> Views { get; } = new List<ViewPlan>();
        public List<BrakesPlan> Brakes { get; } = new List<BrakesPlan>();

        /// <summary>What is kept for each car, as lines (the host's <c>restore --dry-run</c>).</summary>
        public List<string> Lines { get; } = new List<string>();
        public DateTime MadeAtUtc { get; set; }
    }

    /// <summary>
    /// What Racing Desk keeps for each car, worked out from the store, iRacing's files and SmartControl's database, all read and
    /// none written (docs/view-and-pedals-plan.md). The height: app.ini holds S for every car and each car's own height is in
    /// its camera file's cockpit Z. The brakes: the car's base (the profile the rule gave it, or the one he chose) at the force
    /// his keys last set in it, or, where he never set one, at the base's own force (his decision: LightBrake 45 kg, Default 80).
    /// </summary>
    public static class RestorePlanner
    {
        public static RestorePlan Plan(RacingDeskStore store, ViewFiles files, SmartControlSnapshot smartControl, double startHeight = RestorePolicy.StartHeight, DateTime? now = null)
        {
            var plan = new RestorePlan { StartHeight = startHeight, MadeAtUtc = now ?? DateTime.UtcNow, SmartControlFound = smartControl != null };
            var names = Names(store);
            string NameOf(string car) => names.TryGetValue(car, out var n) && !string.IsNullOrWhiteSpace(n) ? n.Trim() : car;

            plan.AppIniHeight = files?.AppIniHeight();
            var keeps = store?.CarViewKeeps().ToDictionary(k => k.CarPath, StringComparer.OrdinalIgnoreCase) ?? new Dictionary<string, CarViewKeep>(StringComparer.OrdinalIgnoreCase);
            foreach (var view in (store?.CarViewsList() ?? new List<CarView>()).OrderBy(v => NameOf(v.CarPath), StringComparer.OrdinalIgnoreCase))
                plan.Views.Add(PlanView(view, NameOf(view.CarPath), files, startHeight, keeps.TryGetValue(view.CarPath, out var k) ? k : null));

            if (store != null)
            {
                var cars = store.CarPedalsList().Select(p => p.CarPath)
                    .Concat(store.CarPedalFactsList().Select(f => f.CarPath))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .OrderBy(NameOf, StringComparer.OrdinalIgnoreCase);
                foreach (string car in cars) plan.Brakes.Add(PlanBrakes(store, car, NameOf(car), smartControl));
            }

            plan.Lines.Add("Seat height: app.ini " + (plan.AppIniHeight == null ? "could not be read"
                : $"holds {Words.Cm(plan.AppIniHeight.Value)}; every car starts at {Words.Cm(startHeight)} there, and its own height is kept in its camera file") + ".");
            foreach (var v in plan.Views) plan.Lines.Add($"Seat height, {v.Name}: " + (v.Words ?? Short(v)));
            if (!plan.SmartControlFound) plan.Lines.Add("Brakes: SmartControl's database could not be read.");
            foreach (var b in plan.Brakes) plan.Lines.Add($"Brakes, {b.Name}: {b.Words}");
            return plan;
        }

        private static Dictionary<string, string> Names(RacingDeskStore store)
        {
            var names = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (store != null) foreach (var car in store.Cars()) names[car.CarPath] = car.Name;
            return names;
        }

        /// <summary>The car's name as the store has it, else its folder.</summary>
        public static string NameOf(RacingDeskStore store, string car, string fallback = null)
        {
            string name = store?.Cars().FirstOrDefault(c => string.Equals(c.CarPath, car, StringComparison.OrdinalIgnoreCase))?.Name;
            return !string.IsNullOrWhiteSpace(name) ? name.Trim() : !string.IsNullOrWhiteSpace(fallback) ? fallback.Trim() : car;
        }

        private static string Short(ViewPlan v) => v.State switch
        {
            "kept" => $"{Words.Cm(v.Effective ?? 0)}, kept in its camera file.",
            "to-move" => $"{Words.Cm(v.ChosenHeight ?? 0)} goes into its camera file (cockpit Z {Words.Cm(v.FileZ ?? 0)} to {Words.Cm(v.NewZ ?? 0)}) the next time Racing Desk starts with iRacing closed.",
            "already" => $"{Words.Cm(v.Effective ?? 0)}, in its camera file already.",
            _ => "nothing to keep.",
        };

        public static ViewPlan PlanView(CarView view, string name, ViewFiles files, double startHeight, CarViewKeep keep = null)
        {
            var p = new ViewPlan { Car = view.CarPath, Name = name, Chosen = view.Chosen, ChosenHeight = view.DriverHeight };
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

            if (!p.HasFile)
            {
                p.State = "no-file";
                p.Words = (view.DriverHeight.HasValue ? $"Its seat height, {Words.Cm(view.DriverHeight.Value)}, is kept here only" : "Its seat height can't be put back")
                          + $" because it has no camera file: save one once, {RestorePolicy.SaveACameraFile}.";
                return p;
            }
            if (!p.Writable)
            {
                p.State = "not-writable";
                p.Words = $"Its seat height is kept here only: its camera file isn't one Racing Desk can write ({p.Why}).";
                return p;
            }
            if (keep != null && keep.WrittenZ.HasValue)
            {
                p.State = "kept";
                p.Effective = startHeight + keep.WrittenZ.Value;
                return p;
            }
            if (!view.Chosen || view.DriverHeight == null)
            {
                p.State = view.DriverHeight == null ? "nothing" : "not-chosen";
                p.Effective = startHeight + (p.FileZ ?? 0);
                return p;
            }
            // The one-time move of a height he chose before: what app.ini held then above S, added to the file's Z as it is now
            // (a camera file he has saved since keeps what he saved, and gets the app.ini part on top).
            double newZ = Math.Round((p.FileZ ?? 0) + view.DriverHeight.Value - startHeight, 4);
            p.NewZ = newZ;
            p.Effective = startHeight + newZ;
            if (Math.Abs(newZ) > RestorePolicy.MaxCockpitZ + 1e-9)
            {
                p.State = "beyond";
                p.Words = $"Its seat height isn't put back: it would need {Words.Cm(newZ)} in its camera file, beyond the ±{Words.Cm(RestorePolicy.MaxCockpitZ).TrimStart('+')} Racing Desk keeps to.";
                return p;
            }
            p.State = Math.Abs(view.DriverHeight.Value - startHeight) < RestorePolicy.SmallestChange ? "already" : "to-move";
            return p;
        }

        /// <summary>The car's brakes, as they go on the pedals: from the store and SmartControl's profiles, in words for the Cars page.</summary>
        public static BrakesPlan PlanBrakes(RacingDeskStore store, string car, string name, SmartControlSnapshot smartControl, CarList list = null)
        {
            var facts = store.CarPedalFactsOf(car);
            var bound = store.CarPedalsOf(car);
            var p = new BrakesPlan { Car = car, Name = name };
            if (facts?.GivenBy == "none" && bound == null)
            {
                p.State = "none";
                p.Words = "None: you chose no profile for this car, so its brakes are left as they are.";
                return p;
            }

            // The base: the profile the car was given (by the rule, or by him on the desk), else the rule's by the car list.
            SmartControlProfile from = null;
            if (bound != null)
            {
                p.BaseFrom = "store";
                p.BaseName = bound.ProfileName?.Trim();
                from = smartControl?.Profiles.FirstOrDefault(x => x.Id == bound.ProfileId)
                       ?? smartControl?.Profiles.FirstOrDefault(x => string.Equals(x.Name?.Trim(), p.BaseName, StringComparison.OrdinalIgnoreCase));
            }
            else
            {
                string byList = CarPedalsKeeper.BaseByList((list ?? CarList.Default).Find(car));
                if (byList == null)
                {
                    p.State = "no-base";
                    p.Words = "Not yet: Racing Desk works out this car's brakes at the end of its first drive.";
                    return p;
                }
                p.BaseFrom = "list";
                p.BaseName = byList;
                from = smartControl?.Profiles.FirstOrDefault(x => string.Equals(x.Name?.Trim(), byList, StringComparison.OrdinalIgnoreCase));
            }
            if (from == null)
            {
                p.State = "no-base";
                p.Why = smartControl == null ? "SmartControl's database couldn't be read" : $"SmartControl has no profile named {p.BaseName}";
                p.Words = $"Its brakes can't be put on: {p.Why}.";
                return p;
            }
            p.BaseId = from.Id;
            p.BaseName = from.Name?.Trim();

            int? saved = Usable(facts?.ForceKg);
            if (saved.HasValue) { p.Kg = saved; p.KgFrom = "saved"; }
            else
            {
                // His decision for a car whose force he never set: its base's own force — 45 for LightBrake, 80 for Default — and for
                // another base he chose, the force that profile holds.
                p.Kg = RestorePolicy.BaseForces.TryGetValue(p.BaseName ?? "", out int own) ? own
                     : SmartControlProfileEditor.TryReadForce(from.Data, out double kg) ? Usable(kg) : null;
                p.KgFrom = "base";
            }
            if (p.Kg == null)
            {
                p.State = "refused";
                p.Why = $"no force between {SmartControlProfileEditor.MinKg} and {SmartControlProfileEditor.MaxKg} kg";
                p.Words = $"Its brakes can't be put on: {p.Why}.";
                return p;
            }
            if (!SmartControlProfileEditor.TryEdit(from.Data, p.Kg.Value, SmartControlProfileEditor.DescriptionFor(name, p.BaseName), out byte[] bytes, out string why))
            {
                p.State = "refused";
                p.Why = why;
                p.Words = $"Its brakes can't be put on: {p.BaseName} at {p.Kg} kg couldn't be made ({why}).";
                return p;
            }
            p.Bytes = bytes;
            p.Sha = ViewFiles.Sha(bytes);
            p.State = "on";
            p.Words = $"Put on when you get in and stop with the brake released: {p.BaseName} at {p.Kg} kg"
                      + (p.KgFrom == "base" ? ", its own force, as you haven't set one in this car." : ", the force you last set in it.");
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

    /// <summary>Numbers as the desk says them.</summary>
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
