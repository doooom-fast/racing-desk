using System;
using System.IO;
using System.Linq;
using System.Text;
using Microsoft.Data.Sqlite;
using NUnit.Framework;
using RacingDesk.Data.Pedals;

namespace RacingDesk.Tests.Pedals
{
    [TestFixture]
    public class SmartControlTests
    {
        private string _dir;

        [SetUp]
        public void SetUp()
        {
            _dir = Path.Combine(Path.GetTempPath(), "racing-desk-smartcontrol-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_dir);
        }

        [TearDown]
        public void TearDown()
        {
            SqliteConnection.ClearAllPools();
            try { Directory.Delete(_dir, recursive: true); } catch (IOException) { }
        }

        /// <summary>A profile the way SmartControl writes one: a section a device, each with its hash.</summary>
        internal static string ProfileXml(int brakeKg, string brakeCurve = "0/20/40/60/80/100", string pedals = "SimPedalsUltimate")
        {
            string[] c = brakeCurve.Split('/');
            return "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<Profile>\n" +
                "  <Description>made up</Description>\n" +
                "  <SimPedalsSprint><Hash>AA</Hash><BrakeProfile><MaximumCalibratedForceInKilogram>35</MaximumCalibratedForceInKilogram></BrakeProfile></SimPedalsSprint>\n" +
                $"  <{pedals}>\n    <Hash>BB</Hash>\n" +
                "    <ThrottleProfile><DeadzoneBottomPercentage>6</DeadzoneBottomPercentage><DeadzoneTopPercentage>10</DeadzoneTopPercentage>" +
                "<ZeroPercentage>0</ZeroPercentage><TwentyPercentage>25</TwentyPercentage><FourtyPercentage>50</FourtyPercentage>" +
                "<SixtyPercentage>75</SixtyPercentage><EightyPercentage>92</EightyPercentage><HundredPercentage>100</HundredPercentage></ThrottleProfile>\n" +
                "    <BrakeProfile><DeadzoneBottomPercentage>8</DeadzoneBottomPercentage>" +
                $"<MaximumCalibratedForceInKilogram>{brakeKg}</MaximumCalibratedForceInKilogram>" +
                $"<ZeroPercentage>{c[0]}</ZeroPercentage><TwentyPercentage>{c[1]}</TwentyPercentage><FourtyPercentage>{c[2]}</FourtyPercentage>" +
                $"<SixtyPercentage>{c[3]}</SixtyPercentage><EightyPercentage>{c[4]}</EightyPercentage><HundredPercentage>{c[5]}</HundredPercentage></BrakeProfile>\n" +
                "    <ClutchProfile><DeadzoneBottomPercentage>5</DeadzoneBottomPercentage><DeadzoneTopPercentage>5</DeadzoneTopPercentage>" +
                "<ZeroPercentage>0</ZeroPercentage><TwentyPercentage>20</TwentyPercentage></ClutchProfile>\n" +
                $"  </{pedals}>\n</Profile>\n";
        }

        private string Database(Action<SqliteConnection> fill, bool tables = true) =>
            Database(Path.Combine(_dir, "Heusinkveld.db"), fill, tables);

        /// <summary>A database as SmartControl keeps it, as far as this app reads it.</summary>
        internal static string Database(string path, Action<SqliteConnection> fill, bool tables = true)
        {
            using var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ToString());
            db.Open();
            if (tables)
                Run(db, "CREATE TABLE profile_sim_device (id TEXT PRIMARY KEY, name TEXT, data BLOB);" +
                        "CREATE TABLE keyboard_binding (id INTEGER PRIMARY KEY, action_type INTEGER, action_value TEXT, first_key TEXT, second_key TEXT);");
            fill?.Invoke(db);
            return path;
        }

        internal static void Run(SqliteConnection db, string sql, params (string, object)[] args)
        {
            using var cmd = db.CreateCommand();
            cmd.CommandText = sql;
            foreach (var (name, value) in args) cmd.Parameters.AddWithValue(name, value);
            cmd.ExecuteNonQuery();
        }

