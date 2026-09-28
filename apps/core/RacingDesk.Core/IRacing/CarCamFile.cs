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
    /// </summary>
    public static class CarCamFile
    {
        // "MACC", a version, the length of what follows; then one record per camera, its name first.
        private const int HeaderSize = 12, RecordSize = 184, NameSize = 32, OffsetAt = 52;
        private const string Cockpit = "CamCockpit";

        /// <summary>Versions 14 and 15 are on the rig, and lay the cockpit record out the same way.</summary>
        internal static bool KnownVersion(int version) => version == 14 || version == 15;

        public static bool TryReadCockpit(byte[] file, out CockpitOffset offset)
        {
            offset = null;
            if (file == null || file.Length < HeaderSize) return false;
            if (file[0] != 'M' || file[1] != 'A' || file[2] != 'C' || file[3] != 'C') return false;
            if (!KnownVersion(BitConverter.ToInt32(file, 4))) return false;

            int length = BitConverter.ToInt32(file, 8);
            if (length <= 0 || length % RecordSize != 0 || HeaderSize + length != file.Length) return false;

            for (int at = HeaderSize; at < file.Length; at += RecordSize)
            {
                if (Name(file, at) != Cockpit) continue;
                float x = BitConverter.ToSingle(file, at + OffsetAt);
                float y = BitConverter.ToSingle(file, at + OffsetAt + 4);
                float z = BitConverter.ToSingle(file, at + OffsetAt + 8);
                // The camera tool moves a camera by centimetres. Metres of it means these aren't the offsets.
                if (!Plausible(x) || !Plausible(y) || !Plausible(z)) return false;
                offset = new CockpitOffset { X = x, Y = y, Z = z };
                return true;
            }
            return false;
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
