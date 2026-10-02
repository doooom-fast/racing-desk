using System;
using System.Text;

namespace RacingDesk.Plugin.IRacing
{
    /// <summary>Where the cockpit camera sits against the car's own seat, in metres.</summary>
    public sealed class CockpitOffset
    {
        /// <summary>Fore and aft: the seat slid forward or back.</summary>
        public float X { get; internal set; }
        public float Y { get; internal set; }
        /// <summary>Up and down.</summary>
        public float Z { get; internal set; }

        public bool IsZero => X == 0f && Y == 0f && Z == 0f;
    }

    /// <summary>
    /// A car's <c>car.cam</c>, as iRacing's camera tool saves it under
    /// <c>Documents\iRacing\cameras\cars\&lt;car&gt;</c> — the one place the sim keeps anything about the view
    /// per car. The format is iRacing's own and undocumented; this reads the cockpit camera's offset and
    /// nothing else, and reads nothing from a file that isn't laid out the way the ones on the rig are.
    ///
    /// It can also make the one change Racing Desk makes to such a file (docs/view-and-pedals-plan.md): the cockpit
    /// camera's height, Z, at +60 of the cockpit record, and — behind a switch of its own, only once the first run has
    /// shown that it adds to the horizon — its vertical shift at +84. Each edit is made on a copy and changes those four
    /// bytes and no others, and only in a file laid out exactly as the 19 on the rig are: "MACC", version 14 or 15,
    /// 1,668 bytes (nine records of 184), the cockpit record found by its name. Anything else is refused, with why.
    /// </summary>
    public static class CarCamFile
    {
        // "MACC", a version, the length of what follows; then one record per camera, its name first.
        private const int HeaderSize = 12, RecordSize = 184, NameSize = 32, OffsetAt = 52, VerticalShiftAt = 84;
        private const string Cockpit = "CamCockpit";

        /// <summary>The length of every camera file on the rig: the header and nine cameras.</summary>
        public const int KnownLength = HeaderSize + 9 * RecordSize;

        /// <summary>Where, in the cockpit record, its height is: Z of the offset X/Y/Z at +52/+56/+60.</summary>
        public const int CockpitZAt = OffsetAt + 8;

        /// <summary>Versions 14 and 15 are on the rig, and lay the cockpit record out the same way.</summary>
        internal static bool KnownVersion(int version) => version == 14 || version == 15;

        public static bool TryReadCockpit(byte[] file, out CockpitOffset offset)
        {
            offset = null;
            int at = CockpitRecord(file, exactLength: false);
            if (at < 0) return false;
            float x = BitConverter.ToSingle(file, at + OffsetAt);
            float y = BitConverter.ToSingle(file, at + OffsetAt + 4);
            float z = BitConverter.ToSingle(file, at + OffsetAt + 8);
            // The camera tool moves a camera by centimetres. Metres of it means these aren't the offsets.
            if (!Plausible(x) || !Plausible(y) || !Plausible(z)) return false;
            offset = new CockpitOffset { X = x, Y = y, Z = z };
            return true;
        }

        /// <summary>The cockpit camera's vertical shift (+84 of its record): what the horizon may be kept in, per car.</summary>
        public static bool TryReadCockpitVerticalShift(byte[] file, out float shift)
        {
            shift = 0f;
            int at = CockpitRecord(file, exactLength: false);
            if (at < 0) return false;
            float v = BitConverter.ToSingle(file, at + VerticalShiftAt);
            if (!Plausible(v)) return false;
            shift = v;
            return true;
        }

        /// <summary>
        /// Whether a file is one Racing Desk may write: laid out as the rig's are, to the byte (<see cref="KnownLength"/>),
        /// with a cockpit record whose offsets read as offsets. <paramref name="why"/> says what is not so.
        /// </summary>
        public static bool IsWritable(byte[] file, out string why)
        {
            why = null;
            if (file == null || file.Length < HeaderSize) { why = "the file is empty or cut short"; return false; }
            if (file[0] != 'M' || file[1] != 'A' || file[2] != 'C' || file[3] != 'C') { why = "it is not a camera file (no MACC at its start)"; return false; }
            int version = BitConverter.ToInt32(file, 4);
            if (!KnownVersion(version)) { why = $"its version is {version}, and only 14 and 15 are known"; return false; }
            if (file.Length != KnownLength) { why = $"it is {file.Length} bytes, not the {KnownLength} every camera file on the rig is"; return false; }
            if (CockpitRecord(file, exactLength: true) < 0) { why = "it has no cockpit camera (CamCockpit) laid out as the rig's are"; return false; }
            if (!TryReadCockpit(file, out _)) { why = "its cockpit offsets do not read as offsets"; return false; }
            return true;
        }

        /// <summary>
        /// A copy of the file with the cockpit camera's height (Z, +60 of the cockpit record) set to <paramref name="z"/>
        /// metres, and every other byte as it was. False, with why, for a file that is not one Racing Desk may write or a
        /// value that is not a height.
        /// </summary>
        public static bool TryWriteCockpitZ(byte[] file, float z, out byte[] edited, out string why) =>
            TryWriteFloat(file, CockpitZAt, z, out edited, out why);

        /// <summary>The same for the cockpit camera's vertical shift (+84): the horizon kept per car, behind its own switch.</summary>
        public static bool TryWriteCockpitVerticalShift(byte[] file, float shift, out byte[] edited, out string why) =>
            TryWriteFloat(file, VerticalShiftAt, shift, out edited, out why);

        private static bool TryWriteFloat(byte[] file, int field, float value, out byte[] edited, out string why)
        {
            edited = null;
            if (!IsWritable(file, out why)) return false;
            if (float.IsNaN(value) || float.IsInfinity(value) || !Plausible(value)) { why = "the value is not one a camera tool would give"; return false; }
            int at = CockpitRecord(file, exactLength: true) + field;
            var copy = (byte[])file.Clone();
            byte[] bytes = BitConverter.GetBytes(value);
            Buffer.BlockCopy(bytes, 0, copy, at, 4);
            // Four bytes and no others: said, not assumed.
            for (int i = 0; i < copy.Length; i++)
                if (copy[i] != file[i] && (i < at || i >= at + 4)) { why = "the edit reached past its four bytes"; return false; }
            edited = copy;
            why = null;
            return true;
        }

        /// <summary>Where the cockpit record begins, or -1 for a file that is not laid out as the rig's are.</summary>
        private static int CockpitRecord(byte[] file, bool exactLength)
        {
            if (file == null || file.Length < HeaderSize) return -1;
            if (file[0] != 'M' || file[1] != 'A' || file[2] != 'C' || file[3] != 'C') return -1;
            if (!KnownVersion(BitConverter.ToInt32(file, 4))) return -1;

            int length = BitConverter.ToInt32(file, 8);
            if (length <= 0 || length % RecordSize != 0 || HeaderSize + length != file.Length) return -1;
            if (exactLength && file.Length != KnownLength) return -1;

            int found = -1;
            for (int at = HeaderSize; at < file.Length; at += RecordSize)
            {
                if (Name(file, at) != Cockpit) continue;
                // Two cockpit records would be a file nobody on the rig has: which is the camera is not known.
                if (found >= 0) return -1;
                found = at;
            }
            return found;
        }

        private static bool Plausible(float v) => !float.IsNaN(v) && !float.IsInfinity(v) && Math.Abs(v) <= 2f;

        private static string Name(byte[] file, int at)
        {
            int n = 0;
            while (n < NameSize && file[at + n] != 0) n++;
            return Encoding.ASCII.GetString(file, at, n);
        }
    }
}
