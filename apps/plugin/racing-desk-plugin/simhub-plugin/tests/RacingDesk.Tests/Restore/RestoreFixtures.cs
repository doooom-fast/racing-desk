using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;
using NUnit.Framework;
using RacingDesk.Data;
using RacingDesk.Data.Pedals;
using RacingDesk.Data.Restore;

namespace RacingDesk.Tests.Restore
{
    /// <summary>The machine, as a test says it is: nothing here asks Windows anything.</summary>
    internal sealed class FakeProbe : IRigProbe
    {
        public bool Sim, Editor, Live = true;
        public bool? Elevated = false, Pedals = true, SimIsElevated = false;
        public string Front = "notepad";
        public int SimAsked;

        /// <summary>When SmartControl Live started; null while it is not running, or that cannot be asked.</summary>
        public DateTime? LiveStarted;

        public bool SimRunning() { SimAsked++; return Sim; }
        public bool EditorRunning() => Editor;
        public bool LiveRunning() => Live;
        public DateTime? LiveStartedAtUtc() => Live ? LiveStarted : null;
        public bool? ForegroundElevated() => Elevated;
        public string ForegroundProcess() => Front;
        public bool? PedalsConnected() => Pedals;
        public bool? SimElevated() => Sim ? SimIsElevated : null;
    }

    /// <summary>A key sender that sends nothing and counts: the only kind a test is given.</summary>
    internal sealed class FakeKeys : IKeySender
    {
        public int Sent;
        public bool Takes = true;

        /// <summary>Called as the key is sent, before it counts: what the world looks like at the moment of the press.</summary>
        public Action OnSend;

        public bool SendF24() { OnSend?.Invoke(); Sent++; return Takes; }
    }

    /// <summary>Made-up copies of what the rig has, in a folder of the test's own; nothing of the rig's is read.</summary>
    internal sealed class RestoreRig : IDisposable
    {
        public readonly string Dir = Path.Combine(Path.GetTempPath(), "racing-desk-restore-" + Guid.NewGuid().ToString("N"));
        public string Documents => Path.Combine(Dir, "iRacing");
        public string Backups => Path.Combine(Dir, "backups");
        public string Store => Path.Combine(Dir, "racing-desk.db");
        public string SmartControlDb => Path.Combine(Dir, "Heusinkveld.db");
        public string Telemetry => Path.Combine(Dir, "telemetry");
        public readonly FakeProbe Probe = new FakeProbe();
        public readonly FakeKeys Keys = new FakeKeys();
        public readonly List<string> Logged = new List<string>();

        /// <summary>The forces the key watcher was told the pedals are at (the car, the force), and the keys he pressed in the car.</summary>
        public readonly List<(string Car, double Kg)> Seeded = new List<(string, double)>();
        public int Presses;

        public RestoreRig()
        {
            Directory.CreateDirectory(Documents);
        }

        public ViewFiles Files() => new ViewFiles(Documents, Path.Combine(Backups, "view"), Probe, Store);

        public RestoreContext Context() => new RestoreContext
        {
            StorePath = Store, Files = Files(), SmartControlDb = SmartControlDb, Backups = Backups, TelemetryDir = Telemetry, Probe = Probe, Keys = Keys,
            Log = m => { lock (Logged) Logged.Add(m); },
            ForceIs = (car, kg) => { lock (Seeded) Seeded.Add((car, kg)); },
            PressesThisRun = () => Presses,
        };

