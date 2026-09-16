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

  // ── Wear helpers ──

  // Parse demo wear: plugin sends 0=new, 1=gone. Invert to 1=new, 0=gone.
  function _parseDemoWear(val) {
    if (val == null || val === '') return null;
    var v = parseFloat(val);
    if (isNaN(v)) return null;
    return Math.max(0, Math.min(1, 1 - v));
  }

  // Parse tyre wear with null-awareness and raw telemetry fallback.
  // Returns null when no data available, otherwise 0-1 (1=new, 0=worn).
  function _parseTyreWear(gameDataVal, rawL, rawM, rawR) {
    // Try GameData value first
    if (gameDataVal != null && gameDataVal !== '') {
      var v = parseFloat(gameDataVal);
      if (!isNaN(v)) return v;
    }
    // Fallback: raw telemetry wear points (average of inner/mid/outer)
    var l = parseFloat(rawL), m = parseFloat(rawM), r = parseFloat(rawR);
    if (!isNaN(l) && !isNaN(m) && !isNaN(r) && (l + m + r) > 0) {
      return (l + m + r) / 3;
    }
    return null; // No data available yet
  }

  function updateWearRing(ringEl, valEl, wear) {
    if (!ringEl || !valEl) return;
    if (wear === null || wear === undefined) {
      // No data — empty ring, placeholder text
      ringEl.style.strokeDashoffset = RING_CIRCUMFERENCE;
      ringEl.className.baseVal = 'pb-ring-fill';
      valEl.textContent = '—';
      return;
    }
    // iRacing: 1 = new tyre, 0 = fully worn → wear IS remaining life
    var pct = Math.max(0, Math.min(100, wear * 100));
    var remaining = Math.round(pct);
    // dashoffset: 0 = full circle, CIRCUMFERENCE = empty circle
    ringEl.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - pct / 100);
    ringEl.className.baseVal = 'pb-ring-fill' +
      (remaining < 20 ? ' crit' : remaining < 40 ? ' warn' : '');
    valEl.textContent = remaining + '%';
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

    var _demo = +d['RaceCorProDrive.Plugin.DemoMode'] || 0;
    var pb = function(key) { return d['RaceCorProDrive.Plugin.PitBox.' + key]; };
    var dc = function(key) { return d['DataCorePlugin.GameRawData.Telemetry.' + key]; };
    var ds = function(key) {
      return _demo ? d['RaceCorProDrive.Plugin.Demo.DS.' + key]
                   : d['RaceCorProDrive.Plugin.DS.' + key];
    };
    var gd = function(key) { return d['DataCorePlugin.GameData.' + key]; };
    // Demo-aware tire data: demo mode uses different property names
    var demoTyre = function(key) { return d['RaceCorProDrive.Plugin.Demo.' + key]; };

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
    // as needing attention (TireHealthState >= 2 means "change recommended").
    // In demo mode, simulate strategy suggestion when any tire drops below 50% wear.
    var st = function(key) { return d['RaceCorProDrive.Plugin.Strategy.' + key]; };
    var tireHealth = parseInt(st('TireHealthState')) || 0;
    var tireLapsLeft = st('TireLapsRemaining');
    var shouldSuggest = tireHealth >= 2;

    // Demo mode: simulate strategist when tire wear is notable
    if (_demo && !shouldSuggest) {
      var demoWearFL = _parseDemoWear(demoTyre('TyreWearFL'));
      var demoWearFR = _parseDemoWear(demoTyre('TyreWearFR'));
      var demoWearRL = _parseDemoWear(demoTyre('TyreWearRL'));
      var demoWearRR = _parseDemoWear(demoTyre('TyreWearRR'));
      // Trigger when any tire is below 60% remaining life
      if ((demoWearFL !== null && demoWearFL < 0.6) ||
          (demoWearFR !== null && demoWearFR < 0.6) ||
          (demoWearRL !== null && demoWearRL < 0.6) ||
          (demoWearRR !== null && demoWearRR < 0.6)) {
        shouldSuggest = true;
        // Estimate laps remaining from worst tire
        var worstWear = Math.min(
          demoWearFL !== null ? demoWearFL : 1,
          demoWearFR !== null ? demoWearFR : 1,
          demoWearRL !== null ? demoWearRL : 1,
          demoWearRR !== null ? demoWearRR : 1
        );
        tireLapsLeft = Math.max(1, Math.round(worstWear * 20));
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
      var lapsStr = (tireLapsLeft != null && tireLapsLeft !== '')
        ? ' · ~' + Math.round(parseFloat(tireLapsLeft)) + ' laps left'
        : '';
      _els.stratLabel.textContent = 'Accept tire change' + lapsStr;
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
    // iRacing sends 0-1 where 1=new, 0=worn.
    // Null-aware parsing: null/undefined = "no data yet" (show —),
    // 0 = "fully worn" (show 0%).
    // In demo mode, wear comes from Plugin.Demo.TyreWear* (0=new, 1=worn — inverted).
    // In live mode, falls back to raw telemetry average if GameData returns null (first lap).
    var wearFL, wearFR, wearRL, wearRR;
    if (_demo) {
      // Demo wear is 0=new, 1=gone — invert to match iRacing's 1=new convention
      wearFL = _parseDemoWear(demoTyre('TyreWearFL'));
      wearFR = _parseDemoWear(demoTyre('TyreWearFR'));
      wearRL = _parseDemoWear(demoTyre('TyreWearRL'));
      wearRR = _parseDemoWear(demoTyre('TyreWearRR'));
    } else {
      wearFL = _parseTyreWear(gd('TyreWearFrontLeft'), dc('LFwearL'), dc('LFwearM'), dc('LFwearR'));
      wearFR = _parseTyreWear(gd('TyreWearFrontRight'), dc('RFwearL'), dc('RFwearM'), dc('RFwearR'));
      wearRL = _parseTyreWear(gd('TyreWearRearLeft'), dc('LRwearL'), dc('LRwearM'), dc('LRwearR'));
      wearRR = _parseTyreWear(gd('TyreWearRearRight'), dc('RRwearL'), dc('RRwearM'), dc('RRwearR'));
    }
    updateWearRing(_els.ringLF, _els.wearLFVal, wearFL);
    updateWearRing(_els.ringRF, _els.wearRFVal, wearFR);
    updateWearRing(_els.ringLR, _els.wearLRVal, wearRL);
    updateWearRing(_els.ringRR, _els.wearRRVal, wearRR);

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
    var fuelLaps = parseFloat(ds('FuelLapsRemaining')) || 0;
    var fuelDisplay = pb('FuelDisplay') || '—';
    var fuelRequested = pb('FuelRequested');
    var unitLabel = units === 0 ? 'gal' : 'L';

    // Hold last-known-good fuel values while in pit lane (telemetry can
    // momentarily report zeros/blanks during pit service)
    if (!inPitLane && fuelFormattedRaw) _lastFuelFormatted = fuelFormattedRaw;
    if (!inPitLane && fuelPerLapRaw) _lastFuelPerLap = fuelPerLapRaw;
    if (!inPitLane && fuelLaps > 0) _lastFuelLaps = fuelLaps.toFixed(1);
    var fuelFormatted = fuelFormattedRaw || _lastFuelFormatted;
    var fuelPerLap = fuelPerLapRaw || _lastFuelPerLap;

    _prevInPitLane = inPitLane;

    // Tank capacity — read from GameData.MaxFuel (liters), convert if imperial.
    // Hold the last known value: MaxFuel can momentarily drop to 0 during pit service.
    var maxFuelRawLive = _demo
      ? parseFloat(d['RaceCorProDrive.Plugin.Demo.MaxFuel']) || 0
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
      var fuelLapsStr = (fuelStratLaps != null && fuelStratLaps !== '')
        ? ' · ~' + Math.round(parseFloat(fuelStratLaps)) + ' laps left'
        : '';
      _els.fuelStratLabel.textContent = 'Accept fuel stop' + fuelLapsStr;
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
      _els.fuelLaps.textContent = fuelLaps > 0 && fuelLaps < 99
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