        internal static void AddProfile(SqliteConnection db, string id, string name, object data) =>
            Run(db, "INSERT INTO profile_sim_device (id, name, data) VALUES ($id, $name, $data)",
                ("$id", id), ("$name", name), ("$data", data));

        internal static void AddKey(SqliteConnection db, int type, string value, string first, string second) =>
            Run(db, "INSERT INTO keyboard_binding (action_type, action_value, first_key, second_key) VALUES ($t, $v, $a, $b)",
                ("$t", type), ("$v", value), ("$a", first), ("$b", second));

        [Test]
        public void ReadsEachProfilesPedalsAndKeepsItsBytes()
        {
            byte[] heavy = Encoding.UTF8.GetBytes(ProfileXml(83, "0/8/25/50/75/100"));
            // SmartControl writes some with a byte-order mark.
            byte[] light = new byte[] { 0xEF, 0xBB, 0xBF }.Concat(Encoding.UTF8.GetBytes(ProfileXml(45))).ToArray();
            string path = Database(db =>
            {
                AddProfile(db, "b2", "light", light);
                AddProfile(db, "a1", "Heavy", heavy);
            });

            var snapshot = SmartControl.Read(path);

            Assert.That(snapshot.DatabasePath, Is.EqualTo(path));
            Assert.That(snapshot.Profiles.Select(p => p.Name), Is.EqualTo(new[] { "Heavy", "light" }));

            var first = snapshot.Profiles[0];
            Assert.That(first.Id, Is.EqualTo("a1"));
            Assert.That(first.Data, Is.EqualTo(heavy));
            Assert.That(first.Brake.MaxForceKg, Is.EqualTo(83));
            Assert.That(first.Brake.DeadzoneBottom, Is.EqualTo(8));
            Assert.That(first.Brake.DeadzoneTop, Is.Null, "the brake has no top deadzone");
            Assert.That(first.Brake.Curve, Is.EqualTo(new double[] { 0, 8, 25, 50, 75, 100 }));
            Assert.That(first.Throttle.DeadzoneTop, Is.EqualTo(10));
            Assert.That(first.Throttle.Curve, Is.EqualTo(new double[] { 0, 25, 50, 75, 92, 100 }));
            Assert.That(first.Throttle.MaxForceKg, Is.Null);
            Assert.That(first.Clutch.Curve, Is.Empty, "a curve with points missing isn't a curve");

            Assert.That(snapshot.Profiles[1].Data, Is.EqualTo(light));
            Assert.That(snapshot.Profiles[1].Brake.MaxForceKg, Is.EqualTo(45));
        }

        [Test]
        public void AProfileIsReadWhateverItsFirstLineSaysItIs()
        {
            // Five of the six profiles on the rig say encoding="utf-16" and are one byte to a letter: SmartControl
            // writes a profile from a string and stores the string. A reader that believes the line reads none.
            string sixteen = ProfileXml(80).Replace("encoding=\"utf-8\"", "encoding=\"utf-16\"");
            byte[] mislabelled = Encoding.UTF8.GetBytes(sixteen);
            byte[] truly = Encoding.Unicode.GetBytes(sixteen);
            byte[] marked = new byte[] { 0xFF, 0xFE }.Concat(Encoding.Unicode.GetBytes(sixteen)).ToArray();
            byte[] bigEnd = Encoding.BigEndianUnicode.GetBytes(sixteen);
            string path = Database(db =>
            {
                AddProfile(db, "a1", "a mislabelled", mislabelled);
                AddProfile(db, "b2", "b truly", truly);
                AddProfile(db, "c3", "c marked", marked);
                AddProfile(db, "d4", "d big end", bigEnd);
            });

            var profiles = SmartControl.Read(path).Profiles;

            Assert.That(profiles.Select(p => p.Brake?.MaxForceKg), Is.EqualTo(new double?[] { 80, 80, 80, 80 }));
            Assert.That(profiles[0].Data, Is.EqualTo(mislabelled), "and kept as it was, first line and all");
            Assert.That(profiles[1].Data, Is.EqualTo(truly));
        }

