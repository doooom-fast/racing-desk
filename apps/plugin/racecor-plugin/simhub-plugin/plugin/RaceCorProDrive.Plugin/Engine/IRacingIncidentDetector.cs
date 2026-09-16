using System;
using System.Collections.Generic;
using RaceCorProDrive.Plugin.Models;

namespace RaceCorProDrive.Plugin.Engine
{
    /// <summary>
    /// iRacing-specific incident detection using SDK incident count and opponent data.
    /// Detects incidents via IncidentCount delta and builds proximity lists from
    /// nearest-ahead/behind opponent data (CarIdx arrays are not yet exposed in the
    /// normalized snapshot, so we use the available gap + name fields).
    /// </summary>
    public class IRacingIncidentDetector : IIncidentDetector
    {
        // ── State ────────────────────────────────────────────────────────
        private int _lastIncidentCount = -1;
        private int _incidentDelta;

        // ── IIncidentDetector ────────────────────────────────────────────

        /// <inheritdoc/>
        public bool IsIncidentDetected(TelemetrySnapshot current, TelemetrySnapshot previous)
        {
            if (current == null || previous == null) return false;
            if (!current.GameRunning) return false;

            // First frame: initialize baseline
            if (_lastIncidentCount < 0)
            {
                _lastIncidentCount = current.IncidentCount;
                return false;
            }

            _incidentDelta = current.IncidentCount - _lastIncidentCount;
            _lastIncidentCount = current.IncidentCount;

            return _incidentDelta > 0;
        }

        /// <inheritdoc/>
        public int GetIncidentSeverity()
        {
            return _incidentDelta;
        }

        /// <inheritdoc/>
        public List<NearbyDriver> GetNearbyDrivers(TelemetrySnapshot current)
        {
            var nearby = new List<NearbyDriver>();
            if (current == null) return nearby;

            // Use the normalized nearest-ahead/behind data available in TelemetrySnapshot.
            // These come from IRacingExtraProperties or opponent reflection in Capture.cs.
            if (!string.IsNullOrEmpty(current.NearestAheadName) && current.NearestAheadName != "—")
            {
                nearby.Add(new NearbyDriver
                {
                    CarIdx = -1, // Not available from normalized data
                    Name = current.NearestAheadName,
                    IRating = current.NearestAheadRating,
                    GapToPlayer = current.GapAhead,
                    RelativeSpeed = 0, // Would need consecutive frames to compute
                    OnPitRoad = false,
                    LapDistPct = ClampTrackPosition(current.TrackPositionPct + EstimateTrackFraction(current.GapAhead, current.SpeedKmh))
                });
            }

            if (!string.IsNullOrEmpty(current.NearestBehindName) && current.NearestBehindName != "—")
            {
                nearby.Add(new NearbyDriver
                {
                    CarIdx = -1,
                    Name = current.NearestBehindName,
                    IRating = current.NearestBehindRating,
                    GapToPlayer = -current.GapBehind, // Negative = behind
                    RelativeSpeed = 0,
                    OnPitRoad = false,
                    LapDistPct = ClampTrackPosition(current.TrackPositionPct - EstimateTrackFraction(current.GapBehind, current.SpeedKmh))
                });
            }

            return nearby;
        }

        /// <summary>Reset state for a new session.</summary>
        public void Reset()
        {
            _lastIncidentCount = -1;
            _incidentDelta = 0;
        }

        // ── Helpers ──────────────────────────────────────────────────────

        /// <summary>
        /// Estimate track fraction from gap time and speed.
        /// Rough approximation: gapSeconds * speedKmh / (3.6 * trackLength).
        /// Since we don't have track length, use a normalized estimate.
        /// </summary>
        private static double EstimateTrackFraction(double gapSeconds, double speedKmh)
        {
            if (speedKmh <= 0 || gapSeconds <= 0) return 0;
            // Assume ~4km average track length for rough estimation
            double speedMs = speedKmh / 3.6;
            double distanceM = gapSeconds * speedMs;
            return distanceM / 4000.0;
        }

        private static double ClampTrackPosition(double pct)
        {
            while (pct < 0) pct += 1.0;
            while (pct >= 1.0) pct -= 1.0;
            return pct;
        }
    }
}
