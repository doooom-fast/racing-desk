using System;
using System.IO;
using IRSDKSharper;
using RaceCorProDrive.Plugin.IRacing;

namespace RaceCor.Data
{
    /// <summary>Streams an .ibt's frames front to back, optionally every Nth frame — for backfill.</summary>
    public sealed class IbtSequentialReader : IRawTelemetry, IDisposable
    {
        private readonly IbtFile _file;
        private readonly FileStream _stream;
        private readonly byte[] _frame;
        private readonly int _step;
        private int _next;

        public IbtSequentialReader(IbtFile file, int step = 1)
        {
            _file = file;
            _step = Math.Max(1, step);
            _frame = new byte[file.BufferLength];
            _stream = new FileStream(file.Path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, 1 << 20, FileOptions.SequentialScan);
            _stream.Position = file.BufferOffset;
        }

        public int FrameIndex { get; private set; } = -1;

        public bool MoveNext()
        {
            if (_next >= _file.RecordCount) return false;
            long position = _file.BufferOffset + (long)_next * _file.BufferLength;
            if (_stream.Position != position) _stream.Seek(position, SeekOrigin.Begin);
            int read = 0;
            while (read < _frame.Length)
            {
                int n = _stream.Read(_frame, read, _frame.Length - read);
                if (n <= 0) return false;
                read += n;
            }
            FrameIndex = _next;
            _next += _step;
            return true;
        }

        public bool IsConnected => FrameIndex >= 0;
        public IRacingSdkSessionInfo SessionInfo => _file.SessionInfo;
        public object GetValue(string name) => FrameIndex < 0 ? null : _file.Decode(_frame, name);

        public void Dispose() => _stream.Dispose();
    }
}
