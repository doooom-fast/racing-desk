@echo off
setlocal enabledelayedexpansion

title RaceCor ProDrive — Build Installer

echo.
echo  ============================================
echo   RaceCor ProDrive — Build Installer
echo  ============================================
echo.
echo  Builds the SimHub plugin, packages the Electron
echo  overlay, and compiles the Inno Setup installer.
echo.

:: -------------------------------------------------------------------
:: 0. Determine repo root
:: -------------------------------------------------------------------

set "SCRIPTS_DIR=%~dp0"
if "%SCRIPTS_DIR:~-1%"=="\" set "SCRIPTS_DIR=%SCRIPTS_DIR:~0,-1%"
for %%I in ("%SCRIPTS_DIR%\..\..") do set "REPO_DIR=%%~fI"
set "PLUGIN_DIR=%REPO_DIR%\racecor-plugin\plugin\RaceCorProDrive.Plugin"
set "OVERLAY_DIR=%REPO_DIR%\racecor-overlay"
set "INSTALLER_DIR=%REPO_DIR%\installer"

echo  Repo root:    %REPO_DIR%
echo  Plugin:       %PLUGIN_DIR%
echo  Overlay:      %OVERLAY_DIR%
echo  Installer:    %INSTALLER_DIR%
echo.

:: -------------------------------------------------------------------
:: 1. Build the SimHub plugin (Release mode)
:: -------------------------------------------------------------------

echo  [1/4] Building SimHub plugin (dotnet build Release)...

:: For installer builds, output to a staging folder instead of SimHub
set "STAGING=%REPO_DIR%\installer\staging"
if not exist "%STAGING%" mkdir "%STAGING%"

dotnet build "%PLUGIN_DIR%\RaceCorProDrive.Plugin.csproj" ^
  -c Release ^
  -p:OutputPath="%STAGING%" ^
  -p:AppendTargetFrameworkToOutputPath=false ^
  -p:AppendRuntimeIdentifierToOutputPath=false ^
  -p:CopyDataset=false ^
  -p:ExportToRepo=false

if !ERRORLEVEL! NEQ 0 (
    echo.
    echo  ERROR: Plugin build failed.
    goto :error
)

:: Copy the DLL and PDB to the expected location for Inno Setup
copy /Y "%STAGING%\RaceCorProDrive.dll" "%REPO_DIR%\racecor-plugin\RaceCorProDrive.dll" >NUL
if exist "%STAGING%\RaceCorProDrive.pdb" (
    copy /Y "%STAGING%\RaceCorProDrive.pdb" "%REPO_DIR%\racecor-plugin\RaceCorProDrive.pdb" >NUL
)

echo        OK — Plugin built successfully.
echo.

:: -------------------------------------------------------------------
:: 2. Install overlay npm dependencies
:: -------------------------------------------------------------------

echo  [2/4] Installing overlay dependencies (npm ci)...

pushd "%OVERLAY_DIR%"
call npm ci
if !ERRORLEVEL! NEQ 0 (
    echo.
    echo  ERROR: npm ci failed.
    popd
    goto :error
)
popd
echo        OK — Dependencies installed.
echo.

:: -------------------------------------------------------------------
:: 3. Package the Electron overlay (electron-builder)
:: -------------------------------------------------------------------

echo  [3/4] Packaging overlay (electron-builder --win)...

pushd "%OVERLAY_DIR%"
call npx electron-builder --win --config electron-builder.yml
if !ERRORLEVEL! NEQ 0 (
    echo.
    echo  ERROR: electron-builder failed.
    popd
    goto :error
)
popd
echo        OK — Overlay packaged to dist/win-unpacked/.
echo.

:: -------------------------------------------------------------------
:: 4. Compile Inno Setup installer
:: -------------------------------------------------------------------

echo  [4/4] Compiling Inno Setup installer...

:: Try common ISCC locations
set "ISCC="
if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" (
    set "ISCC=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
)
if exist "C:\Program Files\Inno Setup 6\ISCC.exe" (
    set "ISCC=C:\Program Files\Inno Setup 6\ISCC.exe"
)

if not defined ISCC (
    echo  WARNING: Inno Setup 6 (ISCC.exe) not found.
    echo  Install from https://jrsoftware.org/isdl.php
    echo.
    echo  The Electron overlay is ready in:
    echo    %OVERLAY_DIR%\dist\win-unpacked\
    echo.
    echo  You can compile the installer manually:
    echo    iscc "%INSTALLER_DIR%\k10-motorsports.iss"
    echo.
    goto :done
)

if not exist "%INSTALLER_DIR%\output" mkdir "%INSTALLER_DIR%\output"

"%ISCC%" "%INSTALLER_DIR%\k10-motorsports.iss"
if !ERRORLEVEL! NEQ 0 (
    echo.
    echo  ERROR: Inno Setup compilation failed.
    goto :error
)
echo        OK — Installer compiled.
echo.

:: -------------------------------------------------------------------
:: Done
:: -------------------------------------------------------------------

:done
echo.
echo  ============================================
echo   Build complete!
echo  ============================================
echo.
if exist "%INSTALLER_DIR%\output\K10-Motorsports-Setup-*.exe" (
    echo  Installer:
    for %%F in ("%INSTALLER_DIR%\output\K10-Motorsports-Setup-*.exe") do echo    %%F
    echo.
)
echo  Overlay (portable):
echo    %OVERLAY_DIR%\dist\win-unpacked\
echo.
echo  Plugin DLL:
echo    %REPO_DIR%\racecor-plugin\RaceCorProDrive.dll
echo.
pause
exit /b 0

:error
echo.
echo  Build failed. See errors above.
echo.
pause
exit /b 1
