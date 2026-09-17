using System;
using RaceCorProDrive.Plugin.IRacing;

namespace RaceCor.Data
{
    /// <summary>
    /// Captures sessions as they're driven: feeds each live frame through <see cref="SessionAccumulator"/>,
    /// saves a session when it ends, and checkpoints the session in progress every completed lap so a crash
    /// or power cut loses at most one lap. Not thread-safe; call from the telemetry thread.
    /// </summary>
    public sealed class LiveRecorder
    {
        private readonly ProDriveStore _store;
        private readonly Action<string> _log;
        private readonly SessionAccumulator _accumulator;
        private readonly string _source;
        private int _checkpointedLaps;
        private DateTime _lastCheckpoint = DateTime.MinValue;

        /// <param name="source">"live" for iRacing; "replay" when driven from an .ibt for verification.</param>
        /// <param name="clock">Maps SessionTime to UTC. Live: now, less time since the frame.</param>
        public LiveRecorder(ProDriveStore store, string source, Func<double, DateTime> clock, Action<string> log = null)
        {
            _store = store;
            _source = source;
            _log = log ?? (_ => { });
            _accumulator = new SessionAccumulator(source, null, clock);
        }

        public int SessionsSaved { get; private set; }

        public void Feed(IRawTelemetry raw)
        {
            var finished = _accumulator.Feed(raw);
            if (finished != null) Save(finished, final: true);
            Checkpoint();
        }

        /// <summary>Call when iRacing disconnects or the host stops.</summary>
        public void Flush()
        {
            var finished = _accumulator.Finish();
            if (finished != null) Save(finished, final: true);
        }

        private void Checkpoint()
        {
            var current = _accumulator.Current;
            if (current == null || current.Laps.Count == _checkpointedLaps) return;
            if (DateTime.UtcNow - _lastCheckpoint < TimeSpan.FromSeconds(5)) return;
            Save(_accumulator.Snapshot(), final: false);
            _checkpointedLaps = current.Laps.Count;
            _lastCheckpoint = DateTime.UtcNow;
        }

        private void Save(SessionRecord s, bool final)
        {
            if (s.DurationSeconds < 1 && s.Laps.Count == 0) return;
            try
            {
                _store.SaveSession(s);
                if (final)
                {
                    SessionsSaved++;
                    _checkpointedLaps = 0;
                    _log($"saved {_source} session: {s.SessionType} at {s.TrackDisplayName}, {s.Laps.Count} laps, {s.Incidents}x");
                }
            }
            catch (Exception ex)
            {
                _log($"session not saved: {ex.Message}");
            }
        }
    }
}
