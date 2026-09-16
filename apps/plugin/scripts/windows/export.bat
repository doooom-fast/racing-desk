@echo off
setlocal enabledelayedexpansion

title K10 Motorsports - Export Built Files to Repo

echo.
echo  ============================================
echo   K10 Motorsports - Export Built Files to Repo
echo  ============================================
echo.
echo  Copies the built DLL, PDB, and dashboard
echo  templates from your SimHub directory back
echo  into this repository for commit.
echo.

:: -------------------------------------------------------------------
:: 1. Find SimHub installation
:: -------------------------------------------------------------------

set "SIMHUB_DIR="

if exist "C:\Program Files (x86)\SimHub\SimHubWPF.exe" (
    set "SIMHUB_DIR=C:\Program Files (x86)\SimHub"
)
if exist "C:\Program Files\SimHub\SimHubWPF.exe" (
    set "SIMHUB_DIR=C:\Program Files\SimHub"
)

if defined SIMHUB_PATH (
    if exist "!SIMHUB_PATH!\SimHubWPF.exe" (
        set "SIMHUB_DIR=!SIMHUB_PATH!"
    )
)

if not defined SIMHUB_DIR (
    echo  SimHub was not found in the default location.
    echo  Enter your SimHub installation folder:
    echo.
    set /p "SIMHUB_DIR=  Path: "
    if not exist "!SIMHUB_DIR!\SimHubWPF.exe" (
        echo.
        echo  ERROR: SimHubWPF.exe not found in "!SIMHUB_DIR!"
        echo.
        pause
        exit /b 1
    )
)

echo  SimHub directory: %SIMHUB_DIR%
echo.

:: -------------------------------------------------------------------
:: 2. Determine repo root (this .bat lives in plugin-tools\)
:: -------------------------------------------------------------------

set "TOOLS_DIR=%~dp0"
if "%TOOLS_DIR:~-1%"=="\" set "TOOLS_DIR=%TOOLS_DIR:~0,-1%"
for %%I in ("%TOOLS_DIR%\..") do set "REPO_DIR=%%~fI"
set "PLUGIN_DIR=%REPO_DIR%\racecor-plugin"

:: -------------------------------------------------------------------
:: 3. Export DLL + PDB
:: -------------------------------------------------------------------

echo  [1/3] Exporting plugin binaries...

if exist "%SIMHUB_DIR%\RaceCorProDrive.dll" (
    copy /Y "%SIMHUB_DIR%\RaceCorProDrive.dll" "%PLUGIN_DIR%\RaceCorProDrive.dll" >NUL
    if !ERRORLEVEL! NEQ 0 (
        echo        FAILED - could not copy DLL. Is SimHub running?
        goto :error
    )
    echo        OK - RaceCorProDrive.dll
) else (
    echo        SKIPPED - RaceCorProDrive.dll not found in SimHub directory.
    echo        Build the plugin first (dotnet build).
    goto :error
)

if exist "%SIMHUB_DIR%\RaceCorProDrive.pdb" (
    copy /Y "%SIMHUB_DIR%\RaceCorProDrive.pdb" "%PLUGIN_DIR%\RaceCorProDrive.pdb" >NUL
    echo        OK - RaceCorProDrive.pdb
) else (
    echo        SKIPPED - RaceCorProDrive.pdb not found (Release build?)
)

:: -------------------------------------------------------------------
:: 4. Export "k10 motorsports" dashboard (excluding _Backups)
:: -------------------------------------------------------------------

echo  [2/3] Exporting k10 motorsports dashboard...

set "DASH1_SRC=%SIMHUB_DIR%\DashTemplates\k10 motorsports"
set "DASH1_DST=%PLUGIN_DIR%\DashTemplates\k10 motorsports"

