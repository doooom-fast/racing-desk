using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using IRSDKSharper;

namespace RacingDesk.Core.Names
{
    /// <summary>
    /// One session's names for the other drivers. Every driver has a list of the names in the order their customer id
    /// prefers them, under the machine's salt (<see cref="PseudonymBook.Rank"/>: rendezvous hashing, so the preference
    /// depends on the id and the name alone, not on the order or the length of the list), and takes the first of them that
    /// no one in the session holds. A field named at once (<see cref="Apply"/>, <see cref="ForMany"/>) is served in an
    /// order of the ids' own (<see cref="PseudonymBook.Priority"/>), so who keeps a contested name does not depend on the
    /// order the drivers are listed in, and the racers are served before the spectators, who never take a racer's first
    /// choice. A name once given is kept for the session (a rival is the same character all race), and the session changes
    /// when its key does (<see cref="BeginSession"/>: iRacing's SessionID and SubSessionID). When every name of the list is
    /// in use the next driver is given a numbered form of the one they prefer ("H. Incandenza II"), never one in use. The
    /// real name goes nowhere: it is not stored, not logged, and never the answer. A driver with no customer id is keyed on
    /// their name, salted the same way.
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
        /// this machine and no one else in the session holds it, and not the same as any other driver's in this session.
        /// Never <paramref name="realName"/>. A driver named on their own like this takes the first name they prefer that
        /// is free; to name a whole field in the order that keeps contested names the same everywhere, use
        /// <see cref="ForMany"/> or <see cref="Apply"/>.
        /// </summary>
        /// <param name="custId">iRacing's customer id; 0 or less for a driver without one (keyed on the name instead).</param>
        /// <param name="realName">The driver's own name, used only as the key when there is no customer id.</param>
        public string For(long custId, string realName)
        {
            lock (_gate) return ForLocked(custId, realName);
        }

        /// <summary>
        /// Names several drivers at once: each gets the first name they prefer that is free, the drivers being served in the
        /// order of their keys' own priority (not the order given), so that where two want the same name the same one keeps
        /// it whatever the order the field was listed in. The answers are in the order given.
        /// </summary>
        public string[] ForMany(IReadOnlyList<KeyValuePair<long, string>> drivers)
        {
            if (drivers == null) return new string[0];
            lock (_gate) return ForManyLocked(drivers);
        }

        private string[] ForManyLocked(IReadOnlyList<KeyValuePair<long, string>> drivers)
        {
            int n = drivers.Count;
            var keys = new string[n];
            var priority = new ulong[n];
            var order = new int[n];
            for (int i = 0; i < n; i++)
            {
                keys[i] = KeyOf(drivers[i].Key, drivers[i].Value, out _);
                priority[i] = _book.Priority(keys[i]);
                order[i] = i;
            }
            Array.Sort(order, (a, b) =>
            {
                int c = priority[b].CompareTo(priority[a]);
                return c != 0 ? c : string.CompareOrdinal(keys[a], keys[b]);
            });
            var result = new string[n];
            foreach (int i in order) result[i] = ForLocked(drivers[i].Key, drivers[i].Value);
            return result;
        }

        private static string CustKey(long custId) => "cust:" + custId.ToString(CultureInfo.InvariantCulture);

        private string KeyOf(long custId, string realName, out string already)
        {
            already = null;
            if (custId > 0) return CustKey(custId);
            string n = (realName ?? "").Trim();
            // Already one of this session's names (the model applied twice): it stays what it is.
            if (n.Length > 0 && _taken.Contains(n)) already = n;
            return "name:" + n.ToLowerInvariant();
        }

        private string ForLocked(long custId, string realName)
        {
            string key = KeyOf(custId, realName, out string already);
            if (already != null) return already;
            if (_byKey.TryGetValue(key, out string have)) return have;
            string chosen = Choose(key);
            _byKey[key] = chosen;
            _taken.Add(chosen);
            return chosen;
        }

        /// <summary>The first name this key prefers that is free; a numbered form once the list is used up.</summary>
        private string Choose(string key)
        {
            var list = _book.List;
            if (list.IsEmpty)
            {
                // No list in this build: a number, never the name.
                for (int probe = 0; probe < 20000; probe++)
                {
                    string candidate = "Driver " + (_book.Number(key, probe) % 10000).ToString("D4", CultureInfo.InvariantCulture);
                    if (!_taken.Contains(candidate)) return candidate;
                }
                return "Driver " + (10000 + _taken.Count).ToString(CultureInfo.InvariantCulture);
            }
            var ranked = _book.Rank(key);
            foreach (int i in ranked)
            {
                string candidate = list.Entries[i].Shown;
                if (!_taken.Contains(candidate)) return candidate;
            }
            // Every name is in use: a numbered form of the one this key prefers, then of the next, …, then the second numbering.
            for (int round = 2; ; round++)
                foreach (int i in ranked)
                {
                    string candidate = list.Entries[i].Shown + " " + Roman(round);
                    if (!_taken.Contains(candidate)) return candidate;
                }
        }