        [Test]
        public void ReadsTheSectionForThePedalsAskedFor()
        {
            string path = Database(db => AddProfile(db, "a1", "one", Encoding.UTF8.GetBytes(ProfileXml(60))));

            Assert.That(SmartControl.Read(path, "SimPedalsSprint").Profiles[0].Brake.MaxForceKg, Is.EqualTo(35));
            Assert.That(SmartControl.Read(path, "SimPedalsRacecenter").Profiles[0].Brake, Is.Null);
        }

        [Test]
        public void AProfileThatCannotBeReadIsStillListedAndStillWhole()
        {
            byte[] broken = Encoding.UTF8.GetBytes("<Profile><SimPedalsUltimate>");
            string path = Database(db =>
            {
                AddProfile(db, "a1", "broken", broken);
                AddProfile(db, "b2", "empty", DBNull.Value);
                AddProfile(db, "c3", "text", ProfileXml(70));
            });

            var profiles = SmartControl.Read(path).Profiles;

            Assert.That(profiles.Select(p => p.Name), Is.EqualTo(new[] { "broken", "empty", "text" }));
            Assert.That(profiles[0].Brake, Is.Null);
            Assert.That(profiles[0].Data, Is.EqualTo(broken));
            Assert.That(profiles[1].Brake, Is.Null);
            Assert.That(profiles[1].Data, Is.Empty);
            Assert.That(profiles[2].Brake.MaxForceKg, Is.EqualTo(70), "a profile stored as text is read too");
        }

        [Test]
        public void ReadsLivesKeys()
        {
            string path = Database(db =>
            {
                AddKey(db, 8, "50", "PRIOR", "");
                AddKey(db, 9, "5", "RCONTROL", "UP");
                AddKey(db, 10, "5", "RCONTROL", "DOWN");
                AddKey(db, 3, "whatever", "F1", "");
            });

            var keys = SmartControl.Read(path).Keys;

            Assert.That(keys.Select(k => k.Action), Is.EqualTo(new[]
            {
                LiveAction.SetBrakeForce, LiveAction.RaiseBrakeForce, LiveAction.LowerBrakeForce, LiveAction.Other,
            }));
            Assert.That(keys[0].Value, Is.EqualTo(50));
            Assert.That(keys[0].FirstKey, Is.EqualTo("PRIOR"));
            Assert.That(keys[0].SecondKey, Is.Empty);
            Assert.That(keys[1].SecondKey, Is.EqualTo("UP"));
            Assert.That(keys[3].Value, Is.EqualTo(0));
        }

        [Test]
        public void NoDatabaseIsNoSnapshotAndAStrangeOneIsAnEmptyOne()
        {
            Assert.That(SmartControl.Read(Path.Combine(_dir, "absent.db")), Is.Null);

            var snapshot = SmartControl.Read(Database(null, tables: false));
            Assert.That(snapshot.Profiles, Is.Empty);
            Assert.That(snapshot.Keys, Is.Empty);
        }

        [Test]
        public void ReadingChangesNothingAndHoldsNothing()
        {
            string path = Database(db => AddProfile(db, "a1", "one", Encoding.UTF8.GetBytes(ProfileXml(60))));
            byte[] before = File.ReadAllBytes(path);
            DateTime written = File.GetLastWriteTimeUtc(path);

            SmartControl.Read(path);

            Assert.That(File.ReadAllBytes(path), Is.EqualTo(before));
            Assert.That(File.GetLastWriteTimeUtc(path), Is.EqualTo(written));
            Assert.That(Directory.GetFiles(_dir).Select(Path.GetFileName), Is.EqualTo(new[] { "Heusinkveld.db" }), "no journal left beside it");
            // SmartControl can open its own file for writing straight after.
            using (new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { }
        }
    }
}
