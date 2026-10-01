using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Xml.Linq;
using Newtonsoft.Json.Linq;
using RacingDesk.Plugin.Engine;
using RacingDesk.Plugin.Engine.Moza;

namespace RacingDesk.Plugin
{
    // The localhost:8889 HTTP contract: action endpoints and the flat JSON state map.
    public sealed partial class RacingDeskRuntime
    {
        /// <summary>Whether :HttpPort is bound and served — false when another host or SimHub got there first.</summary>
        public bool HttpListening => _httpListener != null && _httpListener.IsListening;

        private void StartHttpServer()
        {
            // Try binding in order of preference:
            // 1. Wildcard (*) — works if SimHub runs as admin or URL ACL is registered
            // 2. localhost only — always works without admin, sufficient for local overlays
            // LoopbackOnly (tests, probes): 127.0.0.1 alone, which HTTP.sys binds on that address and no other.
            string[] prefixes = _options.LoopbackOnly
                ? new[] { $"http://127.0.0.1:{_options.HttpPort}/racing-desk/" }
                : new[]
                {
                    $"http://*:{_options.HttpPort}/racing-desk/",
                    $"http://localhost:{_options.HttpPort}/racing-desk/"
                };

            foreach (var prefix in prefixes)
            {
                try
                {
                    _httpListener = new HttpListener();
                    _httpListener.Prefixes.Add(prefix);
                    _httpListener.Start();
                    _httpThread = new Thread(HttpServerLoop) { IsBackground = true, Name = "RacingDesk-HTTP" };
                    _httpThread.Start();
                    Log.Info($"[RacingDesk] HTTP state server listening on port {_options.HttpPort} (prefix: {prefix})");
                    return;
                }
                catch (Exception ex)
                {
                    Log.Warn($"[RacingDesk] HTTP server failed with prefix {prefix}: {ex.Message}");
                    try { _httpListener?.Close(); }
                    catch (Exception closeEx)
                    {
                        Log.Warn($"[RacingDesk] HTTP listener close failed: {closeEx.Message}");
                    }
                    _httpListener = null;
                }
            }

            Log.Warn("[RacingDesk] HTTP server could not start on any prefix — dashboard overlay will not receive data");
        }

        /// <summary>
        /// Whether a request is from a program on this machine, for the routes that act on the machine's hardware: the
        /// connection is the machine's own (<c>IsLocal</c>: its two addresses are the same, or loopback — which a LAN
        /// device that says <c>Host: localhost</c> is not), the Host it names is localhost, 127.0.0.1 or [::1] (a name
        /// pointed at the machine by another site is not), and it carries no Origin (a page in a browser).
        /// </summary>
        internal static bool IsFromThisMachine(bool isLocal, string hostHeader, string origin)
        {
            if (!isLocal || !string.IsNullOrEmpty(origin)) return false;
            if (string.IsNullOrWhiteSpace(hostHeader)) return false;

            string host = hostHeader.Trim();
            if (host.StartsWith("[", StringComparison.Ordinal))
            {
                int close = host.IndexOf(']');
                if (close < 0) return false;
                string rest = host.Substring(close + 1);
                if (rest.Length > 0 && rest[0] != ':') return false;
                host = host.Substring(0, close + 1);
            }
            else
            {
                int colon = host.LastIndexOf(':');
                if (colon >= 0) host = host.Substring(0, colon);
            }
            return host.Equals("localhost", StringComparison.OrdinalIgnoreCase) || host == "127.0.0.1" || host == "[::1]";
        }

        private void StopHttpServer()
        {
            try { _httpListener?.Stop(); }
            catch (Exception ex)
            {
                Log.Warn($"[RacingDesk] HTTP listener stop failed: {ex.Message}");
            }
        }

