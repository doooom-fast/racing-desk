<#
Racing Desk — start the host and the overlay (HUD + desk) from this checkout.

  scripts\racing-desk.ps1          start whatever isn't running yet
  scripts\racing-desk.ps1 -Stop    stop the host and the overlay

The "Racing Desk" shortcut on the Desktop and `npm run app` both run this. Beside SimHub (which holds :8889
with its own plugin while it runs) the host serves :18889/:18890 and leaves the Moza serial port alone; the
HUD keeps reading :8889 either way, and the desk is pointed at the host.
#>
[CmdletBinding()]
param([switch]$Stop)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$hostProject = Join-Path $root 'apps\host\RaceCor.Host'
$overlay = Join-Path $root 'apps\overlay'
$electron = Join-Path $root 'node_modules\.bin\electron.cmd'

function Listening($port) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

function OwnProcesses {
  # Everything started from this checkout: the host (dotnet run, or its built exe) and the overlay's electron.
  Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and $_.CommandLine -like "*$root*" -and ($_.Name -in 'dotnet.exe', 'RaceCor.Host.exe', 'electron.exe')
  }
}

if ($Stop) {
  $procs = @(OwnProcesses)
  foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  Write-Host "stopped $($procs.Count) process(es)"
  exit 0
}

if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Push-Location $root
  npm install
  Pop-Location
}

# Ports: beside SimHub, or in its place.
$simhub = Listening 8889
if ($simhub) { $http = 18889; $ws = 18890 } else { $http = 8889; $ws = 8890 }

if (Listening $http) {
  Write-Host "host already on :$http"
} else {
  $hostArgs = @('run', '--project', $hostProject, '-c', 'Release', '--', '--http-port', $http, '--ws-port', $ws)
  if ($simhub) { $hostArgs += '--no-hardware' }
  Start-Process dotnet -ArgumentList $hostArgs -WorkingDirectory $root -WindowStyle Minimized
  if ($simhub) { Write-Host "starting the host on :$http (SimHub has :8889)..." } else { Write-Host "starting the host on :$http..." }
  $status = $null
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    try {
      $status = Invoke-RestMethod "http://localhost:$http/racecor-io-pro-drive/data/status" -TimeoutSec 2
      break
    } catch { Start-Sleep -Milliseconds 500 }
  }
  if ($status) { Write-Host "host up: $($status.sessions) sessions stored" }
  else { Write-Warning "the host didn't answer on :$http within 90 s - look at its window" }
}

# The desk's calc bundle is generated from packages/calc (what `npm start` does in prestart).
Push-Location $root
node packages\calc\build.mjs
Pop-Location

if (@(OwnProcesses | Where-Object Name -eq 'electron.exe').Count -gt 0) {
  Write-Host 'overlay already running (Ctrl+Shift+O reopens the desk)'
  exit 0
}
Start-Process $electron -ArgumentList @('.', "--desk-host=http://localhost:$http") -WorkingDirectory $overlay -WindowStyle Hidden
Write-Host 'overlay started: the desk opens now; the HUD shows itself when you are in the car'
