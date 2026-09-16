using System.Collections.Generic;

namespace RaceCorProDrive.Plugin.Engine
{
    /// <summary>
    /// Abstraction for incident detection across different simulators.
    /// iRacing implementation uses SDK incident count and CarIdx arrays.
    /// Generic implementation (future) uses physics heuristics only.
    /// </summary>
    public interface IIncidentDetector
    {
        /// <summary>
        /// Detect whether a new incident occurred between the current and previous frames.
        /// </summary>
        /// <param name="current">Current telemetry frame.</param>
        /// <param name="previous">Previous telemetry frame.</param>
        /// <returns>True if a new incident was detected.</returns>
        bool IsIncidentDetected(TelemetrySnapshot current, TelemetrySnapshot previous);

        /// <summary>
        /// Get the severity of the most recently detected incident.
        /// For iRacing: 1 (1x), 2 (2x), or 4 (4x).
        /// </summary>
        int GetIncidentSeverity();

        /// <summary>
        /// Build a list of all drivers near the player at the current moment.
        /// Should be called immediately after IsIncidentDetected returns true.
        /// </summary>
        /// <param name="current">Current telemetry frame with CarIdx data.</param>
        /// <returns>List of nearby drivers with gap and speed data.</returns>
        List<Models.NearbyDriver> GetNearbyDrivers(TelemetrySnapshot current);
    }
}
