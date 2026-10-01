using System;
using System.Collections.Generic;

namespace RacingDesk.Core.Screens
{
    /// <summary>
    /// The monitor the sim is shown on, for what looks at the picture (the ambient sampler): the one Windows has most of
    /// the sim's window on, found as the host's <c>/racing-desk/data/simwindow</c> route finds it; while the sim has no
    /// window on screen, or it cannot be looked for, the primary monitor. In physical pixels, on the virtual screen.
    ///
    /// What is found is kept for <see cref="LookEveryMs"/>: finding the sim's window lists every process on the rig, and
    /// the sampler asks four times a second. Not thread-safe: it is one thread's.
    /// </summary>
    public sealed class SimMonitor
    {
        /// <summary>How long what was found is kept before it is looked for again.</summary>
        public const long LookEveryMs = 2000;

        /// <summary>Why the monitor is the one it is.</summary>
        public enum Reason
        {
            /// <summary>Nothing was found: Windows listed no monitor, or could not be asked.</summary>
            None,
            /// <summary>The sim's window is on it.</summary>
            Sim,
            /// <summary>The sim has no window on screen, or it could not be looked for: the primary.</summary>
            Primary,
        }

        private readonly ISimWindowSource _sim;
        private readonly IMonitorSource _monitors;
        private bool _looked;
        private long _lookedAt;
        private ScreenRect _monitor;
        private Reason _why;

        /// <summary>Windows's: the sim's window as the host finds it, and the monitors as it lists them.</summary>
        public SimMonitor() : this(new Win32SimWindowSource(), new Win32MonitorSource())
        {
        }

        public SimMonitor(ISimWindowSource sim, IMonitorSource monitors)
        {
            _sim = sim;
            _monitors = monitors;
        }

        /// <summary>Why the monitor <see cref="Current"/> last gave is the one it is.</summary>
        public Reason Why => _why;

        /// <summary>
        /// The monitor to look at now; not usable when there is none. Looked for again once <see cref="LookEveryMs"/>
        /// has passed since the last look, by <paramref name="nowMs"/> (a clock that only goes forward; one that went
        /// back is looked for again too), and after <see cref="Forget"/>.
        /// </summary>
        public ScreenRect Current(long nowMs)
        {
            if (!_looked || nowMs - _lookedAt >= LookEveryMs || nowMs < _lookedAt)
            {
                _monitor = Choose(_sim, _monitors, out _why);
                _lookedAt = nowMs;
                _looked = true;
            }
            return _monitor;
        }

        /// <summary>Looked for afresh at the next <see cref="Current"/>: the screens may have changed under what was found.</summary>
        public void Forget()
        {
            _looked = false;
        }

        /// <summary>
        /// The monitor the sim's window is on, as the source says; if it names none, the listed monitor with most of the
        /// window; with no window, the primary monitor. A source that throws is one that did not say, and nothing
        /// thrown goes further.
        /// </summary>
        public static ScreenRect Choose(ISimWindowSource sim, IMonitorSource monitors, out Reason why)
        {
            SimWindowInfo info;
            try { info = sim?.Find(); }
            catch (Exception) { info = null; }

            if (info != null && info.Window.IsUsable && info.Monitor.IsUsable)
            {
                why = Reason.Sim;
                return info.Monitor;
            }

            IReadOnlyList<MonitorInfo> listed;
            try { listed = monitors?.List(); }
            catch (Exception) { listed = null; }

            if (info != null && info.Window.IsUsable)
            {
                var holding = MostOf(info.Window, listed);
                if (holding.IsUsable)
                {
                    why = Reason.Sim;
                    return holding;
                }
            }

            if (listed != null)
            {
                foreach (var monitor in listed)
                {
                    if (monitor != null && monitor.Primary && monitor.Bounds.IsUsable)
                    {
                        why = Reason.Primary;
                        return monitor.Bounds;
                    }
                }
            }

            why = Reason.None;
            return new ScreenRect();
        }

        // The listed monitor with most of the window on it; the first of equals. Not usable when it is on none.
        private static ScreenRect MostOf(ScreenRect window, IReadOnlyList<MonitorInfo> listed)
        {
            var best = new ScreenRect();
            long most = 0;
            if (listed == null) return best;
            foreach (var monitor in listed)
            {
                if (monitor == null || !monitor.Bounds.IsUsable) continue;
                long share = Overlap(window, monitor.Bounds);
                if (share > most)
                {
                    most = share;
                    best = monitor.Bounds;
                }
            }
            return best;
        }

        private static long Overlap(ScreenRect a, ScreenRect b)
        {
            long w = Math.Min((long)a.X + a.Width, (long)b.X + b.Width) - Math.Max(a.X, b.X);
            long h = Math.Min((long)a.Y + a.Height, (long)b.Y + b.Height) - Math.Max(a.Y, b.Y);
            return w > 0 && h > 0 ? w * h : 0;
        }
    }
}
