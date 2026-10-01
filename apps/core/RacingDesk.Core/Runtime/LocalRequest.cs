using System;
using System.Collections.Specialized;
using System.Net;

namespace RacingDesk.Plugin
{
    /// <summary>
    /// Who is asking, for the routes that act on this machine: the runtime's <c>?action=</c> routes (they write to the
    /// wheel base and the pedals, change the pedal profiles and the runtime's state, and several of the reads ask the
    /// hardware) and the host's one write, <c>POST /racing-desk/data/pedals</c>. :8889 and :18889 answer every address, so
    /// that the iPad view can read the telemetry, and these are for a program on this machine and for nothing else.
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
        public static bool NamesThisMachine(string hostHeader)
        {
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
    }
}
