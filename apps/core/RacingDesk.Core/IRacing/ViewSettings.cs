using System;
using System.Globalization;

namespace RacingDesk.Plugin.IRacing
{
    /// <summary>
    /// The driving view as iRacing keeps it in <c>[View]</c> of <c>app.ini</c>: one set for every car. The sim
    /// writes the file when it exits, so what is there after a run is what the driver left that car with.
    /// A value the file doesn't have, or that isn't a number, is null.
    /// </summary>
    public sealed class ViewSettings
    {
        /// <summary><c>driverHeightAdj</c>, metres. The in-car height keys move it.</summary>
        public double? DriverHeight { get; internal set; }

        /// <summary><c>DrivingVanishY</c>: the view shifted up or down. The in-car horizon keys move it.</summary>
        public double? VanishY { get; internal set; }

        /// <summary><c>DriverHeadHorizon</c>, 0 to 1: how far the head stays level when the car tilts.</summary>
        public double? HeadHorizon { get; internal set; }

        /// <summary><c>drivingCamFOV</c>, degrees.</summary>
        public double? Fov { get; internal set; }

        public bool IsEmpty => DriverHeight == null && VanishY == null && HeadHorizon == null && Fov == null;

        public static ViewSettings Parse(string appIni)
        {
            var view = new ViewSettings();
            if (string.IsNullOrEmpty(appIni)) return view;

            bool inView = false;
            int pos = 0;
            while (pos < appIni.Length)
            {
                int end = appIni.IndexOf('\n', pos);
                if (end < 0) end = appIni.Length;
                string line = appIni.Substring(pos, end - pos).Trim();
                pos = end + 1;

                if (line.Length == 0 || line[0] == ';') continue;
                if (line[0] == '[')
                {
                    // iRacing writes each section once; a second [View] would be somebody's edit, and is read too.
                    inView = line.StartsWith("[View]", StringComparison.OrdinalIgnoreCase);
                    continue;
                }
                if (!inView) continue;

                int equals = line.IndexOf('=');
                if (equals <= 0) continue;
                string key = line.Substring(0, equals).Trim();
                string text = line.Substring(equals + 1);
                int comment = text.IndexOf(';');
                if (comment >= 0) text = text.Substring(0, comment);

                // The sim writes a point whatever the machine's locale.
                double? value = null;
                if (double.TryParse(text.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double n)
                    && !double.IsNaN(n) && !double.IsInfinity(n))
                    value = n;

                if (key.Equals("driverHeightAdj", StringComparison.OrdinalIgnoreCase)) view.DriverHeight = value;
                else if (key.Equals("DrivingVanishY", StringComparison.OrdinalIgnoreCase)) view.VanishY = value;
                else if (key.Equals("DriverHeadHorizon", StringComparison.OrdinalIgnoreCase)) view.HeadHorizon = value;
                else if (key.Equals("drivingCamFOV", StringComparison.OrdinalIgnoreCase)) view.Fov = value;
            }
            return view;
        }
    }
}
