using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using RacingDesk.Plugin;

namespace RacingDesk.Core.Names
{
    /// <summary>
    /// The names other drivers are shown under (<see cref="PseudonymList"/>) and the salt that picks one for each: 32
    /// random bytes made once on this machine and kept in the app's data folder, never sent anywhere. The app's host and
    /// the SimHub plugin read the same file, so a rival has one name on both paths. A session's names are given out by
    /// <see cref="NewSession"/>.
    /// </summary>
    public sealed class PseudonymBook
    {
        /// <summary>The app's data folder under %LOCALAPPDATA% (RacingDesk.Data's DataFolder.Name says the same).</summary>
        public const string DataFolderName = "Racing Desk";
        public const string SaltFileName = "pseudonyms.salt";
        public const int SaltLength = 32;

        public static string DefaultSaltPath =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), DataFolderName, SaltFileName);

        private static readonly object DefaultGate = new object();
        private static PseudonymBook _default;

        /// <summary>
        /// The machine's book: the embedded list and the salt at <see cref="DefaultSaltPath"/>, read or made on first use.
        /// Tests give one of their own, with a salt of their own, so nothing of theirs is written to the rig.
        /// </summary>
        public static PseudonymBook Default
        {
            get
            {
                lock (DefaultGate)
                {
                    if (_default == null)
                    {
                        var salt = LoadSalt(DefaultSaltPath, out bool kept, m => Log.Warn("[RacingDesk] names: " + m));
                        _default = new PseudonymBook(PseudonymList.Default, salt, kept);
                        Log.Info($"[RacingDesk] names: {_default.List.Count} names, salt {(kept ? "kept" : "for this run only")}");
                    }
                    return _default;
                }
            }
            set { lock (DefaultGate) _default = value; }
        }

        private readonly byte[] _salt;

        public PseudonymBook(PseudonymList list, byte[] salt) : this(list, salt, true) { }

        private PseudonymBook(PseudonymList list, byte[] salt, bool saltIsKept)
        {
            List = list ?? PseudonymList.Empty;
            if (salt == null || salt.Length == 0) throw new ArgumentException("a salt", nameof(salt));
            _salt = (byte[])salt.Clone();
            SaltIsKept = saltIsKept;
        }

        public PseudonymList List { get; }

        /// <summary>
        /// False when the salt file could neither be read nor written: the names are then steady within this run of the
        /// program and no longer, and the log has said so.
        /// </summary>
        public bool SaltIsKept { get; }

        /// <summary>One session's names: the same driver the same name for the session, and no two drivers one name.</summary>
        public Pseudonymizer NewSession() => new Pseudonymizer(this);

        /// <summary>
        /// The salt at <paramref name="path"/>: read if it is there, else made and written (to a temporary name first, then
        /// moved into place, so two programs starting together end with one file and both read it). A file that cannot
        /// be read or written leaves a salt for this run alone, and <paramref name="kept"/> false.
        /// </summary>
        public static byte[] LoadSalt(string path, out bool kept, Action<string> warn = null)
        {
            kept = false;
            byte[] fresh = NewSalt();
            if (string.IsNullOrWhiteSpace(path)) return fresh;
            try
            {
                var have = ReadSalt(path);
                if (have != null) { kept = true; return have; }

                string dir = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                string temp = path + ".tmp-" + Guid.NewGuid().ToString("N");
                File.WriteAllBytes(temp, fresh);
                try
                {
                    File.Move(temp, path);
                }
                catch (IOException)
                {
                    // Another program wrote it first: theirs is the salt, and ours goes.
                    try { File.Delete(temp); } catch { }
                }
                var written = ReadSalt(path);
                if (written != null) { kept = true; return written; }
                warn?.Invoke($"the salt at {path} could not be read back; names are steady for this run only");
                return fresh;
            }
            catch (Exception ex)
            {
                warn?.Invoke($"the salt at {path} could not be read or written ({ex.Message}); names are steady for this run only");
                return fresh;
            }
        }

        private static byte[] ReadSalt(string path)
        {
            if (!File.Exists(path)) return null;
            var bytes = File.ReadAllBytes(path);
            // A file that is not a salt (too short to be one) is left alone, and not trusted: nothing of the driver's is
            // overwritten, and a salt is 32 bytes.
            if (bytes.Length < 16) throw new InvalidDataException($"{bytes.Length} bytes, not a salt");
            return bytes;
        }

        private static byte[] NewSalt()
        {
            var salt = new byte[SaltLength];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(salt);
            return salt;
        }

        // ── What the hashing gave, kept for as long as this book lives (and so for as long as its salt is the same) ──
        // A rival met again — on the next server, in the next session, as a late joiner — costs a lookup, not one HMAC for
        // every name of the list. Bounded: past the limit the lot is dropped and made again as it is asked for.
        internal const int KeptKeysLimit = 2048;
        private readonly object _keptGate = new object();
        private readonly Dictionary<string, int[]> _ranks = new Dictionary<string, int[]>(StringComparer.Ordinal);
        private readonly Dictionary<string, ulong> _priorities = new Dictionary<string, ulong>(StringComparer.Ordinal);
        private byte[][] _nameBytes;
        private int _hashed;

        /// <summary>How many keys this book has ranked by hashing (not from what it kept): for a test.</summary>
        internal int Hashed => Volatile.Read(ref _hashed);

        /// <summary>Called as a key's ranking is hashed, with the key, on the thread that hashes it: for a test.</summary>
        internal Action<string> Ranking { get; set; }

        /// <summary>
        /// Every name of the list in the order a key prefers them, best first: each name is scored by
        /// <c>HMAC-SHA256(salt, "rank|" + key + "|" + the name as the work gives it)</c> and the highest score leads
        /// (rendezvous hashing). A name's score depends on that name and the key alone, so a key's order is the same
        /// whatever order the file lists the names in and however many it holds: a name added to the list changes the
        /// choice only of the keys that prefer it to the one they had. Ties (a 64-bit coincidence) go to the name that sorts first.
        /// The order is kept (<see cref="KeptKeysLimit"/>) and the same array handed out again: it is not to be changed.
        /// </summary>
        internal int[] Rank(string key)
        {
            lock (_keptGate)
                if (_ranks.TryGetValue(key, out int[] kept)) return kept;
            int[] order;
            using (var hmac = new HMACSHA256(_salt)) order = RankWith(hmac, key);
            Keep(_ranks, key, order);
            return order;
        }

        /// <summary>
        /// Which of two keys named in the same moment is served first when they want the same name: a number of the key's
        /// own under the salt (<c>HMAC-SHA256(salt, "priority|" + key)</c>), so that who keeps a contested name does not
        /// depend on the order the field is listed in. Kept, like the ranking.
        /// </summary>
        internal ulong Priority(string key)
        {
            lock (_keptGate)
                if (_priorities.TryGetValue(key, out ulong kept)) return kept;
            ulong p = Number("priority|" + key);
            Keep(_priorities, key, p);
            return p;
        }

        /// <summary>
        /// Ranks and prioritises every key not yet known, with one HMAC for the lot: what a field about to be named is
        /// given first, so that naming it is lookups. Nothing is held while it hashes but the HMAC itself.
        /// </summary>
        internal void Prepare(IEnumerable<string> keys, bool priorities = true)
        {
            if (keys == null) return;
            HMACSHA256 hmac = null;
            try
            {
                foreach (string key in keys)
                {
                    if (key == null) continue;
                    bool rank, priority;
                    lock (_keptGate)
                    {
                        rank = !List.IsEmpty && !_ranks.ContainsKey(key);
                        priority = priorities && !_priorities.ContainsKey(key);
                    }
                    if (!rank && !priority) continue;
                    hmac = hmac ?? new HMACSHA256(_salt);
                    if (rank) Keep(_ranks, key, RankWith(hmac, key));
                    if (priority) Keep(_priorities, key, Score(hmac, Encoding.UTF8.GetBytes("priority|" + key)));
                }
            }
            finally
            {
                hmac?.Dispose();
            }
        }

        private int[] RankWith(HMACSHA256 hmac, string key)
        {
            Ranking?.Invoke(key);
            Interlocked.Increment(ref _hashed);
            var entries = List.Entries;
            int n = entries.Count;
            var names = NameBytes();
            // "rank|" + key + "|" + name, in one buffer: the key's part once, each name's bytes after it. The key ends at
            // the '|', so its bytes are the same alone as in the whole string.
            byte[] head = Encoding.UTF8.GetBytes("rank|" + key + "|");
            int longest = 0;
            foreach (var b in names) longest = Math.Max(longest, b.Length);
            var message = new byte[head.Length + longest];
            Buffer.BlockCopy(head, 0, message, 0, head.Length);
            var scores = new ulong[n];
            var order = new int[n];
            for (int i = 0; i < n; i++)
            {
                Buffer.BlockCopy(names[i], 0, message, head.Length, names[i].Length);
                scores[i] = BitConverter.ToUInt64(hmac.ComputeHash(message, 0, head.Length + names[i].Length), 0);
                order[i] = i;
            }
            Array.Sort(order, (a, b) =>
            {
                int c = scores[b].CompareTo(scores[a]);
                return c != 0 ? c : string.CompareOrdinal(entries[a].Name, entries[b].Name);
            });
            return order;
        }

        private byte[][] NameBytes()
        {
            var have = Volatile.Read(ref _nameBytes);
            if (have != null) return have;
            var entries = List.Entries;
            var made = new byte[entries.Count][];
            for (int i = 0; i < made.Length; i++) made[i] = Encoding.UTF8.GetBytes(entries[i].Name);
            Interlocked.CompareExchange(ref _nameBytes, made, null);
            return Volatile.Read(ref _nameBytes);
        }

        private void Keep<T>(Dictionary<string, T> kept, string key, T value)
        {
            lock (_keptGate)
            {
                if (kept.Count >= KeptKeysLimit) kept.Clear();
                kept[key] = value;
            }
        }

        private static ulong Score(HMACSHA256 hmac, byte[] message) => BitConverter.ToUInt64(hmac.ComputeHash(message), 0);

        /// <summary>A number of the key's own under the salt, for a build that carries no list.</summary>
        internal ulong Number(string key, int probe = 0) => Number("number|" + key + "|" + probe.ToString(System.Globalization.CultureInfo.InvariantCulture));

        private ulong Number(string message)
        {
            using (var hmac = new HMACSHA256(_salt))
                return Score(hmac, Encoding.UTF8.GetBytes(message));
        }
    }
}
