using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using NUnit.Framework;
using RacingDesk.Plugin;

namespace RacingDesk.Tests
{
    /// <summary>
    /// The engine reads SimHub's opponents by property name, and three of the names it read were not SimHub's: iRating,
    /// the gap to the player and the pit lane read 0 for every car. The names are read here from SimHub's own assembly
    /// (GameReaderCommon.dll, where SimHub is installed; read, never loaded or changed), and the readers ask for those.
    /// </summary>
    [TestFixture]
    public class SimHubOpponentTests
    {
        private const string GameReaderCommon = @"C:\Program Files (x86)\SimHub\GameReaderCommon.dll";

        /// <summary>The properties of GameReaderCommon.Opponent, by name, as its metadata lists them.</summary>
        private static HashSet<string> OpponentProperties()
        {
            Assume.That(File.Exists(GameReaderCommon), Is.True, "SimHub is not installed here");
            var names = new HashSet<string>(StringComparer.Ordinal);
            using var file = File.OpenRead(GameReaderCommon);
            using var pe = new PEReader(file);
            var md = pe.GetMetadataReader();
            foreach (var handle in md.TypeDefinitions)
            {
                var type = md.GetTypeDefinition(handle);
                if (md.GetString(type.Namespace) != "GameReaderCommon" || md.GetString(type.Name) != "Opponent") continue;
                foreach (var p in type.GetProperties()) names.Add(md.GetString(md.GetPropertyDefinition(p).Name));
            }
            return names;
        }

        [Test]
        public void TheNamesTheLeaderboardAndTheCaptureReadAreSimHubsOwn()
        {
            var props = OpponentProperties();
            Assert.That(props, Is.Not.Empty, "GameReaderCommon.Opponent was found");
            foreach (string name in new[] { "IRacing_IRating", "GaptoPlayer", "IsCarInPit", "IsCarInPitLane", "Position", "BestLapTime", "LastLapTime", "RelativeGapToPlayer", "IsPlayer", "Name", "CarNumber" })
                Assert.That(props, Does.Contain(name), name);
            // The names that were read before, and are not SimHub's: what made them read 0.
            foreach (string name in new[] { "IRating", "Irating", "GapToPlayer", "IsInPit", "IsInPitLane" })
                Assert.That(props, Does.Not.Contain(name), name);
        }

        private sealed class SimHubShaped
        {
            public double? IRacing_IRating { get; set; }
        }

        private sealed class HostShaped
        {
            public int IRating { get; set; }
        }

        [Test]
        public void AnOpponentsIRatingIsReadBySimHubsNameOrTheHosts()
        {
            Assert.That(RacingDeskRuntime.OpponentIRating(typeof(SimHubShaped), new SimHubShaped { IRacing_IRating = 2451.0 }), Is.EqualTo(2451));
            Assert.That(RacingDeskRuntime.OpponentIRating(typeof(SimHubShaped), new SimHubShaped()), Is.EqualTo(0), "not known: 0");
            Assert.That(RacingDeskRuntime.OpponentIRating(typeof(HostShaped), new HostShaped { IRating = 1980 }), Is.EqualTo(1980));
            Assert.That(RacingDeskRuntime.OpponentIRating(typeof(object), new object()), Is.EqualTo(0));
            Assert.That(RacingDeskRuntime.OpponentIRating(typeof(SimHubShaped), new SimHubShaped { IRacing_IRating = double.NaN }), Is.EqualTo(0), "not a number: 0, not a throw");
            Assert.That(RacingDeskRuntime.OpponentIRating(typeof(SimHubShaped), new SimHubShaped { IRacing_IRating = double.PositiveInfinity }), Is.EqualTo(0));
        }

        // ── The gap to him, as the leaderboard carries it ──────────────────────────────────────────────────────────
        // The HUD's default board (focus on him) sorts the rows by the gap and shows it: negative for a car ahead of him,
        // positive for one behind (leaderboard.js). SimHub's GaptoPlayer read 0 for every car before (the name was not
        // SimHub's), so the board stood in the order of the race with no gaps; now it is read, and these keep the board
        // right whatever SimHub gives.

        private sealed class SimHubGap
        {
            public double? GaptoPlayer { get; set; }
        }

        private static double? Gap(double? g) => RacingDeskRuntime.OpponentGap(typeof(SimHubGap), new SimHubGap { GaptoPlayer = g });

        [Test]
        public void AGapIsItsSize_AndOneThatIsNotKnownOrNotANumberIsNone()
        {
            Assert.That(Gap(1.25), Is.EqualTo(1.25));
            Assert.That(Gap(-1.25), Is.EqualTo(1.25), "the size; the sign is the race's");
            Assert.That(Gap(null), Is.Null);
            Assert.That(Gap(0), Is.Null, "0 is no gap SimHub knows");
            // NaN or Infinity printed into the :8889 answer would make all of it invalid JSON, and the HUD would stop.
            Assert.That(Gap(double.NaN), Is.Null);
            Assert.That(Gap(double.PositiveInfinity), Is.Null);
            Assert.That(Gap(double.NegativeInfinity), Is.Null);
            Assert.That(RacingDeskRuntime.OpponentGap(typeof(object), new object()), Is.Null);
        }

        [Test]
        public void TheGapsAreSignedByTheOrderOfTheRace_WhicheverSignTheSourceGives()
        {
            // He is P3. The sizes come from the source, the signs from the positions: a car ahead negative, behind positive.
            var rows = new List<(int, double?, bool)> { (1, 4.0, false), (2, 1.5, false), (3, null, true), (4, 0.8, false), (5, 3.2, false) };
            Assert.That(RacingDeskRuntime.LeaderboardGaps(rows, 3), Is.EqualTo(new[] { -4.0, -1.5, 0, 0.8, 3.2 }));
        }

        [Test]
        public void WhileAnyOtherCarsGapIsNotKnown_NoRowCarriesOne_AndTheBoardStaysInTheOrderOfTheRace()
        {
            // A car with no gap would carry 0 and be sorted in beside him: instead none carries one, as before the gaps were read.
            var rows = new List<(int, double?, bool)> { (1, 4.0, false), (2, null, false), (3, null, true), (4, 0.8, false) };
            Assert.That(RacingDeskRuntime.LeaderboardGaps(rows, 3), Is.EqualTo(new double[4]));
            // His position not known: nobody is ahead of him or behind.
            var known = new List<(int, double?, bool)> { (1, 4.0, false), (2, 1.0, false) };
            Assert.That(RacingDeskRuntime.LeaderboardGaps(known, 0), Is.EqualTo(new double[2]));
        }
    }
}
