using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using IRSDKSharper;

namespace RacingDesk.Plugin.IRacing
{
    public sealed class IbtVar
    {
        public string Name { get; internal set; }
        public IRacingSdkEnum.VarType Type { get; internal set; }
        public int Offset { get; internal set; }
        public int Count { get; internal set; }
        public string Unit { get; internal set; }
        public string Description { get; internal set; }
    }

    /// <summary>
    /// A recorded iRacing disk-telemetry file (.ibt): header, variable table, session YAML and
    /// fixed-size frames. Frames are read on demand, so opening even a 100 MB file is cheap.
    /// </summary>
    public sealed class IbtFile : IDisposable
    {
        private const int HeaderSize = 144;
        private const int VarHeaderSize = 144;

        private readonly FileStream _stream;
        private readonly Dictionary<string, IbtVar> _vars = new Dictionary<string, IbtVar>(StringComparer.Ordinal);
        private IRacingSdkSessionInfo _sessionInfo;
        private bool _sessionInfoParsed;

        public string Path { get; }
        public int Version { get; }
        public int TickRate { get; }
        public int BufferLength { get; }
        public int BufferOffset { get; }
        public int RecordCount { get; }
        public int LapCount { get; }
        public DateTime SessionStartUtc { get; }
        public double SessionStartTime { get; }
        public double SessionEndTime { get; }
        public string SessionInfoYamlText { get; }
        public IReadOnlyDictionary<string, IbtVar> Vars => _vars;

        public IbtFile(string path)
        {
            Path = path;
            _stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, 1 << 16, FileOptions.RandomAccess);
            try
            {
                var h = ReadAt(0, HeaderSize);
                Version = BitConverter.ToInt32(h, 0);
                TickRate = BitConverter.ToInt32(h, 8);
                int sessionInfoLen = BitConverter.ToInt32(h, 16);
                int sessionInfoOffset = BitConverter.ToInt32(h, 20);
                int numVars = BitConverter.ToInt32(h, 24);
                int varHeaderOffset = BitConverter.ToInt32(h, 28);
                BufferLength = BitConverter.ToInt32(h, 36);
                BufferOffset = BitConverter.ToInt32(h, 52);
                long startUnix = BitConverter.ToInt64(h, 112);
                SessionStartUtc = startUnix > 946684800 && startUnix < 32503680000 // 2000..3000
                    ? DateTimeOffset.FromUnixTimeSeconds(startUnix).UtcDateTime
                    : File.GetLastWriteTimeUtc(path);
                SessionStartTime = BitConverter.ToDouble(h, 120);
                SessionEndTime = BitConverter.ToDouble(h, 128);
                LapCount = BitConverter.ToInt32(h, 136);
                RecordCount = BitConverter.ToInt32(h, 140);

                if (numVars <= 0 || numVars > 4096 || BufferLength <= 0 || sessionInfoLen < 0)
                    throw new InvalidDataException($"{path}: not a valid .ibt header");

                // Files cut short by a crash report more records than they hold.
                long available = (_stream.Length - BufferOffset) / BufferLength;
                if (available < RecordCount) RecordCount = (int)Math.Max(0, available);

                var vb = ReadAt(varHeaderOffset, numVars * VarHeaderSize);
                for (int i = 0; i < numVars; i++)
                {
                    int o = i * VarHeaderSize;
                    var v = new IbtVar
                    {
                        Type = (IRacingSdkEnum.VarType)BitConverter.ToInt32(vb, o),
                        Offset = BitConverter.ToInt32(vb, o + 4),
                        Count = BitConverter.ToInt32(vb, o + 8),
                        Name = CString(vb, o + 16, 32),
                        Description = CString(vb, o + 48, 64),
                        Unit = CString(vb, o + 112, 32),
                    };
                    _vars[v.Name] = v;
                }

                SessionInfoYamlText = CString(ReadAt(sessionInfoOffset, sessionInfoLen), 0, sessionInfoLen);
            }
            catch
            {
                _stream.Dispose();
                throw;
            }
        }

        /// <summary>Session YAML parsed on first use.</summary>
        public IRacingSdkSessionInfo SessionInfo
        {
            get
            {
                if (!_sessionInfoParsed)
                {
                    _sessionInfo = SessionInfoYaml.Parse(SessionInfoYamlText);
                    _sessionInfoParsed = true;
                }
                return _sessionInfo;
            }
        }

        /// <summary>Reads frame <paramref name="index"/> into <paramref name="buffer"/> (at least <see cref="BufferLength"/> bytes).</summary>
        public bool ReadFrame(int index, byte[] buffer)
        {
            if (index < 0 || index >= RecordCount) return false;
            lock (_stream)
            {
                _stream.Position = BufferOffset + (long)index * BufferLength;
                return ReadExactly(buffer, BufferLength);
            }
        }

        public object Decode(byte[] frame, string name) =>
            _vars.TryGetValue(name, out var v) ? RawDecode.Decode(frame, v.Type, v.Offset, v.Count) : null;

        public void Dispose() => _stream.Dispose();

        private byte[] ReadAt(long position, int length)
        {
            var buf = new byte[length];
            lock (_stream)
            {
                _stream.Position = position;
                if (!ReadExactly(buf, length)) throw new InvalidDataException($"{Path}: truncated at {position}");
            }
            return buf;
        }

        private bool ReadExactly(byte[] buffer, int length)
        {
            int read = 0;
            while (read < length)
            {
                int n = _stream.Read(buffer, read, length - read);
                if (n <= 0) return false;
                read += n;
            }
            return true;
        }

        private static readonly Encoding Latin1 = Encoding.GetEncoding("ISO-8859-1");

        private static string CString(byte[] b, int offset, int max)
        {
            int end = Array.IndexOf(b, (byte)0, offset, max);
            return Latin1.GetString(b, offset, (end < 0 ? offset + max : end) - offset);
        }
    }

    /// <summary><see cref="IRawTelemetry"/> over an .ibt file, positioned on one frame at a time.</summary>
    public sealed class IbtRawTelemetry : IRawTelemetry
    {
        private readonly IbtFile _file;
        private readonly byte[] _frame;

        public IbtRawTelemetry(IbtFile file)
        {
            _file = file ?? throw new ArgumentNullException(nameof(file));
            _frame = new byte[file.BufferLength];
        }

        public IbtFile File => _file;
        public int FrameIndex { get; private set; } = -1;

        public bool Seek(int index)
        {
            if (!_file.ReadFrame(index, _frame)) return false;
            FrameIndex = index;
            return true;
        }

        public bool IsConnected => FrameIndex >= 0;
        public IRacingSdkSessionInfo SessionInfo => _file.SessionInfo;
        public object GetValue(string name) => FrameIndex < 0 ? null : _file.Decode(_frame, name);
    }
}
