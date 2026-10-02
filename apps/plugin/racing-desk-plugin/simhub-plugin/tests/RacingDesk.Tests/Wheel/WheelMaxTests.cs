using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RacingDesk.Data.Wheel;
using RacingDesk.Host;
using RacingDesk.Plugin.Engine.Moza;

namespace RacingDesk.Tests.Wheel
{
    /// <summary>
    /// The wheel's maximum torque, for the HUD's datastream ("max wheel Nm"): from what the wheel base itself last said, or
    /// from Pit House's own saved preset for it, read and never written, or not at all. A MOZA preset is an ordinary zip
    /// of a <c>preset.json</c> (the device, and <c>deviceParams.maximumTorque</c> in per cent of the model's rated peak)
    /// and a <c>metadata.json</c>, one for each preset under <c>Documents\MOZA Pit House\Presets\Motor</c>; its
    /// <c>config.ini</c> maps each device Pit House has met to the preset it last used. The folders here are built in a
    /// temporary directory in that shape (the shape was read from the rig's own files, read-only, on 2026-10-01).
    /// </summary>
    [TestFixture]
    public class WheelMaxTests
    {
        private static readonly Guid R9Id = Guid.Parse("6617120a-80e5-4096-b7c7-76daf8241c20");
        private static readonly Guid R21Id = Guid.Parse("4ae02c83-47f6-4a1f-84c9-a5f84a3e095e");

        /// <summary>A Documents folder with Pit House's presets in it.</summary>
        private sealed class House : IDisposable
        {
            public readonly string Documents = Path.Combine(Path.GetTempPath(), "racing-desk-pithouse-" + Guid.NewGuid().ToString("N"));
            public string Presets => Path.Combine(Documents, "MOZA Pit House", "Presets");

            public House() { Directory.CreateDirectory(Path.Combine(Presets, "Motor")); }

            public string MotorPath(Guid id) => Path.Combine(Presets, "Motor", id.ToString("D") + ".mzpreset");

            /// <summary>A motor preset: <paramref name="devices"/> a string or an array, <paramref name="torque"/> whatever the file says.</summary>
            public void Motor(Guid id, string name, object devices, object torque, string saved = "2026-09-30T16:57:42", string deviceType = "Motor")
            {
                var preset = new JObject
                {
                    ["carModels"] = new JArray(), ["deviceParams"] = new JObject { ["gameForceFeedbackStrength"] = 70, ["maximumTorque"] = torque == null ? null : JToken.FromObject(torque) },
                    ["devices"] = JToken.FromObject(devices), ["deviceType"] = deviceType, ["gameId"] = -1, ["id"] = id.ToString("D"), ["isOfficial"] = false,
                    ["lastModified"] = saved, ["name"] = name, ["version"] = 5,
                };
                if (torque == null) ((JObject)preset["deviceParams"]).Remove("maximumTorque");
                WriteZip(MotorPath(id), ("preset.json", preset.ToString()), ("metadata.json", "{\"format_version\":1}"));
            }

            public static void WriteZip(string path, params (string Name, string Text)[] entries)
            {
                using (var file = new FileStream(path, FileMode.Create, FileAccess.Write))
                using (var zip = new ZipArchive(file, ZipArchiveMode.Create))
                    foreach (var (name, text) in entries)
                        using (var w = new StreamWriter(zip.CreateEntry(name).Open(), new UTF8Encoding(false)))
                            w.Write(text);
            }

            /// <summary>config.ini as Pit House writes it: each device it has met, the preset it last used.</summary>
            public void Config(params Guid[] lastUsed)
            {
                var sb = new StringBuilder("[LastUsedPreset]\r\n");
                for (int i = 0; i < lastUsed.Length; i++) sb.Append("device").Append(i).Append('=').Append(lastUsed[i].ToString("D")).Append("\r\n");
                sb.Append("\r\n[Other]\r\nversion=95\r\n\r\n[IsAutoLoadPreset]\r\nPedals=false\r\nMotor=false\r\n");
                File.WriteAllText(Path.Combine(Presets, "config.ini"), sb.ToString());
            }

            public void Dispose() { try { Directory.Delete(Documents, true); } catch { } }
        }

        private static WheelLimit Read(House house) => new PitHouseWheelLimits(house.Documents).Read();

        // ── Pit House's preset ──

