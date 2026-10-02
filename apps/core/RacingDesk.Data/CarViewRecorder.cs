using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Data
{
    /// <summary>The view one car was driven with, as it stood when the sim closed.</summary>
    public sealed class CarView
    {
        public string CarPath { get; set; }

        /// <summary>From <c>app.ini</c>; see <see cref="ViewSettings"/>.</summary>
        public double? DriverHeight { get; set; }
        public double? VanishY { get; set; }
        public double? HeadHorizon { get; set; }
        public double? Fov { get; set; }

        /// <summary>From the car's <c>car.cam</c>; null when it has none, or none that can be read.</summary>
        public double? SeatX { get; set; }
        public double? SeatY { get; set; }
        public double? SeatZ { get; set; }

        /// <summary>
        /// The driver changed the view while in this car, so it is this car's and not what the last one left
        /// behind. iRacing keeps one view for every car: an untouched value may only be inherited.
        /// </summary>
        public bool Chosen { get; set; }

        public DateTime SeenAtUtc { get; set; }
    }

    /// <summary>
    /// One run's view as the recorder saw it: app.ini at the car's first frame (<see cref="Before"/>, null when it could not
    /// be read) and what was recorded once the sim had gone (<see cref="View"/>, whose height and horizon are app.ini's
    /// then). What putting the height back works from (RacingDesk.Data.Restore).
    /// </summary>
    public sealed class ViewRun
    {
        public string CarPath { get; set; }
        public ViewSettings Before { get; set; }
        public CarView View { get; set; }
    }

    /// <summary>
    /// Records the view per car, and writes nothing of iRacing's. The sim reads <c>app.ini</c> when it starts
    /// and writes it when it exits, so the file holds the view the run began with for as long as the sim is
    /// up, and the view it ended with once the sim has gone: read once each side, the difference is what the
    /// driver changed in this car.
    /// </summary>
    public sealed class CarViewRecorder
    {
        private readonly string _documents;
        private readonly Func<bool> _simRunning;
        private readonly Action<CarView> _save;
        private readonly Action<string> _log;
        private readonly object _gate = new object();

        private string _carPath;
        private ViewSettings _before;
        private DateTime _beforeWritten;
        private CancellationTokenSource _waiting;

        /// <summary>
        /// Told, after a run's view has been recorded and saved, what the run began with and ended on: putting the height
        /// back (RestoreDirector) works out from it what it would keep. On the recorder's own thread; what it throws is
        /// logged and goes no further.
        /// </summary>
        public Action<ViewRun> Ran { get; set; }

        /// <summary>How long a closing sim is given to go, and then to write its files.</summary>
        internal TimeSpan ExitTimeout = TimeSpan.FromSeconds(90), WriteTimeout = TimeSpan.FromSeconds(15);
        internal TimeSpan Poll = TimeSpan.FromMilliseconds(500);

        public static string DefaultDocuments =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "iRacing");

        public CarViewRecorder(string documents, Func<bool> simRunning, Action<CarView> save, Action<string> log = null)
        {
            _documents = documents ?? DefaultDocuments;
            _simRunning = simRunning ?? throw new ArgumentNullException(nameof(simRunning));
            _save = save ?? throw new ArgumentNullException(nameof(save));
            _log = log ?? (_ => { });
        }

        /// <summary>The car the driver is in. Cheap enough to call on every frame.</summary>
        public void SeeCar(string carPath)
        {
            if (string.IsNullOrWhiteSpace(carPath)) return;
            carPath = carPath.Trim();
            lock (_gate)
            {
                // Frames again: the sim hadn't gone after all.
                _waiting?.Cancel();
                _waiting = null;

                if (string.Equals(carPath, _carPath, StringComparison.OrdinalIgnoreCase)) return;
                _carPath = carPath;
                _before = ReadAppIni(out _beforeWritten);
            }
        }

        /// <summary>
        /// The sim has stopped sending. Waits, off this thread, for it to exit and write its files, then
        /// records the view. The task is for tests; nothing else need wait on it.
        /// </summary>
        public Task SimGone()
        {
            string carPath;
            ViewSettings before;
            DateTime beforeWritten;
            CancellationTokenSource waiting;
            lock (_gate)
            {
                if (_carPath == null || _waiting != null) return Task.CompletedTask;
                carPath = _carPath;
                before = _before;
                beforeWritten = _beforeWritten;
                waiting = _waiting = new CancellationTokenSource();
            }

            return Task.Run(() =>
            {
                try
                {
                    if (!Wait(() => !_simRunning(), ExitTimeout, waiting.Token))
                    {
                        if (!waiting.IsCancellationRequested) _log("view: the sim is still running; nothing recorded");
                        return;
                    }
                    // The sim writes app.ini on its way out. If it never does, what is there is still the view.
                    Wait(() => Written(AppIni) > beforeWritten, WriteTimeout, waiting.Token);
                    if (waiting.IsCancellationRequested) return;

                    var view = Record(carPath, before);
                    if (view == null) return;
                    _save(view);
                    _log($"view: {carPath} — height {Show(view.DriverHeight)}, horizon {Show(view.VanishY)}, seat {Show(view.SeatX)}" +
                         (view.Chosen ? " (changed in this car)" : ""));
                    try { Ran?.Invoke(new ViewRun { CarPath = carPath, Before = before, View = view }); }
                    catch (Exception ex) { _log("view: what the run ended on was not handed on — " + ex.Message.Trim()); }
                }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
                {
                    _log("view: not recorded — " + ex.Message.Trim());
                }
                finally
                {
                    lock (_gate)
                    {
                        if (ReferenceEquals(_waiting, waiting))
                        {
                            // The next run starts from what this one left, in whichever car it is.
                            _waiting = null;
                            _carPath = null;
                            _before = null;
                        }
                    }
                    waiting.Dispose();
                }
            });
        }

        /// <summary>The view as the files have it now, against what the run began with. Null if there is no view to read.</summary>
        internal CarView Record(string carPath, ViewSettings before)
        {
            var after = ReadAppIni(out _);
            if (after == null || after.IsEmpty) return null;

            var view = new CarView
            {
                CarPath = carPath,
                DriverHeight = after.DriverHeight,
                VanishY = after.VanishY,
                HeadHorizon = after.HeadHorizon,
                Fov = after.Fov,
                Chosen = before != null && !before.IsEmpty && Changed(before, after),
                SeenAtUtc = DateTime.UtcNow,
            };

            string cam = CarCamPath(_documents, carPath);
            if (cam != null && File.Exists(cam) && CarCamFile.TryReadCockpit(ReadShared(cam), out var seat))
            {
                view.SeatX = seat.X;
                view.SeatY = seat.Y;
                view.SeatZ = seat.Z;
            }
            return view;
        }

        // The field of view is left out: it is set for the screen, in the garage, and says nothing about the car.
        private static bool Changed(ViewSettings before, ViewSettings after) =>
            Differs(before.DriverHeight, after.DriverHeight)
            || Differs(before.VanishY, after.VanishY)
            || Differs(before.HeadHorizon, after.HeadHorizon);

        private static bool Differs(double? a, double? b) =>
            a.HasValue != b.HasValue || (a.HasValue && Math.Abs(a.Value - b.Value) > 1e-6);

        /// <summary>
        /// <c>cameras\cars\mx5\mx52016\car.cam</c> for "mx5 mx52016": a space in the sim's name for a car is a
        /// folder deeper. Null for a name that isn't a plain folder name.
        /// </summary>
        public static string CarCamPath(string documents, string carPath)
        {
            if (string.IsNullOrWhiteSpace(documents) || string.IsNullOrWhiteSpace(carPath)) return null;
            string path = Path.Combine(documents, "cameras", "cars");
            foreach (string part in carPath.Trim().Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries))
            {
                if (part == "." || part == ".." || part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) return null;
                path = Path.Combine(path, part);
            }
            return Path.Combine(path, "car.cam");
        }

        private string AppIni => Path.Combine(_documents, "app.ini");

        private ViewSettings ReadAppIni(out DateTime written)
        {
            written = Written(AppIni);
            try
            {
                return File.Exists(AppIni) ? ViewSettings.Parse(System.Text.Encoding.UTF8.GetString(ReadShared(AppIni))) : null;
            }
            catch (IOException) { return null; }
            catch (UnauthorizedAccessException) { return null; }
        }

        private static DateTime Written(string path)
        {
            try { return File.Exists(path) ? File.GetLastWriteTimeUtc(path) : DateTime.MinValue; }
            catch (IOException) { return DateTime.MinValue; }
        }

        // The sim and the iRacing UI both write these; never stand in their way.
        private static byte[] ReadShared(string path)
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var buffer = new MemoryStream();
            stream.CopyTo(buffer);
            return buffer.ToArray();
        }

        private bool Wait(Func<bool> done, TimeSpan limit, CancellationToken cancel)
        {
            var until = DateTime.UtcNow + limit;
            while (!cancel.IsCancellationRequested)
            {
                if (done()) return true;
                if (DateTime.UtcNow >= until) return false;
                cancel.WaitHandle.WaitOne(Poll);
            }
            return false;
        }

        private static string Show(double? value) =>
            value.HasValue ? value.Value.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture) : "—";
    }
}
