@echo off
setlocal enabledelayedexpansion

:: -------------------------------------------------------------------
:: The Racing Desk — Windows Installer
::
:: Installs the SimHub plugin (DLL + datasets).
:: Stream Deck plugin is handled by the Inno Setup installer (.iss).
::
:: Usage:
::   install.bat                     — auto-detect SimHub
::   set SIMHUB_PATH=C:\...\SimHub  — override SimHub location
:: -------------------------------------------------------------------

echo.
echo  ============================================
echo   The Racing Desk — Installer
echo  ============================================
echo.

:: -------------------------------------------------------------------
:: Resolve paths relative to this script
:: -------------------------------------------------------------------

set "SCRIPT_DIR=%~dp0"
:: Repo root is two levels up from scripts\windows\
set "PLUGIN_ROOT=%SCRIPT_DIR%..\.."

:: Overlay repo is a sibling directory
set "OVERLAY_ROOT=%PLUGIN_ROOT%\..\racing-desk-overlay"

:: -------------------------------------------------------------------
:: Verify required source files exist
:: -------------------------------------------------------------------

if not exist "%PLUGIN_ROOT%\RacingDesk.dll" (
    echo [ERROR] RacingDesk.dll not found in repo root.
    echo         Build the plugin first: dotnet build
    goto :error
)

if not exist "%PLUGIN_ROOT%\racingdesk-data\" (
    echo [ERROR] racingdesk-data directory not found.
    goto :error
)

:: -------------------------------------------------------------------
:: Find SimHub installation
:: -------------------------------------------------------------------

if defined SIMHUB_PATH (
    echo  Using SIMHUB_PATH: %SIMHUB_PATH%
    goto :validate_simhub
)

:: Check default install locations
if exist "C:\Program Files (x86)\SimHub\SimHubWPF.exe" (
    set "SIMHUB_PATH=C:\Program Files (x86)\SimHub"
    echo  Found SimHub: !SIMHUB_PATH!
    goto :validate_simhub
)

if exist "C:\Program Files\SimHub\SimHubWPF.exe" (
    set "SIMHUB_PATH=C:\Program Files\SimHub"
    echo  Found SimHub: !SIMHUB_PATH!
    goto :validate_simhub
)

echo [ERROR] SimHub not found. Set SIMHUB_PATH and re-run.
echo         Example: set SIMHUB_PATH=C:\Program Files (x86)\SimHub
goto :error

:validate_simhub
if not exist "%SIMHUB_PATH%\SimHubWPF.exe" (
    echo [ERROR] SimHubWPF.exe not found in %SIMHUB_PATH%
    echo         Is this a valid SimHub installation?
    goto :error
)

:: -------------------------------------------------------------------
:: Check if SimHub is running
:: -------------------------------------------------------------------

tasklist /FI "IMAGENAME eq SimHubWPF.exe" 2>NUL | find /I "SimHubWPF.exe" >NUL
if %ERRORLEVEL% equ 0 (
    echo.
    echo  [WARNING] SimHub is currently running.
    echo            Close SimHub before installing, or restart it after.
    echo.
)

:: -------------------------------------------------------------------
:: Install SimHub Plugin
:: -------------------------------------------------------------------

echo  Installing SimHub plugin...

:: Copy DLL
:: The plugin was RaceCorProDrive.dll until 2026-09-27; SimHub would load both. Clear the old one first.
if exist "%SIMHUB_PATH%\RaceCorProDrive.dll" (
    del /F /Q "%SIMHUB_PATH%\RaceCorProDrive.dll" "%SIMHUB_PATH%\RaceCorProDrive.pdb" 2>NUL
    echo    Removed the old RaceCorProDrive.dll
)
if exist "%SIMHUB_PATH%\racecorprodrive-data\" (
    rmdir /S /Q "%SIMHUB_PATH%\racecorprodrive-data"
    echo    Removed the old racecorprodrive-data
)
copy /Y "%PLUGIN_ROOT%\RacingDesk.dll" "%SIMHUB_PATH%\RacingDesk.dll" >NUL
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to copy RacingDesk.dll
    goto :error
)
echo    Copied RacingDesk.dll

:: Copy PDB if present (optional — debug symbols)
if exist "%PLUGIN_ROOT%\RacingDesk.pdb" (
    copy /Y "%PLUGIN_ROOT%\RacingDesk.pdb" "%SIMHUB_PATH%\RacingDesk.pdb" >NUL
    echo    Copied RacingDesk.pdb
)

:: Copy dataset directory
echo    Copying datasets...
if not exist "%SIMHUB_PATH%\racingdesk-data\" mkdir "%SIMHUB_PATH%\racingdesk-data"
xcopy /E /Y /Q "%PLUGIN_ROOT%\racingdesk-data\*" "%SIMHUB_PATH%\racingdesk-data\" >NUL
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to copy dataset files
    goto :error
)
echo    Copied racingdesk-data

echo.
echo  SimHub plugin installed successfully.
echo.

:: -------------------------------------------------------------------
:: Done
:: -------------------------------------------------------------------

:done
echo  ============================================
echo   Installation complete
echo  ============================================
echo.
exit /b 0

:error
echo.
echo  Installation failed.
echo.
exit /b 1
