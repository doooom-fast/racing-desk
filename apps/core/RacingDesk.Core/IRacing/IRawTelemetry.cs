using System;
using IRSDKSharper;

namespace RacingDesk.Plugin.IRacing
{
    /// <summary>
    /// iRacing telemetry by variable name, from either the live shared-memory SDK or a recorded .ibt.
    /// </summary>
    public interface IRawTelemetry
    {
        bool IsConnected { get; }

        /// <summary>Parsed session YAML (weekend, drivers, sessions, sectors), or null before it's available.</summary>
        IRacingSdkSessionInfo SessionInfo { get; }

        /// <summary>
        /// A telemetry variable: scalars (count 1) boxed as char / bool / int / float / double, arrays as
        /// typed arrays. Bitfields come back as int, matching what SimHub exposes. Null if unknown.
        /// </summary>
        object GetValue(string name);
    }

    internal static class RawDecode
    {
        public static object Decode(byte[] buffer, IRacingSdkEnum.VarType type, int offset, int count)
        {
            if (count <= 1)
            {
                switch (type)
                {
                    case IRacingSdkEnum.VarType.Char: return (char)buffer[offset];
                    case IRacingSdkEnum.VarType.Bool: return buffer[offset] != 0;
                    case IRacingSdkEnum.VarType.Int:
                    case IRacingSdkEnum.VarType.BitField: return BitConverter.ToInt32(buffer, offset);
                    case IRacingSdkEnum.VarType.Float: return BitConverter.ToSingle(buffer, offset);
                    case IRacingSdkEnum.VarType.Double: return BitConverter.ToDouble(buffer, offset);
                    default: return null;
                }
            }
            switch (type)
            {
                case IRacingSdkEnum.VarType.Bool:
                {
                    var a = new bool[count];
                    for (int i = 0; i < count; i++) a[i] = buffer[offset + i] != 0;
                    return a;
                }
                case IRacingSdkEnum.VarType.Int:
                case IRacingSdkEnum.VarType.BitField:
                {
                    var a = new int[count];
                    for (int i = 0; i < count; i++) a[i] = BitConverter.ToInt32(buffer, offset + i * 4);
                    return a;
                }
                case IRacingSdkEnum.VarType.Float:
                {
                    var a = new float[count];
                    for (int i = 0; i < count; i++) a[i] = BitConverter.ToSingle(buffer, offset + i * 4);
                    return a;
                }
                case IRacingSdkEnum.VarType.Double:
                {
                    var a = new double[count];
                    for (int i = 0; i < count; i++) a[i] = BitConverter.ToDouble(buffer, offset + i * 8);
                    return a;
                }
                case IRacingSdkEnum.VarType.Char:
                {
                    var a = new char[count];
                    for (int i = 0; i < count; i++) a[i] = (char)buffer[offset + i];
                    return a;
                }
                default: return null;
            }
        }
    }
}
