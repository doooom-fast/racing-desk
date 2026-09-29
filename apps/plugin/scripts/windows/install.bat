@echo off
setlocal enabledelayedexpansion

:: ================================================================
::  The Racing Desk - SimHub Plugin Build & Install
:: ================================================================
::
::  Stops SimHub, builds the plugin, copies the build output + the
::  racingdesk-data dataset folder into SimHub's install
::  directory, and relaunches SimHub.
::
::  The csproj is already wired so that when SimHub is detected on
::  this machine its OutputPath points at $(SimHubPath) directly -
::  meaning `dotnet build` drops the DLL straight into SimHub. This
::  script handles everything around that: kill, build, copy data,
::  restart.
::
::  Usage:
::    install.bat                  Release build, auto-detect SimHub
::    install.bat Debug            Debug build
::    set SIMHUB_PATH=C:\...\SimHub install.bat   Explicit path
::
::  Requires:
::    - .NET SDK on PATH (dotnet --version)
::    - SimHub installed at default location, or SIMHUB_PATH set
:: ================================================================

set CONFIG=%~1
if "%CONFIG%"=="" set CONFIG=Release

set "SCRIPT_DIR=%~dp0"
:: This script lives in <repo>/scripts/windows/. Repo root is two up.
set "REPO_ROOT=%SCRIPT_DIR%..\.."
set "PLUGIN_REPO=%REPO_ROOT%\racing-desk-plugin"
set "PLUGIN_PROJ=%PLUGIN_REPO%\simhub-plugin\plugin\RacingDesk.Plugin\RacingDesk.Plugin.csproj"
set "DATA_DIR=%PLUGIN_REPO%\simhub-plugin\racingdesk-data"

echo.
echo  ============================================
echo   The Racing Desk - SimHub Plugin Install
echo  ============================================

:: -- 1. Resolve SimHub path --------------------------------------
set "SH="
if defined SIMHUB_PATH (
    if exist "!SIMHUB_PATH!\SimHubWPF.exe" set "SH=!SIMHUB_PATH!"
)
if "!SH!"=="" if exist "C:\Program Files (x86)\SimHub\SimHubWPF.exe" (
    set "SH=C:\Program Files (x86)\SimHub"
)
if "!SH!"=="" if exist "C:\Program Files\SimHub\SimHubWPF.exe" (
    set "SH=C:\Program Files\SimHub"
)
if "!SH!"=="" (
    echo.
    echo  ERROR: SimHub not found.
    echo         Install SimHub or set SIMHUB_PATH explicitly:
    echo         set SIMHUB_PATH=C:\Path\To\SimHub
    echo.
    pause
    exit /b 1
)
:: Strip trailing backslash if any
if "!SH:~-1!"=="\" set "SH=!SH:~0,-1!"
set "SH_EXE=!SH!\SimHubWPF.exe"

echo.
echo  Config:    %CONFIG%
echo  SimHub:    !SH!
echo  Project:   %PLUGIN_PROJ%
echo  Data:      %DATA_DIR%
echo.

:: -- 2. Verify project + data exist -----------------------------
if not exist "%PLUGIN_PROJ%" (
    echo  ERROR: Plugin project not found at:
    echo         %PLUGIN_PROJ%
    pause
    exit /b 1
)
if not exist "%DATA_DIR%\" (
    echo  ERROR: Dataset directory not found at:
    echo         %DATA_DIR%
    pause
    exit /b 1
)

