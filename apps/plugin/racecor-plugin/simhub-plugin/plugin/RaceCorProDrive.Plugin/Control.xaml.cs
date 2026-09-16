using System;
using System.IO;
using System.Reflection;
using System.Windows.Controls;
using System.Windows.Media.Imaging;

namespace RaceCorProDrive.Plugin
{
    public partial class SettingsControl : UserControl
    {
        private readonly Plugin _plugin;

        public SettingsControl(Plugin plugin)
        {
            _plugin = plugin;
            InitializeComponent();

            // Load logo (sits next to the plugin DLL on disk).
            try
            {
                var asmDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? "";
                var iconPath = Path.Combine(asmDir, "icon.png");
                if (File.Exists(iconPath))
                {
                    BrandLogo.Source = new BitmapImage(new Uri(iconPath));
                }
            }
            catch { /* non-critical */ }

            // Show the plugin's current version. The updater used to
            // live here; it now lives in the WinUI host (RaceCor Pro
            // Drive → Settings → System → Updates), which is the
            // user's primary surface. Keeping a static version label
            // here so SimHub admins can still verify what's loaded.
            VersionLabel.Text = "Plugin version: v" + ReadAssemblyVersion();
        }

        private static string ReadAssemblyVersion()
        {
            var asm = Assembly.GetExecutingAssembly();
            var info = asm.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
            if (!string.IsNullOrWhiteSpace(info))
            {
                var plus = info.IndexOf('+');
                return plus > 0 ? info.Substring(0, plus) : info;
            }
            var ver = asm.GetName().Version;
            return ver != null ? ver.Major + "." + ver.Minor + "." + ver.Build : "0.0.0";
        }
    }
}
