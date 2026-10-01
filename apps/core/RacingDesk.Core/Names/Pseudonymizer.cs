using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using IRSDKSharper;

namespace RacingDesk.Core.Names
{
    /// <summary>
    /// One session's names for the other drivers. A driver is named by a salted hash of their customer id
    /// (<see cref="PseudonymBook"/>): the same id gets the same first choice on this machine every time, and when another
    /// driver in this session already holds it, the next probe of the hash until a name is free. A name once given is kept
    /// for the session, so a rival is the same character all race; the session changes when its key does
    /// (<see cref="BeginSession"/>: iRacing's SessionID and SubSessionID). The real name goes nowhere: it is not stored, not
    /// logged, and never the answer. A driver with no customer id is keyed on their name, salted the same way.
    /// </summary>
    public sealed class Pseudonymizer
    {
        private readonly PseudonymBook _book;
        private readonly object _gate = new object();
        private readonly Dictionary<string, string> _byKey = new Dictionary<string, string>(StringComparer.Ordinal);
        private readonly HashSet<string> _taken = new HashSet<string>(StringComparer.Ordinal);
        private string _sessionKey;

        public Pseudonymizer(PseudonymBook book)
        {
            _book = book ?? throw new ArgumentNullException(nameof(book));
        }

        public PseudonymBook Book => _book;

        /// <summary>The key of the session whose names these are; null before any.</summary>
        public string SessionKey { get { lock (_gate) return _sessionKey; } }

        /// <summary>How many drivers have a name in this session.</summary>
        public int Named { get { lock (_gate) return _byKey.Count; } }

        /// <summary>
        /// Begins a session: a key other than the current one forgets the names given so far, so the next session's
        /// drivers get their first choices again. The same key changes nothing.
        /// </summary>
        public void BeginSession(string key)
        {
            lock (_gate) BeginSessionLocked(key);
        }

        private void BeginSessionLocked(string key)
        {
            key = key ?? "";
            if (string.Equals(_sessionKey, key, StringComparison.Ordinal)) return;
            _sessionKey = key;
            _byKey.Clear();
            _taken.Clear();
        }

        /// <summary>
        /// The name shown for another driver: a character from the list, the same whenever this customer id is seen on
        /// this machine, and not the same as any other driver's in this session. Never <paramref name="realName"/>.
        /// </summary>
        /// <param name="custId">iRacing's customer id; 0 or less for a driver without one (keyed on the name instead).</param>
        /// <param name="realName">The driver's own name, used only as the key when there is no customer id.</param>
        public string For(long custId, string realName)
        {
            lock (_gate) return ForLocked(custId, realName);
        }

        private string ForLocked(long custId, string realName)
        {
            string key;
            if (custId > 0)
            {
                key = "cust:" + custId.ToString(CultureInfo.InvariantCulture);
            }
            else
            {
                string n = (realName ?? "").Trim();
                // Already one of this session's names (the model applied twice): it stays what it is.
                if (n.Length > 0 && _taken.Contains(n)) return n;
                key = "name:" + n.ToLowerInvariant();
            }
            if (_byKey.TryGetValue(key, out string have)) return have;

            string chosen;
            var list = _book.List;
            if (list.IsEmpty)
            {
                // No list in this build: a number, never the name.
                chosen = "Driver " + (_book.Hash(key, 0) % 10000).ToString("D4", CultureInfo.InvariantCulture);
            }
            else
            {
                int n = list.Count;
                chosen = null;
                for (int probe = 0; probe <= n * 4; probe++)
                {
                    string candidate = list.Entries[(int)(_book.Hash(key, probe) % (ulong)n)].Shown;
                    if (!_taken.Contains(candidate) || probe == n * 4) { chosen = candidate; break; }
                }
            }
            _byKey[key] = chosen;
            _taken.Add(chosen);
            return chosen;
        }

        /// <summary>
        /// Gives every other driver in the session model their name: <c>UserName</c>, <c>AbbrevName</c> and <c>Initials</c>,
        /// and a <c>TeamName</c> that is the driver's own name (iRacing's for a driver without a team). The player's entry
        /// (<c>DriverCarIdx</c>) and the pace car are left as they are. Applying it again changes nothing. Returns
        /// <paramref name="info"/>.
        /// </summary>
        public IRacingSdkSessionInfo Apply(IRacingSdkSessionInfo info)
        {
            var di = info?.DriverInfo;
            var drivers = di?.Drivers;
            if (drivers == null) return info;
            lock (_gate)
            {
                BeginSessionLocked(SessionKeyOf(info));
                int me = di.DriverCarIdx;
                foreach (var d in drivers)
                {
                    if (d == null || d.CarIdx == me || d.CarIsPaceCar != 0) continue;
                    string real = d.UserName;
                    bool hasName = !string.IsNullOrWhiteSpace(real);
                    if (!hasName && d.UserID <= 0) continue;
                    string shown = ForLocked(d.UserID, real);
                    if (hasName && !string.IsNullOrWhiteSpace(d.TeamName)) d.TeamName = TeamNameFor(d.TeamName, real, shown);
                    d.UserName = shown;
                    d.AbbrevName = shown;
                    d.Initials = Initials(shown);
                }
            }
            return info;
        }

        /// <summary>What a session is known by: iRacing's SessionID and SubSessionID ("0:0" for an offline session).</summary>
        public static string SessionKeyOf(IRacingSdkSessionInfo info)
        {
            var wi = info?.WeekendInfo;
            return (wi?.SessionID ?? 0).ToString(CultureInfo.InvariantCulture) + ":" + (wi?.SubSessionID ?? 0).ToString(CultureInfo.InvariantCulture);
        }

        /// <summary>The first letter of each word: "H. Incandenza" → "HI", "Sick Boy" → "SB".</summary>
        internal static string Initials(string shown)
        {
            var sb = new StringBuilder();
            foreach (string word in (shown ?? "").Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries))
                if (char.IsLetter(word[0])) sb.Append(char.ToUpperInvariant(word[0]));
            return sb.ToString();
        }

        /// <summary>
        /// A team named after its driver is renamed with them: the team that is the driver's name becomes the pseudonym, a
        /// team name with the driver's name in it has it replaced, and any other team name is left as it is.
        /// </summary>
        internal static string TeamNameFor(string team, string real, string shown)
        {
            if (string.IsNullOrWhiteSpace(team) || string.IsNullOrWhiteSpace(real)) return team;
            string t = team.Trim(), r = real.Trim();
            if (string.Equals(t, r, StringComparison.OrdinalIgnoreCase)) return shown;
            int at = t.IndexOf(r, StringComparison.OrdinalIgnoreCase);
            return at < 0 ? team : t.Substring(0, at) + shown + t.Substring(at + r.Length);
        }
    }
}
