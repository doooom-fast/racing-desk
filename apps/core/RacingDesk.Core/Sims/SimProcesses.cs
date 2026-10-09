using System;
using System.Collections.Generic;

namespace RacingDesk.Core.Sims
{
    /// <summary>
    /// The sims on the rig, by the names Windows lists their processes under (no ".exe"), in one place: iRacing's two,
    /// Assetto Corsa's (<c>acs</c>; <c>AssettoCorsa.exe</c> is its launcher, as Content Manager is), Assetto Corsa EVO's and
    /// Assetto Corsa Competizione's. Everything that asks "is a sim running" — the host's heavy I/O, the HUD's screen — goes
    /// by <see cref="All"/>; the writers of iRacing's own files (app.ini, a car's camera file) go by <see cref="IRacing"/>, since
    /// those files are iRacing's alone. Nothing of Racing Desk's may load the machine while he drives, whatever the sim.
    /// </summary>
    public static class SimProcesses
    {
        public const string IRacingName = "iRacing";
        public const string AssettoCorsaName = "Assetto Corsa";
        public const string AssettoCorsaEvoName = "Assetto Corsa EVO";
        public const string AssettoCorsaCompetizioneName = "Assetto Corsa Competizione";

        /// <summary>iRacing's simulator, the DX11 one first. iRacingUI.exe is the launcher, not the sim.</summary>
        public static readonly string[] IRacing = { "iRacingSim64DX11", "iRacingSim64" };

        /// <summary>Assetto Corsa runs a session as acs.exe; the launcher (AssettoCorsa.exe, or Content Manager) is not the sim.</summary>
        public static readonly string[] AssettoCorsa = { "acs" };

        public static readonly string[] AssettoCorsaEvo = { "AssettoCorsaEVO" };

        public static readonly string[] AssettoCorsaCompetizione = { "AC2-Win64-Shipping" };

        /// <summary>Every sim's process names, iRacing's first.</summary>
        public static readonly string[] All = Join(IRacing, AssettoCorsa, AssettoCorsaEvo, AssettoCorsaCompetizione);

        /// <summary>The sim a process name belongs to, in words ("iRacing", "Assetto Corsa", …), or null for one that is no sim's.</summary>
        public static string GameOf(string processName)
        {
            if (string.IsNullOrEmpty(processName)) return null;
            string name = processName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? processName.Substring(0, processName.Length - 4) : processName;
            if (Has(IRacing, name)) return IRacingName;
            if (Has(AssettoCorsa, name)) return AssettoCorsaName;
            if (Has(AssettoCorsaEvo, name)) return AssettoCorsaEvoName;
            if (Has(AssettoCorsaCompetizione, name)) return AssettoCorsaCompetizioneName;
            return null;
        }

        /// <summary>Whether any of <paramref name="names"/> is running, by <paramref name="running"/> (Windows, or a test's fake).</summary>
        public static bool AnyRunning(IEnumerable<string> names, Func<string, bool> running)
        {
            if (names == null) throw new ArgumentNullException(nameof(names));
            if (running == null) throw new ArgumentNullException(nameof(running));
            foreach (string name in names)
                if (running(name)) return true;
            return false;
        }

        private static bool Has(string[] names, string name)
        {
            foreach (string n in names)
                if (string.Equals(n, name, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        private static string[] Join(params string[][] lists)
        {
            var all = new List<string>();
            foreach (var list in lists) all.AddRange(list);
            return all.ToArray();
        }
    }
}
