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
        }
    }
}
