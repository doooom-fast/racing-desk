using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using Microsoft.Data.Sqlite;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RacingDesk.Data;
using RacingDesk.Data.Audio;
using RacingDesk.Data.Restore;
using RacingDesk.Host;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Tests.Restore
{
    /// <summary>Windows' audio, as a test says it is: a list of devices and a default, and a call when the default changes.</summary>
    internal sealed class FakeAudio : IAudioDevices
    {
        public static readonly AudioDevice SoundBar = new AudioDevice("{0.0.0.00000000}.{sound-bar}", "Speakers (SineAudio DS6301M Plus V1.23)");
        public static readonly AudioDevice AirPods = new AudioDevice("{0.0.0.00000000}.{air-pods}", "Headphones (Kevin's AirPods Max)");
        public static readonly AudioDevice Desk = new AudioDevice("{0.0.0.00000000}.{desk}", "Speakers (Realtek(R) Audio)");

        public List<AudioDevice> Devices = new List<AudioDevice> { SoundBar, AirPods, Desk };
        public AudioDevice? Current = AirPods;
        public bool Throws;
        public event Action? Changed;

        public IReadOnlyList<AudioDevice> Active() { if (Throws) throw new InvalidOperationException("no audio"); return Devices.ToList(); }
        public AudioDevice Default() { if (Throws) throw new InvalidOperationException("no audio"); return Current!; }

        /// <summary>Windows makes a device the default and says so, on a thread of its own.</summary>
        public void MakeDefault(AudioDevice? device)
        {
            Current = device;
            Changed?.Invoke();
        }

        public void Dispose() { }
    }

    /// <summary>Made-up copies of what the rig has, in a folder of the test's own; his real app.ini is never read.</summary>
    internal sealed class SoundBarRig : IDisposable
    {
        public readonly string Dir = Path.Combine(Path.GetTempPath(), "racing-desk-soundbar-" + Guid.NewGuid().ToString("N"));
        public string Documents => Path.Combine(Dir, "iRacing");
        public string Backups => Path.Combine(Dir, "backups", "view");
        public string Store => Path.Combine(Dir, "racing-desk.db");
        public string Settings => Path.Combine(Dir, "soundbar.json");
        public string AppIniPath => Path.Combine(Documents, "app.ini");
        public readonly FakeProbe Probe = new FakeProbe();
        public readonly FakeAudio Audio = new FakeAudio();
        public readonly List<string> Logged = new List<string>();
        public DateTime Now = new DateTime(2026, 10, 7, 14, 30, 0, DateTimeKind.Utc);

        public SoundBarRig(string mix = "1", string lfe = "0")
        {
            Directory.CreateDirectory(Documents);
            WriteAppIni(mix, lfe);
            using (new RacingDeskStore(Store)) { }
            SqliteConnection.ClearAllPools();
        }

        private static string Line(string key, string value, string comment) => (key + "=" + value).PadRight(40) + "\t; " + comment + "\r\n";

        /// <summary>app.ini as the sim writes the audio and bass shaker sections: values padded to a column, a tab, a comment.</summary>
        public static string AppIniText(string mix, string lfe) =>
            "[Graphics]\r\n" + Line("fullScreen", "1", "full screen") + "\r\n" +
            "[Audio]\r\n" +
            Line("devLFEAPI", "1", "0 = None, 1 = DirectSound") +
            Line("devLFEName", "System Default", "Name of the sound device") +
            Line("loudnessLFE", "-6.000000", "How much to duck or raise volume of all LFE bass shaker effects, in Decibels") +
            Line("xa2_mixToLFE", mix, "Send xaudio sound to LFE channel in addition to normal channels") +
            "\r\n[BassShaker]\r\n" +
            Line("enableGameEffects", "1", "Enable game audio based vibrations for bass shakers") +
            Line("LFEEnabled", lfe, "Enable or Disable LFE bass shaker effect.") +
            Line("volGameMaster_dB", "-12.000000", "How much to duck or raise volume of the game audio bass shaker effect, in Decibels") +
            "\r\n[View]\r\n" + Line("driverHeightAdj", "-0.020000", "Range -0.050m to 0.050m") + "\r\n[XXX Dev Use Only]\r\nsomething=1\r\n";

        public void WriteAppIni(string mix, string lfe) => File.WriteAllBytes(AppIniPath, Encoding.ASCII.GetBytes(AppIniText(mix, lfe)));
        /// <summary>The file as it is now; read the way the host reads it, sharing with a writer that is swapping it in.</summary>
        public byte[] AppIniBytes()
        {
            for (int attempt = 0; ; attempt++)
            {
                try
                {
                    using var stream = new FileStream(AppIniPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                    using var copy = new MemoryStream();
                    stream.CopyTo(copy);
                    return copy.ToArray();
                }
                catch (IOException) when (attempt < 50) { Thread.Sleep(10); }
            }
        }
        public string Value(string section, string key) => AppIniEditor.TryReadText(AppIniBytes(), section, key, out string text) ? text : "(none)";
        public string Mix => Value("Audio", "xa2_mixToLFE");
        public string Lfe => Value("BassShaker", "LFEEnabled");

        public ViewFiles Files() => new ViewFiles(Documents, Backups, Probe, Store, () => Now);
        public SoundBarLfe Service() => new SoundBarLfe(Audio, Files(), Probe, Store, Settings, m => { lock (Logged) Logged.Add(m); }, () => Now) { SimWatchEvery = TimeSpan.FromMilliseconds(50) };

        public IReadOnlyList<SoundBarKeep> Kept()
        {
            using var store = new RacingDeskStore(Store);
            return store.SoundBarKeeps();
        }

        /// <summary>The copies aside of app.ini: <c>original\app.ini</c> and one folder for each write.</summary>
        public string[] BackupFiles() => Directory.Exists(Backups) ? Directory.GetFiles(Backups, "app.ini", SearchOption.AllDirectories) : Array.Empty<string>();

        public void Dispose()
        {
            SqliteConnection.ClearAllPools();
            try { Directory.Delete(Dir, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }

    [TestFixture]
    public class SoundBarLfeTests
    {
        private SoundBarRig _rig = null!;

        [SetUp] public void SetUp() => _rig = new SoundBarRig();
        [TearDown] public void TearDown() => _rig.Dispose();

        [Test]
        public void TheSoundBarBecomesTheDefault_LfeGoesOff_AndKeepsHisValuesFirst_ThenTheAirPodsPutThemBack()
        {
            _rig.WriteAppIni("1", "1");
            byte[] before = _rig.AppIniBytes();
            using var bar = _rig.Service();
            _rig.Audio.Current = FakeAudio.SoundBar;
            bar.ReconcileNow();

            Assert.That((_rig.Mix, _rig.Lfe), Is.EqualTo(("0", "0")));
            Assert.That(_rig.AppIniBytes(), Is.EqualTo(Encoding.ASCII.GetBytes(SoundBarRig.AppIniText("0", "0"))),
                "the two values are the only bytes that moved, and each is padded to the width it had");
            var kept = _rig.Kept();
            Assert.That(kept.Select(k => (k.Setting, k.Original, k.Written, k.WrittenOk)).ToArray(),
                Is.EqualTo(new[] { ("Audio.xa2_mixToLFE", "1", "0", true), ("BassShaker.LFEEnabled", "1", "0", true) }));
            Assert.That(bar.View().State, Is.EqualTo("working"));
            Assert.That(bar.Settings.LastText, Is.EqualTo(SoundBarLfe.TurnedOff));
            Assert.That(bar.Settings.LastAtUtc, Is.EqualTo(_rig.Now));
            Assert.That(File.ReadAllBytes(_rig.BackupFiles().Single(f => !f.Contains("original"))), Is.EqualTo(before), "the copy aside is the file as he had it");

            // Asked again with nothing new to do, nothing is written again.
            _rig.Now = _rig.Now.AddMinutes(5);
            int copies = _rig.BackupFiles().Length;
            bar.ReconcileNow();
            Assert.That(_rig.BackupFiles().Length, Is.EqualTo(copies));
            Assert.That(bar.Settings.LastAtUtc, Is.Not.EqualTo(_rig.Now));

            // Anything else becomes the default: what Racing Desk changed is put back.
            _rig.Now = _rig.Now.AddMinutes(5);
            _rig.Audio.Current = FakeAudio.AirPods;
            bar.ReconcileNow();
            Assert.That((_rig.Mix, _rig.Lfe), Is.EqualTo(("1", "1")));
            Assert.That(_rig.AppIniBytes(), Is.EqualTo(before), "back to the very bytes he had");
            Assert.That(_rig.Kept(), Is.Empty);
            Assert.That(bar.Settings.LastText, Is.EqualTo(SoundBarLfe.PutBack));
            Assert.That(bar.Settings.LastAtUtc, Is.EqualTo(_rig.Now));
            Assert.That(bar.View().State, Is.EqualTo("idle"));
        }

        [Test]
        public void ALfeThatIsOffAlready_IsNotKept_NorTouched_AndStaysOffWhenTheAirPodsComeBack()
        {
            // The rig as it is: the bass shaker's LFE is off, the game's sound is mixed into it.
            using var bar = _rig.Service();
            _rig.Audio.Current = FakeAudio.SoundBar;
            bar.ReconcileNow();
            Assert.That((_rig.Mix, _rig.Lfe), Is.EqualTo(("0", "0")));
            Assert.That(_rig.Kept().Select(k => k.Setting).ToArray(), Is.EqualTo(new[] { "Audio.xa2_mixToLFE" }), "only what was changed is kept");

            _rig.Audio.Current = FakeAudio.Desk;
            bar.ReconcileNow();
            Assert.That((_rig.Mix, _rig.Lfe), Is.EqualTo(("1", "0")));
            Assert.That(_rig.AppIniBytes(), Is.EqualTo(Encoding.ASCII.GetBytes(SoundBarRig.AppIniText("1", "0"))));
        }

        [Test]
        public void OnlyTheTwoLfeValuesMove_NoOtherLfeKey_AndNothingElseOfAppIni()
        {
            _rig.WriteAppIni("1", "1");
            using var bar = _rig.Service();
            _rig.Audio.Current = FakeAudio.SoundBar;
            bar.ReconcileNow();
            string text = Encoding.ASCII.GetString(_rig.AppIniBytes());
            foreach (string untouched in new[] { "devLFEAPI=1", "devLFEName=System Default", "loudnessLFE=-6.000000", "enableGameEffects=1", "volGameMaster_dB=-12.000000", "driverHeightAdj=-0.020000", "fullScreen=1" })
                Assert.That(text, Does.Contain(untouched), untouched + " is left as it is");
        }

        [Test]
        public void WhileTheSimRuns_NothingIsWritten_AndItWaitsUntilTheSimHasClosed()
        {
            _rig.WriteAppIni("1", "1");
            byte[] before = _rig.AppIniBytes();
            _rig.Probe.Sim = true;
            using var bar = _rig.Service();
            _rig.Audio.Current = FakeAudio.SoundBar;
            bar.ReconcileNow();

            Assert.That(_rig.AppIniBytes(), Is.EqualTo(before));
            Assert.That(_rig.BackupFiles(), Is.Empty, "not even a copy aside");
            Assert.That(_rig.Kept(), Is.Empty);
            var view = bar.View();
            Assert.That(view.State, Is.EqualTo("waiting"));
            Assert.That(view.Waiting, Is.EqualTo("Waiting for iRacing to close, to turn its LFE off for the sound bar."));

            // The sim closes: the next look (the sim's end, or the short watch while it waits) writes it.
            _rig.Probe.Sim = false;
            bar.SimGone();
            Assert.That(bar.Settled().Wait(TimeSpan.FromSeconds(10)), Is.True);
            Assert.That((_rig.Mix, _rig.Lfe), Is.EqualTo(("0", "0")));
            Assert.That(bar.View().Waiting, Is.Null);
        }

        [Test]
        public void AWaitingChange_NoticesTheSimClosingByItself()
        {
            _rig.Probe.Sim = true;
            using var bar = _rig.Service();
            _rig.Audio.Current = FakeAudio.SoundBar;
            bar.ReconcileNow();
            Assert.That(_rig.Mix, Is.EqualTo("1"));
            _rig.Probe.Sim = false;
            Assert.That(SpinWait.SpinUntil(() => _rig.Mix == "0", TimeSpan.FromSeconds(10)), Is.True, "looked at again when the sim had closed");
        }

        [Test]
        public void WhileTheSimRuns_NothingIsPutBackEither()
        {
            _rig.WriteAppIni("1", "1");
            using var bar = _rig.Service();
            _rig.Audio.Current = FakeAudio.SoundBar;
            bar.ReconcileNow();
            _rig.Probe.Sim = true;
            byte[] during = _rig.AppIniBytes();
            int copies = _rig.BackupFiles().Length;
            _rig.Audio.Current = FakeAudio.AirPods;
            bar.ReconcileNow();
            Assert.That(_rig.AppIniBytes(), Is.EqualTo(during));
            Assert.That(_rig.BackupFiles().Length, Is.EqualTo(copies));
            Assert.That(bar.View().Waiting, Is.EqualTo("Waiting for iRacing to close, to put its LFE back."));
            Assert.That(_rig.Kept(), Has.Count.EqualTo(2), "what is to be put back is still kept");
            _rig.Probe.Sim = false;
            bar.ReconcileNow();
            Assert.That((_rig.Mix, _rig.Lfe), Is.EqualTo(("1", "1")));
        }

        [Test]
        public void AValueHeChangedHimselfSince_IsLeftAlone_OnTheSoundBar_AndWhenTheAirPodsComeBack()
        {
            _rig.WriteAppIni("1", "1");
            byte[] original = _rig.AppIniBytes();
            using var bar = _rig.Service();
            _rig.Audio.Current = FakeAudio.SoundBar;
            bar.ReconcileNow();
            Assert.That((_rig.Mix, _rig.Lfe), Is.EqualTo(("0", "0")));

            // In iRacing's options he turns the game's sound back into the LFE, on the sound bar: his, and not fought.
            _rig.WriteAppIni("1", "0");
            byte[] hisOwn = _rig.AppIniBytes();
            int copies = _rig.BackupFiles().Length;
            bar.ReconcileNow();
            bar.ReconcileNow();
            Assert.That(_rig.AppIniBytes(), Is.EqualTo(hisOwn), "Racing Desk does not switch it off again behind his back");
            Assert.That(_rig.BackupFiles().Length, Is.EqualTo(copies));

            // The AirPods: the bass shaker's LFE, which Racing Desk still holds off, goes back; the game's sound, which he turned on, stays on.
            _rig.Audio.Current = FakeAudio.AirPods;
            bar.ReconcileNow();
            Assert.That((_rig.Mix, _rig.Lfe), Is.EqualTo(("1", "1")));
            Assert.That(_rig.AppIniBytes(), Is.EqualTo(original));
            Assert.That(_rig.Kept(), Is.Empty);
        }

        [Test]
        public void AValueSetToSomethingElse_BecomesTheKeptValue_AndIsWhatStands()
        {
            _rig.WriteAppIni("1", "0");
            using var bar = _rig.Service();
            _rig.Audio.Current = FakeAudio.SoundBar;
            bar.ReconcileNow();
            Assert.That(_rig.Kept().Single().Original, Is.EqualTo("1"));

            // Not the old value and not Racing Desk's: his new value is the one kept now, and stays in the file.
            Assert.That(AppIniEditor.TrySetText(_rig.AppIniBytes(), "Audio", "xa2_mixToLFE", "2", out var changed, out string why), Is.True, why);
            File.WriteAllBytes(_rig.AppIniPath, changed);
            bar.ReconcileNow();
            Assert.That(_rig.Mix, Is.EqualTo("2"));
            var keep = _rig.Kept().Single();
            Assert.That((keep.Original, keep.Written), Is.EqualTo(("2", "0")));
            Assert.That(bar.Settings.LastText, Is.EqualTo(SoundBarLfe.LeftAlone));

            _rig.Audio.Current = FakeAudio.AirPods;
            bar.ReconcileNow();
            Assert.That(_rig.Mix, Is.EqualTo("2"), "nothing is put back over his value");
            Assert.That(_rig.Kept(), Is.Empty);
        }

        [Test]
        public void TheBackupIsMadeFirst_AndAFailedOneStopsTheWrite_WithHisValuesKept()
        {
            _rig.WriteAppIni("1", "1");
            byte[] before = _rig.AppIniBytes();
            // The folder for the copies cannot be made: a file stands where it should be.
            Directory.CreateDirectory(Path.GetDirectoryName(_rig.Backups)!);
            File.WriteAllText(_rig.Backups, "in the way");
            using var bar = _rig.Service();
            _rig.Audio.Current = FakeAudio.SoundBar;
            bar.ReconcileNow();

            Assert.That(_rig.AppIniBytes(), Is.EqualTo(before), "no copy, no write");
            Assert.That(bar.View().Problem, Does.StartWith("iRacing's LFE couldn't be changed: the backup could not be made"));
            Assert.That(bar.View().State, Is.EqualTo("problem"));
            Assert.That(_rig.Kept().Select(k => (k.Original, k.WrittenOk)).ToArray(), Is.EqualTo(new[] { ("1", false), ("1", false) }),
                "his values were kept before anything else, and are not taken for written");

            // The way is cleared: the same look now makes the copy, writes, and marks them written.
            File.Delete(_rig.Backups);
            bar.ReconcileNow();
            Assert.That((_rig.Mix, _rig.Lfe), Is.EqualTo(("0", "0")));
            Assert.That(File.ReadAllBytes(_rig.BackupFiles().Single(f => !f.Contains("original"))), Is.EqualTo(before));
            Assert.That(_rig.Kept().All(k => k.WrittenOk), Is.True);
            Assert.That(bar.View().Problem, Is.Null);
        }

        [Test]
        public void AStopBetweenKeepingAndWriting_IsNotTakenForHisOwnChange()
        {
            // The values were kept (not yet written) and the host stopped: the file still holds the originals.
            using (var store = new RacingDeskStore(_rig.Store))
                store.SaveSoundBarKeep(new SoundBarKeep { Setting = "Audio.xa2_mixToLFE", Original = "1", Written = "0", WrittenOk = false, AtUtc = _rig.Now });
            using var bar = _rig.Service();
            _rig.Audio.Current = FakeAudio.SoundBar;
            bar.ReconcileNow();
            Assert.That(_rig.Mix, Is.EqualTo("0"));
            Assert.That(_rig.Kept().Single().WrittenOk, Is.True);
            _rig.Audio.Current = FakeAudio.AirPods;
            bar.ReconcileNow();
            Assert.That(_rig.Mix, Is.EqualTo("1"));
        }

        [Test]
        public void TheSwitchOff_ChangesNothing()
        {
            _rig.WriteAppIni("1", "1");
            byte[] before = _rig.AppIniBytes();
            using var bar = _rig.Service();
            bar.SetEnabled(false);
            Assert.That(bar.Settled().Wait(TimeSpan.FromSeconds(10)), Is.True);
            _rig.Audio.Current = FakeAudio.SoundBar;
            bar.ReconcileNow();
            Assert.That(_rig.AppIniBytes(), Is.EqualTo(before));
            Assert.That(_rig.BackupFiles(), Is.Empty);
            Assert.That(_rig.Kept(), Is.Empty);
            Assert.That(bar.Settings.LastText, Is.Null);
            Assert.That(SoundBarSettings.Load(_rig.Settings).Enabled, Is.False, "kept in soundbar.json");
        }

        [Test]
        public void TheSwitchTurnedOffAfterTheChange_PutsHisValuesBack_AndTurnedOnAgain_DoesItAgain()
        {
            _rig.WriteAppIni("1", "1");
            byte[] before = _rig.AppIniBytes();
            using var bar = _rig.Service();
            _rig.Audio.Current = FakeAudio.SoundBar;
            bar.ReconcileNow();
            Assert.That(_rig.Mix, Is.EqualTo("0"));

            bar.SetEnabled(false);
            Assert.That(bar.Settled().Wait(TimeSpan.FromSeconds(10)), Is.True);
            Assert.That(_rig.AppIniBytes(), Is.EqualTo(before));

            bar.SetEnabled(true);
            Assert.That(bar.Settled().Wait(TimeSpan.FromSeconds(10)), Is.True);
            Assert.That(_rig.Mix, Is.EqualTo("0"));
        }

        [Test]
        public void AnotherDeviceChosenAsTheSoundBar_IsTheOneThatSwitchesIt()
        {
            using var bar = _rig.Service();
            Assert.That(bar.SetDevice("{no such device}"), Is.False);
            Assert.That(bar.SetDevice(FakeAudio.Desk.Id), Is.True);
            Assert.That(bar.Settled().Wait(TimeSpan.FromSeconds(10)), Is.True);
            Assert.That(bar.Settings.DeviceName, Is.EqualTo(FakeAudio.Desk.Name));

            _rig.Audio.Current = FakeAudio.SoundBar;       // no longer the one
            bar.ReconcileNow();
            Assert.That(_rig.Mix, Is.EqualTo("1"));
            _rig.Audio.Current = FakeAudio.Desk;
            bar.ReconcileNow();
            Assert.That(_rig.Mix, Is.EqualTo("0"));

            Assert.That(bar.SetDevice(""), Is.True, "an empty choice is the SineAudio one again");
            _rig.Audio.Current = FakeAudio.SoundBar;
            bar.ReconcileNow();
            Assert.That(bar.View().OnSoundBar, Is.True);
        }

        [Test]
        public void TheListShowsTheActiveDevices_AndDefaultsToTheOneWithSineAudioInItsName()
        {
            using var bar = _rig.Service();
            var view = bar.View();
            Assert.That(view.Devices.Select(d => d.Name).ToArray(), Is.EqualTo(new[] { FakeAudio.SoundBar.Name, FakeAudio.AirPods.Name, FakeAudio.Desk.Name }));
            Assert.That(view.Device!.Id, Is.EqualTo(FakeAudio.SoundBar.Id));
            Assert.That(view.Connected, Is.True);
            Assert.That(view.OnSoundBar, Is.False, "the AirPods are the default");
            Assert.That(view.Enabled, Is.True, "on by default");

            // The sound bar away (Bluetooth off): nothing is taken for it.
            _rig.Audio.Devices.Remove(FakeAudio.SoundBar);
            Assert.That(bar.View().Device, Is.Null);
            // A device he chose that is away is still his choice, said as not connected.
            _rig.Audio.Devices.Add(FakeAudio.SoundBar);
            bar.SetDevice(FakeAudio.SoundBar.Id);
            _rig.Audio.Devices.Remove(FakeAudio.SoundBar);
            var away = bar.View();
            Assert.That((away.Device!.Name, away.Connected), Is.EqualTo((FakeAudio.SoundBar.Name, false)));
        }

        [Test]
        public void TheHostStartingWithAnotherDevice_PutsBackWhatAnEarlierRunChanged()
        {
            _rig.WriteAppIni("1", "1");
            byte[] before = _rig.AppIniBytes();
            using (var first = _rig.Service())
            {
                _rig.Audio.Current = FakeAudio.SoundBar;
                first.ReconcileNow();
            }
            Assert.That(_rig.Mix, Is.EqualTo("0"));

            // Racing Desk is started again with the AirPods on: its first look puts them back.
            _rig.Audio.Current = FakeAudio.AirPods;
            using var second = _rig.Service();
            second.Start();
            Assert.That(second.Settled().Wait(TimeSpan.FromSeconds(10)), Is.True);
            Assert.That(_rig.AppIniBytes(), Is.EqualTo(before));
        }

        [Test]
        public void WindowsSayingTheDefaultChanged_IsAllItTakes()
        {
            _rig.WriteAppIni("1", "1");
            using var bar = _rig.Service();
            bar.Start();
            Assert.That(bar.Settled().Wait(TimeSpan.FromSeconds(10)), Is.True);
            Assert.That(_rig.Mix, Is.EqualTo("1"));

            _rig.Audio.MakeDefault(FakeAudio.SoundBar);
            Assert.That(bar.Settled().Wait(TimeSpan.FromSeconds(10)), Is.True);
            Assert.That(_rig.Mix, Is.EqualTo("0"));

            _rig.Audio.MakeDefault(FakeAudio.AirPods);
            Assert.That(bar.Settled().Wait(TimeSpan.FromSeconds(10)), Is.True);
            Assert.That(_rig.Mix, Is.EqualTo("1"));
        }

        [Test]
        public void WhenWindowsCannotBeAsked_OrHasNoDevice_NothingIsChanged()
        {
            _rig.WriteAppIni("1", "1");
            byte[] before = _rig.AppIniBytes();
            using var bar = _rig.Service();
            _rig.Audio.Throws = true;
            bar.ReconcileNow();
            Assert.That(bar.View().State, Is.EqualTo("problem"));
            _rig.Audio.Throws = false;
            _rig.Audio.Current = null;
            bar.ReconcileNow();
            Assert.That(_rig.AppIniBytes(), Is.EqualTo(before));
            Assert.That(bar.View().Problem, Is.Null);
        }

        [Test]
        public void AnAppIniWithoutTheLines_IsLeftAsItIs_AndAMissingOneIsSaid()
        {
            File.WriteAllBytes(_rig.AppIniPath, Encoding.ASCII.GetBytes("[Graphics]\r\nfullScreen=1\r\n"));
            byte[] before = _rig.AppIniBytes();
            using var bar = _rig.Service();
            _rig.Audio.Current = FakeAudio.SoundBar;
            bar.ReconcileNow();
            Assert.That(_rig.AppIniBytes(), Is.EqualTo(before));
            Assert.That(_rig.Kept(), Is.Empty);
            File.Delete(_rig.AppIniPath);
            bar.ReconcileNow();
            Assert.That(bar.View().Problem, Is.EqualTo("iRacing's app.ini wasn't found, so nothing was changed."));
        }
    }

    [TestFixture]
    public class AppIniTextTests
    {
        private static byte[] Ini(string mix = "1", string lfe = "0") => Encoding.ASCII.GetBytes(SoundBarRig.AppIniText(mix, lfe));

        [Test]
        public void ASwitchIsReadAsTheFileSpellsIt_AndSetInTheLinesOwnForm()
        {
            var before = Ini("1", "0");
            Assert.That(AppIniEditor.TryReadText(before, "Audio", "xa2_mixToLFE", out string text), Is.True);
            Assert.That(text, Is.EqualTo("1"));
            Assert.That(AppIniEditor.TrySetText(before, "Audio", "xa2_mixToLFE", "0", out var after, out string why), Is.True, why);
            Assert.That(after, Is.EqualTo(Ini("0", "0")), "the tab, the comment and every other byte stay");
            Assert.That(after.Length, Is.EqualTo(before.Length));
            Assert.That(AppIniEditor.TrySetText(before, "Audio", "xa2_mixToLFE", "0.000000", out var decimals, out _), Is.True);
            Assert.That(Encoding.ASCII.GetString(decimals), Does.Contain("xa2_mixToLFE=0.000000".PadRight(40) + "\t; Send xaudio"), "the width allows more, and the line stays as wide");
        }

        [Test]
        public void AKeyNotThereOrThereTwice_AWordTooWide_OrOneThatBreaksTheLine_IsRefused()
        {
            Assert.That(AppIniEditor.TrySetText(Ini(), "Audio", "noSuchKey", "0", out _, out string why), Is.False);
            Assert.That(why, Does.Contain("not in [Audio]"));
            Assert.That(AppIniEditor.TrySetText(Ini(), "BassShaker", "xa2_mixToLFE", "0", out _, out _), Is.False, "another section's is not this one");
            var twice = Encoding.ASCII.GetBytes(SoundBarRig.AppIniText("1", "0") + "\r\n[Audio]\r\nxa2_mixToLFE=1\t; again\r\n");
            Assert.That(AppIniEditor.TrySetText(twice, "Audio", "xa2_mixToLFE", "0", out _, out why), Is.False);
            Assert.That(why, Does.Contain("2 times"));
            var tight = Encoding.ASCII.GetBytes("[Audio]\r\nxa2_mixToLFE=1\t; tight\r\n");
            Assert.That(AppIniEditor.TrySetText(tight, "Audio", "xa2_mixToLFE", "0.000000", out _, out why), Is.False);
            Assert.That(why, Does.Contain("wider"));
            foreach (string bad in new[] { "", " ", "0\t; x", "0;", "a=b", "0\r\n[View]", "[x]" })
                Assert.That(AppIniEditor.TrySetText(Ini(), "Audio", "xa2_mixToLFE", bad, out _, out _), Is.False, "'" + bad + "'");
        }

        [Test]
        public void TheSafeWriter_RefusesWhatIsNotWhatItSaw_WithTheSimClosed_AndWritesNothing()
        {
            using var rig = new SoundBarRig("1", "0");
            byte[] before = rig.AppIniBytes();
            var files = rig.Files();
            var stale = files.ApplyIniText(new[] { new IniTextChange { Section = "Audio", Key = "xa2_mixToLFE", Text = "0", Expect = "0" } });
            Assert.That(stale.Ok, Is.False);
            Assert.That(stale.Why, Does.Contain("no longer what Racing Desk saw"));
            Assert.That(rig.AppIniBytes(), Is.EqualTo(before));
            Assert.That(rig.BackupFiles(), Is.Empty);

            rig.Probe.Sim = true;
            var running = files.ApplyIniText(new[] { new IniTextChange { Section = "Audio", Key = "xa2_mixToLFE", Text = "0", Expect = "1" } });
            Assert.That(running.Ok, Is.False);
            Assert.That(running.Why, Does.StartWith("iRacing is running"));
            Assert.That(rig.AppIniBytes(), Is.EqualTo(before));

            rig.Probe.Sim = false;
            var good = files.ApplyIniText(new[] { new IniTextChange { Section = "Audio", Key = "xa2_mixToLFE", Text = "0", Expect = "1" } });
            Assert.That(good.Ok, Is.True, good.Why);
            Assert.That(rig.Mix, Is.EqualTo("0"));
            Assert.That(rig.BackupFiles().Length, Is.EqualTo(2), "the first original, kept for good, and the copy for this write");
        }
    }

    [TestFixture]
    public class WindowsAudioDevicesTests
    {
        [Test]
        public void WindowsCoreAudio_ListsTheActiveDevicesAndTheDefault_AndCanBeWatchedAndLetGo()
        {
            WindowsAudioDevices devices;
            try { devices = new WindowsAudioDevices(); }
            catch (System.Runtime.InteropServices.COMException ex) { Assert.Inconclusive("this machine has no Core Audio: " + ex.Message); return; }
            using (devices)
            {
                var active = devices.Active();
                var current = devices.Default();
                TestContext.Out.WriteLine($"{active.Count} active playback devices; default: {(current == null ? "none" : "present")}");
                Assert.That(active.All(d => !string.IsNullOrWhiteSpace(d.Id) && !string.IsNullOrWhiteSpace(d.Name)), Is.True);
                if (current != null) Assert.That(active.Any(d => d.Id == current.Id), Is.True, "the default is one of the active devices");
                devices.Changed += () => { };
            }
        }
    }

    [TestFixture]
    public class SoundBarRouteTests
    {
        private SoundBarRig _rig = null!;

        [SetUp] public void SetUp() => _rig = new SoundBarRig();
        [TearDown] public void TearDown() => _rig.Dispose();

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        private (HttpStatusCode Status, JObject? Body) Ask(SoundBarLfe? service, HttpMethod method, string? body = null, Action<HttpRequestMessage>? shape = null)
        {
            int port = FreePort();
            using var listener = new HttpListener();
            listener.Prefixes.Add($"http://127.0.0.1:{port}/racing-desk/");
            listener.Start();
            var api = new LocalDataApi(_rig.Store);
            api.SoundBar.Service = service;
            var claimed = Task.Run(() => api.TryHandle(listener.GetContext()));
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
            using var request = new HttpRequestMessage(method, $"http://127.0.0.1:{port}/racing-desk/data/soundbar");
            if (body != null) request.Content = new StringContent(body, Encoding.UTF8, "application/json");
            shape?.Invoke(request);
            using var response = http.Send(request);
            string text = new StreamReader(response.Content.ReadAsStream(), Encoding.UTF8).ReadToEnd();
            Assert.That(claimed.Result, Is.True);
            return (response.StatusCode, text.Length > 0 ? Newtonsoft.Json.JsonConvert.DeserializeObject<JObject>(text, new Newtonsoft.Json.JsonSerializerSettings { DateParseHandling = Newtonsoft.Json.DateParseHandling.None }) : null);
        }

        [Test]
        public void AHostWithNoService_SaysItHasNone()
        {
            var (status, body) = Ask(null, HttpMethod.Get);
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That((bool)body!["available"]!, Is.False);
            Assert.That(Ask(null, HttpMethod.Post, "{\"enabled\":false}").Status, Is.EqualTo(HttpStatusCode.Conflict));
        }

        [Test]
        public void TheRouteSays_TheSwitch_TheDevices_TheOneTakenForTheSoundBar_AndHowItStands()
        {
            _rig.WriteAppIni("1", "1");
            using var bar = _rig.Service();
            _rig.Audio.Current = FakeAudio.SoundBar;
            bar.ReconcileNow();
            var (status, body) = Ask(bar, HttpMethod.Get);
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That((bool)body!["available"]!, Is.True);
            Assert.That((bool)body["enabled"]!, Is.True);
            Assert.That((string)body["device"]!["id"]!, Is.EqualTo(FakeAudio.SoundBar.Id));
            Assert.That((string)body["device"]!["name"]!, Is.EqualTo(FakeAudio.SoundBar.Name));
            Assert.That(body["devices"]!.Select(d => (string)d["name"]!).ToArray(), Is.EqualTo(new[] { FakeAudio.SoundBar.Name, FakeAudio.AirPods.Name, FakeAudio.Desk.Name }));
            Assert.That((bool)body["onSoundBar"]!, Is.True);
            Assert.That((string)body["status"]!["state"]!, Is.EqualTo("working"));
            Assert.That((string)body["status"]!["last"]!, Is.EqualTo(SoundBarLfe.TurnedOff));
            Assert.That((string)body["status"]!["lastAtUtc"]!, Is.EqualTo("2026-10-07T14:30:00.000Z"));
        }

        [Test]
        public void ACommand_FromAProgram_IsTaken_AndFromAPage_IsRefused()
        {
            using var bar = _rig.Service();
            var off = Ask(bar, HttpMethod.Post, "{\"enabled\":false}");
            Assert.That(off.Status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(((bool)off.Body!["ok"]!, (bool)off.Body["enabled"]!), Is.EqualTo((true, false)));
            Assert.That(bar.Settings.Enabled, Is.False);

            var device = Ask(bar, HttpMethod.Post, "{\"device\":" + Newtonsoft.Json.JsonConvert.SerializeObject(FakeAudio.Desk.Id) + "}");
            Assert.That((bool)device.Body!["ok"]!, Is.True);
            Assert.That(bar.Settings.DeviceId, Is.EqualTo(FakeAudio.Desk.Id));
            var unknown = Ask(bar, HttpMethod.Post, "{\"device\":\"{nothing}\"}");
            Assert.That((bool)unknown.Body!["ok"]!, Is.False);

            foreach (string wrong in new[] { "{\"enabled\":\"yes\"}", "{\"step\":\"A1\"}", "{\"device\":5}", "[1]" })
                Assert.That(Ask(bar, HttpMethod.Post, wrong).Status, Is.EqualTo(HttpStatusCode.BadRequest), wrong);

            var page = Ask(bar, HttpMethod.Post, "{\"enabled\":true}", r => r.Headers.Add("Origin", "null"));
            Assert.That(page.Status, Is.EqualTo(HttpStatusCode.Forbidden));
            var marked = Ask(bar, HttpMethod.Post, "{\"enabled\":true}", r => r.Headers.TryAddWithoutValidation("Sec-Fetch-Site", "cross-site"));
            Assert.That(marked.Status, Is.EqualTo(HttpStatusCode.Forbidden));
            Assert.That(bar.Settings.Enabled, Is.False, "a page changed nothing");
            Assert.That(bar.Settled().Wait(TimeSpan.FromSeconds(10)), Is.True);
        }

        [Test]
        public void TheRouteIsOnTheHostsList()
        {
            Assert.That(LocalDataApi.Routes, Does.Contain("soundbar"), "so DataRoutesThisMachineTests asks it of every kind of asker");
        }
    }
}
