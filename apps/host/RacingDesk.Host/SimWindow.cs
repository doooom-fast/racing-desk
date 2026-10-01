using System.Text.Json;
using RacingDesk.Core.Screens;

namespace RacingDesk.Host
{
    /// <summary>
    /// The answer to <c>GET /racing-desk/data/simwindow</c>, which the app's HUD asks so that it is drawn on the screen
    /// the sim is on: Electron cannot see another program's windows. Read-only, and nothing of the window but where it is.
    /// </summary>
    internal static class SimWindowApi
    {
        /// <summary>
        /// <c>{ "process", "window": { x, y, width, height }, "monitor": { x, y, width, height } }</c>, in physical
        /// pixels; JSON <c>null</c> when the sim is not running, is minimized or has no window on screen.
        /// </summary>
        public static void Write(Utf8JsonWriter json, SimWindowInfo info)
        {
            if (info == null || !info.Window.IsUsable)
            {
                json.WriteNullValue();
                return;
            }
            json.WriteStartObject();
            json.WriteString("process", info.Process);
            WriteRect(json, "window", info.Window);
            if (info.Monitor.IsUsable) WriteRect(json, "monitor", info.Monitor);
            else json.WriteNull("monitor");
            json.WriteEndObject();
        }

        private static void WriteRect(Utf8JsonWriter json, string name, ScreenRect rect)
        {
            json.WriteStartObject(name);
            json.WriteNumber("x", rect.X);
            json.WriteNumber("y", rect.Y);
            json.WriteNumber("width", rect.Width);
            json.WriteNumber("height", rect.Height);
            json.WriteEndObject();
        }
    }
}
