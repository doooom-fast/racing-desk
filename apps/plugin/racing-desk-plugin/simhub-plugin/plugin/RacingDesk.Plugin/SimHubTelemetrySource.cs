using GameReaderCommon;
using RacingDesk.Plugin.Engine;
using SimHub.Plugins;

namespace RacingDesk.Plugin
{
    /// <summary>Adapts SimHub's PluginManager + GameData to RacingDesk.Core's telemetry source.</summary>
    internal sealed class SimHubTelemetrySource : ITelemetrySource, IPlayerNameSource
    {
        public PluginManager PluginManager { get; set; }
        public GameData Data { get; set; }

        /// <summary>
        /// The plugin's own reading of the session (the SDK bridge), which names each car by its customer id. Without one
        /// (another sim, the bridge not up) an opponent is still named from the list, keyed on the name SimHub gives.
        /// </summary>
        public IRacingSdkBridge Names { get; set; }

        public bool GameRunning => Data != null && Data.GameRunning;
        public string GameName => Data?.GameName;
        public object NewData => Data?.NewData;
        public object GetPropertyValue(string fullName) => PluginManager?.GetPropertyValue(fullName);

        /// <summary>
        /// Where other drivers' names leave SimHub and enter the plugin's path: the real name goes to the bridge and no
        /// further, and what comes back is the character's — or his own, for his own car (root CLAUDE.md, Other drivers' names).
        /// </summary>
        public string OpponentName(object opponent)
        {
            if (!(opponent is Opponent opp)) return null;
            var names = Names;
            if (names == null) return opp.IsPlayer ? opp.Name : RacingDesk.Core.Names.PseudonymBook.Default.NewSession().For(0, opp.Name);
            return names.OpponentName(opp.CarNumber, opp.Name, opp.IsPlayer);
        }

        /// <summary>SimHub's PlayerName, unless the bridge's session says a teammate is driving his car.</summary>
        public string PlayerName(string given) => Names?.PlayerName(given) ?? given;
    }
}