:: -- 3. Stop SimHub ---------------------------------------------
:: Order: PowerShell Stop-Process first (works in Parallels VMs
:: where taskkill may lack perms), then taskkill as fallback.
echo  [1/4] Stopping SimHub (if running)...
:: Remember whether it was up BEFORE stopping it: only then is it started again at the end. Installing
:: while SimHub is closed must not open it - nothing starts on this rig that the user didn't start.
set "WAS_RUNNING=0"
powershell -NoProfile -Command "if (Get-Process -Name 'SimHubWPF' -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }" 2>NUL
if !ERRORLEVEL! NEQ 0 set "WAS_RUNNING=1"
for %%P in (SimHubWPF SimHub SimHubElectron) do (
    powershell -NoProfile -Command "if (Get-Process -Name '%%P' -ErrorAction SilentlyContinue) { Stop-Process -Name '%%P' -Force -ErrorAction SilentlyContinue }" 2>NUL
)
:: Confirm it's down so the DLL/data copies don't hit file locks. The waits are PowerShell's: `timeout` quits at
:: once ("Input redirection is not supported") when this runs without a console of its own, as from a tool.
for /L %%I in (1,1,15) do (
    powershell -NoProfile -Command "if (-not (Get-Process -Name 'SimHubWPF' -ErrorAction SilentlyContinue)) { exit 0 } else { exit 1 }" 2>NUL
    if !ERRORLEVEL! == 0 goto :stopped
    set "WAS_RUNNING=1"
    powershell -NoProfile -Command "Start-Sleep -Seconds 1" >NUL 2>&1
)
echo        WARNING: SimHub still running after 15s; force-killing.
taskkill /F /IM SimHubWPF.exe /T >NUL 2>&1
powershell -NoProfile -Command "Start-Sleep -Seconds 2" >NUL 2>&1
:: A SimHub started as administrator - by its own "run elevated" scheduled task, as on this rig - cannot be ended
:: from a console that is not: Stop-Process and taskkill are both refused. Say so and install nothing, rather than
:: copy over a DLL it holds.
powershell -NoProfile -Command "if (Get-Process -Name 'SimHubWPF' -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }" 2>NUL
if !ERRORLEVEL! NEQ 0 (
    echo.
    echo  ERROR: SimHub could not be closed. It is probably running as administrator.
    echo         Exit it from its tray icon ^(right-click, Exit^) and run this again.
    echo.
    pause
    exit /b 1
)

:stopped
:: Tiny grace so the OS releases file handles.
powershell -NoProfile -Command "Start-Sleep -Seconds 1" >NUL 2>&1

:: Belt-and-braces: kill any other PowerShell / pwsh process that
:: pinned the plugin DLL via [Reflection.Assembly]::LoadFrom (e.g. an
:: ad-hoc diagnostic shell from earlier in the session). Excludes
:: this script's own parent shell so we don't terminate ourselves.
:: The DLL stays loaded for the AppDomain lifetime, blocking the
:: build's overwrite step with MSB3021 / MSB3027.
powershell -NoProfile -Command "$self = $PID; Get-Process powershell, pwsh -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $self -and $_.Id -ne $env:PROCESSOR_ID } | ForEach-Object { try { if ($_.Modules | Where-Object { $_.FileName -eq '!SH!\RacingDesk.dll' }) { Write-Host (\"       Releasing DLL lock held by PowerShell PID \" + $_.Id); Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } } catch {} }" 2>NUL

echo        OK.

:: -- 4. Build plugin --------------------------------------------
:: Set SIMHUB_PATH for the csproj so OutputPath points at SimHub
:: (it already does this when SimHub is detected; we're explicit
:: so the build is deterministic regardless of how SimHub was found).
::
:: CRITICAL: SIMHUB_PATH must end with '\' for the csproj's HintPaths
:: to resolve. They're written as `$(SimHubPath)GameReaderCommon.dll`
:: (no separator between path and filename), so a missing trailing
:: backslash mashes the dir into the filename and every SimHub
:: reference (GameReaderCommon, SimHub.Plugins, SimHub.Logging)
:: silently fails to resolve - producing a wall of CS0246 errors.
set "SIMHUB_PATH=!SH!\"
echo  [2/4] Building plugin (%CONFIG%)...
:: Build always lands in build/ (never directly in SimHub) so we can
:: pick exactly what to copy.
set "STAGE=%PLUGIN_REPO%\simhub-plugin\build"
dotnet build "%PLUGIN_PROJ%" -c %CONFIG% --nologo
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  ============================================
    echo   BUILD FAILED - SimHub will not be restarted
    echo  ============================================
    pause
    exit /b 1
)
if not exist "%STAGE%\RacingDesk.dll" (
    echo  ERROR: Build did not produce RacingDesk.dll at %STAGE%
    pause
    exit /b 1
)
echo        OK.

