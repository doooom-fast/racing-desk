using System;
using System.Collections.Specialized;
using System.Globalization;
using System.Net;

namespace RacingDesk.Plugin
{
    /// <summary>
    /// Who is asking, for the routes that act on this machine: the runtime's <c>?action=</c> routes (they write to the
    /// wheel base and the pedals, change the pedal profiles and the runtime's state, and several of the reads ask the
    /// hardware) and the host's one write, <c>POST /racing-desk/data/pedals</c>. :8889 and :18889 answer every address, so
    /// that the iPad view can read the telemetry, and these are for a program on this machine and for nothing else.
    ///
    /// The host's reads (<c>/racing-desk/data/…</c>: the sessions with the driver's customer id, the store's path) are
    /// for this machine too, by a rule of their own (<see cref="RefusalOfRead(bool, NameValueCollection, int)"/>): the
    /// desk's page reads them and a page says an Origin, so the browser test above does not apply to them — a page of
    /// the app is let through, a page of any other origin is not.
    /// </summary>
    public static class LocalRequest
    {
        /// <summary>Whether <paramref name="request"/> is from a program on this machine: see <see cref="IsFromThisMachine(bool, NameValueCollection)"/>.</summary>
        public static bool IsFromThisMachine(HttpListenerRequest request) =>
            request != null && IsFromThisMachine(request.IsLocal, request.Headers);

        /// <summary>
        /// Whether a request is from a program on this machine: the connection is the machine's own (<c>IsLocal</c>: its
        /// two addresses are the same, or loopback — which a LAN device that says <c>Host: localhost</c> is not), the Host
        /// it names is localhost, 127.0.0.1 or [::1] (a name pointed at the machine by another site is not), and it was
        /// not sent by a browser (<see cref="SaysItIsABrowser"/>).
        /// </summary>
        public static bool IsFromThisMachine(bool isLocal, NameValueCollection headers)
        {
            if (!isLocal || headers == null || SaysItIsABrowser(headers)) return false;
            return NamesThisMachine(headers["Host"]);
        }

        /// <summary>
        /// Whether a browser sent the request. A page's script says where it came from (<c>Origin</c>, and <c>null</c> for a
        /// page that has none, such as the HUD's own); and a browser says what a request is for on every one it makes,
        /// including the ones a page cannot add a header to — a link, an image, a form (<c>Sec-Fetch-Site</c>,
        /// <c>-Dest</c> and <c>-User</c>, and <c>Referer</c>). A program says none of them: Node's own fetch sends
        /// <c>Sec-Fetch-Mode</c> and no more, so that one alone is not a browser. The same test as the app's remote server
        /// makes of what is sent to its actions.
        /// </summary>
        public static bool SaysItIsABrowser(NameValueCollection headers)
        {
            if (headers == null) return false;
            foreach (string name in new[] { "Origin", "Referer", "Sec-Fetch-Site", "Sec-Fetch-Dest", "Sec-Fetch-User" })
                if (!string.IsNullOrEmpty(headers[name])) return true;
            return false;
        }

        /// <summary>Whether a Host header names this machine as localhost, 127.0.0.1 or [::1], with or without a port.</summary>
        public static bool NamesThisMachine(string hostHeader) =>
            TrySplitHost(hostHeader, out string host, out _) && IsThisMachinesName(host);

        /// <summary>
        /// Whether a Host header names this machine (as <see cref="NamesThisMachine"/>) at the port the connection came in
        /// on: <c>localhost:8889</c> for a request to :8889. A request that leaves the port out, or names another, is not
        /// one a program on this machine makes to this port.
        /// </summary>
        public static bool NamesThisMachineOnPort(string hostHeader, int port)
        {
            if (port <= 0 || !TrySplitHost(hostHeader, out string host, out string portText) || !IsThisMachinesName(host)) return false;
            return int.TryParse(portText, NumberStyles.None, CultureInfo.InvariantCulture, out int named) && named == port;
        }

        private static bool IsThisMachinesName(string host) =>
            host.Equals("localhost", StringComparison.OrdinalIgnoreCase) || host == "127.0.0.1" || host == "[::1]";