        /// <summary>
        /// Takes back a name this session gave before (a stored grid, written by a session that named its drivers): it is
        /// this driver's again, and nobody else's. Only one of the list's names (or a numbered form of one) is taken back,
        /// once; false for anything else (a real name stored before the names were replaced is not a name to keep, and is
        /// named afresh by <see cref="For"/>).
        /// </summary>
        public bool Keep(long custId, string shown)
        {
            lock (_gate)
            {
                string s = (shown ?? "").Trim();
                if (s.Length == 0 || !(_book.List.ContainsShown(s) || _book.List.ContainsShown(BaseOf(s))) || _taken.Contains(s)) return false;
                if (custId > 0)
                {
                    string key = CustKey(custId);
                    if (_byKey.ContainsKey(key)) return false;
                    _byKey[key] = s;
                }
                _taken.Add(s);
                return true;
            }
        }

        /// <summary>One driver of a named field: the entry of the session model and the name it is shown under.</summary>
        public sealed class FieldName
        {
            public IRacingSdkSessionInfo.DriverInfoModel.DriverModel Driver { get; internal set; }
            public string Shown { get; internal set; }
        }

        /// <summary>
        /// Names every driver of the session model who is not him and not the pace car, as one field: the racers first, in
        /// the order of their keys' priority, and then the spectators, who so never take a racer's first choice. The model
        /// is not changed (<see cref="Apply"/> does that); the answer is in the model's order. A driver with neither an id
        /// nor a name is not named.
        /// </summary>
        internal IReadOnlyList<FieldName> NameField(IRacingSdkSessionInfo info)
        {
            var result = new List<FieldName>();
            var di = info?.DriverInfo;
            var drivers = di?.Drivers;
            if (drivers == null) return result;
            lock (_gate)
            {
                BeginSessionLocked(SessionKeyOf(info));
                var racers = new List<IRacingSdkSessionInfo.DriverInfoModel.DriverModel>();
                var spectators = new List<IRacingSdkSessionInfo.DriverInfoModel.DriverModel>();
                foreach (var d in drivers)
                {
                    if (d == null || d.CarIsPaceCar != 0 || IsHim(di, d)) continue;
                    if (string.IsNullOrWhiteSpace(d.UserName) && d.UserID <= 0) continue;
                    (d.IsSpectator != 0 ? spectators : racers).Add(d);
                }
                var shown = new Dictionary<IRacingSdkSessionInfo.DriverInfoModel.DriverModel, string>();
                foreach (var group in new[] { racers, spectators })
                {
                    var wants = group.Select(d => new KeyValuePair<long, string>(d.UserID, d.UserName)).ToList();
                    var names = ForManyLocked(wants);
                    for (int i = 0; i < group.Count; i++) shown[group[i]] = names[i];
                }
                foreach (var d in drivers)
                    if (d != null && shown.TryGetValue(d, out string s)) result.Add(new FieldName { Driver = d, Shown = s });
            }
            return result;
        }