        public void Dispose()
        {
            SqliteConnection.ClearAllPools();
            try { Directory.Delete(Dir, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }

        // ── iRacing's files ──

        /// <summary>app.ini as the sim writes it: [View] values to six decimals, padded to column 40, then a tab and a comment.</summary>
        public static string AppIniText(double height, double vanishY = 0.19, double fov = 70) =>
            "[Graphics]\r\nfullScreen=1                            \t; full screen\r\n\r\n[View]\r\n" +
            Line("cockpitLookAngle", 65, "Angle in degrees to rotate head when looking left/right") +
            Line("DriverHeadHorizon", 0, "Percent to allow the drivers head to stay level with the horizon") +
            Line("driverHeightAdj", height, "Range -0.050m to 0.050m  (approx. +/- 2 in.)") +
            Line("drivingCamFOV", fov, "driving camera field of view") +
            Line("DrivingVanishY", vanishY, "Shift the driving view up/down to make it easier to see the dash") +
            "\r\n[XXX Dev Use Only]\r\nsomething=1\r\n";

        private static string Line(string key, double value, string comment) =>
            (key + "=" + value.ToString("0.000000", CultureInfo.InvariantCulture)).PadRight(40) + "\t; " + comment + "\r\n";

        public void AppIni(double height, double vanishY = 0.19, double fov = 70) =>
            File.WriteAllBytes(Path.Combine(Documents, "app.ini"), Encoding.ASCII.GetBytes(AppIniText(height, vanishY, fov)));

        public byte[] AppIniBytes() => File.ReadAllBytes(Path.Combine(Documents, "app.ini"));

        public void CameraIni(params (string Car, string LastCarSet)[] cars)
        {
            var text = new StringBuilder("[global]\r\nsomething=1\r\n\r\n");
            foreach (var (car, last) in cars) text.Append($"[cars\\{car.Replace(' ', '\\')}]\r\nLastCarSet={last}\r\n\r\n");
            File.WriteAllText(Path.Combine(Documents, "camera.ini"), text.ToString(), Encoding.ASCII);
        }

        private static readonly string[] Cameras =
        {
            "CamNose", "CamGearbox", "CamRoll Bar", "CamLF Susp", "CamLR Susp", "CamGyro", "CamRF Susp", "CamRR Susp", "CamCockpit",
        };

        /// <summary>A camera file in the rig's layout: 12 bytes of header, nine cameras of 184, the cockpit last.</summary>
        public static byte[] CarCam(int version, float x, float y, float z, float shift = 0f, string[] cameras = null)
        {
            cameras = cameras ?? Cameras;
            var file = new byte[12 + cameras.Length * 184];
            Encoding.ASCII.GetBytes("MACC").CopyTo(file, 0);
            BitConverter.GetBytes(version).CopyTo(file, 4);
            BitConverter.GetBytes(cameras.Length * 184).CopyTo(file, 8);
            for (int i = 0; i < cameras.Length; i++)
            {
                int at = 12 + i * 184;
                Encoding.ASCII.GetBytes(cameras[i]).CopyTo(file, at);
                bool cockpit = cameras[i] == "CamCockpit";
                BitConverter.GetBytes(cockpit ? 5 : 4).CopyTo(file, at + 32);
                BitConverter.GetBytes(cockpit ? x : 1.5f).CopyTo(file, at + 52);
                BitConverter.GetBytes(cockpit ? y : 0.4f).CopyTo(file, at + 56);
                BitConverter.GetBytes(cockpit ? z : 0.9f).CopyTo(file, at + 60);
                BitConverter.GetBytes(1.2f).CopyTo(file, at + 76);
                BitConverter.GetBytes(cockpit ? shift : -0.125f).CopyTo(file, at + 84);
                BitConverter.GetBytes(1.2589f).CopyTo(file, at + 96);
            }
            return file;
        }

        public string CamPath(string car) => Path.Combine(Documents, ViewFiles.DefaultCamFile(car));

        public void Cam(string car, float x, float z, float shift = 0f, int version = 14)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(CamPath(car)));
            File.WriteAllBytes(CamPath(car), CarCam(version, x, 0f, z, shift));
        }

        public float CamZ(string car) => BitConverter.ToSingle(File.ReadAllBytes(CamPath(car)), 12 + 8 * 184 + 60);
        public float CamShift(string car) => BitConverter.ToSingle(File.ReadAllBytes(CamPath(car)), 12 + 8 * 184 + 84);

        // ── SmartControl ──

        /// <summary>The vendor's own tables, as LibHeusinkveld creates them (its seed SQL), with made-up rows.</summary>
        public const string VendorSchema = @"
CREATE TABLE ""profile_sim_device"" (id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, ""data"" BLOB);
CREATE TABLE profile_smartcontrol_live (id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, shortcut_first_key TEXT, shortcut_second_key TEXT);
CREATE TABLE keyboard_binding (id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, action_type INTEGER NOT NULL, action_value TEXT NOT NULL, first_key TEXT NOT NULL, second_key TEXT);
CREATE TABLE ""profile_smartcontrol_live_keyboard_binding"" (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  fk_profile_smartcontrol_live_id INTEGER NOT NULL,
  fk_keyboard_binding_id INTEGER NOT NULL,
  CONSTRAINT profile_smartcontrol_live_keyboard_binding_FK_1 FOREIGN KEY (fk_profile_smartcontrol_live_id) REFERENCES profile_smartcontrol_live(id) ON DELETE CASCADE,
  CONSTRAINT profile_smartcontrol_live_keyboard_binding_FK_2 FOREIGN KEY (fk_keyboard_binding_id) REFERENCES keyboard_binding(id) ON DELETE CASCADE
);
CREATE TABLE ""database_version""(version_number INTEGER NOT NULL);
";

        public const string DefaultId = "0123456789abcdef0123456789abcdef", LightId = "fedcba9876543210fedcba9876543210", RainId = "00112233445566778899aabbccddeeff";