        /// <summary>A Host header as its name and its port (empty when it gives none); false for one that is not a Host at all.</summary>
        private static bool TrySplitHost(string hostHeader, out string host, out string port)
        {
            host = null;
            port = "";
            if (string.IsNullOrWhiteSpace(hostHeader)) return false;

            host = hostHeader.Trim();
            if (host.StartsWith("[", StringComparison.Ordinal))
            {
                int close = host.IndexOf(']');
                if (close < 0) return false;
                string rest = host.Substring(close + 1);
                if (rest.Length > 0 && rest[0] != ':') return false;
                if (rest.Length > 0) port = rest.Substring(1);
                host = host.Substring(0, close + 1);
            }
            else
            {
                int colon = host.LastIndexOf(':');
                if (colon >= 0)
                {
                    port = host.Substring(colon + 1);
                    host = host.Substring(0, colon);
                }
            }
            return true;
        }

        // ── The host's reads ─────────────────────────────────────────

        /// <summary>
        /// The origins of the app's own pages, the only ones the host's reads answer by CORS: the desk and the HUD are files
        /// (<c>loadFile</c>), and a page that is a file says <c>Origin: null</c>. The iPad's HUD is served by the app's own
        /// server and reads the telemetry through it, never these routes.
        /// </summary>
        public static readonly string[] AppOrigins = { "null" };

        /// <summary>Why a request to the host's data was refused: see <see cref="RefusalOfRead(bool, NameValueCollection, int)"/>.</summary>
        public enum Refusal
        {
            /// <summary>Not refused.</summary>
            None,
            /// <summary>The connection is not this machine's own: a device on the network.</summary>
            AnotherMachine,
            /// <summary>The Host names something other than this machine at this port: an address on the network, or a name another site has pointed at the rig.</summary>
            AnotherHost,
            /// <summary>The request names the origin of a web site: a page in a browser that is not the app's own.</summary>
            AWebSite,
            /// <summary>A browser sent it, where only a program may ask: the routes that are not reads.</summary>
            ABrowser,
        }

        /// <summary>The request as <see cref="RefusalOfRead(bool, NameValueCollection, int)"/> sees it; one that is not there is another machine's.</summary>
        public static Refusal RefusalOfRead(HttpListenerRequest request) =>
            request == null ? Refusal.AnotherMachine : RefusalOfRead(request.IsLocal, request.Headers, request.LocalEndPoint?.Port ?? 0);

        /// <summary>
        /// Whether a read of the host's data (<c>/racing-desk/data/…</c>) may be answered. They carry the driver's customer id
        /// and the store's path, and :8889 answers every address, so a read is answered only to this machine: the connection
        /// is its own (<c>IsLocal</c>), the Host names it at the port the request came in on, and the Origin, when there is
        /// one, is one of the app's own pages (<see cref="AppOrigins"/>) and not that of a web site open on the rig. Unlike
        /// <see cref="IsFromThisMachine(bool, NameValueCollection)"/> it does not turn away a browser's other marks: the desk
        /// is a page and carries them (<c>Sec-Fetch-*</c>); the origin is what a page is told apart by, and what it may
        /// read by CORS.
        /// </summary>
        /// <param name="port">The port the request came in on (<c>LocalEndPoint.Port</c>).</param>
        public static Refusal RefusalOfRead(bool isLocal, NameValueCollection headers, int port)
        {
            if (!isLocal || headers == null) return Refusal.AnotherMachine;
            if (!NamesThisMachineOnPort(headers["Host"], port)) return Refusal.AnotherHost;
            return AnswersToOrigin(headers["Origin"]) ? Refusal.None : Refusal.AWebSite;
        }

        /// <summary>Whether a read from this Origin is answered: no Origin (a program) or one of <see cref="AppOrigins"/>.</summary>
        public static bool AnswersToOrigin(string origin)
        {
            if (string.IsNullOrEmpty(origin)) return true;
            foreach (string own in AppOrigins)
                if (string.Equals(origin, own, StringComparison.Ordinal)) return true;
            return false;
        }
    }
}
