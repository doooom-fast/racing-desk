using System.Collections.Generic;
using System.Text.Json;
using RacingDesk.Core.Screens;

namespace RacingDesk.Host
{
    /// <summary>
    /// The answer to <c>GET /racing-desk/data/monitors</c>, which the app's HUD asks so that a screen is named by the size
    /// it really has: Electron gives a screen's size in device-independent pixels, rounded up, and at 175 % that cannot be
    /// turned back into the panel's own (823 wide is 1440 physical here, but 1439 is 823 wide too). Read-only, and
    /// nothing of the monitors but where they are.
    /// </summary>
    internal static class MonitorsApi
    {
        /// <summary><c>[ { "x", "y", "width", "height", "primary" } ]</c>, in physical pixels, a monitor with no size left out.</summary>
        public static void Write(Utf8JsonWriter json, IReadOnlyList<MonitorInfo> monitors)
        {
            json.WriteStartArray();
            if (monitors != null)
            {
                foreach (var monitor in monitors)
                {
                    if (monitor == null || !monitor.Bounds.IsUsable) continue;
                    json.WriteStartObject();
                    json.WriteNumber("x", monitor.Bounds.X);
                    json.WriteNumber("y", monitor.Bounds.Y);
                    json.WriteNumber("width", monitor.Bounds.Width);
                    json.WriteNumber("height", monitor.Bounds.Height);
                    json.WriteBoolean("primary", monitor.Primary);
                    json.WriteEndObject();
                }
            }
            json.WriteEndArray();
        }
    }
}
