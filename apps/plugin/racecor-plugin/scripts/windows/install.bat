@echo off
setlocal enabledelayedexpansion

:: -------------------------------------------------------------------
:: RaceCor Pro Drive — Windows Installer
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
echo   RaceCor Pro Drive — Installer
echo  ============================================
echo.

:: -------------------------------------------------------------------
:: Resolve paths relative to this script
:: -------------------------------------------------------------------

set "SCRIPT_DIR=%~dp0"
:: Repo root is two levels up from scripts\windows\
set "PLUGIN_ROOT=%SCRIPT_DIR%..\.."

:: Overlay repo is a sibling directory
set "OVERLAY_ROOT=%PLUGIN_ROOT%\..\racecor-overlay"

:: -------------------------------------------------------------------
:: Verify required source files exist
:: -------------------------------------------------------------------

if not exist "%PLUGIN_ROOT%\RaceCorProDrive.dll" (
    echo [ERROR] RaceCorProDrive.dll not found in repo root.
    echo         Build the plugin first: dotnet build
    goto :error
)

if not exist "%PLUGIN_ROOT%\racecorprodrive-data\" (
    echo [ERROR] racecorprodrive-data directory not found.
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
copy /Y "%PLUGIN_ROOT%\RaceCorProDrive.dll" "%SIMHUB_PATH%\RaceCorProDrive.dll" >NUL
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to copy RaceCorProDrive.dll
    goto :error
)
echo    Copied RaceCorProDrive.dll

:: Copy PDB if present (optional — debug symbols)
if exist "%PLUGIN_ROOT%\RaceCorProDrive.pdb" (
    copy /Y "%PLUGIN_ROOT%\RaceCorProDrive.pdb" "%SIMHUB_PATH%\RaceCorProDrive.pdb" >NUL
    echo    Copied RaceCorProDrive.pdb
)

:: Copy dataset directory
echo    Copying datasets...
if not exist "%SIMHUB_PATH%\racecorprodrive-data\" mkdir "%SIMHUB_PATH%\racecorprodrive-data"
xcopy /E /Y /Q "%PLUGIN_ROOT%\racecorprodrive-data\*" "%SIMHUB_PATH%\racecorprodrive-data\" >NUL
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to copy dataset files
    goto :error
)
echo    Copied racecorprodrive-data

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
