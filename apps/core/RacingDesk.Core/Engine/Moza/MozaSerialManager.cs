using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO.Ports;
using System.Linq;
using System.Text;
using System.Threading;
using Newtonsoft.Json;

namespace RacingDesk.Plugin.Engine.Moza
{
    /// <summary>
    /// Manages discovery, connection, polling, and command dispatch to all connected
    /// Moza racing hardware over CDC ACM serial ports. Completely bypasses Pit House.
    ///
    /// Lifecycle:
    ///   1. Start() — begins discovery scan and polling on a background thread
    ///   2. Poll loop — every 2 seconds, reads registered settings from all connected devices
    ///   3. WriteSetting() — queues a write command for the next poll cycle
    ///   4. Stop() — shuts down background threads and closes all serial ports
    ///
    /// Thread safety: all public methods are safe to call from any thread.
    /// Serial port access is synchronized per-device via SemaphoreSlim.
    /// </summary>
    public class MozaSerialManager : IDisposable
    {
        // ── Configuration ─────────────────────────────────────────────
        internal const int BaudRate = 115200;
        internal const int DataBits = 8;
        internal const StopBits SerialStopBits = StopBits.One;
        internal const Parity SerialParity = Parity.None;
        internal const int ReadTimeoutMs = 500;
        internal const int WriteTimeoutMs = 500;
        private const int PollIntervalMs = 2000;

        /// <summary>How often the machine's list of COM ports is read (from the registry: cheap) to see whether it changed.</summary>
        internal const int PortListCheckMs = 2000;

        /// <summary>How often, while Pit House runs, the processes are looked at to see whether it has quit.</summary>
        internal const int PitHouseCheckMs = 60 * 1000;

        /// <summary>Moza's USB vendor id: a port without it, and not described as Moza's, is never opened or written to.</summary>
        internal const string MozaVendorId = "346E";
        private const int ReadBufferSize = 256;

        /// <summary>How long a port another program holds is left alone before it is looked at again.</summary>
        internal const int HeldPortRetryMs = 5 * 60 * 1000;

        // ── State ─────────────────────────────────────────────────────
        private readonly ConcurrentDictionary<string, MozaDevice> _devices = new ConcurrentDictionary<string, MozaDevice>();
        private readonly ConcurrentDictionary<string, SerialPort> _ports = new ConcurrentDictionary<string, SerialPort>();
        private readonly ConcurrentDictionary<string, SemaphoreSlim> _portLocks = new ConcurrentDictionary<string, SemaphoreSlim>();
        private readonly ConcurrentQueue<WriteCommand> _writeQueue = new ConcurrentQueue<WriteCommand>();

        private Thread _pollThread;
        private volatile bool _running;
        private volatile bool _disposed = false;

        // ── When the ports are looked for (DiscoverDevices) ───────────
        // Never on a timer: at the start, when the machine's list of COM ports changes, when Pit House quits (it lets go
        // of the base's ports), when a device drops, and on ForceRediscovery; and never while Pit House runs, which holds
        // the base's ports for as long as it does (on the rig, all day). Poll thread only, but for the flag.
        private volatile bool _searchAsked = true;
        private string[] _portsSeen;
        private DateTime _nextPortCheck = DateTime.MinValue;
        private DateTime _nextPitHouseCheck = DateTime.MinValue;
        private bool _pitHouseRunning;

        /// <summary>How many times the ports have been looked for, Pit House or not: for a test.</summary>
        internal int Searches { get; private set; }

        /// <summary>Whether MOZA Pit House was running when last looked at.</summary>
        internal bool PitHouseRunning => _pitHouseRunning;

        // ── Ports another program holds ───────────────────────────────
        // Windows gives a serial port to one handle at a time, so while another program has a port
        // (MOZA Pit House holds the base's for as long as it runs) no open can succeed, from this
        // process or any other. Such a port is logged once a run and looked at again only after
        // HeldPortRetryMs, when the set of ports changes, or on ForceRediscovery. Poll thread only.
        private readonly Dictionary<string, DateTime> _heldPortRetryAt = new Dictionary<string, DateTime>(StringComparer.OrdinalIgnoreCase);
        private readonly HashSet<string> _heldPortsLogged = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private volatile bool _retryHeldPorts;

        private readonly IMozaPortSystem _portSystem;
        private readonly Func<DateTime> _utcNow;
        private readonly Func<IReadOnlyList<string>> _runningMozaProcesses;

        // The programs the warning about Moza software was last logged for, so that it is logged once for each set of
        // them and not each time the processes are looked at. Pit House runs all day on the rig. Poll thread only.
        private string _pitHouseLogged = "";

        // ── Logging callback (injected by Plugin.cs) ──────────────────
        private readonly Action<string> _logInfo;
        private readonly Action<string> _logWarn;

        /// <summary>True if at least one Moza device is connected and responsive.</summary>
        public bool IsConnected => _devices.Values.Any(d => d.IsConnected);

        /// <summary>Number of currently connected devices.</summary>
        public int DeviceCount => _devices.Values.Count(d => d.IsConnected);

        /// <summary>All discovered devices (connected and disconnected).</summary>
        public IReadOnlyList<MozaDevice> Devices => _devices.Values.ToList().AsReadOnly();

        /// <summary>First connected wheelbase, or null.</summary>
        public MozaDevice Wheelbase => _devices.Values.FirstOrDefault(d =>
            d.DeviceType == MozaDeviceRegistry.MozaDeviceType.Wheelbase && d.IsConnected);

        /// <summary>First connected pedals, or null.</summary>
        public MozaDevice Pedals => _devices.Values.FirstOrDefault(d =>
            d.DeviceType == MozaDeviceRegistry.MozaDeviceType.Pedals && d.IsConnected);

        /// <summary>First connected handbrake, or null.</summary>
        public MozaDevice Handbrake => _devices.Values.FirstOrDefault(d =>
            d.DeviceType == MozaDeviceRegistry.MozaDeviceType.Handbrake && d.IsConnected);

        /// <summary>First connected shifter, or null.</summary>
        public MozaDevice Shifter => _devices.Values.FirstOrDefault(d =>
            d.DeviceType == MozaDeviceRegistry.MozaDeviceType.Shifter && d.IsConnected);

        /// <summary>First connected dashboard, or null.</summary>
        public MozaDevice Dashboard => _devices.Values.FirstOrDefault(d =>
            d.DeviceType == MozaDeviceRegistry.MozaDeviceType.Dashboard && d.IsConnected);

        /// <summary>First connected steering wheel, or null.</summary>
        public MozaDevice SteeringWheel => _devices.Values.FirstOrDefault(d =>
            d.DeviceType == MozaDeviceRegistry.MozaDeviceType.SteeringWheel && d.IsConnected);

        /// <summary>Warning message if Pit House is detected running (serial port conflict).</summary>
        public string PitHouseWarning { get; private set; } = "";

        // ═══════════════════════════════════════════════════════════════
        //  CONSTRUCTION & LIFECYCLE
        // ═══════════════════════════════════════════════════════════════

        public MozaSerialManager(Action<string> logInfo = null, Action<string> logWarn = null)
            : this(logInfo, logWarn, new MozaSystemPorts(), () => DateTime.UtcNow)
        {
        }