if exist "%DASH1_SRC%" (
    if not exist "%DASH1_DST%" mkdir "%DASH1_DST%"

    :: Core dashboard files
    for %%F in (
        "k10 motorsports.djson"
        "k10 motorsports.djson.png"
        "k10 motorsports.djson.00.png"
        "k10 motorsports.djson.metadata"
        "k10 motorsports.djson.carclasses"
        "k10 motorsports.html"
    ) do (
        if exist "%DASH1_SRC%\%%~F" (
            copy /Y "%DASH1_SRC%\%%~F" "%DASH1_DST%\%%~F" >NUL
        )
    )

    :: JavascriptExtensions subfolder
    if exist "%DASH1_SRC%\JavascriptExtensions" (
        if not exist "%DASH1_DST%\JavascriptExtensions" mkdir "%DASH1_DST%\JavascriptExtensions"
        xcopy /E /Y /Q "%DASH1_SRC%\JavascriptExtensions" "%DASH1_DST%\JavascriptExtensions" >NUL
    )

    echo        OK - DashTemplates\k10 motorsports\
    echo        NOTE: _Backups directory was excluded (SimHub-local only)
) else (
    echo        SKIPPED - k10 motorsports dashboard not found in SimHub.
)

:: -------------------------------------------------------------------
:: 5. Export "k10 motorsports" dashboard (excluding _Backups)
:: -------------------------------------------------------------------

echo  [3/3] Exporting k10 motorsports dashboard...

set "DASH2_SRC=%SIMHUB_DIR%\DashTemplates\k10 motorsports"
set "DASH2_DST=%PLUGIN_DIR%\DashTemplates\k10 motorsports"

if exist "%DASH2_SRC%" (
    if not exist "%DASH2_DST%" mkdir "%DASH2_DST%"

    :: Core dashboard files
    for %%F in (
        "k10 motorsports.djson"
        "k10 motorsports.djson.metadata"
        "k10 motorsports.html"
    ) do (
        if exist "%DASH2_SRC%\%%~F" (
            copy /Y "%DASH2_SRC%\%%~F" "%DASH2_DST%\%%~F" >NUL
        )
    )

    :: JavascriptExtensions subfolder
    if exist "%DASH2_SRC%\JavascriptExtensions" (
        if not exist "%DASH2_DST%\JavascriptExtensions" mkdir "%DASH2_DST%\JavascriptExtensions"
        xcopy /E /Y /Q "%DASH2_SRC%\JavascriptExtensions" "%DASH2_DST%\JavascriptExtensions" >NUL
    )

    echo        OK - DashTemplates\k10 motorsports\

    :: Also update the Electron overlay's local copy
    set "ELECTRON_DIR=%REPO_DIR%\racecor-overlay"
    if exist "!ELECTRON_DIR!" (
        if exist "%DASH2_SRC%\k10 motorsports.html" (
            copy /Y "%DASH2_SRC%\k10 motorsports.html" "!ELECTRON_DIR!\dashboard.html" >NUL
            echo        OK - K10 Motorsports\dashboard.html (synced)
        )
    )
) else (
    echo        SKIPPED - k10 motorsports dashboard not found in SimHub.
)

:: -------------------------------------------------------------------
:: 6. Summary
:: -------------------------------------------------------------------

echo.
echo  ============================================
echo   Export complete.
echo  ============================================
echo.
echo  Exported files:
echo    %PLUGIN_DIR%\RaceCorProDrive.dll
if exist "%PLUGIN_DIR%\RaceCorProDrive.pdb" (
    echo    %PLUGIN_DIR%\RaceCorProDrive.pdb
)
echo    %PLUGIN_DIR%\DashTemplates\k10 motorsports\
echo    %PLUGIN_DIR%\DashTemplates\k10 motorsports\
echo.
echo  NOTE: Dataset files are NOT exported from SimHub.
echo  The racecorprodrive-data/ folder in the repo is the source of
echo  truth. Edit dataset files in the repo, then use
echo  install.bat or rebuild.bat to push them to SimHub.
echo.
echo  Ready to commit. Run:
echo    git add racecor-plugin/
echo    git commit -m "Update built plugin and dashboards"
echo.
pause
exit /b 0

:error
echo.
echo  Export failed. See errors above.
echo.
pause
exit /b 1
