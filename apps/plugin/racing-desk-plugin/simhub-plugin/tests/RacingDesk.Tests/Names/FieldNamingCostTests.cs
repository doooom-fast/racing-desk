using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using IRSDKSharper;
using NUnit.Framework;
using RacingDesk.Core.Names;
using RacingDesk.Plugin.Engine;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Tests.Names
{
    /// <summary>
    /// What naming a field costs, and that making it cheaper changed no name. A session's names are now hashed outside the
    /// locks the data loop takes, and each driver's ranking is kept for as long as the salt is the same, with one HMAC for
    /// a batch; the names must come out exactly as they did. <see cref="Old"/> is the naming as it was before (the book's
    /// hashing and the session's choosing, copied as they stood), and every field here is named by both.
    /// </summary>
    [TestFixture]
    public class FieldNamingCostTests
    {
        // ── A field of sixty, made up at run time: nobody's names (invented syllables), made-up customer ids ──

        private static readonly string[] A = { "Zeb", "Quil", "Orv", "Thes", "Bran", "Ysol", "Marg", "Tob", "Priv", "Osk", "Imo", "Ham", "Wil", "Leo", "Fen", "Gor" };
        private static readonly string[] B = { "edee", "ana", "ix", "aly", "oc", "de", "uerite", "ias", "ella", "ar", "gen", "ish", "mina", "pold", "wick", "ast" };
        private static readonly string[] C = { "Quorn", "Ashd", "Renn", "Vell", "Brand", "Tarr", "Dunl", "Oaken", "Quarr", "Fizz", "Mopp", "Skell" };
        private static readonly string[] D = { "talk", "own", "quist", "aturi", "vold", "asque", "eavy", "sby", "endine", "wright", "ington", "ard" };

        internal sealed class Car
        {
            public int CarIdx;
            public long CustId;
            public string Name = "";
            public string Number = "";
            public int IRating;
            public bool Spectator;
            public bool PaceCar;
            public int TeamId;
        }

        private static string MadeUpName(int i) =>
            A[i % A.Length] + B[(i / A.Length + i) % B.Length] + " " + C[(i * 7) % C.Length] + D[(i * 5 + i / C.Length) % D.Length];

        /// <summary>
        /// Him at CarIdx 0, <paramref name="rivals"/> others (the last two with no customer id, as a driver can come), three
        /// spectators and the pace car. <paramref name="idBase"/> moves the rivals' ids, so two fields can share some.
        /// </summary>
        internal static List<Car> Field(int rivals = 59, long idBase = 710000, int nameSeed = 0, bool teams = false)
        {
            var cars = new List<Car> { new Car { CarIdx = 0, CustId = SyntheticField.PlayerCustId, Name = SyntheticField.PlayerName, Number = SyntheticField.PlayerNumber, IRating = 1500, TeamId = teams ? 9000 : 0 } };
            for (int i = 1; i <= rivals; i++)
                cars.Add(new Car
                {
                    CarIdx = i,
                    CustId = i > rivals - 2 ? 0 : idBase + i,
                    Name = MadeUpName(i + nameSeed),
                    Number = (i + 100).ToString(CultureInfo.InvariantCulture),
                    IRating = 1200 + (i * 37) % 3000,
                    TeamId = teams ? 9000 + i / 2 : 0,
                });
            for (int s = 0; s < 3; s++)
                cars.Add(new Car { CarIdx = rivals + 1 + s, CustId = 720001 + s, Name = MadeUpName(200 + s), Number = "0", Spectator = true });
            cars.Add(new Car { CarIdx = rivals + 4, Name = "Pace Car", Number = "0", PaceCar = true });
            return cars;
        }

        internal static string Yaml(IEnumerable<Car> cars, long sessionId = 5001, long subSessionId = 70010003, bool teamRace = false)
        {
            var y = new StringBuilder(128 * 1024);
            y.Append("---\nWeekendInfo:\n TrackName: synthetic full\n TrackID: 777\n TrackDisplayName: Synthetic Circuit\n TrackLength: 4.00 km\n")
             .Append(" TrackCountry: Nowhere\n SeriesID: 139\n SessionID: ").Append(sessionId).Append("\n SubSessionID: ").Append(subSessionId).Append('\n')
             .Append(" EventType: Race\n Official: 1\n TeamRacing: ").Append(teamRace ? 1 : 0).Append('\n')
             .Append(" WeekendOptions:\n  IsFixedSetup: 1\n  StandingStart: 0\n  IncidentLimit: 17\n")
             .Append("SessionInfo:\n Sessions:\n - SessionNum: 0\n   SessionType: Race\n   ResultsPositions:\n");
            int p = 1;
            foreach (var c in cars.Where(c => !c.Spectator && !c.PaceCar))
                y.Append("   - Position: ").Append(p++).Append("\n     CarIdx: ").Append(c.CarIdx).Append("\n     LapsComplete: 12\n     Incidents: 2\n");
            y.Append("DriverInfo:\n DriverCarIdx: 0\n DriverUserID: ").Append(SyntheticField.PlayerCustId).Append("\n Drivers:\n");
            foreach (var c in cars)
            {
                string team = teamRace ? C[c.TeamId % C.Length] + D[c.TeamId % D.Length] + " Racing" : c.Name;
                y.Append(" - CarIdx: ").Append(c.CarIdx).Append('\n')
                 .Append("   UserName: ").Append(c.Name).Append('\n')
                 .Append("   AbbrevName: ").Append(c.Name).Append('\n')
                 .Append("   Initials: XX\n")
                 .Append("   UserID: ").Append(c.CustId.ToString(CultureInfo.InvariantCulture)).Append('\n')
                 .Append("   TeamID: ").Append(c.TeamId).Append('\n')
                 .Append("   TeamName: ").Append(team).Append('\n')
                 .Append("   CarNumber: \"").Append(c.Number).Append("\"\n")
                 .Append("   CarPath: ").Append(c.PaceCar ? "safety pcporsche911cup" : "mx5 mx52016").Append('\n')
                 .Append("   CarIsPaceCar: ").Append(c.PaceCar ? 1 : 0).Append('\n')
                 .Append("   IRating: ").Append(c.IRating).Append('\n')
                 .Append("   LicString: A 2.37\n")
                 .Append("   IsSpectator: ").Append(c.Spectator ? 1 : 0).Append('\n')
                 .Append("   CurDriverIncidentCount: 0\n");
            }
            y.Append("SplitTimeInfo:\n Sectors:\n - SectorNum: 0\n   SectorStartPct: 0.000000\n - SectorNum: 1\n   SectorStartPct: 0.500000\n...\n");
            return y.ToString();
        }

        private static IRacingSdkSessionInfo Parse(string yaml) => SessionInfoYaml.Parse(yaml);

        /// <summary>Every entry's four names after a naming, by CarIdx and id (a car may list two drivers in a team race).</summary>
        private static List<string> Shown(IRacingSdkSessionInfo si) =>
            si.DriverInfo.Drivers.Select(d => $"{d.CarIdx}/{d.UserID}: {d.UserName} | {d.AbbrevName} | {d.Initials} | {d.TeamName}").ToList();

        // ── The steps a session of races takes: each named by the old and the new, one namer each for the whole run ──

        private static IEnumerable<(string What, string Yaml)> Steps()
        {
            var sixty = Field();
            yield return ("a field of sixty", Yaml(sixty));
            yield return ("the same session again", Yaml(sixty));
            var joined = Field();
            joined.Insert(joined.Count - 1, new Car { CarIdx = 70, CustId = 740001, Name = MadeUpName(300), Number = "170" });
            joined.Insert(joined.Count - 1, new Car { CarIdx = 71, CustId = 740002, Name = MadeUpName(301), Number = "171" });
            yield return ("two late joiners", Yaml(joined));
            // The next server: forty of the same drivers and twenty new.
            var next = Field(idBase: 710000).Take(41).Concat(Field(rivals: 60, idBase: 730000, nameSeed: 50).Skip(41)).ToList();
            yield return ("a new server, forty the same", Yaml(next, 5002, 70010004));
            yield return ("a team race", Yaml(Field(teams: true), 5003, 70010005, teamRace: true));
        }

        private static readonly byte[] Salt = SyntheticField.SaltFromSeed(4242);

        private static void AssertTheSameAsBefore(PseudonymList list)
        {
            var now = new PseudonymBook(list, Salt).NewSession();
            var before = new Old.Namer(new Old.Book(list, Salt));
            foreach (var (what, yaml) in Steps())
            {
                var mine = Shown(now.Apply(Parse(yaml)));
                var theirs = Shown(before.Apply(Parse(yaml)));
                Assert.That(mine, Is.EqualTo(theirs), what);
                Assert.That(mine.Distinct().Count(), Is.EqualTo(mine.Count), what + ": no two entries alike");
            }
        }

        [Test]
        public void ASixtyCarFieldIsNamedExactlyAsBefore_OverASessionOfRaces() => AssertTheSameAsBefore(PseudonymList.Default);

        [Test]
        public void ASixtyCarFieldIsNamedExactlyAsBefore_WhenTheListIsUsedUp() =>
            AssertTheSameAsBefore(PseudonymizerTests.ListOf("Ann One", "Bo Two", "Cy Three", "Dee Four"));

        [Test]
        public void ASixtyCarFieldIsNamedExactlyAsBefore_WithNoList() => AssertTheSameAsBefore(PseudonymList.Empty);

        [Test]
        public void ForManyNamesAsBefore_InWhateverOrderTheFieldIsListed()
        {
            var drivers = Field().Where(c => !c.PaceCar && c.CarIdx != 0).Select(c => new KeyValuePair<long, string>(c.CustId, c.Name)).ToList();
            var now = new PseudonymBook(PseudonymList.Default, Salt).NewSession();
            var before = new Old.Namer(new Old.Book(PseudonymList.Default, Salt));
            now.BeginSession("x");
            before.BeginSession("x");
            Assert.That(now.ForMany(Enumerable.Reverse(drivers).ToList()), Is.EqualTo(before.ForMany(Enumerable.Reverse(drivers).ToList())));
            Assert.That(now.For(0, "Somebody New"), Is.EqualTo(before.For(0, "Somebody New")));
        }

        [Test]
        public void TheBridgeGivesTheDataLoopTheNamesItDidBefore()
        {
            var book = new PseudonymBook(PseudonymList.Default, Salt);
            var bridge = new IRacingSdkBridge { Book = () => book };
            var before = new Old.Namer(new Old.Book(PseudonymList.Default, Salt));
            var field = Field();
            string yaml = Yaml(field);
            bridge.ApplySessionInfo(Parse(yaml), yaml);
            var expected = before.Apply(Parse(yaml)).DriverInfo.Drivers.ToDictionary(d => d.CarIdx, d => d.UserName);
            foreach (var c in field.Where(c => !c.PaceCar && c.CarIdx != 0))
            {
                Assert.That(bridge.OpponentName(c.Number, c.Name, false), Is.EqualTo(expected[c.CarIdx]), "by name, car " + c.CarIdx);
                if (!c.Spectator) // the spectators share a number ("0"), as iRacing gives them
                    Assert.That(bridge.OpponentName(c.Number, "", false), Is.EqualTo(expected[c.CarIdx]), "by number, car " + c.CarIdx);
            }
            Assert.That(bridge.OpponentName(SyntheticField.PlayerNumber, SyntheticField.PlayerName, true), Is.EqualTo(SyntheticField.PlayerName));
            Assert.That(bridge.PlayerName(SyntheticField.PlayerName), Is.EqualTo(SyntheticField.PlayerName));
        }

        // ── What it costs: rankings kept while the salt is the same ──

        [Test]
        public void ANewServerWithTheSameDriversCostsLookups_AndALateJoinerOneRanking()
        {
            var book = new PseudonymBook(PseudonymList.Default, Salt);
            var names = book.NewSession();
            names.Apply(Parse(Yaml(Field())));
            int first = book.Hashed;
            Assert.That(first, Is.EqualTo(62), "59 rivals and 3 spectators, each ranked once");

            // The next server, the same sixty: nothing hashed again.
            names.Apply(Parse(Yaml(Field(), 5002, 70010004)));
            Assert.That(book.Hashed, Is.EqualTo(first));
            // And a session of their own for each, on the same book (the plugin's and the host's paths share one).
            book.NewSession().Apply(Parse(Yaml(Field(), 5003, 70010005)));
            Assert.That(book.Hashed, Is.EqualTo(first));

            // A late joiner: one ranking.
            var joined = Field();
            joined.Insert(joined.Count - 1, new Car { CarIdx = 70, CustId = 740001, Name = MadeUpName(300), Number = "170" });
            names.Apply(Parse(Yaml(joined, 5003, 70010005)));
            Assert.That(book.Hashed, Is.EqualTo(first + 1));
        }

        [Test]
        public void TheKeptRankingsAreBounded()
        {
            var book = new PseudonymBook(PseudonymizerTests.ListOf("Ann One", "Bo Two", "Cy Three"), Salt);
            var names = book.NewSession();
            for (int i = 0; i < PseudonymBook.KeptKeysLimit + 10; i++) names.For(800000 + i, "x");
            Assert.That(book.Hashed, Is.EqualTo(PseudonymBook.KeptKeysLimit + 10));
            // The first were dropped when the limit was passed, and are ranked again when asked for: the same, by the salt.
            var again = new PseudonymBook(PseudonymizerTests.ListOf("Ann One", "Bo Two", "Cy Three"), Salt).NewSession();
            Assert.That(book.NewSession().For(800000, "x"), Is.EqualTo(again.For(800000, "x")));
        }

        // ── Where it is paid: never under the lock the data loop takes ──

        [Test]
        public void TheDataLoopNeverWaitsOnANewFieldsHashing_TheLockIsTakenOnlyToSwap()
        {
            var book = new PseudonymBook(PseudonymList.Default, Salt);
            var bridge = new IRacingSdkBridge { Book = () => book };
            var small = Field(rivals: 5);
            string smallYaml = Yaml(small);
            bridge.ApplySessionInfo(Parse(smallYaml), smallYaml);
            var before = small.Where(c => !c.PaceCar && c.CarIdx != 0).ToDictionary(c => c.CarIdx, c => bridge.OpponentName(c.Number, c.Name, false));

            using var hashing = new ManualResetEventSlim();
            using var named = new ManualResetEventSlim();
            using var release = new ManualResetEventSlim();
            int held = 0;
            book.Ranking = key => { if (Interlocked.Exchange(ref held, 1) == 0) { hashing.Set(); release.Wait(TimeSpan.FromSeconds(20)); } };
            bridge.NamingStep = step => { if (step == "named") { named.Set(); release.Wait(TimeSpan.FromSeconds(20)); } };
            var big = Field(idBase: 750000, nameSeed: 7);
            string bigYaml = Yaml(big, 5002, 70010004);
            var naming = Task.Run(() => bridge.ApplySessionInfo(Parse(bigYaml), bigYaml));
            try
            {
                Assert.That(hashing.Wait(TimeSpan.FromSeconds(20)), Is.True, "the new field is being hashed");
                // In the middle of the hashing the data loop's calls answer at once: the field it had, a name for a car
                // neither field lists (which needs the session's own gate), and his.
                var asks = Task.Run(() =>
                {
                    foreach (var c in small.Where(c => !c.PaceCar && c.CarIdx != 0))
                        Assert.That(bridge.OpponentName(c.Number, c.Name, false), Is.EqualTo(before[c.CarIdx]));
                    Assert.That(bridge.OpponentName("999", "Somebody Else", false), Is.Not.Null.And.Not.EqualTo("Somebody Else"));
                    Assert.That(bridge.PlayerName(SyntheticField.PlayerName), Is.EqualTo(SyntheticField.PlayerName));
                });
                Assert.That(asks.Wait(TimeSpan.FromSeconds(10)), Is.True, "the data loop waited on the hashing");
                asks.GetAwaiter().GetResult();
                Assert.That(named.IsSet, Is.False, "and the field is still being named");
            }
            finally
            {
                release.Set();
            }
            Assert.That(naming.Wait(TimeSpan.FromSeconds(30)), Is.True);
            naming.GetAwaiter().GetResult();
            Assert.That(named.IsSet, Is.True);

            // Swapped in whole: the new field's names, every one.
            var expected = new Old.Namer(new Old.Book(PseudonymList.Default, Salt));
            expected.Apply(Parse(smallYaml));
            expected.For(0, "Somebody Else");
            var want = expected.Apply(Parse(bigYaml)).DriverInfo.Drivers.ToDictionary(d => d.CarIdx, d => d.UserName);
            foreach (var c in big.Where(c => !c.PaceCar && c.CarIdx != 0))
                Assert.That(bridge.OpponentName(c.Number, c.Name, false), Is.EqualTo(want[c.CarIdx]), "car " + c.CarIdx);
        }

        [Test]
        public void AFieldNamedWhileTheSimWentIsNotSwappedIn()
        {
            var book = new PseudonymBook(PseudonymList.Default, Salt);
            var bridge = new IRacingSdkBridge { Book = () => book };
            bridge.NamingStep = step => { if (step == "named") bridge.OnDisconnected(); };
            string yaml = Yaml(Field());
            bridge.ApplySessionInfo(Parse(yaml), yaml);
            Assert.That(bridge.FieldNamed, Is.False);
            Assert.That(bridge.OpponentName("101", MadeUpName(1), false), Is.Null);
        }

        // ── An update that changes no driver is not named again ──

        [Test]
        public void AnUpdateWhoseDriverInfoIsUnchangedIsNotNamedAgain()
        {
            var book = new PseudonymBook(PseudonymList.Default, Salt);
            var bridge = new IRacingSdkBridge { Book = () => book };
            var field = Field();
            string yaml = Yaml(field);
            bridge.ApplySessionInfo(Parse(yaml), yaml);
            Assert.That(bridge.FieldsNamed, Is.EqualTo(1));

            // The results moved (another lap), the drivers did not: not named again, and the names stand.
            string moved = yaml.Replace("LapsComplete: 12", "LapsComplete: 13");
            Assert.That(moved, Is.Not.EqualTo(yaml));
            bridge.ApplySessionInfo(Parse(moved), moved);
            Assert.That(bridge.FieldsNamed, Is.EqualTo(1));
            Assert.That(bridge.OpponentName("101", field[1].Name, false), Is.Not.Null.And.Not.EqualTo(field[1].Name));

            // A driver's line changed (an incident): named again.
            string incident = moved.Replace("CurDriverIncidentCount: 0\n - CarIdx: 5\n", "CurDriverIncidentCount: 2\n - CarIdx: 5\n");
            Assert.That(incident, Is.Not.EqualTo(moved));
            bridge.ApplySessionInfo(Parse(incident), incident);
            Assert.That(bridge.FieldsNamed, Is.EqualTo(2));

            // The same drivers in another session: named again (the session's names start afresh).
            string other = Yaml(field, 5002, 70010004);
            bridge.ApplySessionInfo(Parse(other), other);
            Assert.That(bridge.FieldsNamed, Is.EqualTo(3));

            // No text (a model alone): always named.
            bridge.ApplySessionInfo(Parse(other));
            Assert.That(bridge.FieldsNamed, Is.EqualTo(4));

            // The sim gone and back: named again, whatever the text.
            bridge.OnDisconnected();
            bridge.ApplySessionInfo(Parse(other), other);
            Assert.That(bridge.FieldsNamed, Is.EqualTo(5));
        }

        [Test]
        public void TheDriverInfoSectionRunsToTheNextKey()
        {
            string yaml = "WeekendInfo:\n TrackID: 1\nDriverInfo:\n DriverCarIdx: 0\n Drivers:\n - CarIdx: 0\n   UserName: x\n\nSplitTimeInfo:\n Sectors:\n...\n";
            Assert.That(IRacingSdkBridge.DriverInfoSection(yaml, out int start, out int length), Is.True);
            Assert.That(yaml.Substring(start, length), Is.EqualTo("DriverInfo:\n DriverCarIdx: 0\n Drivers:\n - CarIdx: 0\n   UserName: x\n\n"));
            Assert.That(IRacingSdkBridge.DriverInfoSection("DriverInfo:\n Drivers:\n", out start, out length), Is.True);
            Assert.That((start, length), Is.EqualTo((0, 22)), "the whole text: no key follows");
            Assert.That(IRacingSdkBridge.DriverInfoSection("WeekendInfo:\n TrackID: 1\n", out start, out _), Is.False);
            Assert.That(start, Is.EqualTo(-1));
        }

        /// <summary>
        /// The naming as it stood before the hashing was kept and taken out of the locks: <c>PseudonymBook.Rank</c>,
        /// <c>Priority</c> and <c>Number</c>, and <c>Pseudonymizer</c>'s choosing, copied line for line. Only what the
        /// unchanged static helpers do (initials, surnames, a numbering's base) is borrowed from the class itself.
        /// </summary>
        private static class Old
        {
            public sealed class Book
            {
                private readonly byte[] _salt;
                public Book(PseudonymList list, byte[] salt) { List = list ?? PseudonymList.Empty; _salt = (byte[])salt.Clone(); }
                public PseudonymList List { get; }

                public int[] Rank(string key)
                {
                    var entries = List.Entries;
                    int n = entries.Count;
                    var scores = new ulong[n];
                    var order = new int[n];
                    using (var hmac = new HMACSHA256(_salt))
                        for (int i = 0; i < n; i++)
                        {
                            scores[i] = BitConverter.ToUInt64(hmac.ComputeHash(Encoding.UTF8.GetBytes("rank|" + key + "|" + entries[i].Name)), 0);
                            order[i] = i;
                        }
                    Array.Sort(order, (a, b) =>
                    {
                        int c = scores[b].CompareTo(scores[a]);
                        return c != 0 ? c : string.CompareOrdinal(entries[a].Name, entries[b].Name);
                    });
                    return order;
                }

                public ulong Priority(string key) => Number("priority|" + key);
                public ulong Number(string key, int probe) => Number("number|" + key + "|" + probe.ToString(CultureInfo.InvariantCulture));

                private ulong Number(string message)
                {
                    using (var hmac = new HMACSHA256(_salt))
                        return BitConverter.ToUInt64(hmac.ComputeHash(Encoding.UTF8.GetBytes(message)), 0);
                }
            }

            public sealed class Namer
            {
                private readonly Book _book;
                private readonly Dictionary<string, string> _byKey = new Dictionary<string, string>(StringComparer.Ordinal);
                private readonly HashSet<string> _taken = new HashSet<string>(StringComparer.Ordinal);
                private string? _sessionKey;

                public Namer(Book book) { _book = book; }

                public void BeginSession(string key)
                {
                    key = key ?? "";
                    if (string.Equals(_sessionKey, key, StringComparison.Ordinal)) return;
                    _sessionKey = key;
                    _byKey.Clear();
                    _taken.Clear();
                }

                public string For(long custId, string realName) => ForLocked(custId, realName);

                public string[] ForMany(IReadOnlyList<KeyValuePair<long, string>> drivers)
                {
                    int n = drivers.Count;
                    var keys = new string[n];
                    var priority = new ulong[n];
                    var order = new int[n];
                    for (int i = 0; i < n; i++)
                    {
                        keys[i] = KeyOf(drivers[i].Key, drivers[i].Value, out _);
                        priority[i] = _book.Priority(keys[i]);
                        order[i] = i;
                    }
                    Array.Sort(order, (a, b) =>
                    {
                        int c = priority[b].CompareTo(priority[a]);
                        return c != 0 ? c : string.CompareOrdinal(keys[a], keys[b]);
                    });
                    var result = new string[n];
                    foreach (int i in order) result[i] = ForLocked(drivers[i].Key, drivers[i].Value);
                    return result;
                }

                private static string CustKey(long custId) => "cust:" + custId.ToString(CultureInfo.InvariantCulture);

                private string KeyOf(long custId, string realName, out string? already)
                {
                    already = null;
                    if (custId > 0) return CustKey(custId);
                    string n = (realName ?? "").Trim();
                    if (n.Length > 0 && _taken.Contains(n)) already = n;
                    return "name:" + n.ToLowerInvariant();
                }

                private string ForLocked(long custId, string realName)
                {
                    string key = KeyOf(custId, realName, out string? already);
                    if (already != null) return already;
                    if (_byKey.TryGetValue(key, out string? have)) return have;
                    string chosen = Choose(key);
                    _byKey[key] = chosen;
                    _taken.Add(chosen);
                    return chosen;
                }

                private string Choose(string key)
                {
                    var list = _book.List;
                    if (list.IsEmpty)
                    {
                        for (int probe = 0; probe < 20000; probe++)
                        {
                            string candidate = "Driver " + (_book.Number(key, probe) % 10000).ToString("D4", CultureInfo.InvariantCulture);
                            if (!_taken.Contains(candidate)) return candidate;
                        }
                        return "Driver " + (10000 + _taken.Count).ToString(CultureInfo.InvariantCulture);
                    }
                    var ranked = _book.Rank(key);
                    foreach (int i in ranked)
                    {
                        string candidate = list.Entries[i].Shown;
                        if (!_taken.Contains(candidate)) return candidate;
                    }
                    for (int round = 2; ; round++)
                        foreach (int i in ranked)
                        {
                            string candidate = list.Entries[i].Shown + " " + Roman(round);
                            if (!_taken.Contains(candidate)) return candidate;
                        }
                }

                private List<(IRacingSdkSessionInfo.DriverInfoModel.DriverModel Driver, string Shown)> NameField(IRacingSdkSessionInfo info)
                {
                    var result = new List<(IRacingSdkSessionInfo.DriverInfoModel.DriverModel, string)>();
                    var di = info.DriverInfo;
                    var drivers = di.Drivers;
                    BeginSession(Pseudonymizer.SessionKeyOf(info));
                    var racers = new List<IRacingSdkSessionInfo.DriverInfoModel.DriverModel>();
                    var spectators = new List<IRacingSdkSessionInfo.DriverInfoModel.DriverModel>();
                    foreach (var d in drivers)
                    {
                        if (d == null || d.CarIsPaceCar != 0 || Pseudonymizer.IsHim(di, d)) continue;
                        if (string.IsNullOrWhiteSpace(d.UserName) && d.UserID <= 0) continue;
                        (d.IsSpectator != 0 ? spectators : racers).Add(d);
                    }
                    var shown = new Dictionary<IRacingSdkSessionInfo.DriverInfoModel.DriverModel, string>();
                    foreach (var group in new[] { racers, spectators })
                    {
                        var wants = group.Select(d => new KeyValuePair<long, string>(d.UserID, d.UserName)).ToList();
                        var names = ForMany(wants);
                        for (int i = 0; i < group.Count; i++) shown[group[i]] = names[i];
                    }
                    foreach (var d in drivers)
                        if (d != null && shown.TryGetValue(d, out string? s)) result.Add((d, s));
                    return result;
                }

                public IRacingSdkSessionInfo Apply(IRacingSdkSessionInfo info)
                {
                    var di = info.DriverInfo;
                    bool team = (info.WeekendInfo?.TeamRacing ?? 0) != 0;
                    var labels = new Dictionary<string, string>(StringComparer.Ordinal);
                    foreach (var (d, shown) in NameField(info))
                    {
                        bool hadTeam = !string.IsNullOrWhiteSpace(d.TeamName);
                        d.UserName = shown;
                        d.AbbrevName = shown;
                        d.Initials = Pseudonymizer.Initials(shown);
                        if (!hadTeam) continue;
                        if (!team) { d.TeamName = shown; continue; }
                        string key = d.TeamID > 0 ? "team:" + d.TeamID.ToString(CultureInfo.InvariantCulture) : "driver:" + shown;
                        if (!labels.TryGetValue(key, out string? label)) labels[key] = label = TeamLabel(key);
                        d.TeamName = label;
                    }
                    if (team)
                        foreach (var d in di.Drivers)
                        {
                            if (d == null || d.CarIsPaceCar != 0 || !Pseudonymizer.IsHim(di, d) || string.IsNullOrWhiteSpace(d.TeamName)) continue;
                            string key = d.TeamID > 0 ? "team:" + d.TeamID.ToString(CultureInfo.InvariantCulture) : "driver:him";
                            if (!labels.TryGetValue(key, out string? label)) labels[key] = label = TeamLabel(key);
                            d.TeamName = label;
                        }
                    return info;
                }

                private string TeamLabel(string key)
                {
                    var list = _book.List;
                    if (list.IsEmpty) return "Team " + (_book.Number(key, 0) % 1000).ToString("D3", CultureInfo.InvariantCulture);
                    return "Team " + Pseudonymizer.SurnameOf(list.Entries[_book.Rank(key)[0]].Shown);
                }

                private static string Roman(int n)
                {
                    var sb = new StringBuilder();
                    int[] values = { 1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1 };
                    string[] symbols = { "M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I" };
                    for (int i = 0; i < values.Length; i++)
                        while (n >= values[i]) { sb.Append(symbols[i]); n -= values[i]; }
                    return sb.ToString();
                }
            }
        }
    }
}
