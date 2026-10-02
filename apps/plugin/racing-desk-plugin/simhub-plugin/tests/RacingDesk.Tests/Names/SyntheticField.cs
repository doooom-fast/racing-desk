using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using NUnit.Framework;
using RacingDesk.Core.Names;

namespace RacingDesk.Tests.Names
{
    /// <summary>
    /// A session of nobody's: the fixtures' customer id for the player, and six rivals with made-up names (no real person;
    /// the surnames are invented) and made-up customer ids. Every test of the names goes through this field, and the scan
    /// of the fixtures (<see cref="NoRealNamesInFixturesTests"/>) knows these names as the tests' own.
    /// </summary>
    internal static class SyntheticField
    {
        public const long PlayerCustId = 424242;
        public const string PlayerName = "Test Driver";
        public const string PlayerNumber = "64";
        public const int PlayerCarIdx = 0;
        public const int PaceCarIdx = 7;

        /// <summary>
        /// A teammate of his, made up like the rivals: in a team race the session's entry for his car is whoever is driving
        /// it, and when that is the teammate, the entry is another driver's (<see cref="Yaml"/>'s <c>teammateDriving</c>).
        /// </summary>
        public const long TeammateCustId = 700099;
        public const string TeammateName = "Leopold Quarrendine";

        /// <summary>A spectator in the session (iRacing lists them among the drivers), made up like the rest.</summary>
        public const long SpectatorCustId = 700077;
        public const string SpectatorName = "Wilhelmina Oakensby";
        public const int SpectatorCarIdx = 8;

        public sealed class Rival
        {
            public int CarIdx;
            public long CustId;
            public string Name = "";
            public string Number = "";
            public int IRating;
            public int Position;
            /// <summary>The surname alone: what a leak would show even where the HUD shortens the name.</summary>
            public string Surname => Name.Substring(Name.LastIndexOf(' ') + 1);
            /// <summary>The HUD's own shortening of the real name ("M. Ashdown-Kell"): a leak through the old formatter.</summary>
            public string Shortened => Name[0] + ". " + Surname;
        }

        public static readonly Rival[] Rivals =
        {
            new Rival { CarIdx = 1, CustId = 700001, Name = "Marguerite Ashdown-Kell", Number = "12", IRating = 2450, Position = 1 },
            new Rival { CarIdx = 2, CustId = 700002, Name = "Tobias Rennquist", Number = "7", IRating = 1980, Position = 2 },
            new Rival { CarIdx = 3, CustId = 700003, Name = "Priya Vellaturi", Number = "88", IRating = 3120, Position = 4 },
            new Rival { CarIdx = 4, CustId = 700004, Name = "Oskar Brandvold", Number = "3", IRating = 1500, Position = 5 },
            new Rival { CarIdx = 5, CustId = 700005, Name = "Imogen Tarrasque", Number = "41", IRating = 2210, Position = 6 },
            new Rival { CarIdx = 6, CustId = 700006, Name = "Hamish Dunleavy-Roe", Number = "19", IRating = 2760, Position = 7 },
        };

        /// <summary>The player's race position: between the second and third rivals.</summary>
        public const int PlayerPosition = 3;

        public static Rival Ahead => Rivals.Single(r => r.Position == PlayerPosition - 1);
        public static Rival Behind => Rivals.Single(r => r.Position == PlayerPosition + 1);

        /// <summary>The field's positions by CarIdx (0..7, the pace car last and unplaced).</summary>
        public static int[] Positions()
        {
            var p = new int[8];
            p[PlayerCarIdx] = PlayerPosition;
            foreach (var r in Rivals) p[r.CarIdx] = r.Position;
            return p;
        }

        /// <summary>Every string by which a rival's real name could show: whole, shortened, the surname.</summary>
        public static IEnumerable<string> Leaks(Rival r) => new[] { r.Name, r.Shortened, r.Surname };

