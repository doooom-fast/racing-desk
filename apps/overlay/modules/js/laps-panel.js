// The laps panel of the glance layout (#lapsPanel in dashboard.html, laid out by drive-view.css): the lap and how many
// there are, his last, best and optimal laps, each sector against his best, his gaps to his session best, to the
// optimal lap and to his best ever, and whether the fuel he has reaches the flag. The numbers are the payload's but
// for the gaps, which are lap-delta.js's. Drawn only while the panel is on screen (drive mode), and a node is written
// to only when what it says has changed.
(function () {
  'use strict';

  const els = {};
  const last = new Map();   // node -> 'text|class' last written

  function el(id) {
    if (!els[id]) els[id] = document.getElementById(id);
    return els[id];
  }

  function put(id, text, cls) {
    const node = el(id);
    if (!node) return;
    const key = text + '|' + (cls || '');
    if (last.get(node) === key) return;
    last.set(node, key);
    node.textContent = text;
    node.className = 'laps-v' + (cls ? ' ' + cls : '');
  }

  function lapTime(s) {
    if (!(s > 0)) return '—';
    const m = Math.floor(s / 60);
    const rest = s - m * 60;
    return m + ':' + (rest < 10 ? '0' : '') + rest.toFixed(3);
  }

  function sectorTime(s) {
    if (!(s > 0)) return '—';
    return s >= 60 ? lapTime(s) : s.toFixed(3);
  }

  // The sector cells: one per sector the plugin has, each its time and its gap to his best of it, coloured as the
  // gaps block colours them (purple a best, green quicker, yellow slower), and the one he is in outlined.
  let _sectorCount = -1;
  const _sectorLast = [];
  function sectors(p, dsPre, count, current, invalid) {
    const box = el('lapsSectors');
    if (!box) return;
    if (count !== _sectorCount) {
      _sectorCount = count;
      box.textContent = '';
      _sectorLast.length = 0;
      for (let i = 1; i <= count; i++) {
        const cell = document.createElement('div');
        cell.className = 'sector-cell';
        cell.innerHTML = '<div class="sector-label">S' + i + '</div><div class="sector-time">—</div><div class="sector-delta"></div>';
        box.appendChild(cell);
      }
    }
    const STATE = ['', 'sector-pb', 'sector-faster', 'sector-slower'];
    for (let i = 1; i <= count; i++) {
      const split = +p[dsPre + 'SectorSplitS' + i] || 0;
      const delta = +p[dsPre + 'SectorDeltaS' + i] || 0;
      const state = +p[dsPre + 'SectorStateS' + i] || 0;
      const cls = 'sector-cell' + (invalid ? ' sector-invalid' : STATE[state] ? ' ' + STATE[state] : '') + (i === current ? ' sector-active' : '');
      const dText = split > 0 && delta !== 0 ? (delta < 0 ? '−' : '+') + Math.abs(delta).toFixed(3) : '';
      const key = cls + '|' + split + '|' + dText;
      if (_sectorLast[i] === key) continue;
      _sectorLast[i] = key;
      const cell = box.children[i - 1];
      if (!cell) continue;
      cell.className = cls;
      cell.children[1].textContent = sectorTime(split);
      cell.children[2].textContent = dText;
    }
  }

  /**
   * One frame. ctx: dsPre, lap, totalLaps, remLaps, remTime, lastLap, bestLap, isLapRace, raceMode, fuelLaps,
   * view (lap-delta.js view()), allTime (DS.LapDelta, or null when it says nothing).
   */
  function updateLapsPanel(p, ctx) {
    if (!document.body.classList.contains('drive-mode-active')) return;
    const LD = window.RacingDeskLapDelta;
    const fmt = (d) => (LD && typeof d === 'number' ? LD.format(d) : { text: '—', cls: 'dim' });

    // The lap, and how many there are when the race is run to a number of them.
    put('lapsCount', ctx.lap > 0 ? (ctx.totalLaps > 0 && ctx.isLapRace ? ctx.lap + ' / ' + ctx.totalLaps : 'Lap ' + ctx.lap) : '—', '');

    // Last, best, optimal. The last is green when it was his best; the optimal is his best of each sector added up
    // (the plugin's, which has seen every lap, else this page's own).
    const best = ctx.bestLap > 0 ? ctx.bestLap : (ctx.view && ctx.view.bestTime) || 0;
    put('lapsLast', lapTime(ctx.lastLap), ctx.lastLap > 0 && best > 0 && ctx.lastLap <= best + 0.0005 ? 'green' : '');
    put('lapsBest', lapTime(best), best > 0 ? 'purple' : '');
    let optimal = 0;
    const bests = ('' + (p[ctx.dsPre + 'SectorBests'] || '')).split(',').map(Number).filter((x) => x > 0);
    const count = +p[ctx.dsPre + 'SectorCount'] || 0;
    if (count > 0 && bests.length === count) optimal = bests.reduce((a, b) => a + b, 0);
    else if (ctx.view && ctx.view.optimalTime > 0) optimal = ctx.view.optimalTime;
    put('lapsOptimal', lapTime(optimal), '');

    sectors(p, ctx.dsPre, count, +p[ctx.dsPre + 'CurrentSector'] || 0, +p[ctx.dsPre + 'IsLapInvalid'] > 0);

    // The three gaps, each against what it says.
    const v = ctx.view || {};
    const b = fmt(v.best), o = fmt(v.optimal), a = fmt(ctx.allTime);
    put('lapsDeltaBest', b.text || '—', b.text ? b.cls : 'dim');
    put('lapsDeltaOpt', o.text || '—', o.text ? o.cls : 'dim');
    put('lapsDeltaAll', a.text || '—', a.text ? a.cls : 'dim');

    // Fuel: laps of it against the laps to go. In a race run to time the laps to go are the time left over his last
    // lap. Out of a race there is no flag to reach, and it says the laps it has.
    const fuelLaps = ctx.fuelLaps > 0 ? ctx.fuelLaps : 0;
    let toGo = 0;
    if (ctx.raceMode) {
      if (ctx.isLapRace && ctx.remLaps > 0) toGo = ctx.remLaps;
      else if (ctx.remTime > 0 && ctx.lastLap > 0) toGo = Math.ceil(ctx.remTime / ctx.lastLap);
    }
    const k = el('lapsFuelK');
    const kText = toGo > 0 ? 'Fuel to the flag' : 'Fuel';
    if (k && k.textContent !== kText) k.textContent = kText;
    if (!(fuelLaps > 0)) put('lapsFuel', '—', 'dim');
    else if (toGo > 0) {
      const spare = fuelLaps - toGo;
      const text = fuelLaps.toFixed(1) + ' laps · ' + toGo + ' to go';
      put('lapsFuel', text, spare >= 0.5 ? 'green' : spare >= 0 ? 'amber' : 'red');
    } else put('lapsFuel', fuelLaps.toFixed(1) + ' laps', '');
  }

  window.updateLapsPanel = updateLapsPanel;
})();