        [Test]
        public void TheR21UltrasPresetGivesItsMaximumInNm()
        {
            using var house = new House();
            house.Motor(R21Id, "R21 Ultra-AC-Official2", "R21 Ultra", 55);
            house.Config(R21Id);

            var limit = Read(house);
            Assert.That(limit, Is.Not.Null);
            Assert.That((limit.Source, limit.Model, limit.Candidates), Is.EqualTo(("pithouse", "R21 Ultra", 1)));
            Assert.That((limit.MaxPercent, limit.RatedNm), Is.EqualTo(((double?)55, (double?)21)));
            Assert.That(limit.MaxNm, Is.EqualTo(11.55).Within(0.0001), "55 per cent of a 21 Nm base");
        }

        [Test]
        public void WithTwoBasesInThePresetsTheOneSavedLastIsTakenAndTheCountSaysTwo()
        {
            using var house = new House();
            house.Motor(R9Id, "bmw", "R9", 65, saved: "2026-08-02T18:45:54");
            house.Motor(R21Id, "R21 Ultra-AC-Official2", "R21 Ultra", 55, saved: "2026-09-30T16:57:42");
            house.Config(R9Id, R21Id);
            var limit = Read(house);
            Assert.That((limit.Model, limit.Candidates), Is.EqualTo(("R21 Ultra", 2)), "Pit House does not say which base is attached: the preset saved last");
            Assert.That(limit.MaxNm, Is.EqualTo(11.55).Within(0.0001));

            // Saved the other way round: the R9's.
            house.Motor(R9Id, "bmw", "R9", 65, saved: "2026-10-02T09:00:00");
            limit = Read(house);
            Assert.That(limit.Model, Is.EqualTo("R9"));
            Assert.That(limit.MaxNm, Is.EqualTo(5.85).Within(0.0001), "65 per cent of 9 Nm");
        }

        [Test]
        public void ThePresetsThatAreNotMotorPresetsOrHaveNoUsableMaximumAreNotRead()
        {
            using var house = new House();
            var pedals = Guid.NewGuid();
            house.Motor(pedals, "pedals", "SR-P", 55, deviceType: "Pedals");
            house.Config(pedals);
            Assert.That(Read(house), Is.Null, "a pedals preset is not the base's");

            foreach (object torque in new object[] { 0, -5, 101, 150, "55", null })
            {
                house.Motor(R21Id, "x", "R21 Ultra", torque);
                house.Config(R21Id);
                Assert.That(Read(house), Is.Null, $"a maximum torque of {torque ?? "none"} is not a setting to show");
            }

            // The device may be a list; a model with no number in its name has no rating but its setting is read.
            house.Motor(R21Id, "x", new[] { "R21 Ultra" }, 55);
            Assert.That(Read(house).Model, Is.EqualTo("R21 Ultra"));
            house.Motor(R21Id, "x", "CS V2.1", 55);
            Assert.That(Read(house).MaxNm, Is.Null, "no rating: no Nm");
            house.Motor(R21Id, "x", "", 55);
            Assert.That(Read(house), Is.Null, "no device");
        }

        [Test]
        public void ANumberIsNeverMadeUpForAModelNotInTheTable()
        {
            using var house = new House();
            house.Motor(R21Id, "x", "R99 Mega", 40);
            house.Config(R21Id);
            var limit = Read(house);
            Assert.That((limit.MaxPercent, limit.RatedNm, limit.MaxNm), Is.EqualTo(((double?)40, (double?)null, (double?)null)));
        }

        [Test]
        public void NoPitHouseOrNothingItSaysIsNull_AndNothingThrows()
        {
            using var house = new House();
            Assert.That(new PitHouseWheelLimits(Path.Combine(house.Documents, "nowhere")).Read(), Is.Null, "no Pit House on this machine");
            Assert.That(Read(house), Is.Null, "no config.ini");

            File.WriteAllText(Path.Combine(house.Presets, "config.ini"), "[Other]\r\nversion=95\r\n");
            Assert.That(Read(house), Is.Null, "no [LastUsedPreset]");

            house.Config(R21Id);
            Assert.That(Read(house), Is.Null, "a preset that is listed and not there");

            File.WriteAllBytes(house.MotorPath(R21Id), new byte[] { 1, 2, 3, 4, 5 });
            var said = new List<string>();
            Assert.That(new PitHouseWheelLimits(house.Documents, null, said.Add).Read(), Is.Null, "a preset that is not a zip");
            Assert.That(said, Has.Count.EqualTo(1));

            House.WriteZip(house.MotorPath(R21Id), ("other.json", "{}"));
            Assert.That(Read(house), Is.Null, "a zip with no preset.json");
            House.WriteZip(house.MotorPath(R21Id), ("preset.json", "[1,2]"));
            Assert.That(Read(house), Is.Null, "a preset that is not an object");

            // A name in the ini that is not a GUID is not followed anywhere (no path is built from it).
            File.WriteAllText(Path.Combine(house.Presets, "config.ini"), "[LastUsedPreset]\r\na=..\\..\\evil\r\nb=\r\n");
            Assert.That(Read(house), Is.Null);
        }