        /// <summary>
        /// For tests: stands in for the machine's serial ports, the clock and the list of Moza programs that are running
        /// (by default, the machine's own).
        /// </summary>
        internal MozaSerialManager(Action<string> logInfo, Action<string> logWarn, IMozaPortSystem portSystem, Func<DateTime> utcNow,
            Func<IReadOnlyList<string>> runningMozaProcesses = null)
        {
            _logInfo = logInfo ?? (_ => { });
            _logWarn = logWarn ?? (_ => { });
            _portSystem = portSystem;
            _utcNow = utcNow;
            _runningMozaProcesses = runningMozaProcesses ?? RunningMozaProcesses;
        }

        /// <summary>
        /// Starts the background discovery and polling thread.
        /// Safe to call multiple times (no-op if already running).
        /// </summary>
        public void Start()
        {
            if (_running) return;
            _running = true;

            _pollThread = new Thread(PollLoop)
            {
                Name = "MozaSerialPoll",
                IsBackground = true,
                Priority = ThreadPriority.BelowNormal
            };
            _pollThread.Start();

            _logInfo("[MozaSerial] Background polling started");
        }

        /// <summary>
        /// Stops the background thread and closes all serial ports.
        /// </summary>
        public void Stop()
        {
            _running = false;
            _pollThread?.Join(3000);
            CloseAllPorts();
            _logInfo("[MozaSerial] Stopped");
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;

            _running = false;
            _pollThread?.Join(3000);
            CloseAllPorts();

            foreach (var sem in _portLocks.Values)
            {
                try { sem.Dispose(); } catch { }
            }
        }

        // ═══════════════════════════════════════════════════════════════
        //  PUBLIC API — WRITE SETTINGS
        // ═══════════════════════════════════════════════════════════════

        /// <summary>Writes queued for the next poll cycle and not yet sent: what a test looks at to see that a request wrote nothing.</summary>
        internal int PendingWrites => _writeQueue.Count;

        /// <summary>Whether a re-discovery of the ports has been asked for and not yet done (<see cref="ForceRediscovery"/>).</summary>
        internal bool RediscoveryAsked => _retryHeldPorts;

        /// <summary>
        /// Queues a single-byte write command to a device for the next poll cycle.
        /// </summary>
        public void WriteSetting(byte deviceId, byte commandId, byte value)
        {
            _writeQueue.Enqueue(new WriteCommand
            {
                DeviceId = deviceId,
                Packet = MozaPacketBuilder.BuildWritePacket(deviceId, commandId, value)
            });
        }

        /// <summary>
        /// Queues a 16-bit write command to a device for the next poll cycle.
        /// </summary>
        public void WriteSetting16(byte deviceId, byte commandId, ushort value)
        {
            _writeQueue.Enqueue(new WriteCommand
            {
                DeviceId = deviceId,
                Packet = MozaPacketBuilder.BuildWritePacket(deviceId, commandId, value)
            });
        }

        /// <summary>
        /// Force an immediate re-discovery of serial ports, ports another program held included.
        /// </summary>
        public void ForceRediscovery()
        {
            _retryHeldPorts = true;
            _searchAsked = true;
        }

        /// <summary>
        /// Force an immediate re-poll of all device settings.
        /// </summary>
        public void ForceRefresh()
        {
            foreach (var device in _devices.Values.Where(d => d.IsConnected))
                device.LastPollTime = DateTime.MinValue;
        }

        // ═══════════════════════════════════════════════════════════════
        //  HTTP API — JSON RESPONSES
        // ═══════════════════════════════════════════════════════════════

        /// <summary>
        /// Returns a JSON array of all connected devices with type, port, and status.
        /// </summary>
        public string GetDeviceListJson()
        {
            var list = _devices.Values.Select(d => new
            {
                type = d.DeviceType.ToString(),
                subType = d.SubType,
                port = d.PortName,
                connected = d.IsConnected,
                displayName = d.DisplayName,
                usbDescription = d.UsbDescription
            });
            return JsonConvert.SerializeObject(list);
        }

        /// <summary>
        /// Returns the wheelbase settings as a JSON object, or null JSON if not connected.
        /// </summary>
        public string GetWheelbaseSettingsJson()
        {
            var wb = Wheelbase?.WheelbaseSettings;
            if (wb == null || !wb.HasData) return "null";
            return JsonConvert.SerializeObject(wb);
        }

        /// <summary>
        /// Returns pedal settings as a JSON object, or null JSON if not connected.
        /// </summary>
        public string GetPedalSettingsJson()
        {
            var p = Pedals?.PedalSettings;
            if (p == null || !p.HasData) return "null";
            return JsonConvert.SerializeObject(p);
        }

        /// <summary>
        /// Returns handbrake settings as a JSON object, or null JSON if not connected.
        /// </summary>
        public string GetHandbrakeSettingsJson()
        {
            var h = Handbrake?.HandbrakeSettings;
            if (h == null || !h.HasData) return "null";
            return JsonConvert.SerializeObject(h);
        }

        /// <summary>
        /// Returns shifter settings as a JSON object, or null JSON if not connected.
        /// </summary>
        public string GetShifterSettingsJson()
        {
            var s = Shifter?.ShifterSettings;
            if (s == null || !s.HasData) return "null";
            return JsonConvert.SerializeObject(s);
        }

        /// <summary>
        /// Returns dashboard settings as a JSON object, or null JSON if not connected.
        /// </summary>
        public string GetDashboardSettingsJson()
        {
            var d = Dashboard?.DashboardSettings;
            if (d == null || !d.HasData) return "null";
            return JsonConvert.SerializeObject(d);
        }

        /// <summary>
        /// Returns steering wheel settings as a JSON object, or null JSON if not connected.
        /// </summary>
        public string GetWheelSettingsJson()
        {
            var w = SteeringWheel?.WheelSettings;
            if (w == null || !w.HasData) return "null";
            return JsonConvert.SerializeObject(w);
        }