        /// <summary>A database as SmartControl 26.02 keeps it: three of his profiles, his two presets, his five keys.</summary>
        public void SmartControl(long version = 1)
        {
            using var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = SmartControlDb, Pooling = false }.ToString());
            db.Open();
            Run(db, VendorSchema);
            Run(db, $"INSERT INTO database_version (version_number) VALUES ({version})");
            Run(db, "INSERT INTO profile_smartcontrol_live (id, name) VALUES (0, '(empty)'); INSERT INTO profile_smartcontrol_live (id, name, shortcut_first_key, shortcut_second_key) VALUES (1, 'Default', 'LCONTROL', 'D')");
            AddProfile(db, DefaultId, "Default", Encoding.UTF8.GetBytes(NewFormatProfile(80, 5, nilDescription: true)));
            AddProfile(db, LightId, "LightBrake", Encoding.UTF8.GetBytes(OldFormatProfile(45, 4)));
            AddProfile(db, RainId, "Rain", Encoding.UTF8.GetBytes(NewFormatProfile(75, 5, nilDescription: false)));
            int id = 6;
            foreach (var (type, value, first, second) in new[] { (8, "50", "PRIOR", ""), (8, "30", "NEXT", ""), (8, "80", "PAUSE", ""), (9, "5", "RCONTROL", "UP"), (10, "5", "RCONTROL", "DOWN") })
            {
                Run(db, $"INSERT INTO keyboard_binding (id, action_type, action_value, first_key, second_key) VALUES ({id}, {type}, '{value}', '{first}', '{second}')");
                Run(db, $"INSERT INTO profile_smartcontrol_live_keyboard_binding (id, fk_profile_smartcontrol_live_id, fk_keyboard_binding_id) VALUES ({id}, 1, {id})");
                id++;
            }
        }

        public static void Run(SqliteConnection db, string sql)
        {
            using var cmd = db.CreateCommand();
            cmd.CommandText = sql;
            cmd.ExecuteNonQuery();
        }

        public static void AddProfile(SqliteConnection db, string id, string name, byte[] data)
        {
            using var cmd = db.CreateCommand();
            cmd.CommandText = "INSERT INTO profile_sim_device (id, name, data) VALUES ($id, $name, $data)";
            cmd.Parameters.AddWithValue("$id", id);
            cmd.Parameters.AddWithValue("$name", name);
            cmd.Parameters.Add("$data", SqliteType.Blob).Value = data;
            cmd.ExecuteNonQuery();
        }

        /// <summary>A profile row as SmartControl's editor would leave it after he saved a change: its bytes replaced, nothing else.</summary>
        public void EditProfile(string id, byte[] data)
        {
            using var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = SmartControlDb, Pooling = false }.ToString());
            db.Open();
            using var cmd = db.CreateCommand();
            cmd.CommandText = "UPDATE profile_sim_device SET data = $data WHERE id = $id";
            cmd.Parameters.AddWithValue("$id", id);
            cmd.Parameters.Add("$data", SqliteType.Blob).Value = data;
            Assert.That(cmd.ExecuteNonQuery(), Is.EqualTo(1));
        }

        /// <summary>A profile row he deleted in SmartControl.</summary>
        public void DeleteProfile(string id)
        {
            using var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = SmartControlDb, Pooling = false }.ToString());
            db.Open();
            Run(db, $"DELETE FROM profile_sim_device WHERE id = '{id}'");
        }

        /// <summary>A profile of his own, added in SmartControl.</summary>
        public void AddProfile(string id, string name, byte[] data)
        {
            using var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = SmartControlDb, Pooling = false }.ToString());
            db.Open();
            AddProfile(db, id, name, data);
        }

        /// <summary>A session's telemetry file (empty: only its name and times are looked at), made and last written at <paramref name="atUtc"/>.</summary>
        public string Ibt(string name, DateTime atUtc)
        {
            Directory.CreateDirectory(Telemetry);
            string path = Path.Combine(Telemetry, name);
            File.WriteAllBytes(path, new byte[16]);
            File.SetCreationTimeUtc(path, atUtc);
            File.SetLastWriteTimeUtc(path, atUtc);
            return path;
        }

        public string FileSha(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)));

        private static string Pedal(string name, int dzb, int? dzt, int? kg, int[] curve)
        {
            var s = new StringBuilder($"      <{name}>\r\n        <DeadzoneBottomPercentage>{dzb}</DeadzoneBottomPercentage>\r\n");
            string[] points = { "ZeroPercentage", "TwentyPercentage", "FourtyPercentage", "SixtyPercentage", "EightyPercentage", "HundredPercentage" };
            for (int i = 0; i < 6; i++) s.Append($"        <{points[i]}>{curve[i]}</{points[i]}>\r\n");
            if (kg.HasValue) s.Append($"        <MaximumCalibratedForceInKilogram>{kg}</MaximumCalibratedForceInKilogram>\r\n");
            if (dzt.HasValue) s.Append($"        <DeadzoneTopPercentage>{dzt}</DeadzoneTopPercentage>\r\n");
            s.Append($"      </{name}>\r\n");
            return s.ToString();
        }

        private static readonly int[] Linear = { 0, 20, 40, 60, 80, 100 };

        /// <summary>The values of a section in the hash's order, for checking the rule from outside it.</summary>
        public static string RuleValues(int brakeDzb, int kg) =>
            "5" + "5" + "020406080100" + brakeDzb + "020406080100" + kg + "5" + "5" + "020406080100";

        public static string Hash(string values) => Convert.ToHexString(SHA512.HashData(Encoding.UTF8.GetBytes(values)));

        private static string Section(string name, string hash, int brakeDzb, int kg) =>
            $"  <{name}>\r\n    <Hash>{hash}</Hash>\r\n" + Pedal("ThrottleProfile", 5, 5, null, Linear) + Pedal("BrakeProfile", brakeDzb, null, kg, Linear)
            + Pedal("ClutchProfile", 5, 5, null, Linear) + $"  </{name}>\r\n";

        /// <summary>A profile as SmartControl writes one now: "utf-16" in its first line over UTF-8 bytes, a Description, correct hashes.</summary>
        public static string NewFormatProfile(int kg, int brakeDzb, bool nilDescription) =>
            "<?xml version=\"1.0\" encoding=\"utf-16\"?>\r\n<Profile xmlns:xsd=\"http://www.w3.org/2001/XMLSchema\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">\r\n"
            + (nilDescription ? "  <Description xsi:nil=\"true\" />\r\n" : "  <Description>wet nights</Description>\r\n")
            + Section("SimPedalsSprint", Hash(RuleValues(brakeDzb, 35)), brakeDzb, 35)
            + Section("SimPedalsUltimate", Hash(RuleValues(brakeDzb, kg)), brakeDzb, kg)
            + "  <SimWheelOne />\r\n</Profile>";

        /// <summary>LightBrake as Heusinkveld ships it: an older format, no Description, and a hash of other values.</summary>
        public static string OldFormatProfile(int kg, int brakeDzb) =>
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\r\n<Profile xmlns:xsd=\"http://www.w3.org/2001/XMLSchema\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">\r\n"
            + "  <Major>1</Major>\r\n  <Minor>1</Minor>\r\n  <Patch>0</Patch>\r\n"
            + Section("SimPedalsSprint", Hash(RuleValues(brakeDzb, 30)), brakeDzb, 20)
            + Section("SimPedalsUltimate", Hash(RuleValues(brakeDzb, 60)), brakeDzb, kg)
            + "</Profile>";

        // ── The store ──

        /// <summary>A store with cars he has driven, their views and their pedals, as the recorders keep them (customer id 424242).</summary>
        public void StoreWithCars(params (string Car, string Name, double? Height, bool Chosen, double? SeatZ, string Base, string BaseId, double? Kg, string GivenBy)[] cars)
        {
            using var store = new RacingDeskStore(Store);
            var session = new SessionRecord
            {
                Source = "live", SessionNum = 0, StartedAtUtc = new DateTime(2026, 9, 30, 18, 0, 0, DateTimeKind.Utc), SessionType = "Practice",
                CarPath = cars.Length > 0 ? cars[0].Car : "mx5 mx52016", CarScreenName = cars.Length > 0 ? cars[0].Name : "Mazda MX-5 Cup", DriverCustId = 424242,
            };
            foreach (var c in cars) session.Cars.Add(new CarRecord { CarPath = c.Car, Name = c.Name });
            store.SaveSession(session);
            foreach (var c in cars)
            {
                if (c.Height.HasValue)
                    store.SaveCarView(new CarView { CarPath = c.Car, DriverHeight = c.Height, VanishY = 0.19, Fov = 70, SeatZ = c.SeatZ, SeatX = c.SeatZ.HasValue ? -0.1 : (double?)null, Chosen = c.Chosen, SeenAtUtc = DateTime.UtcNow });
                if (c.Base != null)
                {
                    store.BindCarPedals(new CarPedals { CarPath = c.Car, ProfileId = c.BaseId, ProfileName = c.Base, BoundAtUtc = DateTime.UtcNow });
                    store.NotePedalsGiven(c.Car, c.GivenBy ?? "rule", c.GivenBy == "driver" ? null : "ABS", DateTime.UtcNow);
                }
                if (c.Kg.HasValue) store.NotePedals(c.Car, c.Kg, true, 0, DateTime.UtcNow);
            }
        }
    }
}
