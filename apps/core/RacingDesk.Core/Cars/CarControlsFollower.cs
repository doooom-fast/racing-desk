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
        private readonly Dictionary<string, CarListCheck> _checks = new Dictionary<string, CarListCheck>(StringComparer.OrdinalIgnoreCase);
        private readonly object _gate = new object();

        private string _carPath;
        private CarEntry _car;
        private CarListCheck _check;
        private string _json;
        private bool _failed;

        public CarControlsFollower(CarList list = null, Action<string> log = null)
        {
            _list = list ?? CarList.Default;
            _log = log ?? (line => Log.Info("[RacingDesk] car list: " + line));
        }

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
                        foreach (string remark in _check.See(variable, inCar)) _log(remark);
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
        }
    }
}