        [Test]
        public void NothingIsWrittenAndAProgramHoldingTheFilesOpenForWritingIsNotInTheWay()
        {
            using var house = new House();
            house.Motor(R21Id, "R21 Ultra-AC-Official2", "R21 Ultra", 55);
            house.Config(R21Id);

            string Snapshot() => string.Join("|", Directory.EnumerateFiles(house.Documents, "*", SearchOption.AllDirectories).OrderBy(f => f, StringComparer.Ordinal)
                .Select(f => f + ":" + File.GetLastWriteTimeUtc(f).Ticks + ":" + Convert.ToBase64String(SHA256.Create().ComputeHash(File.ReadAllBytes(f)))));
            string before = Snapshot();
            string tree = string.Join("|", Directory.EnumerateFileSystemEntries(house.Documents, "*", SearchOption.AllDirectories).OrderBy(f => f, StringComparer.Ordinal));

            // Pit House writes to its presets while it runs: both files are open for reading and writing by another program.
            using (var a = new FileStream(house.MotorPath(R21Id), FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite))
            using (var b = new FileStream(Path.Combine(house.Presets, "config.ini"), FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite))
            {
                var limit = Read(house);
                Assert.That(limit?.MaxNm, Is.EqualTo(11.55).Within(0.0001), "read while another program has them open for writing");
            }

            Assert.That(Snapshot(), Is.EqualTo(before), "no file's bytes or time changed");
            Assert.That(string.Join("|", Directory.EnumerateFileSystemEntries(house.Documents, "*", SearchOption.AllDirectories).OrderBy(f => f, StringComparer.Ordinal)), Is.EqualTo(tree), "nothing created or removed");
        }

        [Test]
        public void ItIsKeptForAFewSecondsAndThenLookedAtAgain()
        {
            using var house = new House();
            house.Motor(R21Id, "x", "R21 Ultra", 55);
            house.Config(R21Id);
            var now = new DateTime(2026, 10, 1, 12, 0, 0, DateTimeKind.Utc);
            var reader = new PitHouseWheelLimits(house.Documents, () => now);
            Assert.That(reader.Read().MaxPercent, Is.EqualTo(55));

            house.Motor(R21Id, "x", "R21 Ultra", 60);
            now = now.AddSeconds(1);
            Assert.That(reader.Read().MaxPercent, Is.EqualTo(55), "kept");
            now = now.AddSeconds(5);
            Assert.That(reader.Read().MaxPercent, Is.EqualTo(60), "looked at again");
        }

        [Test]
        public void ThePresetsOnTheRigItselfAreReadWhenTheyAreThere()
        {
            // The real DocumentsMOZA Pit House, read-only, as the host reads it: the shape this reader goes by is the one the
            // files have today. Nothing is asserted of what is in them (his settings are his), only that they read.
            string real = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "MOZA Pit House", "Presets", "config.ini");
            Assume.That(File.Exists(real), "no Pit House on this machine");
            string before = File.GetLastWriteTimeUtc(real).Ticks + ":" + new FileInfo(real).Length;

            var limit = new PitHouseWheelLimits().Read();
            Assume.That(limit, Is.Not.Null, "Pit House has no motor preset it says it used");
            Assert.That(limit.Source, Is.EqualTo("pithouse"));
            Assert.That(limit.Model, Is.Not.Empty);
            Assert.That(limit.MaxPercent, Is.GreaterThan(0).And.LessThanOrEqualTo(100));
            Assert.That(limit.Candidates, Is.GreaterThanOrEqualTo(1));
            Assert.That(File.GetLastWriteTimeUtc(real).Ticks + ":" + new FileInfo(real).Length, Is.EqualTo(before), "read, not written");
        }

        // ── The model's name and rating ──