        /// <summary>
        /// The session YAML, as iRacing writes it: the player first, the rivals, and the pace car. In a session without teams
        /// each rival's team is named after them, as iRacing names a driver's team there, but the first's is a team of its
        /// own, and the last's has the driver's name inside a longer one. <paramref name="teammateDriving"/>: the entry for
        /// his car is his teammate's (and his own is not listed). <paramref name="teamRace"/>: a team race, TeamRacing 1,
        /// every team named after its drivers' surname, and his car listed twice, as a team's drivers are, with the
        /// teammate and then him. <paramref name="spectator"/> adds a spectator, listed first among the drivers.
        /// </summary>
        public static string Yaml(long sessionId = 5001, long subSessionId = 70010003, int playerCarIdx = PlayerCarIdx, bool reverse = false,
            bool teammateDriving = false, bool teamRace = false, bool spectator = false)
        {
            var y = new StringBuilder();
            y.Append("---\n")
             .Append("WeekendInfo:\n")
             .Append(" TrackName: synthetic full\n")
             .Append(" TrackID: 777\n")
             .Append(" TrackDisplayName: Synthetic Circuit\n")
             .Append(" TrackConfigName: Full\n")
             .Append(" TrackLength: 4.00 km\n")
             .Append(" TrackCountry: Nowhere\n")
             .Append(" SeriesID: 139\n")
             .Append(" SessionID: ").Append(sessionId.ToString(CultureInfo.InvariantCulture)).Append('\n')
             .Append(" SubSessionID: ").Append(subSessionId.ToString(CultureInfo.InvariantCulture)).Append('\n')
             .Append(" EventType: Race\n")
             .Append(" Category: Road\n")
             .Append(" Official: 1\n")
             .Append(" NumCarClasses: 1\n")
             .Append(" TeamRacing: ").Append(teamRace ? 1 : 0).Append('\n')
             .Append(" WeekendOptions:\n")
             .Append("  IsFixedSetup: 1\n")
             .Append("  StandingStart: 0\n")
             .Append("  IncidentLimit: 17\n")
             .Append("SessionInfo:\n")
             .Append(" Sessions:\n")
             .Append(" - SessionNum: 0\n")
             .Append("   SessionType: Race\n")
             .Append("   ResultsPositions:\n");
            foreach (var r in Rivals.Concat(new[] { PlayerAsRival() }).OrderBy(r => r.Position))
                y.Append("   - Position: ").Append(r.Position).Append('\n')
                 .Append("     ClassPosition: ").Append(r.Position - 1).Append('\n')
                 .Append("     CarIdx: ").Append(r.CarIdx).Append('\n')
                 .Append("     LapsComplete: 12\n")
                 .Append("     FastestTime: 92.400\n")
                 .Append("     Incidents: 2\n")
                 .Append("     ReasonOutStr: Running\n");
            y.Append("DriverInfo:\n")
             .Append(" DriverCarIdx: ").Append(playerCarIdx).Append('\n')
             .Append(" DriverUserID: ").Append(PlayerCustId).Append('\n')
             .Append(" DriverCarRedLine: 7200.000\n")
             .Append(" Drivers:\n");
            var order = reverse ? Rivals.Reverse().ToList() : Rivals.ToList();
            if (spectator) Driver(y, SpectatorCarIdx, SpectatorCustId, SpectatorName, "0", 0, SpectatorName, false, isSpectator: true);
            if (teamRace)
            {
                Driver(y, PlayerCarIdx, TeammateCustId, TeammateName, PlayerNumber, 1650, "Oakwright Quarrendine Racing", false, teamId: 9001);
                Driver(y, PlayerCarIdx, PlayerCustId, PlayerName, PlayerNumber, 1500, "Oakwright Quarrendine Racing", false, teamId: 9001);
            }
            else if (teammateDriving) Driver(y, PlayerCarIdx, TeammateCustId, TeammateName, PlayerNumber, 1650, "Nowhere Motorsport", false);
            else Driver(y, PlayerCarIdx, PlayerCustId, PlayerName, PlayerNumber, 1500, PlayerName, false);
            for (int i = 0; i < order.Count; i++)
            {
                var r = order[i];
                string team = teamRace ? r.Surname + " Motorsport"
                    : ReferenceEquals(r, Rivals[0]) ? "Nowhere Motorsport"
                    : ReferenceEquals(r, Rivals[Rivals.Length - 1]) ? r.Name + " Racing" : r.Name;
                Driver(y, r.CarIdx, r.CustId, r.Name, r.Number, r.IRating, team, false, teamId: teamRace ? 9100 + r.CarIdx : 0);
            }
            Driver(y, PaceCarIdx, 0, "Pace Car", "0", 0, "Pace Car", true);
            y.Append("SplitTimeInfo:\n")
             .Append(" Sectors:\n")
             .Append(" - SectorNum: 0\n")
             .Append("   SectorStartPct: 0.000000\n")
             .Append(" - SectorNum: 1\n")
             .Append("   SectorStartPct: 0.500000\n")
             .Append("...\n");
            return y.ToString();
        }

        private static Rival PlayerAsRival() => new Rival { CarIdx = PlayerCarIdx, CustId = PlayerCustId, Name = PlayerName, Number = PlayerNumber, IRating = 1500, Position = PlayerPosition };

