using GameReaderCommon;
using RacingDesk.Core.Names;
using RacingDesk.Plugin.Engine;
using SimHub.Plugins;

namespace RacingDesk.Plugin
{
    /// <summary>Adapts SimHub's PluginManager + GameData to RacingDesk.Core's telemetry source.</summary>
    internal sealed class SimHubTelemetrySource : ITelemetrySource, IPlayerNameSource
    {
        public PluginManager PluginManager { get; set; }
        public GameData Data { get; set; }

        // Every name that leaves SimHub goes through this one object (Names/SimHubNaming, in RacingDesk.Core, where the
        // tests run it): it is the whole of the naming, and this class only reads the three facts off SimHub's opponent.
        private readonly SimHubNaming _naming = new SimHubNaming();

        /// <summary>
        /// The plugin's own reading of the iRacing session (the SDK bridge), which names each car by its customer id.
        /// </summary>
        public IRacingSdkBridge Names { get => _naming.Bridge; set => _naming.Bridge = value; }

        public bool GameRunning => Data != null && Data.GameRunning;
        public string GameName => Data?.GameName;
        public object NewData => Data?.NewData;
        public object GetPropertyValue(string fullName) => PluginManager?.GetPropertyValue(fullName);

        /// <summary>
        /// Where other drivers' names leave SimHub and enter the plugin's path: the real name goes to
        /// <see cref="SimHubNaming"/> and no further, and what comes back is the character's — or his own, for his own car
        /// (root CLAUDE.md, Other drivers' names).
        /// </summary>
        public string OpponentName(object opponent) =>
            opponent is Opponent opp ? _naming.Opponent(GameName, opp.CarNumber, opp.Name, opp.IsPlayer) : null;

        /// <summary>SimHub's PlayerName, unless the session says a teammate is driving his car, and none before it is read.</summary>
        public string PlayerName(string given) => _naming.Player(GameName, given);
    }
}
