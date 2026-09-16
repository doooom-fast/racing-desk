// ═══════════════════════════════════════════════════════════════
// TELEMETRY SIDECAR — Phase 4: frame-synced JSONL telemetry log
//
// During recording, writes one JSON line per poll frame containing
// every telemetry signal the AI editor needs for post-production:
// position, gaps, speed, incidents, flags, sector, lap, G-forces,
// fuel, tyre data, pit status, and commentary triggers.
//
// Output: telemetry.jsonl alongside the video file.
//
// This file drives the entire post-production pipeline — it tells
// the AI editor when to cut, when overtakes happened, when incidents
// occurred. Without it, you're scrubbing through footage by hand.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────
  var _active = false;        // currently writing sidecar data
  var _frameIndex = 0;        // frame counter since recording started
  var _startTime = 0;         // Date.now() when sidecar started
  var _sidecarPath = null;    // full path to the .jsonl file
  var _buffer = [];           // batch write buffer (flushed every N frames)
  var _flushInterval = 30;    // flush every 30 frames (~1 second at 30fps)
  var _prevIncidents = -1;    // for detecting incident changes
  var _prevPosition = -1;     // for detecting position changes
  var _prevLap = -1;          // for detecting lap changes
  var _prevInPit = false;     // for detecting pit entry/exit
  var _markers = [];          // incident/event markers for this recording
  var _headerWritten = false; // header line emitted on first captureFrame

  // ── Start / Stop ──────────────────────────────────────────
  // Called by recorder.js when recording starts/stops.

  function start(videoPath) {
    if (_active) return;

    // Derive sidecar path from video path: foo.webm → foo.telemetry.jsonl
    _sidecarPath = videoPath.replace(/\.(webm|mp4)$/i, '.telemetry.jsonl');
    _active = true;
    _frameIndex = 0;
    _startTime = Date.now();
    _buffer = [];
    _markers = [];
    _prevIncidents = -1;
    _prevPosition = -1;
    _prevLap = -1;
    _prevInPit = false;
    _headerWritten = false;

    // Create the file (empty) via IPC
    if (window.k10 && window.k10.sidecarStart) {
      window.k10.sidecarStart(_sidecarPath);
    }

    console.log('[Sidecar] Started → ' + _sidecarPath);
  }

  // First-frame header — written lazily on the first captureFrame() so
  // we can read car/track/game directly from the live property bag,
  // matching whatever the per-frame rows reflect. Downstream tooling
  // (prodrive-designer's sidecar mapper) keys off `_type === 'header'`.
  function writeHeader(p, isDemo) {
    if (_headerWritten || !_sidecarPath) return;
    _headerWritten = true;

    var carModel =
      (p && (p['DataCorePlugin.GameData.CarModel'] || p['RaceCorProDrive.Plugin.Demo.CarModel'])) ||
      window._currentCarModel ||
      null;
    var trackName =
      (p && (p['DataCorePlugin.GameData.TrackName'] || p['RaceCorProDrive.Plugin.Demo.TrackName'])) ||
      window._currentTrackName ||
      null;

    var header = {
      _type: 'header',
      schemaVersion: 1,
      startedAt: new Date(_startTime).toISOString(),
      car: carModel,
      track: trackName,
      gameId: window._currentGameId || null,
      isDemo: !!isDemo,
    };

    if (window.k10 && window.k10.sidecarWrite) {
      window.k10.sidecarWrite(_sidecarPath, JSON.stringify(header) + '\n');
    }
  }

  function stop() {
    if (!_active) return;

    // Flush any remaining buffered lines
    flush();

    // Write a final summary line with markers
    var summary = {
      _type: 'summary',
      frames: _frameIndex,
      durationMs: Date.now() - _startTime,
      markers: _markers,
    };
    if (window.k10 && window.k10.sidecarWrite) {
      window.k10.sidecarWrite(_sidecarPath, JSON.stringify(summary) + '\n');
    }

    if (window.k10 && window.k10.sidecarStop) {
      window.k10.sidecarStop(_sidecarPath);
    }

    console.log('[Sidecar] Stopped — ' + _frameIndex + ' frames, ' + _markers.length + ' markers');
    _active = false;
    _sidecarPath = null;
  }

  // ── Capture a frame ───────────────────────────────────────
  // Called from pollUpdate() every frame when recording is active.
  // `p` is the raw telemetry property bag from fetchProps().

  function captureFrame(p, isDemo) {
    if (!_active || !p) return;

    // Lazy header on first frame — uses the live property bag, so
    // car/track/game match whatever the per-frame rows will reflect.
    if (!_headerWritten) writeHeader(p, isDemo);

    var dsPre = isDemo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';
    var sessionPre = isDemo ? 'RaceCorProDrive.Plugin.Demo.Grid.' : 'RaceCorProDrive.Plugin.Grid.';
    var pre = isDemo ? 'RaceCorProDrive.Plugin.Demo.' : '';

    var v = function (k) { return p[k] != null ? p[k] : 0; };
    var vs = function (k) { return p[k] != null ? '' + p[k] : ''; };

    var elapsedMs = Date.now() - _startTime;
    var pos = isDemo
      ? +(v('RaceCorProDrive.Plugin.Demo.Position')) || 0
      : +(v('DataCorePlugin.GameData.Position')) || 0;
    var incidents = +(v(dsPre + 'IncidentCount')) || 0;
    var lap = isDemo
      ? +(v('RaceCorProDrive.Plugin.Demo.CurrentLap')) || 0
      : +(v('DataCorePlugin.GameData.CurrentLap')) || 0;
    var inPit = +(v(dsPre + 'IsInPitLane')) > 0;
    var speed = isDemo
      ? +(v('RaceCorProDrive.Plugin.Demo.SpeedMph')) || 0
      : +(v('DataCorePlugin.GameData.SpeedMph')) || 0;

    // ── Detect events (markers) ─────────────────────────────
    if (_prevIncidents >= 0 && incidents > _prevIncidents) {
      _markers.push({
        type: 'incident',
        frame: _frameIndex,
        t: elapsedMs,
        from: _prevIncidents,
        to: incidents,
      });
    }

    if (_prevPosition > 0 && pos > 0 && pos !== _prevPosition) {
      var dir = pos < _prevPosition ? 'gained' : 'lost';
      _markers.push({
        type: 'position_change',
        frame: _frameIndex,
        t: elapsedMs,
        from: _prevPosition,
        to: pos,
        direction: dir,
      });
    }

    if (_prevLap > 0 && lap > _prevLap) {
      _markers.push({
        type: 'new_lap',
        frame: _frameIndex,
        t: elapsedMs,
        lap: lap,
      });
    }

    if (_prevInPit !== inPit && _frameIndex > 0) {
      _markers.push({
        type: inPit ? 'pit_entry' : 'pit_exit',
        frame: _frameIndex,
        t: elapsedMs,
      });
    }

    _prevIncidents = incidents;
    _prevPosition = pos;
    _prevLap = lap;
    _prevInPit = inPit;

    // ── Build the frame record ──────────────────────────────
    // Schema notes:
    //   - Field names are intentionally short to keep per-frame JSONL bloat
    //     down; this file accumulates ~30 frames/sec × race length.
    //   - When a new field is added, the prodrive-designer mapper
    //     (replayer/sidecar-mapper.js) must be taught to read it.
    //     See agents/prodrive-context/ for the cross-repo schema doc.
    //   - Tire / fuel-rate / BB-TC-ABS added 2026-04-26 to enable
    //     designing tire wear, fuel strategy, and adjustment UI in
    //     prodrive-designer with real recorded data.
    var frame = {
      t: +(elapsedMs / 1000).toFixed(3),
      frame: _frameIndex,
      // Position & gaps
      pos: pos,
      totalCars: +(v(sessionPre + 'TotalCars')) || 0,
      gapAhead: isDemo
        ? +(v('RaceCorProDrive.Plugin.Demo.GapAhead')) || 0
        : +(v('IRacingExtraProperties.iRacing_Opponent_Ahead_Gap')) || 0,
      gapBehind: isDemo
        ? +(v('RaceCorProDrive.Plugin.Demo.GapBehind')) || 0
        : +(v('IRacingExtraProperties.iRacing_Opponent_Behind_Gap')) || 0,
      // Lap & sector
      lap: lap,
      sector: +(v(dsPre + 'CurrentSector')) || 0,
      lapDelta: +(v(dsPre + 'LapDelta')) || 0,
      // Speed & inputs
      speed: speed,
      throttle: +(v(isDemo ? 'RaceCorProDrive.Plugin.Demo.Throttle' : 'DataCorePlugin.GameData.Throttle')) || 0,
      brake: +(v(isDemo ? 'RaceCorProDrive.Plugin.Demo.Brake' : 'DataCorePlugin.GameData.Brake')) || 0,
      gear: +(v(isDemo ? 'RaceCorProDrive.Plugin.Demo.Gear' : 'DataCorePlugin.GameData.Gear')) || 0,
      steer: +(v('DataCorePlugin.GameRawData.Telemetry.SteeringWheelAngle')) || 0,
      // G-forces
      latG: +(v(dsPre + 'LatG')) || 0,
      longG: +(v(dsPre + 'LongG')) || 0,
      // Incidents & flags
      incidents: incidents,
      flag: vs(dsPre + 'FlagState') || 'green',
      // Pit status
      pit: inPit,
      // Fuel
      fuel: isDemo ? +(v('RaceCorProDrive.Plugin.Demo.Fuel')) || 0 : +(v('DataCorePlugin.GameData.Fuel')) || 0,
      maxFuel: isDemo ? +(v('RaceCorProDrive.Plugin.Demo.MaxFuel')) || 0 : +(v('DataCorePlugin.GameData.MaxFuel')) || 0,
      // Fuel consumption (added 2026-04-26)
      fuelLap: isDemo
        ? +(v('RaceCorProDrive.Plugin.Demo.FuelPerLap')) || 0
        : +(v('DataCorePlugin.Computed.Fuel_LitersPerLap')) || 0,
      remLaps: isDemo
        ? +(v('RaceCorProDrive.Plugin.Demo.RemainingLaps')) || 0
        : +(v('DataCorePlugin.GameData.RemainingLaps')) || 0,
      // Tire temps °C (added 2026-04-26)
      tFL: isDemo ? +(v('RaceCorProDrive.Plugin.Demo.TyreTempFL')) || 0 : +(v('DataCorePlugin.GameData.TyreTempFrontLeft')) || 0,
      tFR: isDemo ? +(v('RaceCorProDrive.Plugin.Demo.TyreTempFR')) || 0 : +(v('DataCorePlugin.GameData.TyreTempFrontRight')) || 0,
      tRL: isDemo ? +(v('RaceCorProDrive.Plugin.Demo.TyreTempRL')) || 0 : +(v('DataCorePlugin.GameData.TyreTempRearLeft')) || 0,
      tRR: isDemo ? +(v('RaceCorProDrive.Plugin.Demo.TyreTempRR')) || 0 : +(v('DataCorePlugin.GameData.TyreTempRearRight')) || 0,
      // Tire wear 0..1 (added 2026-04-26)
      wFL: isDemo ? +(v('RaceCorProDrive.Plugin.Demo.TyreWearFL')) || 0 : +(v('DataCorePlugin.GameData.TyreWearFrontLeft')) || 0,
      wFR: isDemo ? +(v('RaceCorProDrive.Plugin.Demo.TyreWearFR')) || 0 : +(v('DataCorePlugin.GameData.TyreWearFrontRight')) || 0,
      wRL: isDemo ? +(v('RaceCorProDrive.Plugin.Demo.TyreWearRL')) || 0 : +(v('DataCorePlugin.GameData.TyreWearRearLeft')) || 0,
      wRR: isDemo ? +(v('RaceCorProDrive.Plugin.Demo.TyreWearRR')) || 0 : +(v('DataCorePlugin.GameData.TyreWearRearRight')) || 0,
      // In-car adjustments (added 2026-04-26)
      bb: isDemo ? +(v('RaceCorProDrive.Plugin.Demo.BrakeBias')) || 0 : +(v('DataCorePlugin.GameRawData.Telemetry.dcBrakeBias')) || 0,
      tc: isDemo ? +(v('RaceCorProDrive.Plugin.Demo.TC')) || 0 : +(v('DataCorePlugin.GameRawData.Telemetry.dcTractionControl')) || 0,
      abs: isDemo ? +(v('RaceCorProDrive.Plugin.Demo.ABS')) || 0 : +(v('DataCorePlugin.GameRawData.Telemetry.dcABS')) || 0,
      // Proximity
      closestCar: +(v(dsPre + 'ClosestCarDistance')) || 0,
      // Session
      sessionState: +(v(sessionPre + 'SessionState')) || 0,
      endOfRace: +(v(dsPre + 'IsEndOfRace')) > 0,
    };

    _buffer.push(JSON.stringify(frame));
    _frameIndex++;

    // Flush buffer periodically
    if (_buffer.length >= _flushInterval) {
      flush();
    }
  }

  // ── Flush buffer to file ──────────────────────────────────
  function flush() {
    if (_buffer.length === 0 || !_sidecarPath) return;
    var chunk = _buffer.join('\n') + '\n';
    _buffer = [];
    if (window.k10 && window.k10.sidecarWrite) {
      window.k10.sidecarWrite(_sidecarPath, chunk);
    }
  }

  // ── Get markers (for post-race analysis) ──────────────────
  function getMarkers() {
    return _markers.slice();
  }

  function isActive() {
    return _active;
  }

  // ── Public API ────────────────────────────────────────────
  window.sidecarStart = start;
  window.sidecarStop = stop;
  window.sidecarCaptureFrame = captureFrame;
  window.sidecarGetMarkers = getMarkers;
  window.sidecarIsActive = isActive;
})();