        [Test]
        public void TheModelIsInTheNameAndTheRatingIsTheTables()
        {
            Assert.That(MozaWheelbaseModels.ModelFrom("Gudsen MOZA R9 Base"), Is.EqualTo("R9"));
            Assert.That(MozaWheelbaseModels.ModelFrom("MOZA R12 Ultra Base"), Is.EqualTo("R12 Ultra"));
            Assert.That(MozaWheelbaseModels.ModelFrom("MOZA Racing R21 Base"), Is.EqualTo("R21"));
            Assert.That(MozaWheelbaseModels.ModelFrom("R21 Ultra"), Is.EqualTo("R21 Ultra"));
            Assert.That(MozaWheelbaseModels.ModelFrom("USB Serial Device"), Is.EqualTo(""));
            Assert.That(MozaWheelbaseModels.ModelFrom("(identified via protocol probe — generic USB description)"), Is.EqualTo(""));
            Assert.That(MozaWheelbaseModels.ModelFrom(null), Is.EqualTo(""));

            Assert.That(MozaWheelbaseModels.RatedNm("R5"), Is.EqualTo(5.5), "the R5's name is not its rating");
            Assert.That(new[] { "R9", "R12", "R16", "R21", "R21 Ultra", "R25 Ultra" }.Select(m => MozaWheelbaseModels.RatedNm(m)), Is.EqualTo(new double?[] { 9, 12, 16, 21, 21, 25 }));
            Assert.That(MozaWheelbaseModels.RatedNm("R99"), Is.Null);
            Assert.That(MozaWheelbaseModels.RatedNm("CS V2.1"), Is.Null);
            Assert.That(MozaWheelbaseModels.RatedNm(""), Is.Null);
        }

        // ── What the base itself said, ahead of the file ──

        [Test]
        public void TheBasesOwnReadingComesFirstAndNeedsAModelWithARating()
        {
            var pitHouse = new WheelLimit { Source = "pithouse", Model = "R21 Ultra", MaxPercent = 55, RatedNm = 21, Candidates = 2 };
            var live = WheelLimit.Resolve(new WheelbaseReading("R9", 100), pitHouse);
            Assert.That((live.Source, live.Model, live.MaxNm), Is.EqualTo(("base", "R9", (double?)9)), "the base's own, ahead of Pit House's file");

            Assert.That(WheelLimit.Resolve(new WheelbaseReading("", 40), pitHouse), Is.SameAs(pitHouse), "a base whose model is not known has no Nm: the file's");
            Assert.That(WheelLimit.Resolve(new WheelbaseReading("R99", 40), pitHouse), Is.SameAs(pitHouse));
            Assert.That(WheelLimit.Resolve(null, pitHouse), Is.SameAs(pitHouse));
            Assert.That(WheelLimit.Resolve(null, null), Is.Null);
            Assert.That(WheelLimit.Resolve(new WheelbaseReading("R21", 55), null).MaxNm, Is.EqualTo(11.55).Within(0.0001));
        }

        // ── What the poll publishes ──

