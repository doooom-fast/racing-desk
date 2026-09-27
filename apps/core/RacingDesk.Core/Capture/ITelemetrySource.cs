namespace RacingDesk.Plugin.Engine
{
    /// <summary>
    /// One frame of game data, in SimHub's vocabulary. The SimHub plugin wraps PluginManager + GameData;
    /// the standalone host implements the same names from the iRacing SDK directly.
    /// </summary>
    public interface ITelemetrySource
    {
        bool GameRunning { get; }

        /// <summary>SimHub game name, e.g. "IRacing".</summary>
        string GameName { get; }

        /// <summary>
        /// Normalized game data, read by property name (SimHub's StatusDataBase names: SpeedKmh, Rpms,
        /// Gear, Opponents, PlayerName, ...). Null when no data is available.
        /// </summary>
        object NewData { get; }

        /// <summary>A SimHub property by full name, e.g. "DataCorePlugin.GameRawData.Telemetry.SessionState".</summary>
        object GetPropertyValue(string fullName);
    }
}
