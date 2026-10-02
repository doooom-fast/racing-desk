// ═══════════════════════════════════════════════════════════════
//  PIT BOX — Tabbed driver panel: tyres, fuel, weather,
//  in-car adjustments, camera/FFB.
//  All data read-only from telemetry. Respects iRacing DisplayUnits.
// ═══════════════════════════════════════════════════════════════

(function initPitBox() {
  'use strict';

  // ── DOM cache (populated on first update) ──
  let _els = null;
  let _lastIsIRacing = null;

  // ── Previous values for change detection ──
  const _prev = {};
  let _initialized = false;

  // ── Strategist state ──
  let _stratVisible = false;   // is the strategist suggesting a tire change?
  let _stratTires = [false, false, false, false]; // [LF, RF, LR, RR] suggestion

  // ── Tire selection state (for pit change) ──
  // Tracks which tires the driver wants changed at the next pit stop.
  // Default: all deselected. Strategist "accept" selects all 4.
  var _tireSelected = [false, false, false, false]; // [LF, RF, LR, RR]
  var _tireSelectable = false;  // true when strategy suggests or pit window is open
  var _tireFocusIdx = -1;      // wheel-button focus index (0-3, -1 = strat button)

  // ── Fuel strategist state ──
  var _fuelStratVisible = false;  // is the strategist suggesting a fuel stop?
  var _fuelAccepted = false;      // user accepted the fuel suggestion

  // ── Pit-lane state for fuel hold ──
  var _prevInPitLane = null;
  var _lastFuelFormatted = '—';
  var _lastFuelPerLap = '—';
  var _lastFuelLaps = '—';
  var _lastMaxFuelRaw = 0;  // hold tank capacity across pit resets
  var _fuelHoldKey = '';    // the car, the session and the circuit the held fuel figures are of

  // ── Car silhouette state ──
  let _lastCarType = '';  // 'gt' or 'formula'
  // Open-wheel / formula car patterns (case-insensitive substring match on CarModel)
  var _formulaPatterns = [
    'dallara', 'formula', 'skip barber', 'super formula', 'f3', 'f4',
    'ir-01', 'ir-04', 'ir-18', 'ir18', 'ir01', 'ir04',
    'indy', 'pm-18', 'usp', 'w12', 'w13', 'radical'
  ];

  // ── Wheel button input counters ──
  // The plugin increments these each time the corresponding SimHub action fires.
  // We detect changes per-frame and dispatch the appropriate UI action.
  let _lastTabCycle = -1;
  let _lastTabCycleBack = -1;
  let _lastNext = -1;
  let _lastPrev = -1;
  let _lastIncrement = -1;
  let _lastDecrement = -1;
  let _lastToggle = -1;
  var _tabOrder = ['tyres', 'fuel', 'weather'];
  var _lastWindow = null;         // the pit window's words, the tyres' age and what the tread number is, as last written
  var _lastTyreAge = null;
  var _lastMeasuredNote = null;
  var _pbHidden = false;  // "off" state — pitbox dismissed via tab cycling past the edges

  // SVG circle constants — radius 28, circumference = 2πr ≈ 175.93
  var RING_CIRCUMFERENCE = 2 * Math.PI * 28;

  function cacheElements() {
    var $ = function(id) { return document.getElementById(id); };
    _els = {
      panel:       $('pitBoxPanel'),
      noData:      $('pbNoData'),
      content:     $('pbContent'),
      // Strategist
      stratSuggest: $('pbStratSuggest'),
      stratBtn:     $('pbStratBtn'),
      stratLabel:   $('pbStratLabel'),
      // Car silhouette
      carGT:       $('pbCarGT'),
      carFormula:  $('pbCarFormula'),
      // Tyres tab — circle cells (for selection interaction)
      circleLF:    $('pbCircleLF'),   circleRF:    $('pbCircleRF'),
      circleLR:    $('pbCircleLR'),   circleRR:    $('pbCircleRR'),
      // Tyres tab — circle charts
      ringLF:      $('pbRingLF'),     ringRF:      $('pbRingRF'),
      ringLR:      $('pbRingLR'),     ringRR:      $('pbRingRR'),
      wearLFVal:   $('pbWearLFVal'),  wearRFVal:   $('pbWearRFVal'),
      wearLRVal:   $('pbWearLRVal'),  wearRRVal:   $('pbWearRRVal'),
      // Tyres tab — temps (inside circles)
      tempLF:      $('pbTempLF'),     tempRF:      $('pbTempRF'),
      tempLR:      $('pbTempLR'),     tempRR:      $('pbTempRR'),
      // Fuel tab
      fuelBar:     $('pbFuelBar'),
      fuelAddBar:  $('pbFuelAddBar'),
      fuelLevel:   $('pbFuelLevel'),
      fuelCap:     $('pbFuelCap'),
      fuelPerLap:  $('pbFuelPerLap'),
      fuelLaps:    $('pbFuelLaps'),
      fuelVal:     $('pbFuelVal'),
      fuelPitRow:  $('pbFuelPitRow'),
      fuelStratSuggest: $('pbFuelStratSuggest'),
      fuelStratBtn:     $('pbFuelStratBtn'),
      fuelStratLabel:   $('pbFuelStratLabel'),
      fastRepair:  $('pbFastRepair'),
      windshield:  $('pbWindshield'),
      windowRow:   $('pbRowWindow'),
      windowVal:   $('pbWindow'),
      tyresPage:   $('pbPageTyres'),
      wearNote:    $('pbWearNote'),
      // Weather tab
      weatherIcon: $('pbWeatherIcon'),
      airTemp:     $('pbAirTemp'),
      trackTemp:   $('pbTrackTemp'),
      conditions:  $('pbConditions'),
      // Adjustments tab
      adjBB:    $('pbAdjBB'),    adjTC:    $('pbAdjTC'),
      adjABS:   $('pbAdjABS'),   adjARBF:  $('pbAdjARBF'),
      adjARBR:  $('pbAdjARBR'),  adjEng:   $('pbAdjEng'),
      adjFuel:  $('pbAdjFuel'),  adjWJL:   $('pbAdjWJL'),
      adjWJR:   $('pbAdjWJR'),   adjWingF: $('pbAdjWingF'),
      adjWingR: $('pbAdjWingR'),
      rowTC:    $('pbRowTC'),    rowABS:   $('pbRowABS'),
      rowARBF:  $('pbRowARBF'),  rowARBR:  $('pbRowARBR'),
      rowEng:   $('pbRowEng'),   rowFuel:  $('pbRowFuel'),
      rowWJL:   $('pbRowWJL'),   rowWJR:   $('pbRowWJR'),
      rowWingF: $('pbRowWingF'), rowWingR: $('pbRowWingR'),
      // Camera tab
      ffbMax:   $('pbFFBMax'),
      mirror:   $('pbMirror'),
    };
  }

  // ── Tire selection interaction ──
  var _circleEls = function() {
    return [_els.circleLF, _els.circleRF, _els.circleLR, _els.circleRR];
  };

  function toggleTire(idx) {
    if (!_tireSelectable) return;
    _tireSelected[idx] = !_tireSelected[idx];
    syncTireSelectionUI();
  }

  function selectAllTires() {
    _tireSelected = [true, true, true, true];
    syncTireSelectionUI();
  }

  function deselectAllTires() {
    _tireSelected = [false, false, false, false];
    syncTireSelectionUI();
  }

  function syncTireSelectionUI() {
    var cells = _circleEls();
    for (var i = 0; i < 4; i++) {
      if (!cells[i]) continue;
      cells[i].classList.toggle('selected', _tireSelected[i]);
      // Remove suggested highlight once user has interacted (accepted or toggled)
      cells[i].classList.remove('suggested');
    }
  }

  function setTiresSelectable(selectable) {
    if (selectable === _tireSelectable) return;
    _tireSelectable = selectable;
    var cells = _circleEls();
    for (var i = 0; i < 4; i++) {
      if (!cells[i]) continue;
      cells[i].classList.toggle('selectable', selectable);
      if (!selectable) {
        cells[i].classList.remove('selected', 'suggested');
      }
    }
    if (!selectable) {
      _tireSelected = [false, false, false, false];
      _tireFocusIdx = -1;
    }
  }

  function showStrategistSuggestions() {
    // Highlight all 4 tires with "suggested" amber style
    var cells = _circleEls();
    for (var i = 0; i < 4; i++) {
      if (cells[i]) cells[i].classList.add('suggested');
    }
  }

  // Wire click handlers (called once after first cacheElements)
  var _clicksBound = false;
  function bindTireClicks() {
    if (_clicksBound || !_els) return;
    _clicksBound = true;
    var cells = _circleEls();
    for (var i = 0; i < 4; i++) {
      (function(idx) {
        if (cells[idx]) {
          cells[idx].addEventListener('click', function() { toggleTire(idx); });
        }
      })(i);
    }
    // Strategist "accept" button — selects all 4 tires
    if (_els.stratBtn) {
      _els.stratBtn.addEventListener('click', function() {
        selectAllTires();
      });
    }
    // Fuel strategist "accept" button
    if (_els.fuelStratBtn) {
      _els.fuelStratBtn.addEventListener('click', function() {
        _fuelAccepted = true;
        if (_els.fuelVal) {
          _els.fuelVal.classList.add('accepted');
        }
        if (_els.fuelAddBar) {
          _els.fuelAddBar.classList.add('active');
        }
      });
    }
  }

  // ── Tab switching ──
  window.switchPbTab = function(el) {
    var tab = el.dataset.pbTab;
    if (!tab) return;
    // Deactivate all tabs and pages
    var tabs = document.querySelectorAll('.pb-tab');
    var pages = document.querySelectorAll('.pb-page');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
    for (var i = 0; i < pages.length; i++) pages[i].classList.remove('active');
    // Activate selected
    el.classList.add('active');
    var page = document.querySelector('[data-pb-page="' + tab + '"]');
    if (page) page.classList.add('active');
  };

  // ── Tab cycling (called from IPC / Stream Deck / HTTP action) ──
  // dir: +1 = next, -1 = prev
  window.pitboxCycleTab = function(dir) {
    var panel = document.getElementById('pitBoxPanel');
    if (_pbHidden) {
      _pbHidden = false;
      if (panel) panel.classList.remove('pb-dismissed');
      var revealIdx = dir === 1 ? 0 : _tabOrder.length - 1;
      var revealTab = document.querySelector('.pb-tab[data-pb-tab="' + _tabOrder[revealIdx] + '"]');
      if (revealTab) switchPbTab(revealTab);
      return;
    }
    var activeTab = document.querySelector('.pb-tab.active');
    var currentKey = activeTab ? activeTab.dataset.pbTab : _tabOrder[0];
    var idx = _tabOrder.indexOf(currentKey);
    var atEnd   = (dir === 1  && idx === _tabOrder.length - 1);
    var atStart = (dir === -1 && idx === 0);
    if (atEnd || atStart) {
      _pbHidden = true;
      if (panel) panel.classList.add('pb-dismissed');
      var allTabs = document.querySelectorAll('.pb-tab');
      var allPages = document.querySelectorAll('.pb-page');
      for (var t = 0; t < allTabs.length; t++) allTabs[t].classList.remove('active');
      for (var p = 0; p < allPages.length; p++) allPages[p].classList.remove('active');
    } else {
      var nextIdx = idx + dir;
      var nextTab = document.querySelector('.pb-tab[data-pb-tab="' + _tabOrder[nextIdx] + '"]');
      if (nextTab) switchPbTab(nextTab);
    }
  };

  // ── Flash animation ──
  function flash(el) {
    if (!el || !_initialized) return;
    el.classList.remove('pb-flash');
    void el.offsetWidth;
    el.classList.add('pb-flash');
    setTimeout(function() { el.classList.remove('pb-flash'); }, 1400);
  }

  function checkAndFlash(key, newVal, el) {
    if (_prev[key] !== undefined && _prev[key] !== newVal) flash(el);
    _prev[key] = newVal;
  }

  function setRowVisible(rowEl, visible) {
    if (!rowEl) return;
    rowEl.classList.toggle('hidden', !visible);
  }

  // ── Wear ──
  // Tyre wear on the wire is tread remaining, 0..100 %, 100 = new, per corner — the same number from the host, the
  // SimHub plugin and the demo (root CLAUDE.md, Tyre wear). Nothing here converts it: the ring is the number as it
  // comes. null is not measured, and 0 is not a measurement either (SimHub's own property reads 0 while it has
  // nothing; a tyre with no tread at all is not a thing the sim reports). iRacing measures tread in the pits and
  // nowhere else, so the number is the last measurement: the page says so (the note under the rings, the heading in
  // the glance layout) and the warnings come from the strategy engine, which rates a measurement, not from here.
  // The two thresholds are the engine's (Engine/TyreWear.cs): amber under 35, red under 20 — TYRE_WEAR_WARN_BELOW and
  // TYRE_WEAR_CRIT_BELOW, and the wire's number is read by parseTyreWear, all three in config.js, where every panel
  // that shows tread reads it from.
  var WEAR_WARN_BELOW = TYRE_WEAR_WARN_BELOW, WEAR_CRIT_BELOW = TYRE_WEAR_CRIT_BELOW;
  var _parseWear = parseTyreWear;

  function updateWearRing(ringEl, valEl, remaining) {
    if (!ringEl || !valEl) return;
    if (remaining === null || remaining === undefined) {
      // Not measured — empty ring, placeholder text
      ringEl.style.strokeDashoffset = RING_CIRCUMFERENCE;
      ringEl.className.baseVal = 'pb-ring-fill';
      valEl.textContent = '—';
      return;
    }
    var pct = Math.max(0, Math.min(100, remaining));
    var shown = tyreWearShown(pct);
    // dashoffset: 0 = full circle, CIRCUMFERENCE = empty circle
    ringEl.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - pct / 100);
    ringEl.className.baseVal = 'pb-ring-fill' +
      (pct < WEAR_CRIT_BELOW ? ' crit' : pct < WEAR_WARN_BELOW ? ' warn' : '');
    valEl.textContent = shown + '%';
  }

  // ── Temperature formatting — respects DisplayUnits ──
  function formatTemp(celsius, units) {
    if (!celsius && celsius !== 0) return '—';
    var c = parseFloat(celsius) || 0;
    if (c === 0) return '—';
    // units: 0=imperial(°F), 1=metric(°C)
    if (units === 0) return Math.round(c * 9 / 5 + 32) + '°F';
    return Math.round(c) + '°C';
  }

  // ── Main update handler ──
  window.updatePitBox = function(d) {
    if (!_els) cacheElements();
    if (!_els || !_els.panel) return;

    // Show/hide based on game detection
    // Show pit box for games with pit/strategy data: iRacing, ACC, AC, AC EVO
    var gameId = typeof window._currentGameId !== 'undefined' ? window._currentGameId : 'iracing';
    var hasPitData = gameId === 'iracing' || gameId === 'acc' || gameId === 'ac' || gameId === 'acevo';
    if (hasPitData !== _lastIsIRacing) {
      _lastIsIRacing = hasPitData;
      if (_els.noData) _els.noData.style.display = hasPitData ? 'none' : '';
      if (_els.content) _els.content.style.display = hasPitData ? '' : 'none';
    }
    if (!hasPitData) return;

    var _demo = +d['RacingDesk.Plugin.DemoMode'] || 0;
    var pb = function(key) { return d['RacingDesk.Plugin.PitBox.' + key]; };
    var dc = function(key) { return d['DataCorePlugin.GameRawData.Telemetry.' + key]; };
    var ds = function(key) {
      return _demo ? d['RacingDesk.Plugin.Demo.DS.' + key]
                   : d['RacingDesk.Plugin.DS.' + key];
    };
    var gd = function(key) { return d['DataCorePlugin.GameData.' + key]; };
    // Demo-aware tire data: demo mode uses different property names
    var demoTyre = function(key) { return d['RacingDesk.Plugin.Demo.' + key]; };

    // 0=imperial, 1=metric. Cannot use `|| 1` fallback here because 0 is a
    // valid value (imperial) — `0 || 1` would incorrectly evaluate to metric.
    var rawUnits = ds('DisplayUnits');
    var units = (rawUnits !== '' && rawUnits !== null && rawUnits !== undefined)
      ? parseInt(rawUnits) : 1;

    // ════════════════════════════════════════
    //  TYRES TAB
    // ════════════════════════════════════════

    // ── Bind click handlers on first run ──
    bindTireClicks();

    // ── Strategist tire suggestion ──
    // Show the "accept" button when the strategy engine flags tire health
    // as needing attention (TireHealthState >= 2 means "change recommended": a tyre measured under 20% tread).
    // In demo mode, the page plays the strategist itself when a demo tyre is under the critical threshold: the same
    // tread the live offer comes at (the engine's TireHealthState 2), not the worn one that only turns the ring amber.
    var st = function(key) { return d['RacingDesk.Plugin.Strategy.' + key]; };
    var tireHealth = parseInt(st('TireHealthState')) || 0;
    var tireLapsLeft = st('TireLapsRemaining');
    var shouldSuggest = tireHealth >= 2;

    // Demo mode: the demo's tread (percent remaining, as the live keys are) drives the suggestion
    if (_demo && !shouldSuggest) {
      var demoWearFL = _parseWear(demoTyre('TyreWearFL'));
      var demoWearFR = _parseWear(demoTyre('TyreWearFR'));
      var demoWearRL = _parseWear(demoTyre('TyreWearRL'));
      var demoWearRR = _parseWear(demoTyre('TyreWearRR'));
      if ((demoWearFL !== null && demoWearFL < WEAR_CRIT_BELOW) ||
          (demoWearFR !== null && demoWearFR < WEAR_CRIT_BELOW) ||
          (demoWearRL !== null && demoWearRL < WEAR_CRIT_BELOW) ||
          (demoWearRR !== null && demoWearRR < WEAR_CRIT_BELOW)) {
        shouldSuggest = true;
        // Laps left from the worst tyre: a fifth of a lap per point of tread, for the show
        var worstWear = Math.min(
          demoWearFL !== null ? demoWearFL : 100,
          demoWearFR !== null ? demoWearFR : 100,
          demoWearRL !== null ? demoWearRL : 100,
          demoWearRR !== null ? demoWearRR : 100
        );
        tireLapsLeft = Math.max(1, Math.round(worstWear / 5));
      }
    }

    if (shouldSuggest !== _stratVisible) {
      _stratVisible = shouldSuggest;
      if (_els.stratSuggest) {
        _els.stratSuggest.classList.toggle('hidden', !shouldSuggest);
      }
      // When strategist first appears, enable tire selection and show suggestions
      if (shouldSuggest) {
        setTiresSelectable(true);
        showStrategistSuggestions();
        deselectAllTires(); // default: none selected until user accepts
      }
    }
    // Keep tires selectable while strategist is active
    if (shouldSuggest) setTiresSelectable(true);

    if (shouldSuggest && _els.stratLabel) {
      // The engine's laps left is 99 where it has nothing to say (iRacing measures tread only in the pits) and 0 for a
      // tyre measured critical: neither is a number to show.
      var lapsLeft = (tireLapsLeft != null && tireLapsLeft !== '') ? Math.round(parseFloat(tireLapsLeft)) : NaN;
      var lapsStr = (lapsLeft > 0 && lapsLeft < 99) ? ' · ~' + lapsLeft + ' laps left' : '';
      // (In the glance layout there is nothing to press: the call is read, and says what to do.)
      _els.stratLabel.textContent = document.body.classList.contains('drive-mode-active')
        ? 'Change' + (lapsStr ? ' · ~' + lapsLeft + ' laps' : '')
        : 'Accept tire change' + lapsStr;
      _stratTires = [true, true, true, true];
    } else {
      _stratTires = [false, false, false, false];
      // If strategist disappears, clear selection state
      if (!shouldSuggest && _tireSelectable) {
        setTiresSelectable(false);
      }
    }

    // ── Car silhouette switching ──
    // Detect formula/open-wheel cars from CarModel string
    var carModel = (_demo ? demoTyre('CarModel') : gd('CarModel')) || '';
    var carModelLower = carModel.toLowerCase();
    var carType = 'gt';
    for (var fi = 0; fi < _formulaPatterns.length; fi++) {
      if (carModelLower.indexOf(_formulaPatterns[fi]) !== -1) {
        carType = 'formula';
        break;
      }
    }
    if (carType !== _lastCarType) {
      _lastCarType = carType;
      if (_els.carGT) _els.carGT.style.display = carType === 'gt' ? '' : 'none';
      if (_els.carFormula) _els.carFormula.style.display = carType === 'formula' ? '' : 'none';
    }

    // ── Circle wear charts ──
    // The tread remaining as the wire has it (see _parseWear): the demo's keys and the live keys mean the same thing.
    var wearFL = _parseWear(_demo ? demoTyre('TyreWearFL') : gd('TyreWearFrontLeft'));
    var wearFR = _parseWear(_demo ? demoTyre('TyreWearFR') : gd('TyreWearFrontRight'));
    var wearRL = _parseWear(_demo ? demoTyre('TyreWearRL') : gd('TyreWearRearLeft'));
    var wearRR = _parseWear(_demo ? demoTyre('TyreWearRR') : gd('TyreWearRearRight'));
    updateWearRing(_els.ringLF, _els.wearLFVal, wearFL);
    updateWearRing(_els.ringRF, _els.wearRFVal, wearFR);
    updateWearRing(_els.ringLR, _els.wearLRVal, wearRL);
    updateWearRing(_els.ringRR, _els.wearRRVal, wearRR);

    // What the number is: iRacing measures tread in the pits and nowhere else, so the rings show the last measurement,
    // not live wear. Said in one dim line under the rings, on the rig and in the glance layout alike (the glance
    // layout's heading has no room for it on an iPad); not in the demo, whose tread is made up and moves every lap,
    // and not for a sim that measures as it goes.
    var measuredNote = (!_demo && gameId === 'iracing') ? 'Tread measured in the pits' : '';
    if (_lastMeasuredNote !== measuredNote) {
      _lastMeasuredNote = measuredNote;
      if (_els.wearNote) {
        _els.wearNote.textContent = measuredNote;
        _els.wearNote.classList.toggle('hidden', !measuredNote);
      }
    }

    // Tyre temps (inside circle charts)
    var tempFL = _demo ? demoTyre('TyreTempFL') : gd('TyreTempFrontLeft');
    var tempFR = _demo ? demoTyre('TyreTempFR') : gd('TyreTempFrontRight');
    var tempRL = _demo ? demoTyre('TyreTempRL') : gd('TyreTempRearLeft');
    var tempRR = _demo ? demoTyre('TyreTempRR') : gd('TyreTempRearRight');
    if (_els.tempLF) _els.tempLF.textContent = formatTemp(tempFL, units);
    if (_els.tempRF) _els.tempRF.textContent = formatTemp(tempFR, units);
    if (_els.tempLR) _els.tempLR.textContent = formatTemp(tempRL, units);
    if (_els.tempRR) _els.tempRR.textContent = formatTemp(tempRR, units);

    // ════════════════════════════════════════
    //  FUEL TAB
    // ════════════════════════════════════════

    // Detect pit lane state to hold fuel display during pit service
    var inPitLane = +(d['DataCorePlugin.GameData.IsInPitLane'] || d['DataCorePlugin.GameRawData.Telemetry.IsOnPitRoad']) > 0;
    if (_demo) inPitLane = false; // demo mode doesn't pit

    var fuelPct = parseFloat(ds('FuelPct')) || 0;
    var fuelFormattedRaw = ds('FuelFormatted') || '';
    var fuelPerLapRaw = ds('FuelPerLapFormatted') || '';
    // A number of laps, or 0 for not known yet (parseFuelLaps, config.js: an engine built before 2026-10-01 said exactly 99).
    var fuelLaps = parseFuelLaps(ds('FuelLapsRemaining'));
    var fuelDisplay = pb('FuelDisplay') || '—';
    var fuelRequested = pb('FuelRequested');
    var unitLabel = units === 0 ? 'gal' : 'L';

    // Hold last-known-good fuel values while in pit lane (telemetry can
    // momentarily report zeros/blanks during pit service) — for that blip, and not past the car, the session or the circuit
    // they were of: a new one starts with nothing held, so the pit lane it begins in does not show the last stint's fuel.
    var carModelNow = (_demo ? d['RacingDesk.Plugin.Demo.CarModel'] : gd('CarModel')) || '';
    var sessionNow = (_demo ? d['RacingDesk.Plugin.Demo.SessionTypeName'] : d['RacingDesk.Plugin.SessionTypeName']) || '';
    var circuitNow = d['RacingDesk.Plugin.TrackMap.TrackName'] || gd('TrackName') || '';
    if (carModelNow && sessionNow && circuitNow) {
      var holdKey = carModelNow + '|' + sessionNow + '|' + circuitNow;
      if (holdKey !== _fuelHoldKey) {
        _fuelHoldKey = holdKey;
        _lastFuelFormatted = '—'; _lastFuelPerLap = '—'; _lastFuelLaps = '—';
      }
    }
    if (!inPitLane && fuelFormattedRaw) _lastFuelFormatted = fuelFormattedRaw;
    if (!inPitLane && fuelPerLapRaw) _lastFuelPerLap = fuelPerLapRaw;
    // The laps are held only as a known number: on track, "not known" is a dash, and so is what is held then.
    if (!inPitLane) _lastFuelLaps = fuelLaps > 0 ? fuelLaps.toFixed(1) : '—';
    var fuelFormatted = fuelFormattedRaw || _lastFuelFormatted;
    var fuelPerLap = fuelPerLapRaw || _lastFuelPerLap;

    _prevInPitLane = inPitLane;

    // Tank capacity — read from GameData.MaxFuel (liters), convert if imperial.
    // Hold the last known value: MaxFuel can momentarily drop to 0 during pit service.
    var maxFuelRawLive = _demo
      ? parseFloat(d['RacingDesk.Plugin.Demo.MaxFuel']) || 0
      : parseFloat(d['DataCorePlugin.GameData.MaxFuel']) || 0;
    if (maxFuelRawLive > 0) _lastMaxFuelRaw = maxFuelRawLive;
    var maxFuelRaw = _lastMaxFuelRaw;
    var maxFuelDisplay = units === 0 ? maxFuelRaw / 3.78541 : maxFuelRaw;

    // ── Fuel strategist suggestion ──
    var fuelHealth = parseInt(st('FuelHealthState')) || 0;
    var fuelStratLaps = st('FuelLapsRemaining');
    var shouldSuggestFuel = fuelHealth >= 2;

    // Demo mode: simulate fuel strategist when fuel drops below 30%
    if (_demo && !shouldSuggestFuel && fuelPct > 0 && fuelPct < 30) {
      shouldSuggestFuel = true;
      fuelStratLaps = fuelLaps > 0 ? fuelLaps.toFixed(0) : null;
    }

    if (shouldSuggestFuel !== _fuelStratVisible) {
      _fuelStratVisible = shouldSuggestFuel;
      if (_els.fuelStratSuggest) {
        _els.fuelStratSuggest.classList.toggle('hidden', !shouldSuggestFuel);
      }
      // Reset accepted state when suggestion changes
      if (!shouldSuggestFuel) {
        _fuelAccepted = false;
        if (_els.fuelVal) _els.fuelVal.classList.remove('accepted');
        if (_els.fuelAddBar) _els.fuelAddBar.classList.remove('active');
      }
    }
    if (shouldSuggestFuel && _els.fuelStratLabel) {
      // The laps it says are the laps of fuel the page says beside it ("Laps left", the laps panel's fuel line): one number
      // for the one thing, the engine's DS.FuelLapsRemaining. The strategist works out its own from a trimmed mean of the
      // stint's laps, which is a different number a little of the time and goes stale between laps; it is what the call says
      // only while the engine's is not known. Either is 0 until a lap has said what a lap burns (exactly 99 from an engine
      // built before 2026-10-01): neither is a number of laps to say.
      var callLaps = fuelLaps > 0 ? fuelLaps : parseFuelLaps(fuelStratLaps);
      var fuelLapsStr = callLaps > 0 ? ' · ~' + Math.round(callLaps) + ' laps left' : '';
      _els.fuelStratLabel.textContent = document.body.classList.contains('drive-mode-active')
        ? 'Stop' + (callLaps > 0 ? ' · ~' + Math.round(callLaps) + ' laps' : '')
        : 'Accept fuel stop' + fuelLapsStr;
    }

    // The fuel strategy's pit window (lap numbers; zero while the fuel reaches the flag) and how many laps this set of
    // tyres has done: read in the glance layout, written only when they change.
    var winOpen = parseInt(st('PitWindowOpen')) || 0;
    var winClose = parseInt(st('PitWindowClose')) || 0;
    var winText = winClose > 0 ? (winOpen > 0 && winOpen < winClose ? 'L' + winOpen + '–' + winClose : 'by L' + winClose) : '';
    if (_els.windowRow && _lastWindow !== winText) {
      _lastWindow = winText;
      _els.windowRow.classList.toggle('hidden', !winText);
      if (_els.windowVal) _els.windowVal.textContent = winText;
    }
    var stintLaps = parseInt(st('StintLaps')) || 0;
    var tyreAge = stintLaps > 0 ? ' · ' + stintLaps + (stintLaps === 1 ? ' lap' : ' laps') : '';
    if (_els.tyresPage && _lastTyreAge !== tyreAge) {
      _lastTyreAge = tyreAge;
      if (tyreAge) _els.tyresPage.dataset.age = tyreAge; else delete _els.tyresPage.dataset.age;
    }

    // Tank gauge bar — full width = full tank capacity
    if (_els.fuelBar) {
      _els.fuelBar.style.width = Math.min(100, fuelPct) + '%';
      _els.fuelBar.className = 'pb-fuel-tank-fill' +
        (fuelPct < 10 ? ' crit' : fuelPct < 25 ? ' warn' : '');
    }

    // Pit-add ghost overlay on the bar
    if (_els.fuelAddBar && maxFuelRaw > 0) {
      // Parse the numeric pit fuel add from the display string
      var pitAddMatch = fuelDisplay.match(/[\d.]+/);
      var pitAddVal = pitAddMatch ? parseFloat(pitAddMatch[0]) : 0;
      // Convert back to liters if imperial for percentage calculation
      var pitAddLiters = units === 0 ? pitAddVal * 3.78541 : pitAddVal;
      var pitAddPct = maxFuelRaw > 0 ? (pitAddLiters / maxFuelRaw) * 100 : 0;
      if (fuelRequested && pitAddPct > 0) {
        _els.fuelAddBar.style.left = Math.min(100, fuelPct) + '%';
        _els.fuelAddBar.style.width = Math.min(100 - fuelPct, pitAddPct) + '%';
      } else {
        _els.fuelAddBar.style.width = '0%';
      }
    }

    // Labels: current level + tank capacity
    if (_els.fuelLevel) _els.fuelLevel.textContent = fuelFormatted;
    if (_els.fuelCap) {
      _els.fuelCap.textContent = maxFuelDisplay > 0
        ? '/ ' + maxFuelDisplay.toFixed(1) + ' ' + unitLabel + ' tank'
        : '';
    }
    if (_els.fuelPerLap) _els.fuelPerLap.textContent = fuelPerLap;
    if (_els.fuelLaps) {
      // 0 is "not known yet" (the wire's rule since 2026-10-01), and 99 is what an older plugin said for the same: a dash —
      // or, on pit road, the last known number of this car in this session (held above only when it was a number).
      _els.fuelLaps.textContent = fuelLaps > 0
        ? fuelLaps.toFixed(1) : (inPitLane ? _lastFuelLaps : '—');
    }
    // Pit fuel add
    if (_els.fuelVal) {
      _els.fuelVal.textContent = fuelRequested ? fuelDisplay : 'OFF';
      var fuelValClass = 'pb-value selectable';
      if (fuelRequested) fuelValClass += ' active';
      else fuelValClass += ' inactive';
      if (_fuelAccepted) fuelValClass += ' accepted';
      _els.fuelVal.className = fuelValClass;
      checkAndFlash('fuel', fuelDisplay + '|' + fuelRequested, _els.fuelVal.parentElement);
    }

    // Services
    updateToggle('fastRepair', _els.fastRepair, pb('FastRepairRequested'));
    updateToggle('windshield', _els.windshield, pb('WindshieldRequested'));

    // ════════════════════════════════════════
    //  WEATHER TAB
    // ════════════════════════════════════════

    var airTemp = parseFloat(ds('AirTemp')) || 0;
    var trackTempVal = parseFloat(ds('TrackTemp')) || 0;
    var isWet = parseInt(ds('WeatherWet')) === 1;

    if (_els.weatherIcon) _els.weatherIcon.textContent = isWet ? '🌧' : '☀';
    if (_els.airTemp) _els.airTemp.textContent = formatTemp(airTemp, units);
    if (_els.trackTemp) _els.trackTemp.textContent = formatTemp(trackTempVal, units);
    if (_els.conditions) {
      _els.conditions.textContent = isWet ? 'Wet' : 'Dry';
      _els.conditions.className = 'pb-value' + (isWet ? ' on' : '');
    }

    // ════════════════════════════════════════
    //  ADJUSTMENTS TAB
    // ════════════════════════════════════════

    setRowVisible(_els.rowTC,    pb('HasTC'));
    setRowVisible(_els.rowABS,   pb('HasABS'));
    setRowVisible(_els.rowARBF,  pb('HasARBFront'));
    setRowVisible(_els.rowARBR,  pb('HasARBRear'));
    setRowVisible(_els.rowEng,   pb('HasEnginePower'));
    setRowVisible(_els.rowFuel,  pb('HasFuelMixture'));
    setRowVisible(_els.rowWJL,   pb('HasWeightJackerL'));
    setRowVisible(_els.rowWJR,   pb('HasWeightJackerR'));
    setRowVisible(_els.rowWingF, pb('HasWingFront'));
    setRowVisible(_els.rowWingR, pb('HasWingRear'));

    updateAdj('bb',    _els.adjBB,    dc('dcBrakeBias'),         '%', 1);
    updateAdj('tc',    _els.adjTC,    dc('dcTractionControl'),   '',  0);
    updateAdj('abs',   _els.adjABS,   dc('dcABS'),               '',  0);
    updateAdj('arbf',  _els.adjARBF,  dc('dcAntiRollFront'),     '',  0);
    updateAdj('arbr',  _els.adjARBR,  dc('dcAntiRollRear'),      '',  0);
    updateAdj('eng',   _els.adjEng,   dc('dcEnginePower'),       '',  0);
    updateAdj('fmix',  _els.adjFuel,  dc('dcFuelMixture'),       '',  0);
    updateAdj('wjl',   _els.adjWJL,   dc('dcWeightJackerLeft'),  '',  0);
    updateAdj('wjr',   _els.adjWJR,   dc('dcWeightJackerRight'), '',  0);
    updateAdj('wingf', _els.adjWingF, dc('dcWingFront'),         '',  0);
    updateAdj('wingr', _els.adjWingR, dc('dcWingRear'),          '',  0);

    // ════════════════════════════════════════
    //  CAMERA / FFB TAB
    // ════════════════════════════════════════

    // dcFFBMaxForce is not currently exposed in telemetry —
    // show "—" until we wire it. Mirrors are in-sim only.
    if (_els.ffbMax) _els.ffbMax.textContent = '—';
    if (_els.mirror) _els.mirror.textContent = '—';

    // ════════════════════════════════════════
    //  WHEEL BUTTON INPUTS
    // ════════════════════════════════════════

    var tabCycle     = parseInt(ds('PitboxTabCycle')) || 0;
    var tabCycleBack = parseInt(ds('PitboxTabCycleBack')) || 0;
    var pbNext       = parseInt(ds('PitboxNext')) || 0;
    var pbPrev       = parseInt(ds('PitboxPrev')) || 0;
    var pbInc        = parseInt(ds('PitboxIncrement')) || 0;
    var pbDec        = parseInt(ds('PitboxDecrement')) || 0;
    var pbTog        = parseInt(ds('PitboxToggle')) || 0;

    if (_lastTabCycle === -1) {
      // First frame — capture baselines, don't fire anything
      _lastTabCycle = tabCycle; _lastTabCycleBack = tabCycleBack;
      _lastNext = pbNext; _lastPrev = pbPrev;
      _lastIncrement = pbInc; _lastDecrement = pbDec;
      _lastToggle = pbTog;
    } else {
      // Tab cycling — respond to TabCycle, TabCycleBack, Next, and Prev
      var tabDir = 0;
      if (tabCycle !== _lastTabCycle)         { _lastTabCycle = tabCycle; tabDir = 1; }
      if (tabCycleBack !== _lastTabCycleBack) { _lastTabCycleBack = tabCycleBack; tabDir = -1; }
      if (pbNext !== _lastNext)               { _lastNext = pbNext; tabDir = 1; }
      if (pbPrev !== _lastPrev)               { _lastPrev = pbPrev; tabDir = -1; }
      if (tabDir !== 0) {
        var panel = document.getElementById('pitBoxPanel');
        if (_pbHidden) {
          // Re-show: next → first tab, prev → last tab
          _pbHidden = false;
          if (panel) panel.classList.remove('pb-dismissed');
          var revealIdx = tabDir === 1 ? 0 : _tabOrder.length - 1;
          var revealTab = document.querySelector('.pb-tab[data-pb-tab="' + _tabOrder[revealIdx] + '"]');
          if (revealTab) switchPbTab(revealTab);
        } else {
          var activeTab = document.querySelector('.pb-tab.active');
          var currentKey = activeTab ? activeTab.dataset.pbTab : _tabOrder[0];
          var idx = _tabOrder.indexOf(currentKey);
          // Check if cycling past an edge → dismiss
          var atEnd   = (tabDir === 1  && idx === _tabOrder.length - 1);
          var atStart = (tabDir === -1 && idx === 0);
          if (atEnd || atStart) {
            _pbHidden = true;
            if (panel) panel.classList.add('pb-dismissed');
            // Deselect all tabs and pages so state is clean on re-show
            var allTabs = document.querySelectorAll('.pb-tab');
            var allPages = document.querySelectorAll('.pb-page');
            for (var t = 0; t < allTabs.length; t++) allTabs[t].classList.remove('active');
            for (var p = 0; p < allPages.length; p++) allPages[p].classList.remove('active');
          } else {
            var nextIdx = idx + tabDir;
            var nextTab = document.querySelector('.pb-tab[data-pb-tab="' + _tabOrder[nextIdx] + '"]');
            if (nextTab) switchPbTab(nextTab);
          }
        }
      }
      if (pbInc !== _lastIncrement)  { _lastIncrement = pbInc;  /* TODO: increment focused value */ }
      if (pbDec !== _lastDecrement)  { _lastDecrement = pbDec;  /* TODO: decrement focused value */ }
      // Wheel Toggle button — on tyre tab, toggles tire selection
      if (pbTog !== _lastToggle) {
        _lastToggle = pbTog;
        var togTabEl = document.querySelector('.pb-tab.active');
        var togTabKey = togTabEl ? togTabEl.dataset.pbTab : '';
        if (togTabKey === 'tyres' && _tireSelectable) {
          if (_tireFocusIdx === -1) {
            // Focus is on strategist button — accept (select all)
            selectAllTires();
          } else if (_tireFocusIdx >= 0 && _tireFocusIdx < 4) {
            toggleTire(_tireFocusIdx);
          }
        }
      }
    }

    // Enable flash detection after first full frame
    if (!_initialized) _initialized = true;
  };


  function updateToggle(key, el, isOn) {
    if (!el) return;
    el.textContent = isOn ? 'YES' : 'NO';
    el.className = 'pb-value ' + (isOn ? 'on' : 'off');
    checkAndFlash(key, isOn ? 1 : 0, el.parentElement);
  }

  function updateAdj(key, el, val, suffix, decimals) {
    if (!el) return;
    var v = parseFloat(val) || 0;
    if (v === 0) {
      el.textContent = '—';
      el.className = 'pb-adj-val zero';
    } else {
      el.textContent = v.toFixed(decimals) + suffix;
      el.className = 'pb-adj-val';
    }
    checkAndFlash('adj_' + key, v.toFixed(decimals), el.parentElement);
  }

})();