        private static void Driver(StringBuilder y, int idx, long custId, string name, string number, int irating, string team, bool paceCar,
            int teamId = 0, bool isSpectator = false)
        {
            string initials = string.Concat(name.Split(' ').Select(w => w[0]));
            y.Append(" - CarIdx: ").Append(idx).Append('\n')
             .Append("   UserName: ").Append(name).Append('\n')
             .Append("   AbbrevName: ").Append(name[0]).Append(' ').Append(name.Substring(name.LastIndexOf(' ') + 1)).Append('\n')
             .Append("   Initials: ").Append(initials).Append('\n')
             .Append("   UserID: ").Append(custId.ToString(CultureInfo.InvariantCulture)).Append('\n')
             .Append("   TeamID: ").Append(teamId).Append('\n')
             .Append("   TeamName: ").Append(team).Append('\n')
             .Append("   CarNumber: \"").Append(number).Append("\"\n")
             .Append("   CarNumberRaw: ").Append(number).Append('\n')
             .Append("   CarPath: ").Append(paceCar ? "safety pcporsche911cup" : "mx5 mx52016").Append('\n')
             .Append("   CarClassID: 74\n")
             .Append("   CarID: ").Append(paceCar ? 120 : 67).Append('\n')
             .Append("   CarIsPaceCar: ").Append(paceCar ? 1 : 0).Append('\n')
             .Append("   CarIsAI: 0\n")
             .Append("   CarScreenName: ").Append(paceCar ? "Pace Car" : "Mazda MX-5 Cup").Append('\n')
             .Append("   CarScreenNameShort: ").Append(paceCar ? "Pace Car" : "MX-5 Cup").Append('\n')
             .Append("   IRating: ").Append(irating).Append('\n')
             .Append("   LicLevel: 10\n")
             .Append("   LicString: A 2.37\n")
             .Append("   IsSpectator: ").Append(isSpectator ? 1 : 0).Append('\n');
        }

        /// <summary>The customer ids of the made-up people other than him: the rivals, his teammate and the spectator.</summary>
        public static IEnumerable<long> OtherCustIds() => Rivals.Select(r => r.CustId).Concat(new[] { TeammateCustId, SpectatorCustId });

        /// <summary>
        /// A salt under which every other made-up driver's first choice is different (the six rivals, the teammate and the
        /// spectator), so that the tests of the paths see the rule (a name by the customer id) and not the tie-break, which
        /// has tests of its own. Found by trying seeds in order; the same every run.
        /// </summary>
        public static byte[] CollisionFreeSalt(PseudonymList list)
        {
            for (int seed = 1; seed < 10000; seed++)
            {
                var salt = SaltFromSeed(seed);
                var book = new PseudonymBook(list, salt);
                var firsts = new HashSet<string>(StringComparer.Ordinal);
                bool clash = false;
                foreach (long id in OtherCustIds())
                    if (!firsts.Add(book.NewSession().For(id, "x"))) { clash = true; break; }
                if (!clash) return salt;
            }
            throw new InvalidOperationException("no seed under 10000 keeps eight others apart: the list must be tiny");
        }

        /// <summary>
        /// A salt under which the spectator's first choice is the same as <paramref name="rival"/>'s, and the six rivals'
        /// own first choices are all different, so that who keeps the name is the rule being tested. Found by trying seeds
        /// in order; the same every run.
        /// </summary>
        public static byte[] SaltWhereTheSpectatorWantsARivalsName(PseudonymList list, Rival rival)
        {
            for (int seed = 1; seed < 200000; seed++)
            {
                var salt = SaltFromSeed(seed);
                var book = new PseudonymBook(list, salt);
                if (book.NewSession().For(SpectatorCustId, "x") != book.NewSession().For(rival.CustId, "x")) continue;
                if (Rivals.Select(r => book.NewSession().For(r.CustId, "x")).Distinct().Count() == Rivals.Length) return salt;
            }
            throw new InvalidOperationException("no seed under 200000 makes the spectator and the rival want one name");
        }

        public static byte[] SaltFromSeed(int seed)
        {
            var salt = new byte[PseudonymBook.SaltLength];
            var rng = new Random(seed);
            rng.NextBytes(salt);
            return salt;
        }

        /// <summary>Fails if any form of any rival's real name, or the teammate's, is in <paramref name="text"/>.</summary>
        public static void AssertNoRivalIn(string text, string what)
        {
            foreach (var r in Rivals)
                foreach (var leak in Leaks(r))
                    Assert.That(text, Does.Not.Contain(leak), $"{what} carries a rival's real name (car #{r.Number})");
            foreach (string leak in new[] { TeammateName, "L. Quarrendine", "Quarrendine", SpectatorName, "W. Oakensby", "Oakensby", "Oakwright" })
                Assert.That(text, Does.Not.Contain(leak), $"{what} carries the teammate's or the spectator's real name");
        }
    }
}
