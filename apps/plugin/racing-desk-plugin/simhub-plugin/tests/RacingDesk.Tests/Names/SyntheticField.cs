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
        /// The session YAML, as iRacing writes it: the player first, the rivals, and the pace car. Each rival's team is
        /// named after them, as iRacing names a driver's team in a single-driver session, but the first's is a team of its
        /// own, and the last's has the driver's name inside a longer one.
        /// </summary>
        public static string Yaml(long sessionId = 5001, long subSessionId = 70010003, int playerCarIdx = PlayerCarIdx, bool reverse = false)
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
            Driver(y, PlayerCarIdx, PlayerCustId, PlayerName, PlayerNumber, 1500, PlayerName, false);
            for (int i = 0; i < order.Count; i++)
            {
                var r = order[i];
                string team = ReferenceEquals(r, Rivals[0]) ? "Nowhere Motorsport" : ReferenceEquals(r, Rivals[Rivals.Length - 1]) ? r.Name + " Racing" : r.Name;
                Driver(y, r.CarIdx, r.CustId, r.Name, r.Number, r.IRating, team, false);
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

        private static void Driver(StringBuilder y, int idx, long custId, string name, string number, int irating, string team, bool paceCar)
        {
            string initials = string.Concat(name.Split(' ').Select(w => w[0]));
            y.Append(" - CarIdx: ").Append(idx).Append('\n')
             .Append("   UserName: ").Append(name).Append('\n')
             .Append("   AbbrevName: ").Append(name[0]).Append(' ').Append(name.Substring(name.LastIndexOf(' ') + 1)).Append('\n')
             .Append("   Initials: ").Append(initials).Append('\n')
             .Append("   UserID: ").Append(custId.ToString(CultureInfo.InvariantCulture)).Append('\n')
             .Append("   TeamID: 0\n")
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
             .Append("   IsSpectator: 0\n");
        }

        /// <summary>
        /// A salt under which the six rivals' first choices are all different, so that the tests of the paths see the rule
        /// (a name by the customer id) and not the tie-break, which has a test of its own. Found by trying seeds in order;
        /// the same every run.
        /// </summary>
        public static byte[] CollisionFreeSalt(PseudonymList list)
        {
            for (int seed = 1; seed < 10000; seed++)
            {
                var salt = SaltFromSeed(seed);
                var book = new PseudonymBook(list, salt);
                var firsts = new HashSet<string>(StringComparer.Ordinal);
                bool clash = false;
                foreach (var r in Rivals)
                    if (!firsts.Add(book.NewSession().For(r.CustId, r.Name))) { clash = true; break; }
                if (!clash) return salt;
            }
            throw new InvalidOperationException("no seed under 10000 keeps six rivals apart: the list must be tiny");
        }

        public static byte[] SaltFromSeed(int seed)
        {
            var salt = new byte[PseudonymBook.SaltLength];
            var rng = new Random(seed);
            rng.NextBytes(salt);
            return salt;
        }

        /// <summary>Fails if any form of any rival's real name is in <paramref name="text"/>.</summary>
        public static void AssertNoRivalIn(string text, string what)
        {
            foreach (var r in Rivals)
                foreach (var leak in Leaks(r))
                    Assert.That(text, Does.Not.Contain(leak), $"{what} carries a rival's real name (car #{r.Number})");
        }
    }
}
