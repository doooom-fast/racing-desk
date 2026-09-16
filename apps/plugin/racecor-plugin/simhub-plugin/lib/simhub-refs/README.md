# SimHub Plugin SDK — Reference DLLs

These DLLs are the SimHub plugin API surface, committed to the repo so the
plugin can compile on CI without a SimHub installation.

## Committed files

| File                     | Purpose                        |
|--------------------------|--------------------------------|
| `GameReaderCommon.dll`   | Telemetry data types           |
| `SimHub.Plugins.dll`     | Plugin interfaces & attributes |
| `SimHub.Logging.dll`     | Logging facade                 |

`log4net` and `Newtonsoft.Json` are pulled from NuGet instead.

## How the build resolves them

The `.csproj` checks for a local SimHub install first (`C:\Program Files (x86)\SimHub\`).
If SimHub isn't present (CI), it falls back to this `lib/simhub-refs/` directory automatically.

## Updating

If a new SimHub version changes the plugin API, copy the updated DLLs from your
SimHub install folder into this directory and commit them:

```bash
# From a Windows machine with SimHub installed:
copy "C:\Program Files (x86)\SimHub\GameReaderCommon.dll" simhub-plugin\lib\simhub-refs\
copy "C:\Program Files (x86)\SimHub\SimHub.Plugins.dll"   simhub-plugin\lib\simhub-refs\
copy "C:\Program Files (x86)\SimHub\SimHub.Logging.dll"   simhub-plugin\lib\simhub-refs\
```