        /// <summary>
        /// Diagnostic endpoint: returns detailed information about all COM ports detected on the system,
        /// their USB descriptions, regex matches, and classification attempts.
        /// Useful for debugging device detection when hardware is connected but not recognized.
        /// A port another program holds is found with CheckAccess and reported as such, without opening it (an open that
        /// is refused throws, and SimHub logs every exception with its stack). Ports that nothing describes as Moza are
        /// talked to — a Moza read command is written to each — only when <paramref name="probe"/> asks for it.
        /// </summary>
        public string GetSerialPortDiagnosticJson(bool probe = false)
        {
            var portDiagnostics = new List<object>();
            var portWmiInfo = GetUsbPortWmiInfo();
            var allPortNames = _portSystem.GetPortNames();

            foreach (var portName in allPortNames)
            {
                string usbDescription = "";
                string hardwareId = "";
                string vid = "";
                string pid = "";
                if (portWmiInfo.TryGetValue(portName, out PortWmiInfo wmi))
                {
                    usbDescription = wmi.Description;
                    hardwareId = wmi.HardwareId;
                    vid = wmi.Vid;
                    pid = wmi.Pid;
                }

                // Perform classification — mirroring ClassifyDevice behavior
                var classification = ClassifyDevice(usbDescription);
                string classificationResult = "NoMatch";
                bool matchedViaFallback = false;

                if (classification != null)
                {
                    classificationResult = classification.Value.type.ToString();
                    if (classification.Value.type == MozaDeviceRegistry.MozaDeviceType.Unknown)
                    {
                        matchedViaFallback = true;
                    }
                }

                // Determine regex match details
                object regexMatch = null;
                int patternIndex = 0;
                foreach (var pattern in MozaDeviceRegistry.UsbPatterns)
                {
                    if (pattern.Pattern.IsMatch(usbDescription))
                    {
                        // Report the pattern index and type (including which pass it matched on)
                        if (pattern.DeviceType != MozaDeviceRegistry.MozaDeviceType.Unknown)
                        {
                            regexMatch = new
                            {
                                deviceType = pattern.DeviceType.ToString(),
                                subType = pattern.SubType ?? "",
                                patternIndex = patternIndex,
                                matchedViaFallback = false
                            };
                            break;
                        }
                        // Don't assign Unknown match yet — check if other patterns match first
                    }
                    patternIndex++;
                }

                // If nothing matched specific patterns, check the fallback
                if (regexMatch == null)
                {
                    var fallbackPattern = MozaDeviceRegistry.UsbPatterns
                        .FirstOrDefault(p => p.DeviceType == MozaDeviceRegistry.MozaDeviceType.Unknown);
                    if (fallbackPattern != null && fallbackPattern.Pattern.IsMatch(usbDescription))
                    {
                        regexMatch = new
                        {
                            deviceType = "Unknown",
                            subType = "",
                            patternIndex = System.Array.IndexOf(MozaDeviceRegistry.UsbPatterns, fallbackPattern),
                            matchedViaFallback = true
                        };
                    }
                }

                // Check port open status
                string portOpenStatus = "NotAttempted";
                string portOpenError = "";
                if (_ports.TryGetValue(portName, out var existingPort))
                {
                    portOpenStatus = "AlreadyOpen";
                }
                else if (_portSystem.CheckAccess(portName) == MozaPortAccess.Held)
                {
                    portOpenStatus = "AccessDenied";
                    portOpenError = "Another program holds the port (Windows gives a serial port to one handle at a time)";
                }
                else
                {
                    // Attempt to open the port briefly to test access
                    try
                    {
                        var testPort = _portSystem.Open(portName);
                        testPort.Close();
                        testPort.Dispose();
                        portOpenStatus = "Open";
                    }
                    catch (System.IO.FileNotFoundException)
                    {
                        portOpenStatus = "NotFound";
                    }
                    catch (System.IO.IOException ex)
                    {
                        portOpenStatus = "AccessDenied";
                        portOpenError = ex.Message;
                    }
                    catch (Exception ex)
                    {
                        portOpenStatus = "OtherError";
                        portOpenError = ex.Message;
                    }
                }

                // Check poll status for already-known devices
                string pollStatus = "Unknown";
                if (_devices.TryGetValue(portName, out var device))
                {
                    if (device.IsConnected)
                    {
                        pollStatus = device.FailureCount > 0 ? "ConnectedNoResponse" : "ConnectedPolling";
                    }
                    else
                    {
                        pollStatus = "Disconnected";
                    }
                }

                // Protocol probe: if description classification missed or hit
                // only the generic fallback, AND the port opened cleanly here,
                // ask the device what it is by talking the Moza protocol. This
                // is what unblocks generic-named Moza hardware where the
                // description regex can't help. Skip if the port is already
                // owned by us (we'd collide with live polling) or wasn't
                // openable (Pit House/another app holds it).
                string probedDeviceType = null;
                bool needsProbe = probe && (classificationResult == "NoMatch" || matchedViaFallback)
                    && portOpenStatus == "Open";
                if (needsProbe)
                {
                    var probed = OpenAndProbe(portName, discovery: false);
                    if (probed != null)
                    {
                        probedDeviceType = probed.Value.ToString();
                    }
                }

                var diagnostic = new
                {
                    portName = portName,
                    usbDescription = usbDescription,
                    hardwareId = hardwareId,
                    vid = vid,
                    pid = pid,
                    regexMatch = regexMatch,
                    classification = classificationResult,
                    matchedViaFallback = matchedViaFallback,
                    probedDeviceType = probedDeviceType,
                    portOpenStatus = portOpenStatus,
                    portOpenError = string.IsNullOrEmpty(portOpenError) ? null : portOpenError,
                    pollStatus = pollStatus
                };

                portDiagnostics.Add(diagnostic);
            }

            // Count matched devices by type. A device is "matched" if either
            // the description regex placed it (classif != NoMatch) or the
            // protocol probe identified it. We prefer the probe result for
            // counting if it's set — that's the strongest signal.
            var matchedCount = new Dictionary<string, int>();
            var unmatchedMozaDescriptors = new List<string>();

            foreach (var diag in portDiagnostics)
            {
                var diagObj = (dynamic)diag;
                string classif = diagObj.classification;
                string probed = diagObj.probedDeviceType;

                string effectiveType = !string.IsNullOrEmpty(probed)
                    ? probed
                    : (classif != "NoMatch" ? classif : null);

                if (effectiveType != null)
                {
                    if (!matchedCount.ContainsKey(effectiveType))
                        matchedCount[effectiveType] = 0;
                    matchedCount[effectiveType]++;

                    if (diagObj.matchedViaFallback && string.IsNullOrEmpty(probed))
                    {
                        unmatchedMozaDescriptors.Add($"{diagObj.portName} ({diagObj.usbDescription})");
                    }
                }
            }

            // Build summary
            var summary = new
            {
                timestamp = DateTime.UtcNow.ToString("o"),
                totalPorts = allPortNames.Length,
                matchedDevices = matchedCount,
                unmatchedMozaDevices = unmatchedMozaDescriptors,
                pitHouseWarning = string.IsNullOrEmpty(PitHouseWarning) ? null : PitHouseWarning,
                ports = portDiagnostics
            };

            return JsonConvert.SerializeObject(summary, Formatting.Indented);
        }

        // ═══════════════════════════════════════════════════════════════
        //  MAIN POLL LOOP (background thread)
        // ═══════════════════════════════════════════════════════════════

