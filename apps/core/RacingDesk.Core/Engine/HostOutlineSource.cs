using System;
using System.Collections.Generic;
using System.Globalization;
using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;
using Newtonsoft.Json.Linq;

namespace RacingDesk.Plugin.Engine
{
    /// <summary>
    /// The SimHub plugin's outline source: the app's host, beside SimHub on loopback, serves the store's outlines
    /// at <c>/racing-desk/data/outline?track=&lt;TrackID&gt;</c>. The host is the only process that reads the
    /// driver's .ibt files and the store; the plugin, inside SimHub, asks it and reads no file. A 404 is "no outline
    /// yet" (null); a host that cannot be reached throws, and the map says so. Whether anything listens at the host's
    /// port on this machine is looked at first (<see cref="Reachable"/>), so that with the app closed the map asks
    /// nobody, and nothing is thrown for SimHub to log with its stack.
    /// </summary>
    public sealed class HostOutlineSource : IOutlineSource, IOutlineSourceReachability, IDisposable
    {
        /// <summary>Where the app's host runs beside SimHub, unless the settings say another.</summary>
        public const string DefaultHostUrl = "http://127.0.0.1:18889";

        private readonly HttpClient _http;
        private readonly string _baseUrl;

        public HostOutlineSource(string hostUrl, TimeSpan? timeout = null)
        {
            _baseUrl = (string.IsNullOrWhiteSpace(hostUrl) ? DefaultHostUrl : hostUrl.Trim()).TrimEnd('/');
            _http = new HttpClient { Timeout = timeout ?? TimeSpan.FromSeconds(2) };
        }

        /// <summary>
        /// False when the host's address is this machine's and nothing listens at its port (the app is not running):
        /// read from Windows' table of listening ports, which throws nothing. True for an address elsewhere, where only
        /// asking can tell.
        /// </summary>
        public bool Reachable()
        {
            if (!Uri.TryCreate(_baseUrl, UriKind.Absolute, out var uri) || !uri.IsLoopback) return true;
            try
            {
                foreach (var listener in IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners())
                    if (listener.Port == uri.Port && (IPAddress.IsLoopback(listener.Address) ||
                        listener.Address.Equals(IPAddress.Any) || listener.Address.Equals(IPAddress.IPv6Any)))
                        return true;
                return false;
            }
            catch (NetworkInformationException)
            {
                return true;
            }
        }

        public string Url(int trackId) => _baseUrl + "/racing-desk/data/outline?track=" + trackId.ToString(CultureInfo.InvariantCulture);

        public TrackOutline Get(int trackId)
        {
            using (var response = _http.GetAsync(Url(trackId)).GetAwaiter().GetResult())
            {
                if (response.StatusCode == System.Net.HttpStatusCode.NotFound) return null;
                response.EnsureSuccessStatusCode();
                string body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                return Parse(body);
            }
        }

        /// <summary>The route's JSON as an outline; null for a body with no points in it.</summary>
        public static TrackOutline Parse(string json)
        {
            var o = JObject.Parse(json);
            var pts = o["points"] as JArray;
            if (pts == null || pts.Count < 10) return null;
            var points = new (double X, double Z, double Pct)[pts.Count];
            for (int i = 0; i < pts.Count; i++)
            {
                var p = pts[i] as JArray;
                if (p == null || p.Count < 3) return null;
                points[i] = ((double)p[0], (double)p[1], (double)p[2]);
            }
            return new TrackOutline
            {
                TrackId = (int?)o["trackId"] ?? 0,
                CleanLaps = (int?)o["cleanLaps"] ?? 0,
                LengthMeters = (double?)o["lengthM"] ?? 0,
                OfficialLengthMeters = (double?)o["officialLengthM"] ?? 0,
                Provisional = (bool?)o["provisional"] ?? false,
                Crowd = (bool?)o["crowd"] ?? false,
                UpdatedAtUtc = DateTime.TryParse((string)o["updatedAt"], CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var at) ? at : DateTime.MinValue,
                Points = points,
            };
        }

        public void Dispose() => _http.Dispose();
    }
}
