using GameReaderCommon;
using RaceCorProDrive.Plugin.Engine;
using SimHub.Plugins;

namespace RaceCorProDrive.Plugin
{
    /// <summary>Adapts SimHub's PluginManager + GameData to RaceCor.Core's telemetry source.</summary>
    internal sealed class SimHubTelemetrySource : ITelemetrySource
    {
        public PluginManager PluginManager { get; set; }
        public GameData Data { get; set; }

        public bool GameRunning => Data != null && Data.GameRunning;
        public string GameName => Data?.GameName;
        public object NewData => Data?.NewData;
        public object GetPropertyValue(string fullName) => PluginManager?.GetPropertyValue(fullName);
    }
}