        private void PollLoop()
        {
            while (_running)
            {
                try
                {
                    // Discovery, when something asks for it (NoteWhatChanged), never on a timer
                    if (NoteWhatChanged())
                        DiscoverDevices();

                    // Process queued writes
                    ProcessWriteQueue();

                    // Poll all connected devices
                    foreach (var device in _devices.Values.Where(d => d.IsConnected))
                    {
                        if ((DateTime.UtcNow - device.LastPollTime).TotalMilliseconds >= PollIntervalMs)
                        {
                            PollDevice(device);
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logWarn($"[MozaSerial] Poll loop error: {ex.Message}");
                }

                Thread.Sleep(200); // Check interval — much faster than poll interval
            }
        }

        // ═══════════════════════════════════════════════════════════════
        //  DEVICE DISCOVERY
        // ═══════════════════════════════════════════════════════════════

        /// <summary>
        /// Whether the ports are to be looked for now, and forgets that they were: the list of COM ports is read every
        /// <see cref="PortListCheckMs"/> (a registry read) and a change in it asks for a look; while Pit House runs the
        /// processes are read every <see cref="PitHouseCheckMs"/>, and its quitting asks for one. Poll thread.
        /// </summary>
        internal bool NoteWhatChanged()
        {
            var now = _utcNow();
            if (now >= _nextPortCheck)
            {
                _nextPortCheck = now.AddMilliseconds(PortListCheckMs);
                var names = _portSystem.GetPortNames() ?? new string[0];
                if (_portsSeen == null || !SamePorts(names, _portsSeen))
                {
                    _portsSeen = (string[])names.Clone();
                    _searchAsked = true;
                }
            }
            if (_pitHouseRunning && now >= _nextPitHouseCheck)
            {
                _nextPitHouseCheck = now.AddMilliseconds(PitHouseCheckMs);
                CheckForPitHouse();
                if (!_pitHouseRunning) _searchAsked = true;   // it let go of the base's ports
            }
            if (!_searchAsked) return false;
            _searchAsked = false;
            return true;
        }

        private static bool SamePorts(string[] a, string[] b) =>
            a.Length == b.Length && new HashSet<string>(a, StringComparer.OrdinalIgnoreCase).SetEquals(b);

        internal void DiscoverDevices()
        {
            try
            {
                CheckForPitHouse();
                if (_pitHouseRunning)
                {
                    // Pit House has the base's ports for as long as it runs (the warning above says so, once): nothing
                    // is opened, checked or written to until it quits, which NoteWhatChanged sees.
                    _nextPitHouseCheck = _utcNow().AddMilliseconds(PitHouseCheckMs);
                    return;
                }
                Searches++;

                if (_retryHeldPorts)
                {
                    _retryHeldPorts = false;
                    RetryHeldPortsNow();
                }

                var portNames = _portSystem.GetPortNames();
                if (portNames == null || portNames.Length == 0) return;

                // Prune disconnected devices so they can be re-discovered.
                // Without this, a device that hit MaxFailures stays in _devices
                // forever and the ContainsKey check below blocks rediscovery —
                // even after the hardware is power-cycled or replugged.
                var portNameSet = new HashSet<string>(portNames, StringComparer.OrdinalIgnoreCase);
                foreach (var kvp in _devices.ToArray())
                {
                    if (!kvp.Value.IsConnected)
                    {
                        // Port vanished from the system — remove immediately
                        if (!portNameSet.Contains(kvp.Key))
                        {
                            _devices.TryRemove(kvp.Key, out _);
                            _logInfo($"[MozaSerial] Pruned stale device entry for {kvp.Key} (port no longer present)");
                        }
                        // Port still exists but device disconnected — allow rediscovery
                        // by removing the entry so the loop below can re-classify and reopen
                        else
                        {
                            _devices.TryRemove(kvp.Key, out _);
                            _logInfo($"[MozaSerial] Clearing disconnected device on {kvp.Key} for rediscovery");
                        }
                    }
                }

                // Query WMI for USB serial device descriptions and vendor ids
                var portInfo = GetUsbPortWmiInfo();

                // Drop the not-Moza probe cache if the port set has changed
                // (hot-plug, USB cable replug, etc.) so new devices get a probe.
                RefreshProbeCacheIfPortsChanged(portNames);

                int discoveryMatchedCount = 0;
                int discoveryProbeIdentifiedCount = 0;
                var discoveryMatchesByType = new Dictionary<string, int>();
                var discoveryUnmatchedMozaDescriptors = new List<string>();

                foreach (var portName in portNames)
                {
                    // Skip already-known connected ports
                    if (_devices.ContainsKey(portName)) continue;

                    // Try to match against Moza USB patterns
                    string description = "";
                    string vendor = "";
                    if (portInfo.TryGetValue(portName, out var info))
                    {
                        description = info.Description ?? "";
                        vendor = info.Vid ?? "";
                    }

                    var match = ClassifyDevice(description);
                    bool identifiedByProbe = false;
                    if (match == null)
                    {
                        // Not described as Moza's. A port whose USB vendor is not Moza's either is somebody else's
                        // device (a Valve receiver, a button box, an Arduino): it is never opened, checked or written to.
                        if (!IsMozaVendor(vendor)) continue;
                        // Moza's own vendor id behind a generic description ("USB Serial Device", as the base presents
                        // on the rig): the protocol probe says which device it is.
                        var probedType = OpenAndProbe(portName, discovery: true);
                        if (probedType == null) continue;
                        match = (probedType.Value, "");
                        identifiedByProbe = true;
                        discoveryProbeIdentifiedCount++;
                        _logInfo($"[MozaSerial] Probe identified {portName} as {probedType.Value} (USB description: \"{description}\")");
                    }
                    else if (!MayOpen(portName))
                    {
                        // Held by another program — before the counting below, which
                        // would otherwise log this port's match on every cycle.
                        continue;
                    }

                    discoveryMatchedCount++;
                    string typeStr = match.Value.type.ToString();
                    if (!discoveryMatchesByType.ContainsKey(typeStr))
                        discoveryMatchesByType[typeStr] = 0;
                    discoveryMatchesByType[typeStr]++;

                    if (match.Value.type == MozaDeviceRegistry.MozaDeviceType.Unknown)
                    {
                        discoveryUnmatchedMozaDescriptors.Add($"{portName} ({description})");
                        _logWarn($"[MozaSerial] Detected Moza device on {portName} but could not determine specific type — USB descriptor: \"{description}\". Device will be tracked but not polled for settings.");
                    }

                    var device = new MozaDevice(
                        portName,
                        match.Value.type,
                        MozaDeviceRegistry.GetDeviceId(match.Value.type),
                        match.Value.subType)
                    {
                        UsbDescription = identifiedByProbe && string.IsNullOrEmpty(description)
                            ? "(identified via protocol probe — generic USB description)"
                            : description
                    };

                    // The model the description names, where it names one (a base seen through a generic USB description
                    // is left without: the HUD does not guess).
                    if (device.WheelbaseSettings != null)
                        device.WheelbaseSettings.Model = MozaWheelbaseModels.ModelFrom(description);

                    if (TryOpenPort(device))
                    {
                        // Use TryAdd to avoid TOCTOU race condition
                        if (_devices.TryAdd(portName, device))
                        {
                            _logInfo($"[MozaSerial] Discovered: {device.DisplayName} ({description})");
                        }
                    }
                }

                // Emit diagnostic summary if any Moza-like devices were detected
                if (discoveryMatchedCount > 0)
                {
                    var sb = new StringBuilder();
                    sb.AppendLine("[MozaSerial] DIAGNOSTIC:");
                    sb.AppendLine($"  Total ports: {portNames.Length}, Matched Moza devices: {discoveryMatchedCount} ({discoveryProbeIdentifiedCount} via protocol probe)");
                    foreach (var kvp in discoveryMatchesByType)
                    {
                        sb.AppendLine($"    {kvp.Key}: {kvp.Value}");
                    }
                    if (discoveryUnmatchedMozaDescriptors.Count > 0)
                    {
                        sb.AppendLine("  Unmatched Moza-looking (fallback only):");
                        foreach (var desc in discoveryUnmatchedMozaDescriptors)
                        {
                            sb.AppendLine($"    {desc}");
                        }
                    }
                    if (!string.IsNullOrEmpty(PitHouseWarning))
                    {
                        sb.AppendLine($"  Pit House Warning: {PitHouseWarning}");
                    }
                    _logInfo(sb.ToString());
                }
            }
            catch (Exception ex)
            {
                _logWarn($"[MozaSerial] Discovery error: {ex.Message}");
            }
        }

        /// <summary>Whether a port's USB vendor id is Moza's (<see cref="MozaVendorId"/>).</summary>
        internal static bool IsMozaVendor(string vid) => string.Equals((vid ?? "").Trim(), MozaVendorId, StringComparison.OrdinalIgnoreCase);

        /// <summary>
        /// Per-port WMI data: the description, the raw HardwareID and the USB
        /// VID/PID taken from it. Discovery classifies by the description and
        /// probes only a port whose VID is Moza's; the diagnostic shows all of it.
        /// </summary>
        internal class PortWmiInfo
        {
            public string Description { get; set; } = "";
            public string HardwareId { get; set; } = "";
            public string Vid { get; set; } = "";  // 4-char hex, no prefix (e.g. "346E")
            public string Pid { get; set; } = "";  // 4-char hex, no prefix
        }

        /// <summary>What WMI says of each serial port, by port name (<see cref="PortWmiInfo"/>); empty if it cannot say.</summary>
        private Dictionary<string, PortWmiInfo> GetUsbPortWmiInfo()
        {
            try
            {
                return _portSystem.GetPortInfo();
            }
            catch (Exception ex)
            {
                _logWarn($"[MozaSerial] WMI query failed: {ex.Message}");
                return new Dictionary<string, PortWmiInfo>(StringComparer.OrdinalIgnoreCase);
            }
        }

        /// <summary>
        /// Matches a USB description string against known Moza device patterns.
        /// </summary>
        private static (MozaDeviceRegistry.MozaDeviceType type, string subType)? ClassifyDevice(string description)
        {
            if (string.IsNullOrEmpty(description)) return null;

            foreach (var pattern in MozaDeviceRegistry.UsbPatterns)
            {
                if (pattern.Pattern.IsMatch(description))
                {
                    // Skip the generic fallback pattern for "Unknown" — only use it if nothing else matched
                    if (pattern.DeviceType == MozaDeviceRegistry.MozaDeviceType.Unknown)
                        continue;

                    return (pattern.DeviceType, pattern.SubType ?? "");
                }
            }

            // Check generic Gudsen/Moza fallback
            var fallback = MozaDeviceRegistry.UsbPatterns
                .FirstOrDefault(p => p.DeviceType == MozaDeviceRegistry.MozaDeviceType.Unknown);
            if (fallback != null && fallback.Pattern.IsMatch(description))
                return (MozaDeviceRegistry.MozaDeviceType.Unknown, "");

            return null;
        }

        /// <summary>
        /// Checks for processes that commonly hold Moza COM ports open. PitHouse
        /// UI is the obvious one, but closing the UI leaves PitHouse's background
        /// service and Moza's sync daemon running — they keep the port locked.
        /// Users who reported "PitHouse is closed but Moza still doesn't work"
        /// were usually hitting one of these.
        /// </summary>
        private static readonly string[] PitHouseProcessCandidates = new[]
        {
            "MOZA Pit House",        // main UI, as the process is named on the rig ("MOZA Pit House.exe")
            "PitHouse",              // main UI, as older installs named it
            "MozaBackgroundSystem",  // sync daemon, keeps running after UI close
            "MozaService",           // some installers register this as a service helper
            "MozaUsbGateway",        // USB bridge, holds devices for the daemon
            "Nextmotion",            // older Moza companion
        };

        /// <summary>The programs that are Pit House itself, of the candidates: while one runs, the ports are not looked at.</summary>
        private static readonly string[] PitHouseItself = { "MOZA Pit House", "PitHouse" };

        /// <summary>Whether the programs <see cref="RunningMozaProcesses"/> found include Pit House itself.</summary>
        internal static bool IncludesPitHouse(IReadOnlyList<string> running) =>
            running != null && running.Any(r => PitHouseItself.Any(p => string.Equals(r, p + ".exe", StringComparison.OrdinalIgnoreCase)));

        /// <summary>The Moza programs that are running on this machine, by file name: one look at the processes for all of them.</summary>
        internal static IReadOnlyList<string> RunningMozaProcesses()
        {
            var offenders = new List<string>();
            var processes = System.Diagnostics.Process.GetProcesses();
            try
            {
                foreach (var name in PitHouseProcessCandidates)
                    if (processes.Any(p => string.Equals(SafeName(p), name, StringComparison.OrdinalIgnoreCase)))
                        offenders.Add(name + ".exe");
            }
            finally
            {
                foreach (var p in processes) p.Dispose();
            }
            return offenders;
        }

        private static string SafeName(System.Diagnostics.Process p)
        {
            try { return p.ProcessName; }
            catch (InvalidOperationException) { return ""; }   // gone between the list and the look
        }

        /// <summary>
        /// Keeps <see cref="PitHouseWarning"/> and <see cref="PitHouseRunning"/> as the machine is, each time the ports are
        /// looked for and while Pit House runs, and logs the warning once for each set of programs that is running. Pit
        /// House holds the base's two ports for as long as it runs, which on the rig is all day.
        /// </summary>
        private void CheckForPitHouse()
        {
            try
            {
                var offenders = _runningMozaProcesses();
                _pitHouseRunning = IncludesPitHouse(offenders);

                if (offenders.Count > 0)
                {
                    string who = string.Join(", ", offenders);
                    PitHouseWarning = "Moza software is running and holding serial ports: "
                        + who
                        + ". Quit these processes (Pit House + its background service) so the plugin can access the hardware.";
                    if (who != _pitHouseLogged)
                    {
                        _pitHouseLogged = who;
                        _logWarn($"[MozaSerial] {PitHouseWarning}");
                    }
                }
                else
                {
                    PitHouseWarning = "";
                    _pitHouseLogged = "";   // said again if it comes back
                }
            }
            catch { /* ignore — process enumeration can fail */ }
        }

        // ═══════════════════════════════════════════════════════════════
        //  SERIAL PORT MANAGEMENT
        // ═══════════════════════════════════════════════════════════════

        // ═══════════════════════════════════════════════════════════════
        //  PROTOCOL PROBE
        //  Identify a Moza device by talking to it. The description-regex
        //  classifier in MozaDeviceRegistry can't help when the USB descriptor
        //  is generic (no "Gudsen"/"MOZA" substring) — many driver stacks
        //  expose Moza devices as plain "USB Serial Port (COMn)". The probe
        //  bypasses descriptors entirely: send each candidate device type a
        //  known-safe read command, watch for a valid framed response with
        //  the matching nibble-swapped device ID. The device that answers IS
        //  the device. Scales to every current and future Moza product
        //  without a per-product VID/PID catalog.
        // ═══════════════════════════════════════════════════════════════

        /// <summary>
        /// Per-device-type single-byte read command used as the probe. Each is
        /// a non-destructive read of a current setting (FFB strength, deadzone,
        /// brightness, etc.). The response is short (~5 bytes) and the parser
        /// only accepts it if the framing, checksum, and nibble-swapped device
        /// ID all match the request — false positives from non-Moza devices
        /// are extremely unlikely.
        /// </summary>
        private static readonly (MozaDeviceRegistry.MozaDeviceType Type, byte ProbeCmd)[] ProbeCandidates = new[]
        {
            (MozaDeviceRegistry.MozaDeviceType.Wheelbase,     MozaDeviceRegistry.WheelbaseCmd.FfbStrength),
            (MozaDeviceRegistry.MozaDeviceType.Pedals,        MozaDeviceRegistry.PedalCmd.GetCommand(MozaDeviceRegistry.PedalAxis.Throttle, MozaDeviceRegistry.PedalCmd.Deadzone)),
            (MozaDeviceRegistry.MozaDeviceType.Shifter,       MozaDeviceRegistry.ShifterCmd.Direction),
            (MozaDeviceRegistry.MozaDeviceType.Handbrake,     MozaDeviceRegistry.HandbrakeCmd.Deadzone),
            (MozaDeviceRegistry.MozaDeviceType.Dashboard,     MozaDeviceRegistry.DashboardCmd.Brightness),
            (MozaDeviceRegistry.MozaDeviceType.SteeringWheel, MozaDeviceRegistry.WheelCmd.PaddleMode),
            (MozaDeviceRegistry.MozaDeviceType.UniversalHub,  MozaDeviceRegistry.HubCmd.CompatibilityMode),
        };

        /// <summary>
        /// Cache of ports we've probed and confirmed don't speak the Moza
        /// protocol (only a port with Moza's vendor id is ever probed). Cleared
        /// when the port set changes so hot-plugged devices get a fresh probe.
        /// </summary>
        private readonly HashSet<string> _probedNotMoza = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        private string[] _lastKnownPortNames = new string[0];

        /// <summary>
        /// If the port list has changed since the last discovery cycle, drop
        /// the not-Moza cache so newly-attached devices get probed, and look
        /// at the ports another program held again.
        /// </summary>
        private void RefreshProbeCacheIfPortsChanged(string[] currentPortNames)
        {
            bool changed = currentPortNames.Length != _lastKnownPortNames.Length
                || !currentPortNames.OrderBy(p => p).SequenceEqual(_lastKnownPortNames.OrderBy(p => p));
            if (changed)
            {
                _probedNotMoza.Clear();
                RetryHeldPortsNow();
                _lastKnownPortNames = (string[])currentPortNames.Clone();
            }
        }

        /// <summary>
        /// True when discovery may open the port now. A port another program
        /// holds is found with CheckAccess, which does not throw — SerialPort.Open
        /// does, and SimHub logs every exception thrown in its process with its
        /// stack, caught or not — and is then left alone until HeldPortRetryMs
        /// has passed, the set of ports changes, or ForceRediscovery is called.
        /// Any other failure is left to the open, which says what it was.
        /// </summary>
        private bool MayOpen(string portName)
        {
            bool wasHeld = _heldPortRetryAt.TryGetValue(portName, out DateTime retryAt);
            if (wasHeld && _utcNow() < retryAt) return false;

            var access = _portSystem.CheckAccess(portName);
            if (access == MozaPortAccess.Held)
            {
                NoteHeld(portName);
                return false;
            }

            if (wasHeld)
            {
                _heldPortRetryAt.Remove(portName);
                if (access == MozaPortAccess.Free)
                    _logInfo($"[MozaSerial] {portName} is no longer held by another program");
            }
            return true;
        }

        /// <summary>
        /// Leaves a port another program holds alone for HeldPortRetryMs, and
        /// logs it the first time in the run — once, with no stack.
        /// </summary>
        private void NoteHeld(string portName)
        {
            _heldPortRetryAt[portName] = _utcNow().AddMilliseconds(HeldPortRetryMs);
            if (_heldPortsLogged.Add(portName))
            {
                _logWarn($"[MozaSerial] {portName} is held by another program (access denied) and can't be opened "
                    + $"until it lets go. Looking again every {HeldPortRetryMs / 60000} minutes and when the ports change; "
                    + "not logged again this run.");
            }
        }

        private void RetryHeldPortsNow()
        {
            foreach (var portName in _heldPortRetryAt.Keys.ToList())
                _heldPortRetryAt[portName] = DateTime.MinValue;
        }

        /// <summary>
        /// Opens a port, runs ProbeOpenPort, and closes it. Used by discovery
        /// for unclassified ports and (outside discovery: no cache, no back-off
        /// from held ports) by the diagnostic.
        /// </summary>
        private MozaDeviceRegistry.MozaDeviceType? OpenAndProbe(string portName, bool discovery)
        {
            if (discovery && _probedNotMoza.Contains(portName)) return null;
            // Don't probe ports we've already opened for polling — the open
            // would fail and a probe response could collide with live traffic.
            if (_ports.ContainsKey(portName)) return null;
            if (discovery && !MayOpen(portName)) return null;

            SerialPort port = null;
            try
            {
                port = _portSystem.Open(portName);

                var result = ProbeOpenPort(port);
                if (result == null && discovery) _probedNotMoza.Add(portName);
                return result;
            }
            catch (UnauthorizedAccessException) when (discovery)
            {
                // Taken between CheckAccess and the open. Not cached as
                // not-Moza: once the other program lets go we want to retry.
                NoteHeld(portName);
                return null;
            }
            catch (Exception ex)
            {
                // NotFound / device error / etc. — port unprobeable right now.
                _logWarn($"[MozaSerial] Probe open failed on {portName}: {ex.Message}");
                return null;
            }
            finally
            {
                if (port != null)
                {
                    try { port.Close(); } catch { }
                    try { port.Dispose(); } catch { }
                }
            }
        }

        /// <summary>
        /// Sends a probe read packet for each candidate device type and
        /// returns the type that responded with a valid framed packet whose
        /// nibble-swapped device ID matches the request. Caller is
        /// responsible for opening and closing the port.
        /// </summary>
        private static MozaDeviceRegistry.MozaDeviceType? ProbeOpenPort(SerialPort port)
        {
            foreach (var candidate in ProbeCandidates)
            {
                byte deviceId = MozaDeviceRegistry.GetDeviceId(candidate.Type);
                if (deviceId == 0) continue;

                try
                {
                    byte[] packet = MozaPacketBuilder.BuildReadPacket(deviceId, candidate.ProbeCmd);
                    port.DiscardInBuffer();
                    port.Write(packet, 0, packet.Length);

                    // ~200ms total wait per candidate. Real Moza devices reply
                    // in tens of ms; the retry budget covers slow USB hubs and
                    // scheduling jitter.
                    int available = 0;
                    for (int retry = 0; retry < 5; retry++)
                    {
                        Thread.Sleep(40);
                        available = port.BytesToRead;
                        if (available > 0) break;
                    }
                    if (available <= 0) continue;

                    byte[] buffer = new byte[Math.Min(available, ReadBufferSize)];
                    int read = port.Read(buffer, 0, buffer.Length);
                    if (read <= 0) continue;
                    if (read < buffer.Length)
                        Array.Resize(ref buffer, read);

                    var responses = MozaResponseParser.ParseResponses(buffer);
                    foreach (var resp in responses)
                    {
                        // The parser already validated start byte + checksum.
                        // We additionally require: this is a read-response
                        // (group 0xA1) and the un-swapped device ID matches
                        // the one we asked. That's strong enough that random
                        // serial noise from a non-Moza device is essentially
                        // never going to false-positive.
                        if (resp.IsReadResponse && resp.DeviceId == deviceId)
                        {
                            return candidate.Type;
                        }
                    }
                }
                catch (TimeoutException) { /* next candidate */ }
                catch (System.IO.IOException) { return null; }
                catch (InvalidOperationException) { return null; }
            }
            return null;
        }

        private bool TryOpenPort(MozaDevice device)
        {
            try
            {
                var port = _portSystem.Open(device.PortName);

                _ports[device.PortName] = port;
                _portLocks[device.PortName] = new SemaphoreSlim(1, 1);
                device.IsConnected = true;

                return true;
            }
            catch (UnauthorizedAccessException)
            {
                NoteHeld(device.PortName);
                return false;
            }
            catch (Exception ex)
            {
                _logWarn($"[MozaSerial] Failed to open {device.PortName}: {ex.Message}");
                return false;
            }
        }

        private void ClosePort(string portName)
        {
            // Acquire semaphore to ensure no SendAndReceive is in progress
            SemaphoreSlim semaphore = null;
            if (_portLocks.TryGetValue(portName, out semaphore))
            {
                if (!semaphore.Wait(WriteTimeoutMs))
                    _logWarn($"[MozaSerial] Timeout acquiring lock for {portName} during close");
            }

            try
            {
                if (_ports.TryRemove(portName, out var port))
                {
                    try { port.Close(); } catch { }
                    try { port.Dispose(); } catch { }
                }

                if (_devices.TryGetValue(portName, out var device))
                    device.IsConnected = false;
            }
            finally
            {
                // Release the semaphore and dispose it
                if (semaphore != null)
                {
                    try { semaphore.Release(); } catch { }
                    try { _portLocks.TryRemove(portName, out _); semaphore.Dispose(); } catch { }
                }
            }
        }

        private void CloseAllPorts()
        {
            foreach (var portName in _ports.Keys.ToList())
                ClosePort(portName);
        }

        // ═══════════════════════════════════════════════════════════════
        //  POLLING — READ DEVICE SETTINGS
        // ═══════════════════════════════════════════════════════════════

        private void PollDevice(MozaDevice device)
        {
            byte[][] commands = GetPollCommands(device);
            if (commands == null || commands.Length == 0)
            {
                device.RecordSuccess(); // Nothing to poll but device exists
                return;
            }

            foreach (var packet in commands)
            {
                byte[] response = SendAndReceive(device.PortName, packet);
                if (response == null)
                {
                    if (device.RecordFailure())
                    {
                        _logWarn($"[MozaSerial] {device.DisplayName} disconnected after {MozaDevice.MaxFailures} failures");
                        ClosePort(device.PortName);
                        _searchAsked = true;   // looked for again, once
                    }
                    return; // Stop polling this device on failure
                }

                // Parse and apply responses
                var parsed = MozaResponseParser.ParseResponses(response);
                foreach (var resp in parsed)
                {
                    ApplyResponse(device, resp);
                }
            }

            device.RecordSuccess();
        }

        /// <summary>
        /// Builds the set of read-request packets for a device based on its type.
        /// </summary>
        private byte[][] GetPollCommands(MozaDevice device)
        {
            switch (device.DeviceType)
            {
                case MozaDeviceRegistry.MozaDeviceType.Wheelbase:
                    return BuildReadPackets(MozaDeviceRegistry.DeviceWheelbase,
                        MozaDeviceRegistry.WheelbaseCmd.PollCommands,
                        MozaDeviceRegistry.WheelbaseCmd.TwoByteCommands);

                case MozaDeviceRegistry.MozaDeviceType.Pedals:
                    return BuildPedalReadPackets();

                case MozaDeviceRegistry.MozaDeviceType.Handbrake:
                    return BuildReadPackets(MozaDeviceRegistry.DeviceHandbrake,
                        MozaDeviceRegistry.HandbrakeCmd.PollCommands,
                        MozaDeviceRegistry.HandbrakeCmd.TwoByteCommands);

                case MozaDeviceRegistry.MozaDeviceType.Shifter:
                    return BuildReadPackets(MozaDeviceRegistry.DeviceShifter,
                        MozaDeviceRegistry.ShifterCmd.PollCommands, null);

                case MozaDeviceRegistry.MozaDeviceType.Dashboard:
                    return BuildReadPackets(MozaDeviceRegistry.DeviceDashboard,
                        MozaDeviceRegistry.DashboardCmd.PollCommands, null);

                case MozaDeviceRegistry.MozaDeviceType.SteeringWheel:
                    // Poll both primary (0x15) and extended (0x17)
                    var primary = BuildReadPackets(MozaDeviceRegistry.DeviceSteeringWheelPrimary,
                        MozaDeviceRegistry.WheelCmd.PrimaryPollCommands, null);
                    var extended = BuildReadPackets(MozaDeviceRegistry.DeviceSteeringWheelExtended,
                        MozaDeviceRegistry.WheelCmd.ExtendedPollCommands, null);
                    var combined = new byte[primary.Length + extended.Length][];
                    primary.CopyTo(combined, 0);
                    extended.CopyTo(combined, primary.Length);
                    return combined;

                default:
                    return null;
            }
        }

        private byte[][] BuildReadPackets(byte deviceId, byte[] commands, byte[] twoByteCommands)
        {
            var packets = new List<byte[]>();
            foreach (var cmd in commands)
            {
                packets.Add(MozaPacketBuilder.BuildReadPacket(deviceId, cmd));
            }
            // Also poll 2-byte commands
            if (twoByteCommands != null)
            {
                foreach (var cmd in twoByteCommands)
                {
                    packets.Add(MozaPacketBuilder.BuildReadPacket(deviceId, cmd));
                }
            }
            return packets.ToArray();
        }

        private byte[][] BuildPedalReadPackets()
        {
            var packets = new List<byte[]>();
            foreach (var axis in new[] { MozaDeviceRegistry.PedalAxis.Throttle, MozaDeviceRegistry.PedalAxis.Brake, MozaDeviceRegistry.PedalAxis.Clutch })
            {
                // Single-byte settings
                var singleByteOffsets = new byte[]
                {
                    MozaDeviceRegistry.PedalCmd.Deadzone,
                    MozaDeviceRegistry.PedalCmd.CurveY1, MozaDeviceRegistry.PedalCmd.CurveY2,
                    MozaDeviceRegistry.PedalCmd.CurveY3, MozaDeviceRegistry.PedalCmd.CurveY4,
                    MozaDeviceRegistry.PedalCmd.CurveY5, MozaDeviceRegistry.PedalCmd.HidSource
                };
                foreach (var offset in singleByteOffsets)
                {
                    byte cmd = MozaDeviceRegistry.PedalCmd.GetCommand(axis, offset);
                    packets.Add(MozaPacketBuilder.BuildReadPacket(MozaDeviceRegistry.DevicePedals, cmd));
                }

                // Two-byte settings (calibration)
                foreach (var offset in MozaDeviceRegistry.PedalCmd.TwoByteOffsets)
                {
                    byte cmd = MozaDeviceRegistry.PedalCmd.GetCommand(axis, offset);
                    packets.Add(MozaPacketBuilder.BuildReadPacket(MozaDeviceRegistry.DevicePedals, cmd));
                }
            }
            return packets.ToArray();
        }

        // ═══════════════════════════════════════════════════════════════
        //  RESPONSE HANDLING
        // ═══════════════════════════════════════════════════════════════

        private void ApplyResponse(MozaDevice device, MozaResponse response)
        {
            if (!response.IsReadResponse) return;
            if (response.CommandAndPayload == null || response.CommandAndPayload.Length < 2) return;

            byte commandId = MozaResponseParser.GetCommandId(response);
            bool isTwoByte = MozaDeviceRegistry.IsTwoByteCommand(device.DeviceId, commandId);

            int value;
            if (isTwoByte)
            {
                if (response.CommandAndPayload.Length < 3) return;
                value = MozaResponseParser.GetValueUInt16(response);
            }
            else
            {
                value = MozaResponseParser.GetValueByte(response);
            }

            switch (device.DeviceType)
            {
                case MozaDeviceRegistry.MozaDeviceType.Wheelbase:
                    device.WheelbaseSettings?.ApplyValue(commandId, value);
                    break;
                case MozaDeviceRegistry.MozaDeviceType.Pedals:
                    device.PedalSettings?.ApplyValue(commandId, value);
                    break;
                case MozaDeviceRegistry.MozaDeviceType.Handbrake:
                    device.HandbrakeSettings?.ApplyValue(commandId, value);
                    break;
                case MozaDeviceRegistry.MozaDeviceType.Shifter:
                    device.ShifterSettings?.ApplyValue(commandId, value);
                    break;
                case MozaDeviceRegistry.MozaDeviceType.Dashboard:
                    device.DashboardSettings?.ApplyValue(commandId, value);
                    break;
                case MozaDeviceRegistry.MozaDeviceType.SteeringWheel:
                    // Route to primary or extended based on response device ID
                    if (response.DeviceId == MozaDeviceRegistry.DeviceSteeringWheelPrimary)
                        device.WheelSettings?.ApplyPrimaryValue(commandId, value);
                    else if (response.DeviceId == MozaDeviceRegistry.DeviceSteeringWheelExtended)
                        device.WheelSettings?.ApplyExtendedValue(commandId, value);
                    break;
            }
        }

        // ═══════════════════════════════════════════════════════════════
        //  WRITE QUEUE PROCESSING
        // ═══════════════════════════════════════════════════════════════

        private void ProcessWriteQueue()
        {
            int processed = 0;
            while (_writeQueue.TryDequeue(out var cmd) && processed < 20)
            {
                // Find the port for this device ID
                var device = _devices.Values.FirstOrDefault(d =>
                    d.DeviceId == cmd.DeviceId && d.IsConnected);

                if (device != null)
                {
                    SendPacket(device.PortName, cmd.Packet);
                }
                processed++;
            }
        }

        // ═══════════════════════════════════════════════════════════════
        //  SERIAL I/O (thread-safe per port)
        // ═══════════════════════════════════════════════════════════════

        /// <summary>
        /// Sends a packet and reads the response, with per-port locking.
        /// Returns the raw response bytes, or null on failure.
        /// </summary>
        private byte[] SendAndReceive(string portName, byte[] packet)
        {
            if (!_ports.TryGetValue(portName, out var port)) return null;
            if (!_portLocks.TryGetValue(portName, out var semaphore)) return null;

            if (!semaphore.Wait(WriteTimeoutMs)) return null;
            try
            {
                if (!port.IsOpen) return null;

                port.DiscardInBuffer();
                port.Write(packet, 0, packet.Length);

                // Retry loop: wait up to ~200ms total for data to appear
                int available = 0;
                for (int retry = 0; retry < 5; retry++)
                {
                    Thread.Sleep(50);
                    available = port.BytesToRead;
                    if (available > 0) break;
                }

                if (available <= 0) return null;

                byte[] buffer = new byte[Math.Min(available, ReadBufferSize)];
                int read = port.Read(buffer, 0, buffer.Length);
                if (read <= 0) return null;

                if (read < buffer.Length)
                    Array.Resize(ref buffer, read);
                return buffer;
            }
            catch (TimeoutException)
            {
                return null;
            }
            catch (System.IO.IOException)
            {
                return null; // Port disconnected
            }
            catch (InvalidOperationException)
            {
                return null; // Port closed
            }
            finally
            {
                semaphore.Release();
            }
        }

        /// <summary>
        /// Sends a packet without waiting for a response (for write commands).
        /// </summary>
        private void SendPacket(string portName, byte[] packet)
        {
            if (!_ports.TryGetValue(portName, out var port)) return;
            if (!_portLocks.TryGetValue(portName, out var semaphore)) return;

            if (!semaphore.Wait(WriteTimeoutMs)) return;
            try
            {
                if (port.IsOpen)
                    port.Write(packet, 0, packet.Length);
            }
            catch (Exception ex)
            {
                _logWarn($"[MozaSerial] Write error on {portName}: {ex.Message}");
            }
            finally
            {
                semaphore.Release();
            }
        }

        // ═══════════════════════════════════════════════════════════════
        //  SUMMARY FOR MAIN POLL RESPONSE
        // ═══════════════════════════════════════════════════════════════

        /// <summary>
        /// Appends Moza summary properties to the main HTTP poll response StringBuilder.
        /// Uses the same Jp() pattern as Plugin.cs.
        /// </summary>
        /// <summary>
        /// Property name prefix — must match the convention used by Plugin.cs for all
        /// other dataset properties so that the overlay can find them at the expected paths.
        /// The overlay looks for "RacingDesk.Plugin.DS.MozaConnected" (and the Demo variant);
        /// without this prefix the properties are invisible to the frontend.
        /// </summary>
        private const string Ds = "RacingDesk.Plugin.DS.";

        public void AppendPollSummary(StringBuilder sb, Action<StringBuilder, string, int> jpInt, Action<StringBuilder, string, string> jpStr)
        {
            jpInt(sb, Ds + "MozaConnected", IsConnected ? 1 : 0);
            jpInt(sb, Ds + "MozaDeviceCount", DeviceCount);

            var wb = Wheelbase;
            jpInt(sb, Ds + "MozaWheelbaseConnected", wb != null ? 1 : 0);
            jpInt(sb, Ds + "MozaPedalsConnected", Pedals != null ? 1 : 0);
            jpInt(sb, Ds + "MozaHandbrakeConnected", Handbrake != null ? 1 : 0);
            jpInt(sb, Ds + "MozaShifterConnected", Shifter != null ? 1 : 0);
            jpInt(sb, Ds + "MozaDashboardConnected", Dashboard != null ? 1 : 0);
            jpInt(sb, Ds + "MozaWheelConnected", SteeringWheel != null ? 1 : 0);

            if (wb?.WheelbaseSettings != null && wb.WheelbaseSettings.HasData)
            {
                jpInt(sb, Ds + "MozaWheelbaseFFBStrength", wb.WheelbaseSettings.FfbStrength);
                // The base's own max-torque setting, in per cent of its rated peak, where the poll has read it — and in
                // Nm where its model has a rating (the HUD's datastream shows that, ahead of Pit House's saved preset).
                if (wb.WheelbaseSettings.MaxTorque >= 0)
                {
                    jpInt(sb, Ds + "MozaWheelbaseMaxTorque", wb.WheelbaseSettings.MaxTorque);
                    double? rated = MozaWheelbaseModels.RatedNm(wb.WheelbaseSettings.Model);
                    if (rated.HasValue)
                        sb.Append('"').Append(Ds).Append("MozaWheelbaseMaxNm\":")
                          .Append((wb.WheelbaseSettings.MaxTorque * rated.Value / 100.0).ToString("0.###", System.Globalization.CultureInfo.InvariantCulture)).Append(",\n");
                }
                jpInt(sb, Ds + "MozaWheelbaseRotationRange", wb.WheelbaseSettings.RotationRange);
                jpStr(sb, Ds + "MozaWheelbaseModel", wb.WheelbaseSettings.Model ?? "");
            }

            if (!string.IsNullOrEmpty(PitHouseWarning))
            {
                jpStr(sb, Ds + "MozaPitHouseWarning", PitHouseWarning.Replace("\"", "\\\""));
            }
        }

        /// <summary>
        /// What the wheel base itself last said of its maximum torque, or null: no base, nothing read from it yet (the
        /// poll that runs every two seconds does not run while Pit House holds the ports, which on the rig it nearly
        /// always does), or no max-torque setting among what it said. Reads what the poll already holds; nothing is
        /// sent to the base for it.
        /// </summary>
        public WheelbaseReading WheelbaseReading()
        {
            var s = Wheelbase?.WheelbaseSettings;
            if (s == null || !s.HasData || s.MaxTorque < 0) return null;
            return new WheelbaseReading(s.Model, s.MaxTorque);
        }

        // ── Internal write command struct ─────────────────────────────
        private struct WriteCommand
        {
            public byte DeviceId;
            public byte[] Packet;
        }
    }
}
