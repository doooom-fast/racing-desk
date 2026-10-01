using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
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

        /// <summary>HMAC-SHA256 of the key and the probe number under the salt, as a number; the first eight bytes.</summary>
        internal ulong Hash(string key, int probe)
        {
            using (var hmac = new HMACSHA256(_salt))
            {
                var bytes = hmac.ComputeHash(Encoding.UTF8.GetBytes(key + "#" + probe.ToString(System.Globalization.CultureInfo.InvariantCulture)));
                return BitConverter.ToUInt64(bytes, 0);
            }
        }
    }
}
