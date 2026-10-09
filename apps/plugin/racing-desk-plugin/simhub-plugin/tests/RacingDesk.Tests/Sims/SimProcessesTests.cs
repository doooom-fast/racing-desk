using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using RacingDesk.Core.Screens;
using RacingDesk.Core.Sims;
using RacingDesk.Data;
using RacingDesk.Data.Restore;

namespace RacingDesk.Tests.Sims
{
    /// <summary>
    /// The sims on the rig, by process name, in one list — and everything that pauses or looks for "the sim" going by it.
    /// Until 2026-10-09 the host's heavy I/O (the .ibt history, the outlines, the schedule, the car scan) waited for
    /// iRacing alone, and would have run while he raced in Assetto Corsa or Assetto Corsa EVO; the HUD's screen was found
    /// by iRacing's window alone. Windows is never asked here: the guards take a fake that says which names are running.
    /// </summary>
    [TestFixture]
    public class SimProcessesTests
    {
        private static Func<string, bool> Running(params string[] names) =>
            name => names.Contains(name, StringComparer.OrdinalIgnoreCase);

        [Test]
        public void TheListHasEverySimOnTheRig()
        {
            Assert.That(SimProcesses.IRacing, Is.EqualTo(new[] { "iRacingSim64DX11", "iRacingSim64" }));
            Assert.That(SimProcesses.AssettoCorsa, Is.EqualTo(new[] { "acs" }), "acs.exe is the session; AssettoCorsa.exe and Content Manager are launchers");
            Assert.That(SimProcesses.AssettoCorsaEvo, Is.EqualTo(new[] { "AssettoCorsaEVO" }));
            Assert.That(SimProcesses.AssettoCorsaCompetizione, Is.EqualTo(new[] { "AC2-Win64-Shipping" }));
            Assert.That(SimProcesses.All, Is.EqualTo(new[] { "iRacingSim64DX11", "iRacingSim64", "acs", "AssettoCorsaEVO", "AC2-Win64-Shipping" }));
            Assert.That(SimProcesses.All.Select(n => n.ToLowerInvariant()).Distinct().Count(), Is.EqualTo(SimProcesses.All.Length), "no name twice");
            Assert.That(SimProcesses.All, Has.None.EndsWith(".exe"), "Windows lists processes without the extension");
        }

        [Test]
        public void TheHeavyWorkPausesForEverySim_NotIRacingAlone()
        {
            Assert.That(BackgroundIo.SimRunning(Running()), Is.False, "nothing running");
            Assert.That(BackgroundIo.SimRunning(Running("iRacingSim64DX11")), Is.True);
            Assert.That(BackgroundIo.SimRunning(Running("iRacingSim64")), Is.True);
            Assert.That(BackgroundIo.SimRunning(Running("acs")), Is.True, "Assetto Corsa");
            Assert.That(BackgroundIo.SimRunning(Running("AssettoCorsaEVO")), Is.True, "Assetto Corsa EVO");
            Assert.That(BackgroundIo.SimRunning(Running("AC2-Win64-Shipping")), Is.True, "Assetto Corsa Competizione");
            Assert.That(BackgroundIo.SimRunning(Running("AssettoCorsa", "iRacingUI", "SimHubWPF", "Content Manager")), Is.False,
                "a launcher, SimHub or Content Manager is not a sim running");
        }

        [Test]
        public void TheGuardAsksForEachNameOfTheListAndNoOther()
        {
            var asked = new List<string>();
            BackgroundIo.SimRunning(name => { asked.Add(name); return false; });
            Assert.That(asked, Is.EqualTo(SimProcesses.All));
        }

        [Test]
        public void TheHudsScreenIsFoundByAnySimsWindow()
        {
            Assert.That(Win32SimWindowSource.ProcessNames, Is.EqualTo(SimProcesses.All));
            Assert.That(Win32SimWindowSource.ProcessNames[0], Is.EqualTo("iRacingSim64DX11"), "iRacing's DX11 window first, as it always was");
        }

        [Test]
        public void TheWritersOfIRacingsFilesGoByIRacingAlone()
        {
            // app.ini and a car's camera file are iRacing's: they are written while iRacing is closed, whatever else runs.
            Assert.That(WindowsRigProbe.SimProcesses, Is.EqualTo(SimProcesses.IRacing));
        }

        [Test]
        public void EachProcessNamesItsGame_ForTheHudToSay()
        {
            Assert.That(SimProcesses.GameOf("iRacingSim64DX11"), Is.EqualTo("iRacing"));
            Assert.That(SimProcesses.GameOf("iRacingSim64"), Is.EqualTo("iRacing"));
            Assert.That(SimProcesses.GameOf("acs"), Is.EqualTo("Assetto Corsa"));
            Assert.That(SimProcesses.GameOf("acs.exe"), Is.EqualTo("Assetto Corsa"));
            Assert.That(SimProcesses.GameOf("ACS"), Is.EqualTo("Assetto Corsa"), "Windows does not mind the case");
            Assert.That(SimProcesses.GameOf("AssettoCorsaEVO"), Is.EqualTo("Assetto Corsa EVO"));
            Assert.That(SimProcesses.GameOf("AC2-Win64-Shipping"), Is.EqualTo("Assetto Corsa Competizione"));
            Assert.That(SimProcesses.GameOf("AssettoCorsa"), Is.Null, "the launcher is no sim");
            Assert.That(SimProcesses.GameOf(""), Is.Null);
            Assert.That(SimProcesses.GameOf(null), Is.Null);
        }

        [Test]
        public void AnyRunningAsksEveryNameUntilOneIs()
        {
            var asked = new List<string>();
            Assert.That(SimProcesses.AnyRunning(new[] { "a", "b", "c" }, n => { asked.Add(n); return n == "b"; }), Is.True);
            Assert.That(asked, Is.EqualTo(new[] { "a", "b" }));
            Assert.That(SimProcesses.AnyRunning(new string[0], n => true), Is.False);
            Assert.Throws<ArgumentNullException>(() => SimProcesses.AnyRunning(null, n => true));
            Assert.Throws<ArgumentNullException>(() => SimProcesses.AnyRunning(new[] { "a" }, null));
        }
    }
}
