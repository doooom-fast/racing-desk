using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;
using RacingDesk.Core.Cars;

namespace RacingDesk.Data
{
    /// <summary>
    /// Keeps what the check of the car list says (<see cref="CarControlsFollower.Said"/>) in the store, off the
    /// thread the telemetry is on. <see cref="Keep"/> only queues the remark and returns; a pool thread writes what
    /// is queued through a connection of its own, as the view's and the pedals' are written, so a store that is
    /// slow, locked or broken holds nothing up. What goes wrong while writing is logged, the remarks in hand are
    /// dropped, and it goes no further: a thing that is still so is said again the next time the car is driven
    /// (<see cref="CarRemark.Again"/>), which is when it is next seen, and one that is not was not to be kept.
    /// </summary>
    public sealed class CarListRemarkKeeper : IDisposable
    {
        private readonly string _dbPath;
        private readonly Action<string> _log;
        private readonly ConcurrentQueue<CarListRemark> _queue = new ConcurrentQueue<CarListRemark>();
        private int _running;
        private int _disposed;

        /// <param name="dbPath">The store to keep them in; opened for each batch and closed after it.</param>
        public CarListRemarkKeeper(string dbPath, Action<string> log = null)
        {
            _dbPath = dbPath;
            _log = log ?? (_ => { });
        }

        /// <summary>
        /// Queues a remark to be kept. Never blocks on the store and never throws, so it is safe to call from the
        /// telemetry thread — as the follower's event does.
        /// </summary>
        public void Keep(CarRemark remark)
        {
            try
            {
                if (remark == null || Volatile.Read(ref _disposed) != 0) return;
                // One moment stands for both ends of what this remark says of when it was seen; the store keeps the
                // earliest first and the latest last of all it has been given for the same thing.
                DateTime at = remark.SaidAtUtc == default ? DateTime.UtcNow : remark.SaidAtUtc;
                _queue.Enqueue(new CarListRemark
                {
                    CarPath = remark.CarPath, About = remark.About, Text = remark.Text, ListHash = remark.ListHash,
                    FirstSeenUtc = at, LastSeenUtc = at,
                });
                if (Interlocked.CompareExchange(ref _running, 1, 0) == 0) ThreadPool.QueueUserWorkItem(_ => Drain());
            }
            catch (Exception ex)
            {
                // Only a pool that will not take the work, or a log that throws; the telemetry does not hear of it.
                try { _log("car list remarks not queued: " + ex.Message); } catch { }
            }
        }

        /// <summary>Waits, for as long as it is given, until what has been queued has been written or dropped.</summary>
        public bool Flush(TimeSpan patience)
        {
            var until = DateTime.UtcNow + patience;
            while (Volatile.Read(ref _running) != 0 || !_queue.IsEmpty)
            {
                if (DateTime.UtcNow >= until) return false;
                Thread.Sleep(5);
            }
            return true;
        }

        /// <summary>Stops taking remarks and gives what is queued a few seconds to be written.</summary>
        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
            Flush(TimeSpan.FromSeconds(5));
        }

        private void Drain()
        {
            while (true)
            {
                var batch = new List<CarListRemark>();
                while (_queue.TryDequeue(out var remark)) batch.Add(remark);
                if (batch.Count > 0) Write(batch);
                // Let go of the writer's place, then look once more: a remark queued between the last look and
                // letting go would otherwise wait for the next one.
                Volatile.Write(ref _running, 0);
                if (_queue.IsEmpty || Interlocked.CompareExchange(ref _running, 1, 0) != 0) return;
            }
        }

        private void Write(List<CarListRemark> batch)
        {
            try
            {
                using (var store = new RacingDeskStore(_dbPath)) store.KeepCarListRemarks(batch);
            }
            catch (Exception ex)
            {
                try { _log("car list remarks not stored: " + ex.Message); } catch { }
            }
        }
    }
}
