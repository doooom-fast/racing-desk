@echo off
setlocal enabledelayedexpansion

:: -------------------------------------------------------------------
:: RaceCor Pro Drive — Export Tool
::
:: Copies built artifacts FROM SimHub back to the repo:
::   - RaceCorProDrive.dll + .pdb
::   - DashTemplates/k10 motorsports/ (excluding _Backups)
::
:: Does NOT copy datasets — the repo is the source of truth for those.
:: -------------------------------------------------------------------

echo.
echo  ============================================
echo   RaceCor Pro Drive — Export
echo  ============================================
echo.

:: -------------------------------------------------------------------
:: Resolve paths
:: -------------------------------------------------------------------

set "SCRIPT_DIR=%~dp0"
set "PLUGIN_ROOT=%SCRIPT_DIR%..\.."

:: -------------------------------------------------------------------
:: Find SimHub installation
:: -------------------------------------------------------------------

if defined SIMHUB_PATH (
    echo  Using SIMHUB_PATH: %SIMHUB_PATH%
    goto :validate_simhub
)

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
goto :error

:validate_simhub
if not exist "%SIMHUB_PATH%\SimHubWPF.exe" (
    echo [ERROR] SimHubWPF.exe not found in %SIMHUB_PATH%
    goto :error
)

:: -------------------------------------------------------------------
:: Export DLL + PDB
:: -------------------------------------------------------------------

echo  Exporting built artifacts...

if not exist "%SIMHUB_PATH%\RaceCorProDrive.dll" (
    echo [ERROR] RaceCorProDrive.dll not found in SimHub directory.
    echo         Build the plugin first.
    goto :error
)

copy /Y "%SIMHUB_PATH%\RaceCorProDrive.dll" "%PLUGIN_ROOT%\RaceCorProDrive.dll" >NUL
echo    Exported RaceCorProDrive.dll

if exist "%SIMHUB_PATH%\RaceCorProDrive.pdb" (
    copy /Y "%SIMHUB_PATH%\RaceCorProDrive.pdb" "%PLUGIN_ROOT%\RaceCorProDrive.pdb" >NUL
    echo    Exported RaceCorProDrive.pdb
)

:: -------------------------------------------------------------------
:: Export DashTemplates (excluding _Backups)
:: -------------------------------------------------------------------

set "DASH_SRC=%SIMHUB_PATH%\DashTemplates\k10 motorsports"
set "DASH_DST=%PLUGIN_ROOT%\DashTemplates\k10 motorsports"

if exist "%DASH_SRC%" (
    echo    Exporting DashTemplates...

    :: Clean destination first to avoid stale files
    if exist "%DASH_DST%" rmdir /S /Q "%DASH_DST%"
    mkdir "%DASH_DST%"

    :: Use xcopy with exclude to skip _Backups
    xcopy /E /Y /Q "%DASH_SRC%\*" "%DASH_DST%\" /EXCLUDE:%SCRIPT_DIR%export-xcopy-exclude.txt >NUL
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Failed to export DashTemplates
        goto :error
    )

    :: Belt-and-suspenders: remove _Backups if it slipped through
    if exist "%DASH_DST%\_Backups" rmdir /S /Q "%DASH_DST%\_Backups"

    echo    Exported DashTemplates\k10 motorsports
) else (
    echo    No DashTemplates found in SimHub — skipping.
)

:: -------------------------------------------------------------------
:: Done
:: -------------------------------------------------------------------

echo.
echo  ============================================
echo   Export complete
echo  ============================================
echo.
exit /b 0

:error
echo.
echo  Export failed.
echo.
exit /b 1