        private static MozaSerialManager ManagerWith(MozaDevice device)
        {
            // No Start(): no port is opened. The device is put in as the discovery would have.
            var manager = new MozaSerialManager(_ => { }, _ => { });
            var devices = (ConcurrentDictionary<string, MozaDevice>)typeof(MozaSerialManager).GetField("_devices", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(manager);
            devices["COM99"] = device;
            return manager;
        }

        private static MozaDevice Base(string model, int? maxTorque, int ffb = 70)
        {
            var device = new MozaDevice("COM99", MozaDeviceRegistry.MozaDeviceType.Wheelbase, MozaDeviceRegistry.GetDeviceId(MozaDeviceRegistry.MozaDeviceType.Wheelbase)) { IsConnected = true };
            device.WheelbaseSettings.Model = model;
            device.WheelbaseSettings.ApplyValue(MozaDeviceRegistry.WheelbaseCmd.FfbStrength, ffb);
            if (maxTorque.HasValue) device.WheelbaseSettings.ApplyValue(MozaDeviceRegistry.WheelbaseCmd.MaxTorque, maxTorque.Value);
            return device;
        }

        private static string Summary(MozaSerialManager manager)
        {
            var sb = new StringBuilder();
            manager.AppendPollSummary(sb, (b, k, v) => b.Append('"').Append(k).Append("\":").Append(v).Append(",\n"), (b, k, v) => b.Append('"').Append(k).Append("\":\"").Append(v).Append("\",\n"));
            return sb.ToString();
        }

        [Test]
        public void ThePollPublishesTheBasesMaxTorqueAndModelWhereItHasRead()
        {
            using (var manager = ManagerWith(Base("R21 Ultra", 55)))
            {
                string text = Summary(manager);
                Assert.That(text, Does.Contain("\"RacingDesk.Plugin.DS.MozaWheelbaseMaxTorque\":55,"));
                Assert.That(text, Does.Contain("\"RacingDesk.Plugin.DS.MozaWheelbaseMaxNm\":11.55,"), "55 per cent of the R21 Ultra's 21 Nm");
                Assert.That(text, Does.Contain("\"RacingDesk.Plugin.DS.MozaWheelbaseModel\":\"R21 Ultra\","));
                Assert.That(text, Does.Contain("\"RacingDesk.Plugin.DS.MozaWheelbaseFFBStrength\":70,"), "what was published before is still");
                var reading = manager.WheelbaseReading();
                Assert.That((reading.Model, reading.MaxTorquePercent), Is.EqualTo(("R21 Ultra", 55)));
            }
            using (var manager = ManagerWith(Base("", 40)))
            {
                string text = Summary(manager);
                Assert.That(text, Does.Contain("\"RacingDesk.Plugin.DS.MozaWheelbaseMaxTorque\":40,"));
                Assert.That(text, Does.Not.Contain("MozaWheelbaseMaxNm"), "a base whose model is not known has no rating: no Nm, never a guess");
            }
            using (var manager = ManagerWith(Base("R99", 40)))
                Assert.That(Summary(manager), Does.Not.Contain("MozaWheelbaseMaxNm"), "a model not in the table");
            using (var manager = ManagerWith(Base("", null)))
            {
                Assert.That(Summary(manager), Does.Not.Contain("MozaWheelbaseMaxTorque"), "the base said nothing of it: no key, and no number made up");
                Assert.That(manager.WheelbaseReading(), Is.Null);
            }
            using (var manager = new MozaSerialManager(_ => { }, _ => { }))
            {
                Assert.That(manager.WheelbaseReading(), Is.Null, "no base");
                Assert.That(Summary(manager), Does.Not.Contain("MozaWheelbaseMaxTorque"));
            }
        }

        // ── /racing-desk/data/wheelmax ──

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        private static (HttpStatusCode Status, JObject Body) Get(Func<WheelLimit> limit)
        {
            int port = FreePort();
            using var listener = new HttpListener();
            listener.Prefixes.Add($"http://127.0.0.1:{port}/racing-desk/"); // not localhost: HTTP.sys binds that on every address
            listener.Start();
            var api = new LocalDataApi(Path.Combine(Path.GetTempPath(), "racing-desk-no-store-" + Guid.NewGuid().ToString("N") + ".db")) { WheelMax = limit };
            var claimed = Task.Run(() => api.TryHandle(listener.GetContext()));

            using var http = new HttpClient();
            using var request = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{port}/racing-desk/data/wheelmax");
            using var response = http.Send(request);
            string text = new StreamReader(response.Content.ReadAsStream(), Encoding.UTF8).ReadToEnd();
            Assert.That(claimed.Result, Is.True);
            return (response.StatusCode, text.Length > 0 ? JObject.Parse(text) : null);
        }

        [Test]
        public void TheRouteServesTheMaximumAndSaysNotKnownOtherwise()
        {
            var (status, known) = Get(() => new WheelLimit { Source = "pithouse", Model = "R21 Ultra", MaxPercent = 55, RatedNm = 21, Candidates = 2 });
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(((string)known["source"], (string)known["model"], (double)known["max_pct"], (double)known["rated_nm"], (double)known["max_nm"], (int)known["candidates"]),
                Is.EqualTo(("pithouse", "R21 Ultra", 55.0, 21.0, 11.55, 2)));

            var (_, noRating) = Get(() => new WheelLimit { Source = "pithouse", Model = "CS V2.1", MaxPercent = 55, Candidates = 1 });
            Assert.That(noRating["max_pct"].Type, Is.EqualTo(JTokenType.Float).Or.EqualTo(JTokenType.Integer));
            Assert.That(noRating["max_nm"].Type, Is.EqualTo(JTokenType.Null), "no rating: not a number of Nm");

            foreach (Func<WheelLimit> unknown in new Func<WheelLimit>[] { () => null, () => throw new IOException("Pit House moved its files"), null })
            {
                var (code, none) = Get(unknown);
                Assert.That(code, Is.EqualTo(HttpStatusCode.OK));
                Assert.That(new[] { "source", "model", "max_pct", "rated_nm", "max_nm" }.Select(k => none[k].Type), Is.All.EqualTo(JTokenType.Null), "not known: null, never a number");
                Assert.That((int)none["candidates"], Is.EqualTo(0));
            }
        }

        [Test]
        public void TheRouteIsOnTheHostsList()
        {
            Assert.That(LocalDataApi.Routes, Does.Contain("wheelmax"), "so DataRoutesThisMachineTests asks it of every kind of asker");
        }
    }
}