        private void HttpServerLoop()
        {
            var ic = System.Globalization.CultureInfo.InvariantCulture;

            while (_httpListener != null && _httpListener.IsListening)
            {
                HttpListenerContext ctx;
                try { ctx = _httpListener.GetContext(); }
                catch (Exception ex)
                {
                    Log.Warn($"[RacingDesk] HTTP context get failed: {ex.Message}");
                    break;
                }

                bool responseHandedOff = false;
                try
                {
                    // Handle CORS preflight
                    // Electron 33+ (Chromium 130+) enforces Private Network Access:
                    // file:// → localhost requires Access-Control-Allow-Private-Network
                    if (ctx.Request.HttpMethod == "OPTIONS")
                    {
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
                        ctx.Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type");
                        ctx.Response.Headers.Add("Access-Control-Allow-Private-Network", "true");
                        ctx.Response.StatusCode = 204;
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    // ── Host-provided routes (e.g. RacingDesk.Host's local data API) ──
                    if (_options.ExtraRoutes != null)
                    {
                        bool handled = false;
                        try { handled = _options.ExtraRoutes(ctx); }
                        catch (Exception ex) { Log.Warn($"[RacingDesk] Extra route failed: {ex.Message}"); }
                        if (handled) { responseHandedOff = true; continue; }
                    }

                    // ── Handle action endpoints ──────────────────────────────
                    string rawUrl = ctx.Request.RawUrl ?? "";

                    // Extract action from query string
                    string action = "";
                    int qIdx = rawUrl.IndexOf("action=");
                    if (qIdx >= 0)
                    {
                        int start = qIdx + 7; // "action=".Length
                        int end = rawUrl.IndexOf('&', start);
                        action = end >= 0 ? rawUrl.Substring(start, end - start) : rawUrl.Substring(start);
                    }

                    if (action == "resetmap")
                    {
                        _trackMap.ResetTrackMap();
                        byte[] okBytes = System.Text.Encoding.UTF8.GetBytes("{\"ok\":true}");
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(okBytes, 0, okBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "listtracks")
                    {
                        var ids = _trackMap.GetBundledTrackIds();
                        string json = "[" + string.Join(",", ids.ConvertAll(id => "\"" + id.Replace("\"", "\\\"") + "\"")) + "]";
                        byte[] listBytes = System.Text.Encoding.UTF8.GetBytes(json);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(listBytes, 0, listBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "restartdemo")
                    {
                        _engine.DemoTelemetry.Reset();
                        byte[] okBytes = System.Text.Encoding.UTF8.GetBytes("{\"ok\":true}");
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(okBytes, 0, okBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    // ── Ambient capture rect — dashboard sends the region via query params ──
                    if (action == "setrect")
                    {
                        try
                        {
                            // Parse x, y, w, h from query string (ratios 0-1)
                            var qs = ctx.Request.QueryString;
                            double rx = double.Parse(qs["x"] ?? "0", ic);
                            double ry = double.Parse(qs["y"] ?? "0", ic);
                            double rw = double.Parse(qs["w"] ?? "0", ic);
                            double rh = double.Parse(qs["h"] ?? "0", ic);
                            if (rw > 0.01 && rh > 0.01)
                            {
                                _screenColorSampler.SetRect(rx, ry, rw, rh);
                                Log.Info(
                                    $"[RacingDesk] Ambient rect set: x={rx:F3} y={ry:F3} w={rw:F3} h={rh:F3}");
                            }
                        }
                        catch (Exception ex)
                        {
                            Log.Warn($"[RacingDesk] setrect error: {ex.Message}");
                        }
                        byte[] okBytes = System.Text.Encoding.UTF8.GetBytes("{\"ok\":true}");
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(okBytes, 0, okBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    // ── Pedal profile actions ──────────────────────────────────
                    if (action == "listPedalProfiles" && _pedalProfiles != null)
                    {
                        string json = _pedalProfiles.GetProfileListJson();
                        byte[] listBytes = System.Text.Encoding.UTF8.GetBytes(json);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(listBytes, 0, listBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "setPedalProfile" && _pedalProfiles != null)
                    {
                        var qs = ctx.Request.QueryString;
                        string profileId = qs["id"] ?? "";
                        if (!string.IsNullOrEmpty(profileId))
                            _pedalProfiles.SetActiveProfile(profileId);
                        byte[] okBytes = System.Text.Encoding.UTF8.GetBytes("{\"ok\":true}");
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(okBytes, 0, okBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "bindPedalProfile" && _pedalProfiles != null)
                    {
                        var qs = ctx.Request.QueryString;
                        string profileId = qs["id"] ?? "";
                        string carModel = qs["car"] ?? _lastCarModel;
                        if (!string.IsNullOrEmpty(profileId) && !string.IsNullOrEmpty(carModel))
                            _pedalProfiles.BindProfileToCar(profileId, carModel, carModel);
                        byte[] okBytes = System.Text.Encoding.UTF8.GetBytes("{\"ok\":true}");
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(okBytes, 0, okBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "importMozaPedals" && _pedalProfiles != null)
                    {
                        var imported = _pedalProfiles.ImportFromMoza();
                        string json = imported != null
                            ? "{\"ok\":true,\"name\":\"" + (imported.Name ?? "").Replace("\"", "\\\"") + "\"}"
                            : "{\"ok\":false,\"error\":\"Moza Pithouse not detected or no config found\"}";
                        if (imported != null)
                            _pedalProfiles.SaveProfile(imported);
                        byte[] resultBytes = System.Text.Encoding.UTF8.GetBytes(json);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(resultBytes, 0, resultBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    // ── Moza direct hardware actions ──────────────────────────
                    if (action == "listMozaDevices" && _mozaSerial != null)
                    {
                        string json = _mozaSerial.GetDeviceListJson();
                        byte[] listBytes = System.Text.Encoding.UTF8.GetBytes(json);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(listBytes, 0, listBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "getMozaWheelbaseSettings" && _mozaSerial != null)
                    {
                        string json = _mozaSerial.GetWheelbaseSettingsJson();
                        byte[] resultBytes = System.Text.Encoding.UTF8.GetBytes(json);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(resultBytes, 0, resultBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "setMozaWheelbaseSetting" && _mozaSerial != null)
                    {
                        var qs = ctx.Request.QueryString;
                        string key = qs["key"] ?? "";
                        string val = qs["value"] ?? "";
                        bool ok = ApplyMozaWheelbaseSetting(key, val);
                        byte[] okBytes = System.Text.Encoding.UTF8.GetBytes(ok ? "{\"ok\":true}" : "{\"ok\":false,\"error\":\"Invalid key or value\"}");
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(okBytes, 0, okBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "getMozaPedalSettings" && _mozaSerial != null)
                    {
                        string json = _mozaSerial.GetPedalSettingsJson();
                        byte[] resultBytes = System.Text.Encoding.UTF8.GetBytes(json);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(resultBytes, 0, resultBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "setMozaPedalSetting" && _mozaSerial != null)
                    {
                        var qs = ctx.Request.QueryString;
                        string key = qs["key"] ?? "";
                        string val = qs["value"] ?? "";
                        bool ok = ApplyMozaPedalSetting(key, val);
                        byte[] okBytes = System.Text.Encoding.UTF8.GetBytes(ok ? "{\"ok\":true}" : "{\"ok\":false,\"error\":\"Invalid key or value\"}");
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(okBytes, 0, okBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "getMozaHandbrakeSettings" && _mozaSerial != null)
                    {
                        string json = _mozaSerial.GetHandbrakeSettingsJson();
                        byte[] resultBytes = System.Text.Encoding.UTF8.GetBytes(json);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(resultBytes, 0, resultBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "setMozaHandbrakeSetting" && _mozaSerial != null)
                    {
                        var qs = ctx.Request.QueryString;
                        string key = qs["key"] ?? "";
                        string val = qs["value"] ?? "";
                        bool ok = ApplyMozaHandbrakeSetting(key, val);
                        byte[] okBytes = System.Text.Encoding.UTF8.GetBytes(ok ? "{\"ok\":true}" : "{\"ok\":false,\"error\":\"Invalid key or value\"}");
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(okBytes, 0, okBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "getMozaShifterSettings" && _mozaSerial != null)
                    {
                        string json = _mozaSerial.GetShifterSettingsJson();
                        byte[] resultBytes = System.Text.Encoding.UTF8.GetBytes(json);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(resultBytes, 0, resultBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "getMozaDashboardSettings" && _mozaSerial != null)
                    {
                        string json = _mozaSerial.GetDashboardSettingsJson();
                        byte[] resultBytes = System.Text.Encoding.UTF8.GetBytes(json);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(resultBytes, 0, resultBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "getMozaWheelSettings" && _mozaSerial != null)
                    {
                        string json = _mozaSerial.GetWheelSettingsJson();
                        byte[] resultBytes = System.Text.Encoding.UTF8.GetBytes(json);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(resultBytes, 0, resultBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "mozaRefresh" && _mozaSerial != null)
                    {
                        _mozaSerial.ForceRefresh();
                        byte[] okBytes = System.Text.Encoding.UTF8.GetBytes("{\"ok\":true}");
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(okBytes, 0, okBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "mozaReconnect" && _mozaSerial != null)
                    {
                        _mozaSerial.ForceRediscovery();
                        byte[] okBytes = System.Text.Encoding.UTF8.GetBytes("{\"ok\":true}");
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(okBytes, 0, okBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "listSerialPortDiagnostic" && _mozaSerial != null)
                    {
                        // It opens every serial port the machine has, and with probe=1 writes to the ones nothing
                        // describes as Moza. This port answers every address (the iPad view needs it), and HTTP.sys hands
                        // a localhost prefix any request that says Host: localhost, so the route is for a program on this
                        // machine and no other: not the LAN, not a page in a browser.
                        var request = ctx.Request;
                        if (!IsFromThisMachine(request.IsLocal, request.Headers["Host"], request.Headers["Origin"]))
                        {
                            byte[] refusedBytes = System.Text.Encoding.UTF8.GetBytes("{\"error\":\"this is for a program on this machine\"}");
                            ctx.Response.ContentType = "application/json";
                            ctx.Response.StatusCode = 403;
                            ctx.Response.OutputStream.Write(refusedBytes, 0, refusedBytes.Length);
                            ctx.Response.OutputStream.Close();
                            continue;
                        }
                        // What the ports say they are is read from Windows; talking to them is asked for: ?probe=1.
                        string json = _mozaSerial.GetSerialPortDiagnosticJson(probe: request.QueryString["probe"] == "1");
                        byte[] resultBytes = System.Text.Encoding.UTF8.GetBytes(json);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(resultBytes, 0, resultBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    // ── Build complete state snapshot ────────────────────────
                    var s = _current; // snapshot reference (safe — replaced atomically in DataUpdate)
                    var dt = _engine.DemoTelemetry;
                    bool demo = Settings.DemoMode;

                    // Flag state — demo flags take priority when in demo mode
                    string flagState = "none";
                    {
                        int f = 0;
                        if (demo && _engine.CurrentDemoFlags != 0)
                            f = _engine.CurrentDemoFlags;
                        else if (s.GameRunning)
                            f = s.SessionFlags;
                        if ((f & TelemetrySnapshot.FLAG_RED) != 0) flagState = "red";
                        else if ((f & TelemetrySnapshot.FLAG_REPAIR) != 0) flagState = "meatball";
                        else if ((f & TelemetrySnapshot.FLAG_BLACK) != 0) flagState = "black";
                        else if ((f & TelemetrySnapshot.FLAG_YELLOW) != 0) flagState = "yellow";
                        else if ((f & TelemetrySnapshot.FLAG_BLUE) != 0) flagState = "blue";
                        else if ((f & TelemetrySnapshot.FLAG_DEBRIS) != 0) flagState = "debris";
                        else if ((f & TelemetrySnapshot.FLAG_WHITE) != 0) flagState = "white";
                        else if ((f & TelemetrySnapshot.FLAG_CHECKERED) != 0) flagState = "checkered";
                        else if ((f & TelemetrySnapshot.FLAG_GREEN) != 0) flagState = "green";
                        else if (!demo && IsLappingCarAhead(s)) flagState = "orange";
                    }

                    // Nearest car distance
                    double nearestDist = 1.0;
                    if (s.GameRunning && s.CarIdxLapDistPct != null && s.CarIdxLapDistPct.Length > 0)
                    {
                        double playerPos = s.TrackPositionPct;
                        int playerIdx = s.PlayerCarIdx;
                        for (int i = 0; i < s.CarIdxLapDistPct.Length; i++)
                        {
                            if (i == playerIdx) continue;
                            double other = s.CarIdxLapDistPct[i];
                            if (other <= 0) continue;
                            double d = Math.Abs(playerPos - other);
                            d = Math.Min(d, 1.0 - d);
                            if (d < nearestDist) nearestDist = d;
                        }
                    }

                    // Commentary state
                    string cat = _engine.CurrentCategory ?? "";
                    string label = _engine.CurrentSentimentLabel ?? "";
                    string category = string.IsNullOrEmpty(label) ? cat : cat + " \u2014 " + label;

                    // Build JSON — flat key-value map matching PROP_KEYS the dashboard expects
                    var sb = new StringBuilder(2048);
                    sb.Append("{\n");

                    // ── Game data (live telemetry from snapshot) ──
                    // Demo mode always reports as iRacing so the dashboard enables
                    // all features (track map, iRating, incidents, etc.) without
                    // requiring a live game connection or Discord gating.
                    Jp(sb, "DataCorePlugin.GameRunning", (demo || s.GameRunning) ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.GameId", demo ? "iRacing" : Escape(s.GameName ?? ""));
                    Jp(sb, "RacingDesk.Plugin.SessionTypeName", Escape(s.SessionTypeName ?? ""));
                    Jp(sb, "DataCorePlugin.GameData.Gear", Escape(s.Gear ?? "N"));
                    Jp(sb, "DataCorePlugin.GameData.Rpms", s.Rpms, ic);
                    Jp(sb, "DataCorePlugin.GameData.CarSettings_MaxRPM", s.MaxRpm, ic);
                    Jp(sb, "DataCorePlugin.GameData.SpeedMph", s.SpeedKmh * 0.621371, ic);
                    Jp(sb, "DataCorePlugin.GameData.Throttle", s.Throttle, ic);
                    Jp(sb, "DataCorePlugin.GameData.Brake", s.Brake, ic);
                    Jp(sb, "DataCorePlugin.GameData.Clutch", s.Clutch, ic);
                    Jp(sb, "DataCorePlugin.GameData.Fuel", s.FuelLevel, ic);
                    double fuelPct = Math.Max(0.01, Math.Min(1.0, s.FuelPercent));
                    Jp(sb, "DataCorePlugin.GameData.MaxFuel", s.FuelLevel > 0 ? s.FuelLevel / fuelPct : 0, ic);
                    Jp(sb, "DataCorePlugin.Computed.Fuel_LitersPerLap", s.FuelPerLap, ic);
                    Jp(sb, "DataCorePlugin.GameData.RemainingLaps", s.RemainingLaps, ic);
                    Jp(sb, "DataCorePlugin.GameData.TyreTempFrontLeft", s.TyreTempFL, ic);
                    Jp(sb, "DataCorePlugin.GameData.TyreTempFrontRight", s.TyreTempFR, ic);
                    Jp(sb, "DataCorePlugin.GameData.TyreTempRearLeft", s.TyreTempRL, ic);
                    Jp(sb, "DataCorePlugin.GameData.TyreTempRearRight", s.TyreTempRR, ic);
                    Jp(sb, "DataCorePlugin.GameData.TyreWearFrontLeft", s.TyreWearFL, ic);
                    Jp(sb, "DataCorePlugin.GameData.TyreWearFrontRight", s.TyreWearFR, ic);
                    Jp(sb, "DataCorePlugin.GameData.TyreWearRearLeft", s.TyreWearRL, ic);
                    Jp(sb, "DataCorePlugin.GameData.TyreWearRearRight", s.TyreWearRR, ic);
                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.dcBrakeBias", s.BrakeBias, ic);
                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.dcTractionControl", s.TractionControlSetting, ic);
                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.dcABS", s.AbsSetting, ic);
                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.dcAntiRollFront", s.ArbFront, ic);
                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.dcAntiRollRear", s.ArbRear, ic);
                    // Additional car adjustments
                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.dcEnginePower", s.EnginePower, ic);
                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.dcFuelMixture", s.FuelMixture, ic);
                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.dcWeightJackerLeft", s.WeightJackerLeft, ic);
                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.dcWeightJackerRight", s.WeightJackerRight, ic);
                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.dcWingFront", s.WingFront, ic);
                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.dcWingRear", s.WingRear, ic);
                    // Pit stop selections
                    Jp(sb, "RacingDesk.Plugin.PitBox.PitSvFlags", s.PitSvFlags);
                    Jp(sb, "RacingDesk.Plugin.PitBox.PitSvFuel", s.PitSvFuel, ic);
                    Jp(sb, "RacingDesk.Plugin.PitBox.PitSvLFP", s.PitSvLFP, ic);
                    Jp(sb, "RacingDesk.Plugin.PitBox.PitSvRFP", s.PitSvRFP, ic);
                    Jp(sb, "RacingDesk.Plugin.PitBox.PitSvLRP", s.PitSvLRP, ic);
                    Jp(sb, "RacingDesk.Plugin.PitBox.PitSvRRP", s.PitSvRRP, ic);
                    Jp(sb, "RacingDesk.Plugin.PitBox.TireCompound", s.PitSvTireCompound);
                    Jp(sb, "RacingDesk.Plugin.PitBox.FastRepair", s.PitSvFastRepair);
                    Jp(sb, "RacingDesk.Plugin.PitBox.Windshield", s.PitSvWindshieldTearoff);
                    // Pit box computed display strings
                    Jp(sb, "RacingDesk.Plugin.PitBox.TireLF", s.PitTireLF ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.PitBox.TireRF", s.PitTireRF ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.PitBox.TireLR", s.PitTireLR ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.PitBox.TireRR", s.PitTireRR ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.PitBox.TiresRequested", s.PitTiresRequested ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.PitBox.FuelRequested", s.PitFuelRequested ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.PitBox.FastRepairRequested", s.PitFastRepairRequested ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.PitBox.WindshieldRequested", s.PitWindshieldRequested ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.PitBox.FuelDisplay", Escape(s.PitFuelDisplay));
                    Jp(sb, "RacingDesk.Plugin.PitBox.PressureLF", Escape(s.PitPressureLFDisplay));
                    Jp(sb, "RacingDesk.Plugin.PitBox.PressureRF", Escape(s.PitPressureRFDisplay));
                    Jp(sb, "RacingDesk.Plugin.PitBox.PressureLR", Escape(s.PitPressureLRDisplay));
                    Jp(sb, "RacingDesk.Plugin.PitBox.PressureRR", Escape(s.PitPressureRRDisplay));
                    // Car-specific adjustment availability
                    Jp(sb, "RacingDesk.Plugin.PitBox.HasTC", s.HasTC ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.PitBox.HasABS", s.HasABS ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.PitBox.HasARBFront", s.HasARBFront ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.PitBox.HasARBRear", s.HasARBRear ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.PitBox.HasEnginePower", s.HasEnginePower ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.PitBox.HasFuelMixture", s.HasFuelMixture ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.PitBox.HasWeightJackerL", s.HasWeightJackerL ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.PitBox.HasWeightJackerR", s.HasWeightJackerR ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.PitBox.HasWingFront", s.HasWingFront ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.PitBox.HasWingRear", s.HasWingRear ? 1 : 0);
                    Jp(sb, "DataCorePlugin.GameData.Position", s.Position);
                    Jp(sb, "DataCorePlugin.GameData.CurrentLap", s.CurrentLap);
                    Jp(sb, "DataCorePlugin.GameData.BestLapTime", s.LapBestTime, ic);
                    Jp(sb, "DataCorePlugin.GameData.CurrentLapTime", s.LapCurrentTime, ic);
                    Jp(sb, "DataCorePlugin.GameData.LastLapTime", s.LapLastTime, ic);
                    // Estimate session elapsed: current lap time + completed laps × average lap
                    double avgLap = s.LapBestTime > 0 ? s.LapBestTime : (s.LapLastTime > 0 ? s.LapLastTime : 90);
                    double sessionElapsed = s.LapCurrentTime + s.CompletedLaps * avgLap;
                    Jp(sb, "DataCorePlugin.GameData.SessionTimeSpan", sessionElapsed, ic);
                    Jp(sb, "DataCorePlugin.GameData.RemainingTime", s.SessionTimeRemain, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.SessionLapsRemaining", s.SessionLapsRemaining);
                    Jp(sb, "DataCorePlugin.GameData.TotalLaps", s.SessionLapsTotal);
                    Jp(sb, "DataCorePlugin.GameData.CarModel", Escape(s.CarModel ?? ""));

                    // ── Session summary for web dashboard ──
                    Jp(sb, "RacingDesk.Plugin.Session.Mode", (int)s.SessionMode);
                    Jp(sb, "RacingDesk.Plugin.Session.ModeName", Escape(s.SessionMode.ToString()));
                    Jp(sb, "RacingDesk.Plugin.Session.IsLapRace", s.IsLapRace ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.Session.TrackName", Escape(s.TrackName ?? ""));
                    Jp(sb, "RacingDesk.Plugin.Session.LapsTotal", s.SessionLapsTotal);
                    Jp(sb, "RacingDesk.Plugin.Session.LapsRemaining", s.SessionLapsRemaining);
                    Jp(sb, "RacingDesk.Plugin.Session.TimeRemaining", s.SessionTimeRemain, ic);
                    Jp(sb, "IRacingExtraProperties.iRacing_DriverInfo_IRating", s.IRating);
                    Jp(sb, "IRacingExtraProperties.iRacing_DriverInfo_SafetyRating", s.SafetyRating, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.EstimatedIRatingDelta", s.EstimatedIRatingDelta);
                    Jp(sb, "RacingDesk.Plugin.DS.IRatingFieldSize", s.IRatingFieldSize);
                    Jp(sb, "IRacingExtraProperties.iRacing_Opponent_Ahead_Gap", s.GapAhead, ic);
                    Jp(sb, "IRacingExtraProperties.iRacing_Opponent_Behind_Gap", s.GapBehind, ic);
                    Jp(sb, "IRacingExtraProperties.iRacing_Opponent_Ahead_Name", Escape(s.NearestAheadName ?? ""));
                    Jp(sb, "IRacingExtraProperties.iRacing_Opponent_Behind_Name", Escape(s.NearestBehindName ?? ""));
                    Jp(sb, "IRacingExtraProperties.iRacing_Opponent_Ahead_IRating", s.NearestAheadRating);
                    Jp(sb, "IRacingExtraProperties.iRacing_Opponent_Behind_IRating", s.NearestBehindRating);

                    // ── Datastream (advanced physics/performance) ──
                    Jp(sb, "RacingDesk.Plugin.DS.LatG", s.LatAccel, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.LongG", s.LongAccel, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.YawRate", s.YawRate, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.SteerTorque", s.SteeringWheelTorque, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.TrackTemp", s.TrackTemp, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.AirTemp", s.AirTemp, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.WeatherWet", s.WeatherWet ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.DS.DisplayUnits", s.DisplayUnits);
                    Jp(sb, "RacingDesk.Plugin.DS.PitboxTabCycle", _pitboxTabCycle);
                    Jp(sb, "RacingDesk.Plugin.DS.PitboxTabCycleBack", _pitboxTabCycleBack);
                    Jp(sb, "RacingDesk.Plugin.DS.PitboxNext", _pitboxNext);
                    Jp(sb, "RacingDesk.Plugin.DS.PitboxPrev", _pitboxPrev);
                    Jp(sb, "RacingDesk.Plugin.DS.PitboxIncrement", _pitboxIncrement);
                    Jp(sb, "RacingDesk.Plugin.DS.PitboxDecrement", _pitboxDecrement);
                    Jp(sb, "RacingDesk.Plugin.DS.PitboxToggle", _pitboxToggle);
                    Jp(sb, "RacingDesk.Plugin.DS.IncidentCount", s.IncidentCount);
                    Jp(sb, "RacingDesk.Plugin.DS.IncidentLimitPenalty", s.IncidentLimitPenalty);
                    Jp(sb, "RacingDesk.Plugin.DS.IncidentLimitDQ", s.IncidentLimitDQ);
                    Jp(sb, "RacingDesk.Plugin.DS.LicenseString", Escape(s.LicenseString ?? ""));
                    Jp(sb, "RacingDesk.Plugin.DS.AbsActive", s.AbsActive ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.DS.TcActive", s.TcActive ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.DS.TrackPct", s.TrackPositionPct, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.LapDelta", s.LapDeltaToBest, ic);
                    // Sector splits (legacy 3-sector + N-sector)
                    Jp(sb, "RacingDesk.Plugin.DS.CurrentSector", s.CurrentSector);
                    Jp(sb, "RacingDesk.Plugin.DS.SectorCount", s.SectorCount);
                    Jp(sb, "RacingDesk.Plugin.DS.SectorSplitS1", s.SectorSplitS1, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.SectorSplitS2", s.SectorSplitS2, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.SectorSplitS3", s.SectorSplitS3, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.SectorDeltaS1", s.SectorDeltaS1, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.SectorDeltaS2", s.SectorDeltaS2, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.SectorDeltaS3", s.SectorDeltaS3, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.SectorStateS1", s.SectorStateS1);
                    Jp(sb, "RacingDesk.Plugin.DS.SectorStateS2", s.SectorStateS2);
                    Jp(sb, "RacingDesk.Plugin.DS.SectorStateS3", s.SectorStateS3);
                    Jp(sb, "RacingDesk.Plugin.DS.SectorS2StartPct", s.SectorS2StartPct, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.SectorS3StartPct", s.SectorS3StartPct, ic);
                    // Extended individual sector properties (S4+) for dashboards expecting SectorSplitS{n}
                    if (s.SectorSplits != null && s.SectorSplits.Length > 3)
                    {
                        for (int si = 3; si < s.SectorSplits.Length; si++)
                        {
                            int sn = si + 1; // 1-based sector number
                            Jp(sb, "RacingDesk.Plugin.DS.SectorSplitS" + sn, s.SectorSplits[si], ic);
                            Jp(sb, "RacingDesk.Plugin.DS.SectorDeltaS" + sn, s.SectorDeltas[si], ic);
                            Jp(sb, "RacingDesk.Plugin.DS.SectorStateS" + sn, s.SectorStates[si]);
                        }
                    }
                    // N-sector arrays (always sent — dashboard handles any sector count)
                    if (s.SectorSplits != null)
                    {
                        sb.Append("\"RacingDesk.Plugin.DS.SectorSplits\":\"");
                        for (int si = 0; si < s.SectorSplits.Length; si++)
                        { if (si > 0) sb.Append(','); sb.Append(s.SectorSplits[si].ToString("F3", ic)); }
                        sb.Append("\",");
                        sb.Append("\"RacingDesk.Plugin.DS.SectorDeltas\":\"");
                        for (int si = 0; si < s.SectorDeltas.Length; si++)
                        { if (si > 0) sb.Append(','); sb.Append(s.SectorDeltas[si].ToString("F3", ic)); }
                        sb.Append("\",");
                        sb.Append("\"RacingDesk.Plugin.DS.SectorStates\":\"");
                        for (int si = 0; si < s.SectorStates.Length; si++)
                        { if (si > 0) sb.Append(','); sb.Append(s.SectorStates[si]); }
                        sb.Append("\",");
                        sb.Append("\"RacingDesk.Plugin.DS.SectorBests\":\"");
                        if (s.SectorBests != null)
                        {
                            for (int si = 0; si < s.SectorBests.Length; si++)
                            { if (si > 0) sb.Append(','); sb.Append(s.SectorBests[si].ToString("F3", ic)); }
                        }
                        sb.Append("\",");
                        sb.Append("\"RacingDesk.Plugin.DS.SectorBoundaryPcts\":\"");
                        if (s.SectorBoundaries != null)
                        {
                            for (int si = 0; si < s.SectorBoundaries.Length; si++)
                            { if (si > 0) sb.Append(','); sb.Append(s.SectorBoundaries[si].ToString("F6", ic)); }
                        }
                        sb.Append("\",");
                    }
                    Jp(sb, "RacingDesk.Plugin.DS.CompletedLaps", s.CompletedLaps);
                    Jp(sb, "RacingDesk.Plugin.DS.IsInPitLane", s.IsInPitLane ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.DS.SpeedKmh", s.SpeedKmh, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.PitLimiterOn", s.PitLimiterOn ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.DS.PitSpeedLimitKmh", s.PitSpeedLimitKmh, ic);

                    // ── Computed DS.* — server-side calculations ──
                    Jp(sb, "RacingDesk.Plugin.DS.ThrottleNorm", s.ThrottleNorm, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.BrakeNorm", s.BrakeNorm, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.ClutchNorm", s.ClutchNorm, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.RpmRatio", s.RpmRatio, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.FuelPct", s.FuelPct, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.FuelLapsRemaining", s.FuelLapsRemaining, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.SpeedMph", s.SpeedMph, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.PitSpeedLimitMph", s.PitSpeedLimitMph, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.IsPitSpeeding", s.IsPitSpeeding ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.DS.IsNonRaceSession", s.IsNonRaceSession ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.DS.SessionMode", (int)s.SessionMode);
                    Jp(sb, "RacingDesk.Plugin.DS.SessionModeName", Escape(s.SessionMode.ToString()));
                    Jp(sb, "RacingDesk.Plugin.DS.IsLapRace", s.IsLapRace ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.DS.IsLapInvalid", s.IsLapInvalid ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.DS.IsTimedRace", s.IsTimedRace ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.DS.IsEndOfRace", s.IsEndOfRace ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.DS.PositionDelta", s.PositionDelta);
                    Jp(sb, "RacingDesk.Plugin.DS.StartPosition", s.StartPosition);
                    Jp(sb, "RacingDesk.Plugin.DS.RemainingTimeFormatted", Escape(s.RemainingTimeFormatted ?? ""));
                    Jp(sb, "RacingDesk.Plugin.DS.SpeedDisplay", Escape(s.SpeedDisplay));
                    Jp(sb, "RacingDesk.Plugin.DS.RpmDisplay", Escape(s.RpmDisplay));
                    Jp(sb, "RacingDesk.Plugin.DS.FuelFormatted", Escape(s.FuelFormatted));
                    Jp(sb, "RacingDesk.Plugin.DS.FuelPerLapFormatted", Escape(s.FuelPerLapFormatted));
                    Jp(sb, "RacingDesk.Plugin.DS.PitSuggestion", Escape(s.PitSuggestion ?? ""));
                    Jp(sb, "RacingDesk.Plugin.DS.BBNorm", s.BBNorm, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.TCNorm", s.TCNorm, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.ABSNorm", s.ABSNorm, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.PositionDeltaDisplay", Escape(s.PositionDeltaDisplay ?? ""));
                    Jp(sb, "RacingDesk.Plugin.DS.LapDeltaDisplay", Escape(s.LapDeltaDisplay ?? ""));
                    Jp(sb, "RacingDesk.Plugin.DS.SafetyRatingDisplay", Escape(s.SafetyRatingDisplay));
                    Jp(sb, "RacingDesk.Plugin.DS.GapAheadFormatted", Escape(s.GapAheadFormatted));
                    Jp(sb, "RacingDesk.Plugin.DS.GapBehindFormatted", Escape(s.GapBehindFormatted));

                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.FrameRate", s.FrameRate, ic);
                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.SteeringWheelAngle", s.SteeringWheelAngle, ic);

                    // ── Commentary ──
                    Jp(sb, "RacingDesk.Plugin.CommentaryVisible", _engine.IsVisible ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.CommentaryText", Escape(_engine.CurrentText ?? ""));
                    Jp(sb, "RacingDesk.Plugin.CommentaryTopicTitle", Escape(_engine.CurrentTitle ?? ""));
                    Jp(sb, "RacingDesk.Plugin.CommentaryTopicId", Escape(_engine.CurrentTopicId ?? ""));
                    Jp(sb, "RacingDesk.Plugin.CommentaryCategory", Escape(category));
                    Jp(sb, "RacingDesk.Plugin.CommentarySentimentColor", Escape(_engine.CurrentSentimentColor ?? "#FF000000"));
                    Jp(sb, "RacingDesk.Plugin.CommentarySeverity", _engine.IsVisible ? _engine.CurrentSeverity : 0);
                    Jp(sb, "RacingDesk.Plugin.CommentaryTrackImage", Escape(_engine.CurrentTrackImage ?? ""));
                    Jp(sb, "RacingDesk.Plugin.CommentaryCarImage", Escape(_engine.CurrentCarImage ?? ""));

                    // ── Strategy ──
                    Jp(sb, "RacingDesk.Plugin.Strategy.Visible", _strategy.IsVisible ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.Strategy.Text", Escape(_strategy.CurrentText ?? ""));
                    Jp(sb, "RacingDesk.Plugin.Strategy.Label", Escape(_strategy.CurrentLabel ?? ""));
                    Jp(sb, "RacingDesk.Plugin.Strategy.Severity", _strategy.CurrentSeverity);
                    Jp(sb, "RacingDesk.Plugin.Strategy.Color", Escape(Engine.Strategy.StrategyCoordinator.StrategyColor));
                    Jp(sb, "RacingDesk.Plugin.Strategy.TextColor", Escape(Engine.Strategy.StrategyCoordinator.StrategyTextColor));
                    Jp(sb, "RacingDesk.Plugin.Strategy.FuelLapsRemaining", _strategy.Fuel.FuelLapsRemaining, ic);
                    Jp(sb, "RacingDesk.Plugin.Strategy.FuelHealthState", _strategy.Fuel.FuelHealthState);
                    Jp(sb, "RacingDesk.Plugin.Strategy.CanMakeItToEnd", _strategy.Fuel.CanMakeItToEnd ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.Strategy.PitWindowOpen", _strategy.Fuel.PitWindowOpen);
                    Jp(sb, "RacingDesk.Plugin.Strategy.PitWindowClose", _strategy.Fuel.PitWindowClose);
                    Jp(sb, "RacingDesk.Plugin.Strategy.TireHealthState", _strategy.Tires.TireHealthState);
                    Jp(sb, "RacingDesk.Plugin.Strategy.TireLapsRemaining", _strategy.Tires.EstimatedLapsRemaining, ic);
                    Jp(sb, "RacingDesk.Plugin.Strategy.GripScore", _strategy.Tires.GripScore, ic);
                    Jp(sb, "RacingDesk.Plugin.Strategy.StintNumber", _strategy.StintCount);
                    Jp(sb, "RacingDesk.Plugin.Strategy.StintLaps", _strategy.CurrentStint != null ? _strategy.CurrentStint.LapsCompleted : 0);

                    // ── Incident Coach ──
                    Jp(sb, "RacingDesk.Plugin.DS.IncidentCoach.Active", _incidentCoach.Enabled ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.DS.IncidentCoach.LastIncidentLap", _incidentCoach.LastIncidentLap);
                    // Raw JSON objects — NOT string-escaped, injected directly
                    sb.AppendFormat("  \"RacingDesk.Plugin.DS.IncidentCoach.ThreatDrivers\":{0},\n", _incidentCoach.ThreatDriversJson ?? "[]");
                    sb.AppendFormat("  \"RacingDesk.Plugin.DS.IncidentCoach.ActiveAlert\":{0},\n", _incidentCoach.ActiveAlertJson ?? "{}");
                    Jp(sb, "RacingDesk.Plugin.DS.IncidentCoach.RageScore", _incidentCoach.RageScore, ic);
                    Jp(sb, "RacingDesk.Plugin.DS.IncidentCoach.CooldownActive", _incidentCoach.IsCooldownActive ? 1 : 0);
                    sb.AppendFormat("  \"RacingDesk.Plugin.DS.IncidentCoach.SessionBehavior\":{0},\n", _incidentCoach.SessionBehaviorJson ?? "{}");

                    // ── Demo mode ──
                    Jp(sb, "RacingDesk.Plugin.DemoMode", demo ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.Demo.Gear", Escape(dt.Gear ?? "N"));
                    Jp(sb, "RacingDesk.Plugin.Demo.Rpm", dt.Rpm, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.MaxRpm", dt.MaxRpm, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.SpeedMph", dt.SpeedMph, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.Throttle", dt.Throttle * 100, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.Brake", dt.Brake * 100, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.Clutch", dt.Clutch * 100, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.Fuel", dt.Fuel, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.MaxFuel", dt.MaxFuel, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.FuelPerLap", dt.FuelPerLap, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.RemainingLaps", dt.RemainingLaps, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.TyreTempFL", dt.TyreTempFL, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.TyreTempFR", dt.TyreTempFR, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.TyreTempRL", dt.TyreTempRL, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.TyreTempRR", dt.TyreTempRR, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.TyreWearFL", dt.TyreWearFL, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.TyreWearFR", dt.TyreWearFR, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.TyreWearRL", dt.TyreWearRL, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.TyreWearRR", dt.TyreWearRR, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.BrakeBias", dt.BrakeBias, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.TC", dt.TC, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.ABS", dt.ABS, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.SessionTypeName", Escape(dt.SessionTypeName ?? ""));
                    Jp(sb, "RacingDesk.Plugin.Demo.SessionMode", (int)dt.SessionMode);
                    Jp(sb, "RacingDesk.Plugin.Demo.SessionModeName", Escape(dt.SessionMode.ToString()));
                    Jp(sb, "RacingDesk.Plugin.Demo.Position", dt.Position);
                    Jp(sb, "RacingDesk.Plugin.Demo.CurrentLap", dt.CurrentLap);
                    Jp(sb, "RacingDesk.Plugin.Demo.BestLapTime", dt.BestLapTime, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.CurrentLapTime", dt.CurrentLapTime, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.CarModel", Escape(dt.CarModel ?? ""));
                    Jp(sb, "RacingDesk.Plugin.Demo.SessionTime", dt.SessionTime, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.LastLapTime", dt.LastLapTime, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.RemainingTime", dt.RemainingTime, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.TotalLaps", dt.TotalLaps);
                    Jp(sb, "RacingDesk.Plugin.Demo.IRating", dt.IRating);
                    Jp(sb, "RacingDesk.Plugin.Demo.SafetyRating", dt.SafetyRating, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.GapAhead", dt.GapAhead, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.GapBehind", dt.GapBehind, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.DriverAhead", Escape(dt.DriverAhead ?? ""));
                    Jp(sb, "RacingDesk.Plugin.Demo.DriverBehind", Escape(dt.DriverBehind ?? ""));
                    Jp(sb, "RacingDesk.Plugin.Demo.IRAhead", dt.IRAhead);
                    Jp(sb, "RacingDesk.Plugin.Demo.IRBehind", dt.IRBehind);

                    // ── Demo Datastream ──
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.LatG", dt.LatG, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.LongG", dt.LongG, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.YawRate", dt.YawRate, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.SteerTorque", dt.SteerTorque, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.TrackTemp", dt.TrackTemp, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.IncidentCount", dt.IncidentCount);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.AbsActive", dt.AbsActive ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.TcActive", dt.TcActive ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.LapDelta", dt.LapDelta, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.IsInPitLane", dt.IsInPitLane ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.SessionMode", (int)dt.SessionMode);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.SessionModeName", Escape(dt.SessionMode.ToString()));
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.IsLapRace", dt.IsLapRace ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.IsLapInvalid", dt.IsLapInvalid ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.SectorBests", "");
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.SpeedKmh", dt.SpeedKmh, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.PitLimiterOn", dt.IsInPitLane ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.PitSpeedLimitKmh", 72.0, ic);

                    // ── Demo Computed DS.* ──
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.ThrottleNorm", dt.ThrottleNorm, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.BrakeNorm", dt.BrakeNorm, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.ClutchNorm", dt.ClutchNorm, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.RpmRatio", dt.RpmRatio, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.FuelPct", dt.FuelPct, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.FuelLapsRemaining", dt.FuelLapsRemaining, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.SpeedMph", dt.SpeedMph, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.PitSpeedLimitMph", dt.PitSpeedLimitMph, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.IsPitSpeeding", dt.IsPitSpeeding ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.IsNonRaceSession", dt.IsNonRaceSession ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.IsTimedRace", dt.IsTimedRace ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.IsEndOfRace", dt.IsEndOfRace ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.PositionDelta", dt.PositionDelta);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.StartPosition", dt.StartPosition);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.RemainingTimeFormatted", Escape(dt.RemainingTimeFormatted ?? ""));
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.SpeedDisplay", Escape(dt.SpeedDisplay));
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.RpmDisplay", Escape(dt.RpmDisplay));
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.FuelFormatted", Escape(dt.FuelFormatted));
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.FuelPerLapFormatted", Escape(dt.FuelPerLapFormatted));
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.PitSuggestion", Escape(dt.PitSuggestion ?? ""));
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.BBNorm", dt.BBNorm, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.TCNorm", dt.TCNorm, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.ABSNorm", dt.ABSNorm, ic);
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.PositionDeltaDisplay", Escape(dt.PositionDeltaDisplay ?? ""));
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.LapDeltaDisplay", Escape(dt.LapDeltaDisplay ?? ""));
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.SafetyRatingDisplay", Escape(dt.SafetyRatingDisplay));
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.GapAheadFormatted", Escape(dt.GapAheadFormatted));
                    Jp(sb, "RacingDesk.Plugin.Demo.DS.GapBehindFormatted", Escape(dt.GapBehindFormatted));

                    // ── Grid / Formation state ──
                    Jp(sb, "RacingDesk.Plugin.Grid.SessionState", s.SessionState);
                    // Only where the sim says: a key that is sent is believed, and a constant 0 would hide the HUD for good.
                    if (s.InCar.HasValue) Jp(sb, "DataCorePlugin.GameRawData.Telemetry.IsOnTrack", s.InCar.Value ? 1 : 0);
                    // iRacing's flag field, whole, as it was published (an unsigned number): only where the sim said it, never in demo.
                    if (!demo && s.GameRunning && s.SessionFlagsRaw.HasValue) Jp(sb, Transport.TelemetryFrame.SessionFlagsKey, (long)s.SessionFlagsRaw.Value);
                    // The car's controls by the canonical list: a JSON object, and only for a car the list has.
                    if (!demo && !string.IsNullOrEmpty(s.CarControlsJson))
                        sb.Append('"').Append(Transport.TelemetryFrame.CarControlsKey).Append("\":").Append(s.CarControlsJson).Append(",\n");
                    Jp(sb, "RacingDesk.Plugin.Grid.GriddedCars", s.GriddedCars);
                    Jp(sb, "RacingDesk.Plugin.Grid.TotalCars", s.TotalCars);
                    Jp(sb, "RacingDesk.Plugin.Grid.PaceMode", s.PaceMode);
                    // Start type: read from iRacing WeekendOptions via shared memory
                    Jp(sb, "RacingDesk.Plugin.Grid.StartType", Escape(s.IsStandingStart ? "standing" : "rolling"));
                    // Lights phase: synthesized from PaceMode/SessionState transitions
                    Jp(sb, "RacingDesk.Plugin.Grid.LightsPhase", _lightsPhase);
                    Jp(sb, "RacingDesk.Plugin.Grid.TrackCountry", Escape(s.TrackCountry ?? ""));

                    // ── Demo Grid state ──
                    Jp(sb, "RacingDesk.Plugin.Demo.Grid.SessionState", dt.SessionState);
                    Jp(sb, "RacingDesk.Plugin.Demo.Grid.GriddedCars", dt.GriddedCars);
                    Jp(sb, "RacingDesk.Plugin.Demo.Grid.TotalCars", dt.TotalCars);
                    Jp(sb, "RacingDesk.Plugin.Demo.Grid.PaceMode", dt.PaceMode);
                    Jp(sb, "RacingDesk.Plugin.Demo.Grid.LightsPhase", dt.LightsPhase);
                    Jp(sb, "RacingDesk.Plugin.Demo.Grid.StartType", Escape(dt.IsStandingStart ? "standing" : "rolling"));
                    Jp(sb, "RacingDesk.Plugin.Demo.Grid.TrackCountry", Escape(dt.TrackCountry ?? ""));

                    // ── Driver name (for leaderboard display) ──
                    // Prefer live player name from game data; fall back to settings
                    string livePlayerName = s.PlayerName ?? "";
                    if (!string.IsNullOrEmpty(livePlayerName))
                    {
                        // Split "First Last" into first/last for dashboard display
                        var nameParts = livePlayerName.Trim().Split(new[] { ' ' }, 2);
                        Jp(sb, "RacingDesk.Plugin.DriverFirstName", Escape(nameParts[0]));
                        Jp(sb, "RacingDesk.Plugin.DriverLastName", Escape(nameParts.Length > 1 ? nameParts[1] : ""));
                    }
                    else
                    {
                        Jp(sb, "RacingDesk.Plugin.DriverFirstName", Escape(Settings.DriverFirstName ?? ""));
                        Jp(sb, "RacingDesk.Plugin.DriverLastName", Escape(Settings.DriverLastName ?? ""));
                    }

                    // ── Track map ──
                    Jp(sb, "RacingDesk.Plugin.TrackMap.Ready", _trackMap.IsReady ? 1 : 0);
                    Jp(sb, "RacingDesk.Plugin.TrackMap.TrackName", Escape(_trackMap.TrackName ?? ""));
                    Jp(sb, "RacingDesk.Plugin.TrackMap.TrackSlug", Escape(_lastRawTrackSlug ?? ""));
                    Jp(sb, "RacingDesk.Plugin.TrackMap.TrackDisplayName", Escape(s.TrackDisplayName ?? ""));
                    Jp(sb, "RacingDesk.Plugin.TrackMap.SvgPath", Escape(_trackMap.SvgPath ?? ""));
                    Jp(sb, "RacingDesk.Plugin.TrackMap.PlayerX", _trackMap.PlayerX, ic);
                    Jp(sb, "RacingDesk.Plugin.TrackMap.PlayerY", _trackMap.PlayerY, ic);
                    Jp(sb, "RacingDesk.Plugin.TrackMap.PlayerHeading", _trackMap.PlayerHeadingDeg, ic);
                    Jp(sb, "RacingDesk.Plugin.TrackMap.Opponents", Escape(_trackMap.OpponentData ?? ""));

                    // ── Leaderboard ──
                    // Raw JSON array — NOT string-escaped, injected directly
                    sb.AppendFormat("\"RacingDesk.Plugin.Leaderboard\":{0},\n", _leaderboardJson ?? "[]");

                    // ── Extra (homebridge / legacy) ──
                    Jp(sb, "currentFlagState", Escape(flagState));
                    Jp(sb, "nearestCarDistance", nearestDist, ic);

                    // ── Ambient light — screen color sampled by ScreenColorSampler ──
                    Jp(sb, "RacingDesk.Plugin.DS.AmbientR", _screenColorSampler.HasColor ? _screenColorSampler.R : 0);
                    Jp(sb, "RacingDesk.Plugin.DS.AmbientG", _screenColorSampler.HasColor ? _screenColorSampler.G : 0);
                    Jp(sb, "RacingDesk.Plugin.DS.AmbientB", _screenColorSampler.HasColor ? _screenColorSampler.B : 0);
                    Jp(sb, "RacingDesk.Plugin.DS.AmbientHasData", _screenColorSampler.HasColor ? 1 : 0);

                    // ── Moza hardware summary ──
                    if (_mozaSerial != null)
                    {
                        _mozaSerial.AppendPollSummary(sb, Jp, Jp);
                    }

                    // ── Pedal profile curves (for dashboard visualization) ──
                    if (_pedalProfiles != null)
                    {
                        sb.AppendFormat("\"RacingDesk.Plugin.DS.PedalProfile\":{0},\n",
                            _pedalProfiles.GetDashboardJson());
                    }

                    // Remove trailing comma and close
                    if (sb.Length > 2 && sb[sb.Length - 2] == ',')
                        sb.Remove(sb.Length - 2, 1); // remove last comma
                    sb.Append("}");

                    byte[] buf = Encoding.UTF8.GetBytes(sb.ToString());
                    ctx.Response.ContentType = "application/json";
                    ctx.Response.ContentLength64 = buf.Length;
                    ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                    ctx.Response.OutputStream.Write(buf, 0, buf.Length);
                }
                catch (Exception ex)
                {
                    Log.Warn($"[RacingDesk] HTTP handler error: {ex.Message}");
                }
                finally
                {
                    // A host route that answers asynchronously owns the response and closes it itself.
                    if (!responseHandedOff)
                    {
                        try { ctx.Response.OutputStream.Close(); }
                        catch (Exception ex)
                        {
                            Log.Warn($"[RacingDesk] Response output stream close failed: {ex.Message}");
                        }
                    }
                }
            }
        }

        // JSON property helpers — avoid pulling in Newtonsoft for a simple flat map
        private static void Jp(StringBuilder sb, string key, int val)
            => sb.Append($"  \"{key}\": {val},\n");
        private static void Jp(StringBuilder sb, string key, long val)
            => sb.Append($"  \"{key}\": {val.ToString(System.Globalization.CultureInfo.InvariantCulture)},\n");
        private static void Jp(StringBuilder sb, string key, double val, System.Globalization.CultureInfo ic)
            => sb.Append($"  \"{key}\": {val.ToString("G", ic)},\n");
        private static void Jp(StringBuilder sb, string key, string val)
            => sb.Append($"  \"{key}\": \"{val}\",\n");

        internal static string Escape(string s) =>
            s?.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "") ?? "";

        private string ResolveTopicsPath()
        {
            if (!string.IsNullOrEmpty(Settings.TopicsFilePath) && File.Exists(Settings.TopicsFilePath))
                return Settings.TopicsFilePath;
            return ResolveDatasetFile("commentary_topics.json");
        }

        private string ResolveDatasetFile(string filename)
        {
            string dllDir = _options.AssemblyDirectory ?? "";
            string candidate = Path.Combine(dllDir, "racingdesk-data", filename);
            if (File.Exists(candidate)) return candidate;

            string pluginsData = Path.Combine(_options.PluginsDataDirectory ?? "", filename);
            if (File.Exists(pluginsData)) return pluginsData;

            Log.Warn($"[RacingDesk] {filename} not found in racingdesk-data folder");
            return "";
        }

        // ═══════════════════════════════════════════════════════════════
        //  MOZA HARDWARE — HTTP SETTING WRITE HELPERS
        // ═══════════════════════════════════════════════════════════════

        /// <summary>
        /// Parses a key/value pair and writes the corresponding wheelbase setting.
        /// Keys match the property names in MozaWheelbaseSettings.
        /// </summary>
        private bool ApplyMozaWheelbaseSetting(string key, string valueStr)
        {
            if (_mozaSerial == null || string.IsNullOrEmpty(key)) return false;
            if (!int.TryParse(valueStr, out int value)) return false;

            byte deviceId = MozaDeviceRegistry.DeviceWheelbase;
            switch (key.ToLowerInvariant())
            {
                case "ffbstrength": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.WheelbaseCmd.FfbStrength, (byte)value); return true;
                case "maxtorque": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.WheelbaseCmd.MaxTorque, (byte)value); return true;
                case "roadsensitivity": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.WheelbaseCmd.RoadSensitivity, (byte)value); return true;
                case "speeddamping": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.WheelbaseCmd.SpeedDamping, (byte)value); return true;
                case "minrotationangle": _mozaSerial.WriteSetting16(deviceId, MozaDeviceRegistry.WheelbaseCmd.MinRotationAngle, (ushort)value); return true;
                case "maxrotationangle": _mozaSerial.WriteSetting16(deviceId, MozaDeviceRegistry.WheelbaseCmd.MaxRotationAngle, (ushort)value); return true;
                case "softlock": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.WheelbaseCmd.SoftLock, (byte)value); return true;
                case "friction": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.WheelbaseCmd.Friction, (byte)value); return true;
                case "spring": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.WheelbaseCmd.Spring, (byte)value); return true;
                case "damper": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.WheelbaseCmd.Damper, (byte)value); return true;
                case "inertia": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.WheelbaseCmd.Inertia, (byte)value); return true;
                case "tempprotection": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.WheelbaseCmd.TempProtection, (byte)value); return true;
                case "handsoffprotection": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.WheelbaseCmd.HandsOffProtection, (byte)value); return true;
                default: return false;
            }
        }

        /// <summary>
        /// Parses a key/value pair and writes the corresponding pedal setting.
        /// Key format: "{axis}.{setting}" e.g., "throttle.deadzone", "brake.curveY3"
        /// </summary>
        private bool ApplyMozaPedalSetting(string key, string valueStr)
        {
            if (_mozaSerial == null || string.IsNullOrEmpty(key)) return false;
            if (!int.TryParse(valueStr, out int value)) return false;

            var parts = key.Split('.');
            if (parts.Length != 2) return false;

            MozaDeviceRegistry.PedalAxis axis;
            switch (parts[0].ToLowerInvariant())
            {
                case "throttle": axis = MozaDeviceRegistry.PedalAxis.Throttle; break;
                case "brake": axis = MozaDeviceRegistry.PedalAxis.Brake; break;
                case "clutch": axis = MozaDeviceRegistry.PedalAxis.Clutch; break;
                default: return false;
            }

            byte deviceId = MozaDeviceRegistry.DevicePedals;
            byte offset;
            bool isTwoByte = false;
            switch (parts[1].ToLowerInvariant())
            {
                case "calibrationmin": offset = MozaDeviceRegistry.PedalCmd.CalibrationMin; isTwoByte = true; break;
                case "calibrationmax": offset = MozaDeviceRegistry.PedalCmd.CalibrationMax; isTwoByte = true; break;
                case "deadzone": offset = MozaDeviceRegistry.PedalCmd.Deadzone; break;
                case "curvey1": offset = MozaDeviceRegistry.PedalCmd.CurveY1; break;
                case "curvey2": offset = MozaDeviceRegistry.PedalCmd.CurveY2; break;
                case "curvey3": offset = MozaDeviceRegistry.PedalCmd.CurveY3; break;
                case "curvey4": offset = MozaDeviceRegistry.PedalCmd.CurveY4; break;
                case "curvey5": offset = MozaDeviceRegistry.PedalCmd.CurveY5; break;
                case "hidsource": offset = MozaDeviceRegistry.PedalCmd.HidSource; break;
                default: return false;
            }

            byte cmdId = MozaDeviceRegistry.PedalCmd.GetCommand(axis, offset);
            if (isTwoByte)
                _mozaSerial.WriteSetting16(deviceId, cmdId, (ushort)value);
            else
                _mozaSerial.WriteSetting(deviceId, cmdId, (byte)value);
            return true;
        }

        /// <summary>
        /// Parses a key/value pair and writes the corresponding handbrake setting.
        /// </summary>
        private bool ApplyMozaHandbrakeSetting(string key, string valueStr)
        {
            if (_mozaSerial == null || string.IsNullOrEmpty(key)) return false;
            if (!int.TryParse(valueStr, out int value)) return false;

            byte deviceId = MozaDeviceRegistry.DeviceHandbrake;
            switch (key.ToLowerInvariant())
            {
                case "calibrationmin": _mozaSerial.WriteSetting16(deviceId, MozaDeviceRegistry.HandbrakeCmd.CalibrationMin, (ushort)value); return true;
                case "calibrationmax": _mozaSerial.WriteSetting16(deviceId, MozaDeviceRegistry.HandbrakeCmd.CalibrationMax, (ushort)value); return true;
                case "deadzone": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.HandbrakeCmd.Deadzone, (byte)value); return true;
                case "curvey1": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.HandbrakeCmd.CurveY1, (byte)value); return true;
                case "curvey2": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.HandbrakeCmd.CurveY2, (byte)value); return true;
                case "curvey3": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.HandbrakeCmd.CurveY3, (byte)value); return true;
                case "curvey4": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.HandbrakeCmd.CurveY4, (byte)value); return true;
                case "curvey5": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.HandbrakeCmd.CurveY5, (byte)value); return true;
                case "buttonthreshold": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.HandbrakeCmd.ButtonThreshold, (byte)value); return true;
                case "outputmode": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.HandbrakeCmd.OutputMode, (byte)value); return true;
                default: return false;
            }
        }
    }
}