:: -- 4b. Surgical copy into SimHub ------------------------------
:: Copy ONLY the files we own + clearly-third-party deps SimHub
:: doesn't ship. NEVER copy BCL polyfills (System.Buffers, System.
:: Memory, System.Threading.Tasks.Extensions, Microsoft.NET.StringTools,
:: etc.) or shared libs SimHub already has (Newtonsoft.Json, log4net) -
:: SimHub does strict patch-version checks at startup and a single
:: mismatch silently disables its entire plugin manager.
echo  [3/4] Installing plugin files...
:: The plugin was RaceCorProDrive.dll (with RaceCor.Core.dll beside it) until
:: 2026-09-27; SimHub would load both. Clear the old files first.
for %%F in (RaceCorProDrive.dll RaceCorProDrive.pdb RaceCor.Core.dll RaceCor.Core.pdb) do (
    if exist "!SH!\%%F" (
        del /F /Q "!SH!\%%F" 2>NUL
        echo        Removed the old %%F
    )
)
if exist "!SH!\racecorprodrive-data\" (
    rmdir /S /Q "!SH!\racecorprodrive-data"
    echo        Removed the old racecorprodrive-data
)
:: Allow-list. Add to this set when you genuinely need a new third-
:: party dep that SimHub doesn't ship.
set "COPY_LIST=RacingDesk.dll RacingDesk.pdb RacingDesk.Core.dll RacingDesk.Core.pdb IRSDKSharper.dll Fleck.dll MessagePack.dll MessagePack.Annotations.dll"
for %%F in (%COPY_LIST%) do (
    if exist "%STAGE%\%%F" (
        copy /Y "%STAGE%\%%F" "!SH!\%%F" >NUL
        if !ERRORLEVEL! NEQ 0 (
            echo  ERROR: Failed to copy %%F to !SH!
            pause
            exit /b 1
        )
        echo        Copied %%F
    )
)
:: Sanity-check the must-have files landed.
if not exist "!SH!\RacingDesk.dll" (
    echo  ERROR: RacingDesk.dll didn't land in !SH! after copy.
    pause
    exit /b 1
)

:: Dataset.
if not exist "!SH!\racingdesk-data\" mkdir "!SH!\racingdesk-data"
xcopy /E /Y /Q "%DATA_DIR%\*" "!SH!\racingdesk-data\" >NUL
if %ERRORLEVEL% NEQ 0 (
    echo  ERROR: Dataset copy failed.
    pause
    exit /b 1
)
echo        Dataset OK.

:: -- 4c. Unblock files (Mark-of-the-Web) -----------------------
:: Files copied from a network share or downloaded over the internet
:: get tagged with a Zone.Identifier NTFS stream. SimHub silently
:: refuses to load tagged plugin DLLs.
echo  [3b]  Unblocking plugin files (Mark-of-the-Web)...
powershell -NoProfile -Command "Get-ChildItem '!SH!' -Filter 'RacingDesk*.*' -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue; Get-ChildItem '!SH!' -Filter 'IRSDKSharper.dll','Fleck.dll','MessagePack*.dll' -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue; Get-ChildItem '!SH!\racingdesk-data' -Recurse -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue" 2>NUL
echo        OK.

:: -- 6. Restart SimHub ------------------------------------------
if "!WAS_RUNNING!"=="0" (
    echo  [4/4] SimHub wasn't running, so it isn't started. The plugin loads next time it is.
    goto :finished
)
echo  [4/4] Launching SimHub...
echo        Path: !SH_EXE!
:: Reset ERRORLEVEL so the if-exist check below is clean.
cmd /c "exit /b 0"
if not exist "!SH_EXE!" (
    echo  ERROR: SimHubWPF.exe not found at !SH_EXE!
    pause
    exit /b 1
)
:: The way SimHub starts itself where it has one: its own "run elevated" scheduled task, which starts it as
:: administrator without a UAC prompt. Otherwise the exe, as a shortcut would.
powershell -NoProfile -Command "$t = Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.Actions | Where-Object { $_.Execute -like '*\SimHubWPF.exe' } } | Select-Object -First 1; if ($t) { Start-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath; exit 0 } else { exit 1 }" 2>NUL
if !ERRORLEVEL! NEQ 0 (
    start "" "!SH_EXE!"
    if !ERRORLEVEL! NEQ 0 (
        echo        WARNING: 'start' returned !ERRORLEVEL!, retrying directly...
        "!SH_EXE!"
    )
)
echo        OK.

:finished
echo.
echo  ============================================
echo   Done. The Racing Desk plugin installed.
echo  ============================================
echo.

endlocal
exit /b 0
