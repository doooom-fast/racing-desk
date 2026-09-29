using System;
using System.Collections.Generic;
using RacingDesk.Plugin;

namespace RacingDesk.Core.Cars
{
    /// <summary>
    /// Follows the car the driver is in, frame by frame: finds it in the list, reads its controls, and lets the
    /// check say what it has to say, once. One per telemetry feed. Never throws: what goes wrong here is logged
    /// and the frame goes out without the car's controls, as every frame did before there was a list.
    /// </summary>
    public sealed class CarControlsFollower
    {
        private const string Raw = "DataCorePlugin.GameRawData.Telemetry.";

        private readonly CarList _list;
        private readonly Action<string> _log;
        private readonly Func<DateTime> _now;
        private readonly Dictionary<string, CarListCheck> _checks = new Dictionary<string, CarListCheck>(StringComparer.OrdinalIgnoreCase);
        private readonly object _gate = new object();

        private string _carPath;
        private CarEntry _car;
        private CarListCheck _check;
        private string _json;
        private bool _failed, _failedToTell;

        /// <param name="now">The clock remarks are stamped by; null for the machine's.</param>
        public CarControlsFollower(CarList list = null, Action<string> log = null, Func<DateTime> now = null)
        {
            _list = list ?? CarList.Default;
            _log = log ?? (line => Log.Info("[RacingDesk] car list: " + line));
            _now = now ?? (() => DateTime.UtcNow);
        }

        /// <summary>
        /// Raised for each thing the check says of a car, the first time it is said in this run, with the list it
        /// was said against and when. It is raised on the thread of the frame, and a handler must not hold it up:
        /// the host's only queues the remark to be kept. What a handler throws is logged once and goes no further.
        /// </summary>
        public event Action<CarRemark> Said;

        /// <summary>The list this follower reads.</summary>
        public CarList List => _list;

        /// <summary>The car being followed, as the sim names its folder; null while none is.</summary>
        public string CarPath
        {
            get { lock (_gate) return _carPath; }
        }

        /// <summary>What the check has said of each car this run, by the car's folder.</summary>
        public IReadOnlyDictionary<string, IReadOnlyList<string>> Remarks
        {
            get
            {
                var all = new Dictionary<string, IReadOnlyList<string>>(StringComparer.OrdinalIgnoreCase);
                lock (_gate)
                    foreach (var check in _checks) all[check.Key] = check.Value.Remarks;
                return all;
            }
        }

        /// <summary>
        /// One frame. Returns the car's controls as the HUD is sent them, or null when there is nothing true
        /// to say: no car yet, or a car the list does not have.
        /// </summary>
        /// <param name="carPath">The sim's folder for the car; null or empty until it is known.</param>
        /// <param name="property">A property by its full name, as <c>ITelemetrySource.GetPropertyValue</c> gives it.</param>
        /// <param name="fixedSetup">Whether the session's setup is fixed; null where the sim has not said.</param>
        /// <param name="inCar">The driver is in the car; null from a source that does not say.</param>
        public string See(string carPath, Func<string, object> property, bool? fixedSetup, bool? inCar)
        {
            if (property == null) return null;
            List<CarRemark> fresh = null;
            try
            {
                lock (_gate)
                {
                    if (string.IsNullOrWhiteSpace(carPath))
                    {
                        _carPath = null;
                        _car = null;
                        _check = null;
                        _json = null;
                        return null;
                    }
                    carPath = carPath.Trim();
                    if (!string.Equals(carPath, _carPath, StringComparison.OrdinalIgnoreCase))
                    {
                        _carPath = carPath;
                        _car = _list.Find(carPath);
                        // A list with nothing in it is a build from before there was one: nothing to check against.
                        if (_list.Cars.Count == 0) _check = null;
                        else if (!_checks.TryGetValue(carPath, out _check)) _checks[carPath] = _check = new CarListCheck(carPath, _car);
                        _json = null;
                    }

                    Func<string, object> variable = name => property(Raw + name);
                    if (_check != null)
                    {
                        var said = _check.Take(variable, inCar);
                        if (said.Count > 0)
                        {
                            fresh = new List<CarRemark>(said.Count);
                            DateTime at = _now();
                            foreach (var remark in said)
                            {
                                remark.ListHash = _list.Hash;
                                remark.SaidAtUtc = at;
                                fresh.Add(remark);
                                _log(remark.Line);
                            }
                        }
                    }
                    if (_car == null) return null;

                    string json = CarControls.Read(_car, variable, fixedSetup).ToJson();
                    // The same text is the same string: the frame that goes out holds on to it.
                    if (json != _json) _json = json;
                    return _json;
                }
            }
            catch (Exception ex)
            {
                if (!_failed) Log.Warn("[RacingDesk] car list: the car's controls were not read — " + ex.Message);
                _failed = true;
                return null;
            }
            finally
            {
                if (fresh != null) Tell(fresh);
            }
        }

        // Outside the lock, so that a handler cannot deadlock the telemetry by asking the follower a question, and
        // however the frame ended: a remark said is a remark said, whether or not the car's controls could be read.
        private void Tell(List<CarRemark> fresh)
        {
            var handlers = Said;
            if (handlers == null) return;
            foreach (var remark in fresh)
                foreach (Delegate handler in handlers.GetInvocationList())
                {
                    try
                    {
                        ((Action<CarRemark>)handler)(remark);
                    }
                    catch (Exception ex)
                    {
                        if (!_failedToTell) Log.Warn("[RacingDesk] car list: a remark was not passed on — " + ex.Message);
                        _failedToTell = true;
                    }
                }
        }
    }
}
