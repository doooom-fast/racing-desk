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

        /// <summary>
        /// What an entry of <c>NewData.Opponents</c> is called wherever it is shown or sent: the driver's own name for his
        /// own car, and for every other car the name the source gives it from the list of characters
        /// (<c>RacingDesk.Core.Names</c>). A real name of another driver never leaves the source: the engine reads no
        /// opponent's <c>Name</c> itself, it asks here. Null for an entry the source cannot name.
        /// </summary>
        string OpponentName(object opponent);
    }

    /// <summary>
    /// A source that can tell when the name its sim gives for the player (<c>NewData.PlayerName</c>) is not his: a teammate
    /// driving his car in a team race, who is another driver. It says what to call the player instead; a source without it
    /// is taken at its word. (The host's source needs none: its session model names the teammate where it is parsed.)
    /// </summary>
    public interface IPlayerNameSource
    {
        /// <summary>The name to show for the player: <paramref name="given"/> when it is his, a character's when it is not.</summary>
        string PlayerName(string given);
    }
}