        /// <summary>
        /// Gives every other driver in the session model their name: <c>UserName</c>, <c>AbbrevName</c> and <c>Initials</c>,
        /// and a <c>TeamName</c> that is the driver's character in a session without teams (iRacing's is the driver's own
        /// name there) and a label made from the team's id in a team race (<see cref="TeamLabel"/>: a team may be named
        /// after anyone, so none of its own is kept, his own team's included). His own entry (<see cref="IsHim"/>: his
        /// car, with him in it, not a teammate) and the pace car are otherwise left as they are. Applying it again changes
        /// nothing. Returns
        /// <paramref name="info"/>.
        /// </summary>
        public IRacingSdkSessionInfo Apply(IRacingSdkSessionInfo info)
        {
            var di = info?.DriverInfo;
            if (di?.Drivers == null) return info;
            lock (_gate)
            {
                bool team = (info.WeekendInfo?.TeamRacing ?? 0) != 0;
                var labels = new Dictionary<string, string>(StringComparer.Ordinal);
                foreach (var named in NameField(info))
                {
                    var d = named.Driver;
                    string shown = named.Shown;
                    bool hadTeam = !string.IsNullOrWhiteSpace(d.TeamName);
                    d.UserName = shown;
                    d.AbbrevName = shown;
                    d.Initials = Initials(shown);
                    if (!hadTeam) continue;
                    if (!team) { d.TeamName = shown; continue; }
                    string key = d.TeamID > 0 ? "team:" + d.TeamID.ToString(CultureInfo.InvariantCulture) : "driver:" + shown;
                    if (!labels.TryGetValue(key, out string label)) labels[key] = label = TeamLabel(key);
                    d.TeamName = label;
                }
                // His own entry stays his, but a team race's team name may be made of his teammates' names: it is the label too.
                if (team)
                    foreach (var d in di.Drivers)
                    {
                        if (d == null || d.CarIsPaceCar != 0 || !IsHim(di, d) || string.IsNullOrWhiteSpace(d.TeamName)) continue;
                        string key = d.TeamID > 0 ? "team:" + d.TeamID.ToString(CultureInfo.InvariantCulture) : "driver:him";
                        if (!labels.TryGetValue(key, out string label)) labels[key] = label = TeamLabel(key);
                        d.TeamName = label;
                    }
            }
            return info;
        }

        /// <summary>
        /// A team's name as shown: "Team " and the surname of the character this team's id prefers (the same team, the same
        /// label; teams may share one). Not the name of any driver in the session and not iRacing's: a team can be named
        /// after anyone.
        /// </summary>
        private string TeamLabel(string key)
        {
            var list = _book.List;
            if (list.IsEmpty) return "Team " + (_book.Number(key) % 1000).ToString("D3", CultureInfo.InvariantCulture);
            return "Team " + SurnameOf(list.Entries[_book.Rank(key)[0]].Shown);
        }

        /// <summary>"H. Incandenza" → "Incandenza"; "Sick Boy" and "J.D. Steelritter" are left whole.</summary>
        internal static string SurnameOf(string shown)
        {
            string s = (shown ?? "").Trim();
            int space = s.IndexOf(' ');
            return space == 2 && s[1] == '.' ? s.Substring(3) : s;
        }

        /// <summary>
        /// Whether this entry is him: his car (<c>DriverCarIdx</c>) with him in it. In a team race the entry for his car is
        /// whoever is driving it, and a teammate in it is another driver: when the session says who he is
        /// (<c>DriverUserID</c>) and the entry says someone else, the entry is not his and is renamed like any other.
        /// </summary>
        public static bool IsHim(IRacingSdkSessionInfo.DriverInfoModel di, IRacingSdkSessionInfo.DriverInfoModel.DriverModel d)
        {
            if (di == null || d == null || d.CarIdx != di.DriverCarIdx) return false;
            return di.DriverUserID <= 0 || d.UserID <= 0 || d.UserID == di.DriverUserID;
        }

        /// <summary>What a session is known by: iRacing's SessionID and SubSessionID ("0:0" for an offline session).</summary>
        public static string SessionKeyOf(IRacingSdkSessionInfo info)
        {
            var wi = info?.WeekendInfo;
            return (wi?.SessionID ?? 0).ToString(CultureInfo.InvariantCulture) + ":" + (wi?.SubSessionID ?? 0).ToString(CultureInfo.InvariantCulture);
        }

        /// <summary>The first letter of each word: "H. Incandenza" → "HI", "Sick Boy" → "SB"; a numbering ("II") is no word.</summary>
        internal static string Initials(string shown)
        {
            var sb = new StringBuilder();
            string s = BaseOf((shown ?? "").Trim());
            foreach (string word in s.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries))
                if (char.IsLetter(word[0])) sb.Append(char.ToUpperInvariant(word[0]));
            return sb.ToString();
        }

        /// <summary>"H. Incandenza II" → "H. Incandenza": the name a numbered form is made from.</summary>
        internal static string BaseOf(string shown)
        {
            string s = (shown ?? "").Trim();
            int space = s.LastIndexOf(' ');
            if (space <= 0) return s;
            string tail = s.Substring(space + 1);
            return tail.Length >= 2 && tail.All(c => c == 'I' || c == 'V' || c == 'X') ? s.Substring(0, space) : s;
        }

        private static string Roman(int n)
        {
            var sb = new StringBuilder();
            int[] values = { 1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1 };
            string[] symbols = { "M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I" };
            for (int i = 0; i < values.Length; i++)
                while (n >= values[i]) { sb.Append(symbols[i]); n -= values[i]; }
            return sb.ToString();
        }
    }
}
