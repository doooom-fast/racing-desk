// Racing Desk — career, form and race history from the local store.
// Rows come from RacingDesk.Host (:8889/racing-desk/data/); window.RaceCorCalc (packages/calc) turns
// them into everything shown here. No network beyond localhost.
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const HOST = (params.get('host') || 'http://localhost:8889').replace(/\/+$/, '');
  const DATA = HOST + '/racing-desk/data/';
  // main.js says why it has no host of its own (no exe built, something else on the port) — shown with the
  // offline message, since that is the window the person is looking at.
  const NOTE = params.get('note');
  const STATUS_POLL_MS = 30000;
  const Calc = window.RaceCorCalc;
  const SettingsModel = window.RacingDeskSettingsModel;

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let desk = null;
  let lastStatus = null;
  let selectedRaceId = null;
  // iRacing series-page ids for "Open in iRacing", keyed by series name: pasted by the driver from the iRacing
  // UI once per season and kept in the overlay settings (docs/race-join-findings.md §4).
  let raceLinks = {};

  // ── Formatting ───────────────────────────────────────────

  const CATEGORY_LABEL = {
    sports_car: 'Sports Car', formula_car: 'Formula', oval: 'Oval', dirt_oval: 'Dirt Oval', dirt_road: 'Dirt Road', road: 'Road',
  };

  function lapTime(s) {
    if (!(s > 0)) return '—';
    const m = Math.floor(s / 60);
    const rest = s - m * 60;
    return m > 0 ? `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(3)}` : rest.toFixed(3);
  }

  function signed(n, digits) {
    if (n == null || Number.isNaN(n)) return '<span class="dim">—</span>';
    const text = (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n).toFixed(digits || 0);
    return `<span class="${n > 0 ? 'gain' : n < 0 ? 'loss' : 'dim'}">${text}</span>`;
  }

  function ago(iso) {
    if (!iso) return 'never';
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 36) return `${hours} h ago`;
    return `${Math.round(hours / 24)} days ago`;
  }

  const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  const dateTimeFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  // ── Data ─────────────────────────────────────────────────

  async function getJson(route) {
    const res = await fetch(DATA + route, { cache: 'no-store' });
    // The status goes with the error: a 404 is how a host from before a route says so (the Cars page asks).
    if (!res.ok) throw Object.assign(new Error(`${route}: HTTP ${res.status}`), { status: res.status });
    return res.json();
  }

  async function load() {
    let status;
    try {
      status = await getJson('status');
    } catch (err) {
      showOffline(`Nothing is answering at ${HOST}.`);
      setTimeout(load, 5000);
      return;
    }
    if (!status || typeof status.schemaVersion !== 'number') {
      // Something else holds the port — typically the SimHub plugin, which serves telemetry but has no store.
      showOffline(`${HOST} is answering, but not with RacingDesk.Host's data API (is SimHub's plugin on that port?).`);
      setTimeout(load, 15000);
      return;
    }
    lastStatus = status;
    const [rows, schedule] = await Promise.all([
      getJson('sessions'),
      getJson('schedule').catch(() => null),
    ]);
    lastDriven = lastDrivenByCar(rows);   // the Cars page orders its cars by these rows
    const t0 = performance.now();
    desk = Calc.buildDesk(rows, { schedule: schedule && schedule.series && schedule.series.length ? schedule : null });
    const ms = Math.round(performance.now() - t0);
    if (Object.keys(desk.errors).length) console.warn('[desk] engine errors', desk.errors);
    $('offline').hidden = true;
    raceLinks = await loadRaceLinks();
    render();
    $('freshness').textContent = `${status.sessions.toLocaleString()} sessions · last ${ago(status.lastSessionAt)} · ${ms} ms`;
    // The Cars page is drawn again in its new order. One that found no host — the desk can be up before the
    // host is — asks again now that there is one.
    if (rig && !rig.carsError) renderCarsPage();
    else if (currentPage === 'cars' && !rigAsking) loadCars();
  }

  // ── Open in iRacing ──────────────────────────────────────
  // The iRacing UI registers iracing:// and takes its own routes under web/ (docs/race-join-findings.md §1):
  // running, it switches to the page; not running, it starts and lands there after login. The schedule PDF
  // carries no iRacing ids, so a series' page is whatever the driver pasted; without one, the Official page.

  const OFFICIAL = 'iracing://web/racing/official/';
  const SERIES_LIST = /\/web\/racing\/official\/series-list\/(\d+)\/?/;

  function raceLinkUrl(series) {
    const id = raceLinks[series];
    return id ? `${OFFICIAL}series-list/${id}/` : OFFICIAL;
  }

  // A pasted series page link — https://members-ng.iracing.com/web/racing/official/series-list/6273/, the
  // iracing:// form, or just the id — to the id, or null.
  function parseRaceLink(text) {
    const s = String(text || '').trim();
    if (/^\d+$/.test(s)) return s;
    const m = s.match(SERIES_LIST);
    return m ? m[1] : null;
  }

  function openExternal(url) {
    if (window.racingDesk && window.racingDesk.openExternal) window.racingDesk.openExternal(url);
    else location.href = url; // outside Electron the browser asks the OS for the scheme's handler
  }

  async function loadRaceLinks() {
    if (!window.racingDesk || !window.racingDesk.getSettings) return {};
    try {
      const settings = await window.racingDesk.getSettings();
      return (settings && settings.raceLinks) || {};
    } catch (err) {
      return {};
    }
  }

  // The HUD shares overlay-settings.json and saveSettings replaces the file whole: read, set one key, write.
  async function saveRaceLink(series, id) {
    if (window.racingDesk && window.racingDesk.getSettings && window.racingDesk.saveSettings) {
      const settings = (await window.racingDesk.getSettings()) || {};
      settings.raceLinks = { ...(settings.raceLinks || {}), [series]: id };
      await window.racingDesk.saveSettings(settings);
      raceLinks = settings.raceLinks;
    } else {
      raceLinks = { ...raceLinks, [series]: id };
    }
  }

  async function pollStatus() {
    try {
      const status = await getJson('status');
      if (!lastStatus || status.sessions !== lastStatus.sessions || status.lastSessionAt !== lastStatus.lastSessionAt) await load();
      else $('freshness').textContent = `${status.sessions.toLocaleString()} sessions · last ${ago(status.lastSessionAt)}`;
    } catch (_) { /* host restarting — the next poll retries */ }
  }

  function showOffline(reason) {
    $('offline-reason').textContent = NOTE ? `${reason} ${NOTE}` : reason;
    $('offline').hidden = false;
    $('freshness').textContent = 'Local host not running';
  }

  // ── Render ───────────────────────────────────────────────

  function render() {
    renderMasthead();
    renderRaceNow();
    renderComposure();
    renderWhen();
    renderRaces();
    renderHeatmap();
    renderNextRace();
    renderTracks();
    renderCars();
    renderDna();
    renderMoments();
    if (!selectedRaceId && desk.previousRaces && desk.previousRaces.length) selectRace(desk.previousRaces[0].event.id);
  }

  function renderMasthead() {
    $('ratings').innerHTML = desk.ratings.map((r) => `
      <div class="rating">
        <span class="cat">${esc(CATEGORY_LABEL[r.category] || r.category)}</span>
        <span class="ir">${r.iRating.toLocaleString()}</span>
        <span class="lic lic-${esc(r.license)}">${esc(r.license)} ${esc(r.safetyRating)}</span>
      </div>`).join('');
    const s = desk.stats;
    const stat = (value, label) => `<div class="stat"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
    $('stats').innerHTML = stat(s.races, 'races') + stat(s.laps.toLocaleString(), 'race laps') + stat(s.tracks, 'tracks') +
      stat(s.cars, 'cars') + stat(s.wins, 'wins') + stat(s.podiums, 'podiums');
  }

  function renderRaceNow() {
    const el = $('race-now');
    const v = desk.raceNow;
    if (!v) {
      el.className = 'card verdict tier-insufficient';
      el.innerHTML = '<h2>Race now?</h2><p class="empty">Needs five official races before it can read your hours.</p>';
      return;
    }
    const st = v.stats;
    const fig = (value, label) => `<div class="figure"><b>${value}</b><span>${esc(label)}</span></div>`;
    el.className = `card verdict tier-${v.verdict}`;
    el.innerHTML = `
      <h2>Race now? · ${esc(st.currentDayLabel)} ${esc(st.currentHourLabel)}</h2>
      <div class="headline">${esc(v.headline)}</div>
      <div class="detail-line">${esc(v.detail)}</div>
      <div class="figures">
        ${fig(st.hourAvgIncidents != null ? st.hourAvgIncidents.toFixed(1) + 'x' : '—', `inc/race this hour (${st.hourSampleCount})`)}
        ${fig(st.overallAvgIncidents != null ? st.overallAvgIncidents.toFixed(1) + 'x' : '—', 'your average')}
        ${fig(st.hourAvgPosition != null ? 'P' + st.hourAvgPosition.toFixed(1) : '—', 'avg finish this hour')}
        ${fig(st.dayAvgIncidents != null ? st.dayAvgIncidents.toFixed(1) + 'x' : '—', `on ${st.currentDayLabel}s (${st.daySampleCount})`)}
      </div>`;
  }

  function renderComposure() {
    const el = $('composure');
    const c = desk.composure;
    if (!c || !c.score.sampleSize) {
      el.innerHTML = '<h2>Composure</h2><p class="empty">No races with a known rating change yet.</p>';
      return;
    }
    const streak = c.streaks.current;
    el.innerHTML = `
      <h2>Composure · last ${c.score.sampleSize}</h2>
      <div class="score"><b>${c.score.score}</b><span class="band">${esc(c.score.band)}</span></div>
      <div class="meter"><i style="width:${c.score.score}%"></i></div>
      <dl class="kv">
        <dt>iRating, last ${c.score.sampleSize}</dt><dd>${signed(c.score.iRatingDeltaSum)}</dd>
        <dt>Incidents per race</dt><dd>${c.score.avgIncidents.toFixed(1)}</dd>
        <dt>Heat, last ${c.heat.sampleSize}</dt><dd>${signed(c.heat.iRatingDeltaSum)} <span class="dim">${esc(c.heat.direction)}</span></dd>
        <dt>Current run</dt><dd>${streak ? `${streak.span.length} ${esc(streak.kind)}` : '—'}</dd>
        <dt>Trajectory, 30 days</dt><dd>${c.trajectory.horizons[1] ? signed(c.trajectory.horizons[1].expectedDelta) : '—'}</dd>
      </dl>`;
  }

  function renderWhen() {
    const el = $('when');
    const w = desk.whenPanel;
    if (!w) {
      el.innerHTML = '<h2>When you race well</h2><p class="empty">Needs five official races.</p>';
      return;
    }
    const side = (cls, title, s) => `
      <div class="${cls}">
        <h3>${title}</h3>
        <div class="window">${esc(s.days)}<br>${esc(s.hours)}</div>
        <p>${esc(s.paragraph)}</p>
        <p class="num">${signed(s.avgIRatingDelta, 1)} iR/race</p>
      </div>`;
    el.innerHTML = `<h2>When you race well</h2><div class="sides">${side('strengths', 'Strongest', w.strengths)}${side('watch', 'Watch out', w.watchOut)}</div>`;
  }

  function renderRaces() {
    const list = desk.previousRaces || [];
    const races = list.filter((c) => c.viewModel.sessionTypeTab === 'races');
    $('race-list').innerHTML = races.map((c) => {
      const e = c.event;
      const vm = c.viewModel;
      return `
        <div class="race-row${e.id === selectedRaceId ? ' selected' : ''}" data-id="${esc(e.id)}">
          <div class="pos" style="color:${esc(vm.positionColorHex || 'inherit')}">${esc(vm.positionDisplay || '—')}<small>${esc(vm.fieldSizeLabel || '')}</small></div>
          <div><div class="track">${esc(e.trackDisplayName)}</div><div class="sub">${esc(dateTimeFmt.format(new Date(e.startedAt)))}${e.strengthOfField ? ` · SoF ${e.strengthOfField.toLocaleString()}` : ''}</div></div>
          <div class="car">${esc(e.carName)}</div>
          <div class="cell">${esc(vm.bestLapLabel)}</div>
          <div class="cell">${e.incidents}x</div>
          <div class="cell">${signed(e.iRatingDelta)}</div>
          <div class="cell">${signed(e.safetyRatingDelta, 2)}</div>
        </div>`;
    }).join('') || '<p class="empty" style="padding:0 18px 16px">No official races stored yet.</p>';
  }

  async function selectRace(id) {
    selectedRaceId = id;
    for (const row of document.querySelectorAll('.race-row')) row.classList.toggle('selected', row.dataset.id === id);
    const card = (desk.previousRaces || []).find((c) => c.event.id === id);
    if (!card) return;
    const e = card.event;
    const el = $('detail');
    el.innerHTML = `<h2>Race</h2><div class="title">${esc(e.trackDisplayName)}</div><div class="meta">Loading laps…</div>`;

    let laps = [];
    let incidents = [];
    try {
      const parts = await Promise.all(e.rowIds.map((rowId) => getJson('session?id=' + rowId)));
      for (const part of parts) {
        laps = laps.concat(part.laps);
        incidents = incidents.concat(part.incidents);
      }
    } catch (err) {
      el.querySelector('.meta').textContent = 'Laps unavailable: ' + err.message;
      return;
    }
    if (selectedRaceId !== id) return;

    const timed = laps.filter((l) => l.lap_time_s > 0);
    const best = timed.length ? Math.min(...timed.map((l) => l.lap_time_s)) : null;
    const meta = [
      dateTimeFmt.format(new Date(e.startedAt)),
      e.carName,
      e.startPosition && e.finishPosition ? `P${e.startPosition} → P${e.finishPosition} of ${e.fieldSize}` : null,
      e.strengthOfField ? `SoF ${e.strengthOfField.toLocaleString()}` : null,
      e.iRatingDelta != null ? `${e.iRatingDelta > 0 ? '+' : ''}${e.iRatingDelta} iR` : null,
    ].filter(Boolean).map(esc).join(' · ');

    el.innerHTML = `
      <h2>Race · ${esc(card.viewModel.positionDisplay || '')}</h2>
      <div class="title">${esc(e.trackDisplayName)}</div>
      <div class="meta">${meta}</div>
      ${lapChart(laps, best)}
      <h2>Incidents · ${e.incidents}x</h2>
      <div class="incident-strip" title="Where on the lap incidents happened">
        ${incidents.map((i) => `<i style="left:${(i.lap_dist_pct * 100).toFixed(2)}%" title="Lap ${i.lap}: ${i.points}x at ${(i.lap_dist_pct * 100).toFixed(0)}%"></i>`).join('')}
      </div>
      <div class="laps-scroll">
        <table class="laps-table">
          <thead><tr><th>Lap</th><th>Time</th><th>Pos</th><th>Inc</th><th>Fuel</th></tr></thead>
          <tbody>${laps.map((l) => `
            <tr class="${best && l.lap_time_s === best ? 'best' : ''}">
              <td>${l.lap}${l.pitted ? ' <span class="dim">pit</span>' : ''}</td>
              <td>${lapTime(l.lap_time_s)}</td>
              <td>${l.position > 0 ? 'P' + l.position : '—'}</td>
              <td>${l.incidents || ''}</td>
              <td>${l.fuel_used_l > 0 ? l.fuel_used_l.toFixed(2) + ' L' : ''}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function lapChart(laps, best) {
    const timed = laps.filter((l) => l.lap_time_s > 0);
    if (timed.length < 2) return '<p class="empty">Not enough timed laps to chart.</p>';
    const W = 600, H = 140, padL = 44, padB = 16;
    const sorted = timed.map((l) => l.lap_time_s).sort((a, b) => a - b);
    // Scale to the representative laps, so an out-lap or a tow doesn't flatten the rest.
    const cap = sorted[Math.floor(sorted.length * 0.9)] * 1.04;
    const floor = best * 0.985;
    const bw = (W - padL) / timed.length;
    const y = (t) => H - padB - (Math.min(t, cap) - floor) / (cap - floor) * (H - padB - 6);
    const bars = timed.map((l, i) => {
      const cls = l.pitted ? 'bar-pit' : l.clean ? 'bar-clean' : 'bar-dirty';
      const top = y(l.lap_time_s);
      return `<rect class="${cls}" x="${(padL + i * bw + bw * 0.15).toFixed(1)}" y="${top.toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${(H - padB - top).toFixed(1)}"><title>Lap ${l.lap}: ${lapTime(l.lap_time_s)}</title></rect>`;
    }).join('');
    const by = y(best).toFixed(1);
    return `<svg class="lap-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <line class="best" x1="${padL}" x2="${W}" y1="${by}" y2="${by}"></line>
      <text x="0" y="${by}" dy="3">${lapTime(best)}</text>
      ${bars}
      <text x="${padL}" y="${H - 3}">lap ${timed[0].lap}</text>
      <text x="${W}" y="${H - 3}" text-anchor="end">lap ${timed[timed.length - 1].lap}</text>
    </svg>`;
  }

  function renderHeatmap() {
    const el = $('heatmap');
    const buckets = desk.scatter || [];
    if (!buckets.length) {
      el.innerHTML = '<h2>Your week</h2><p class="empty">No races yet.</p>';
      return;
    }
    const total = buckets.reduce((n, b) => n + b.count, 0);
    const avgInc = buckets.reduce((n, b) => n + b.incidentsSum, 0) / total;
    const maxCount = Math.max(...buckets.map((b) => b.count));
    const at = new Map(buckets.map((b) => [b.day * 24 + b.hour, b]));
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    let cells = '<span></span>' + Array.from({ length: 24 }, (_, h) => `<span class="lbl hr">${h % 3 === 0 ? h : ''}</span>`).join('');
    days.forEach((label, row) => {
      const jsDay = (row + 1) % 7;
      cells += `<span class="lbl">${label}</span>`;
      for (let h = 0; h < 24; h++) {
        const b = at.get(jsDay * 24 + h);
        if (!b) { cells += '<span class="heat-cell"></span>'; continue; }
        // Hue: cleaner than your average → green, messier → red. Strength: how often you race then.
        const rel = Math.max(-1, Math.min(1, (avgInc - b.avgIncidents) / Math.max(avgInc, 1)));
        const hue = rel >= 0 ? 142 : 0;
        const alpha = 0.25 + 0.75 * Math.sqrt(b.count / maxCount);
        const sat = 25 + Math.abs(rel) * 45;
        cells += `<span class="heat-cell" style="background:hsla(${hue},${sat}%,55%,${alpha.toFixed(2)})" title="${label} ${h}:00 — ${b.count} races, ${b.avgIncidents.toFixed(1)}x avg, ${b.irDeltaSum >= 0 ? '+' : ''}${b.irDeltaSum} iR"></span>`;
      }
    });
    el.innerHTML = `<h2>Your week · incidents by hour</h2><div class="heat-grid">${cells}</div>
      <div class="heat-legend"><span><i style="background:hsla(142,60%,55%,.9)"></i>cleaner than your ${avgInc.toFixed(1)}x average</span>
      <span><i style="background:hsla(0,60%,55%,.9)"></i>messier</span><span>brighter = raced more often</span></div>`;
  }

  function renderNextRace() {
    const el = $('next-race');
    const ideas = desk.nextRaceIdeas;
    const season = desk.schedule;
    if (!season) {
      el.innerHTML = `<h2>Next race ideas</h2>
        <p>Suggestions need this season's schedule, which comes from iRacing's official season schedule PDF.
        Fetch and store it with <code>npm run host -- schedule --store</code>.</p>`;
      return;
    }
    if (!ideas || !ideas.length) {
      el.innerHTML = `<h2>Next race ideas · ${esc(season.season || '')}</h2>
        <p>${season.series} series are loaded, but none of them has a race you could join in the next few hours.</p>`;
      return;
    }
    el.innerHTML = `<h2>Next race ideas · ${esc(season.season || '')}</h2>
      <ul class="suggestions">${ideas.slice(0, 5).map((s) => `
        <li>
          <span class="when" style="color:${esc(s.viewModel.scoreColorHex)}">${esc(s.viewModel.startsInShortLabel)}</span>
          <span class="score" style="background:${esc(s.viewModel.scoreColorHex)}22;color:${esc(s.viewModel.scoreColorHex)}">${Math.round(s.score)}</span>
          <span class="name">${esc(s.seriesName)}</span>
          <span class="sub">${esc(s.trackName)}${s.trackConfig ? ' — ' + esc(s.trackConfig) : ''}
            · ${esc(s.viewModel.durationLabel || (s.sessionMinutes + ' min'))}${s.isFixed ? ' · fixed' : ''}
            ${s.carClassNames && s.carClassNames.length ? ' · ' + esc(s.carClassNames.slice(0, 2).join(', ')) : ''}</span>
          <span class="why">${esc(s.strategy ? s.strategy.text : s.commentary || '')}</span>
          <span class="actions">
            <button type="button" class="open-iracing" data-series="${esc(s.seriesName)}">Open in iRacing</button>
            <button type="button" class="link-toggle" title="Paste this series' page link from the iRacing UI, so the button lands on it">${raceLinks[s.seriesName] ? 'linked' : 'link…'}</button>
          </span>
          <form class="link-form" data-series="${esc(s.seriesName)}" hidden>
            <input type="text" placeholder="paste the series page link from the iRacing UI" aria-label="series page link">
            <button type="submit">Save</button>
            <span class="link-note"></span>
          </form>
        </li>`).join('')}</ul>`;
  }

  function renderTracks() {
    const el = $('tracks');
    const tracks = (desk.mastery && desk.mastery.tracks) || [];
    el.innerHTML = `<h2>Track mastery</h2><ul class="rank">${tracks.slice(0, 8).map((t) => `
      <li><span class="name"><span class="tier-dot tier-${esc(t.masteryTier)}"></span>${esc(t.trackName)}</span><span class="score">${t.masteryScore}</span>
      <span class="sub">${t.totalSessions} races · avg ${t.avgPosition != null ? 'P' + t.avgPosition.toFixed(1) : '—'} · best ${t.bestPosition != null ? 'P' + t.bestPosition : '—'} · ${t.avgIncidents.toFixed(1)}x · ${esc(t.trend)}</span></li>`).join('')}</ul>`;
  }

  function renderCars() {
    const el = $('cars');
    const cars = (desk.mastery && desk.mastery.cars) || [];
    el.innerHTML = `<h2>Car affinity</h2><ul class="rank">${cars.slice(0, 8).map((c) => `
      <li><span class="name">${esc(c.manufacturer)}</span><span class="score">${c.affinityScore}</span>
      <span class="sub">${c.totalSessions} races · ${esc(c.cars.slice(0, 2).map((x) => x.carModel).join(', '))} · ${esc(c.trend)}</span></li>`).join('')}</ul>`;
  }

  function renderDna() {
    const el = $('dna');
    const d = desk.dna;
    if (!d) {
      el.innerHTML = '<h2>Driver DNA</h2><p class="empty">Needs three official races.</p>';
      return;
    }
    const dims = ['consistency', 'racecraft', 'cleanness', 'endurance', 'adaptability', 'improvement', 'experience'];
    el.innerHTML = `<h2>Driver DNA</h2>
      <div class="archetype">${esc(d.archetype.major)}</div>
      <div class="variant">${esc(d.archetype.variant)}</div>
      <div class="bars">${dims.map((k) => {
        const v = Math.round(d.profile[k]);
        return `<span>${k[0].toUpperCase() + k.slice(1)}</span><span class="bar"><i style="width:${v}%"></i></span><span class="v">${v}</span>`;
      }).join('')}</div>`;
  }

  function renderMoments() {
    const el = $('moments');
    const moments = (desk.moments || []).slice().sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    el.innerHTML = `<h2>Moments</h2><ul class="rank">${moments.slice(0, 7).map((m) => `
      <li><span class="name">${esc(m.title)}</span><span class="score dim" style="font-size:12px">${esc(dateFmt.format(new Date(m.date)))}</span>
      <span class="sub">${esc(m.description)}</span></li>`).join('') || '<li class="empty">Nothing yet.</li>'}</ul>`;
  }

  // ── Pages ────────────────────────────────────────────────
  // Desk, Cars, Paints and Settings are sections of this one window, shown one at a time. The hash remembers
  // which; main.js asks for one with ?page= (tray menu, first open) or 'show-page' (the window is already up).

  const PAGES = ['desk', 'cars', 'paints', 'settings'];
  let currentPage = null;

  function pageFromHash() {
    const page = location.hash.replace(/^#/, '');
    return PAGES.includes(page) ? page : 'desk';
  }

  function showPage(page) {
    if (!PAGES.includes(page)) page = 'desk';
    currentPage = page;
    for (const el of document.querySelectorAll('[data-page]')) el.hidden = el.dataset.page !== page;
    for (const a of document.querySelectorAll('.nav a')) {
      if (a.dataset.pageLink === page) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    $('offline').classList.toggle('off-page', page !== 'desk'); // the "no local data" notice is the desk page's
    document.dispatchEvent(new CustomEvent('racingdesk:page', { detail: page }));   // a page that paused its checks resumes
    if (location.hash !== '#' + page) {
      try { history.replaceState(null, '', '#' + page); } catch (_) { location.hash = page; }
    }
    if (page === 'cars') loadCars();
    if (page === 'paints') mountPaints();
    if (page === 'settings') renderSettings();
  }

  // ── Cars ─────────────────────────────────────────────────
  // What the host remembers for each car the driver has driven. The view it was last driven with: iRacing keeps
  // one driver height and one horizon for every car, so the host records them per car when the sim closes. And
  // its pedals: which of SmartControl's profiles it is driven with, chosen here once per car. Nothing on the page
  // changes iRacing or the pedals.
  //
  // Read from the host each time the page is shown and on Refresh, not at desk start: cars, views, pedals. A host
  // from before the page answers 404 for the last two; the cars are listed all the same and the page says which
  // it went without. The one write is main.js's (window.racingDesk.rig → rig:bindPedals): the host refuses a
  // write that comes from a page. In a browser there is no bridge, so the selects are off and the page says so.

  let lastDriven = new Map();    // car → { at, iso }: the start of the latest session driven in it
  let rig = null;                // what the page last read (readRig)
  let rigLoad = 0;               // counts loadCars(): an answer that is no longer the latest is dropped
  let rigAsking = false;
  const pedalNotes = new Map();  // car → { kind: 'saved' | 'failed', text }, shown beside its select

  const DASH = '<span class="dim">—</span>';
  const NO_VIEW = 'not recorded yet — it will be after the next time you drive it';
  // SmartControl Live names keys as Windows does. These are the ones seen; any other is shown as it is.
  const KEY_NAMES = new Map([
    ['PRIOR', 'Page Up'], ['NEXT', 'Page Down'], ['PAUSE', 'Pause'], ['RCONTROL', 'Right Ctrl'], ['UP', 'Up'], ['DOWN', 'Down'],
  ]);

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const isCarRow = (r) => r !== null && typeof r === 'object' && typeof r.car_path === 'string';
  const carKey = (carPath) => String(carPath).toLowerCase();
  // Case and accents fold away, so "huracan" finds the Huracán.
  const fold = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

  // A number as the host gave it, less what a float picks up on the way: 0.05999999865889549 is 0.06.
  const plain = (n) => String(Number(n.toFixed(4)));

  // Metres as millimetres, with the sign: −0.06 is "−60 mm". Which way a sign points is the host's to say.
  function mm(metres) {
    if (!isNum(metres)) return DASH;
    const v = Math.round(metres * 1000);
    return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}<span class="unit"> mm</span>`;
  }

  function signedPlain(n) {
    if (!isNum(n)) return DASH;
    const text = plain(Math.abs(n));
    return (text === '0' ? '' : n > 0 ? '+' : '−') + text;
  }

  function lastDrivenByCar(rows) {
    const last = new Map();
    for (const row of rows || []) {
      if (!isCarRow(row) || !row.started_at) continue;
      const at = Date.parse(row.started_at);
      const known = last.get(carKey(row.car_path));
      if (!Number.isNaN(at) && (!known || at > known.at)) last.set(carKey(row.car_path), { at, iso: row.started_at });
    }
    return last;
  }

  function rigBridge() {
    const bridge = window.racingDesk && window.racingDesk.rig;
    return bridge && bridge.bindPedals ? bridge : null;
  }

  // { value }, or { missing } for a route the host doesn't have, or { error } for anything else.
  async function getOptional(route) {
    try {
      return { value: await getJson(route) };
    } catch (err) {
      if (err.status === 404) return { missing: true };
      if (err.status) return { error: err.message };
      return { error: err instanceof SyntaxError ? `${route}: the answer was not JSON` : `nothing is answering at ${HOST}` };
    }
  }

  async function loadCars() {
    const mine = ++rigLoad;
    rigAsking = true;
    $('cars-note').hidden = !!rigBridge();
    if (!rig) $('cars-status').textContent = 'Reading the cars…';
    const [cars, views, pedals] = await Promise.all(['cars', 'views', 'pedals'].map(getOptional));
    if (mine !== rigLoad) return;   // asked again since: that answer is the one to show
    rigAsking = false;
    pedalNotes.clear();
    rig = readRig(cars, views, pedals);
    renderCarsPage();
  }

  // The three answers as the page uses them. `views` and `pedals` are null when the host had none to give, and
  // `notes` says why in words; with no cars there is nothing to hang either on, and only that is said.
  function readRig(cars, views, pedals) {
    const out = { cars: [], carsError: null, views: null, pedals: null, notes: [] };
    if (!Array.isArray(cars.value)) {
      out.carsError = cars.missing ? 'this host has no list of cars' : cars.error || 'the host\'s answer was not a list of cars';
      return out;
    }
    out.cars = cars.value.filter(isCarRow);
    const older = [];

    if (Array.isArray(views.value)) out.views = new Map(views.value.filter(isCarRow).map((v) => [carKey(v.car_path), v]));
    else if (views.missing) older.push('views');
    else out.notes.push(`The views could not be read: ${views.error || 'the answer was not a list'}.`);

    const sc = pedals.value && pedals.value.smartcontrol;
    if (sc !== null && typeof sc === 'object') {
      const list = (v) => (Array.isArray(v) ? v.filter((x) => x !== null && typeof x === 'object') : []);
      out.pedals = {
        found: !!sc.found,
        profiles: list(sc.profiles).filter((p) => typeof p.id === 'string'),
        keys: list(sc.keys),
        cars: new Map(list(pedals.value.cars).filter(isCarRow).map((c) => [carKey(c.car_path), c])),
      };
    } else if (pedals.missing) older.push('pedals');
    else out.notes.push(`The pedals could not be read: ${pedals.error || 'the answer was not SmartControl\'s profiles'}.`);

    if (older.length) out.notes.unshift(`This host is older than the page: it has no ${older.join(' or ')} to show yet.`);
    if (out.pedals && !out.pedals.found) out.notes.push('SmartControl wasn\'t found on this rig, so there are no profiles to choose from.');
    return out;
  }

  // Driven cars, the one driven last first. A car no stored session is in goes after those, by name.
  function drivenCars() {
    return rig.cars.filter((c) => c.driven > 0)
      .map((c) => ({ ...c, label: c.name || c.car_path, last: lastDriven.get(carKey(c.car_path)) || null }))
      .sort((a, b) => (b.last ? b.last.at : 0) - (a.last ? a.last.at : 0) || a.label.localeCompare(b.label));
  }

  function renderCarsPage() {
    if (!rig) return;
    $('cars-note').hidden = !!rigBridge();
    $('cars-status').textContent = rig.notes.join(' ');
    renderCarsList();
    const keys = rig.pedals ? rig.pedals.keys : [];
    $('cars-keys').hidden = !keys.length;
    $('cars-keys').innerHTML = keys.length ? `<span class="label">SmartControl Live keys</span>${keys.map(keyLine).join('')}` : '';
  }

  function renderCarsList() {
    const el = $('cars-list');
    $('cars-count').textContent = '';
    if (rig.carsError) {
      el.innerHTML = `<p class="empty">The cars could not be read: ${esc(rig.carsError)}.</p>`;
      return;
    }
    const all = drivenCars();
    if (!all.length) {
      el.innerHTML = '<p class="empty">No car driven yet.</p>';
      return;
    }
    const typed = $('cars-filter').value.trim();
    const words = fold(typed).split(/\s+/).filter(Boolean);
    const shown = all.filter((c) => {
      const hay = fold(`${c.label} ${c.car_path}`);
      return words.every((w) => hay.includes(w));
    });
    $('cars-count').textContent = shown.length === all.length ? String(all.length) : `${shown.length} of ${all.length}`;
    if (!shown.length) {
      el.innerHTML = `<p class="empty">No car matches “${esc(typed)}”.</p>`;
      return;
    }
    const noSmartControl = rig.pedals && !rig.pedals.found;
    el.innerHTML = `<table class="cars-table">
      <thead>
        <tr>
          <th class="words" rowspan="2">Car</th>
          <th rowspan="2">Last driven</th>
          <th class="group" colspan="4">View, as last driven</th>
          <th class="group" colspan="3">Seat</th>
          <th class="words" rowspan="2">The view is</th>
          <th class="words" rowspan="2">Pedals${noSmartControl ? ' <span class="aside">SmartControl wasn\'t found</span>' : ''}</th>
        </tr>
        <tr>
          <th>Height</th><th>Horizon</th><th class="wraps">Head horizon</th><th>FOV</th>
          <th>Fore/aft</th><th>Sideways</th><th>Up/down</th>
        </tr>
      </thead>
      <tbody>${shown.map(carRow).join('')}</tbody>
    </table>`;
  }

  function carRow(car) {
    const view = rig.views ? rig.views.get(carKey(car.car_path)) : null;
    const viewCells = view ? `
      <td class="n">${mm(view.driver_height)}</td>
      <td class="n">${signedPlain(view.vanish_y)}</td>
      <td class="n">${isNum(view.head_horizon) ? plain(view.head_horizon) : DASH}</td>
      <td class="n">${isNum(view.fov) ? plain(view.fov) + '<span class="unit">°</span>' : DASH}</td>
      <td class="n">${mm(view.seat_x)}</td>
      <td class="n">${mm(view.seat_y)}</td>
      <td class="n">${mm(view.seat_z)}</td>
      <td class="words" title="${esc(viewTitle(view))}">${view.chosen == null ? DASH : view.chosen ? 'its own' : 'inherited'}</td>`
      : `<td class="none" colspan="8">${rig.views ? NO_VIEW : DASH}</td>`;
    return `<tr data-car="${esc(car.car_path)}">
      <td class="car" title="${esc(car.car_path)}">${esc(car.label)}</td>
      <td class="n">${car.last ? esc(ago(car.last.iso)) : DASH}</td>${viewCells}
      <td class="pedals">${pedalsCell(car)}</td>
    </tr>`;
  }

  function viewTitle(view) {
    const parts = [];
    if (view.chosen != null) parts.push(view.chosen ? 'Changed while in this car.' : 'Carried over from the car driven before it, and not changed in this one.');
    if (!Number.isNaN(Date.parse(view.seen_at))) parts.push(`Recorded ${dateTimeFmt.format(new Date(view.seen_at))}.`);
    return parts.join(' ');
  }

  // A car's pedals: the select, what the chosen profile's brake is, and how the last change went. A profile
  // SmartControl no longer has stays in the car's own list, so the select says what the host has, not "none".
  function pedalsCell(car) {
    const pedals = rig.pedals;
    if (!pedals) return DASH;
    const bound = pedals.cars.get(carKey(car.car_path)) || null;
    const boundId = bound && typeof bound.profile_id === 'string' ? bound.profile_id : null;
    const profile = boundId === null ? null : pedals.profiles.find((p) => p.id === boundId) || null;
    const words = pedalWords(bound, profile);
    if (!pedals.found) {
      if (boundId === null) return DASH;
      return `<div class="pedals-line"><span class="kept">${esc(bound.profile_name || boundId)}</span><span class="says">${words}</span></div>`;
    }

    const option = (id, label, selected) => `<option value="${esc(id)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
    const note = pedalNotes.get(carKey(car.car_path));
    return `<div class="pedals-line">
      <select data-car="${esc(car.car_path)}" aria-label="Pedal profile for ${esc(car.label)}"${rigBridge() ? '' : ' disabled'}>
        ${option('', 'no profile of its own', boundId === null)}
        ${pedals.profiles.map((p) => option(p.id, p.name || p.id, p.id === boundId)).join('')}
        ${boundId !== null && !profile ? option(boundId, `${bound.profile_name || boundId} (not in SmartControl)`, true) : ''}
      </select>
      <span class="says">${words}<span class="pedal-note${note ? ' ' + esc(note.kind) : ''}">${note ? esc(note.text) : ''}</span></span>
    </div>`;
  }

  // One line beside the select: the profile's brake as SmartControl has it now, whether the profile is still
  // what the car was given, and the brake force kept for the car itself.
  function pedalWords(bound, profile) {
    const n = (v) => `<span class="num">${esc(plain(v))}</span>`;
    const parts = [];
    if (profile) {
      const brake = profile.brake;
      if (!brake) parts.push('no brake in this profile');
      else {
        if (isNum(brake.max_force_kg)) parts.push(`brake max ${n(brake.max_force_kg)} kg`);
        if (isNum(brake.deadzone_bottom)) parts.push(`bottom deadzone ${n(brake.deadzone_bottom)}%`);
        const shape = curveShape(brake.curve);
        if (shape) parts.push(`${shape} curve`);
      }
    }
    if (bound && bound.profile_now === 'changed') parts.push('<span class="warn">edited in SmartControl since this car was given it</span>');
    if (bound && bound.profile_now === 'gone') parts.push('<span class="warn">deleted in SmartControl</span>');
    if (bound && isNum(bound.brake_force_kg)) parts.push(`brake force ${n(bound.brake_force_kg)} kg in this car`);
    return parts.length ? `<span class="brake">${parts.join(' · ')}</span>` : '';
  }

  // 'linear' when the output is the input at every point — 0, 20, 40 … 100 across six — 'shaped' when it is
  // not, and null for a curve with too few points to say.
  function curveShape(curve) {
    if (!Array.isArray(curve) || curve.length < 2 || !curve.every(isNum)) return null;
    const step = 100 / (curve.length - 1);
    return curve.every((v, i) => Math.abs(v - i * step) < 0.5) ? 'linear' : 'shaped';
  }

  function keyLine(k) {
    const names = (Array.isArray(k.keys) ? k.keys : []).map((name) => KEY_NAMES.get(name) || String(name)).join(' + ');
    const kg = isNum(k.value) ? `${plain(k.value)} kg` : '';
    const what = k.action === 'set' ? `brake force ${kg}`
      : k.action === 'raise' ? `${kg} more`
      : k.action === 'lower' ? `${kg} less`
      : `${k.action == null ? 'other' : k.action}${isNum(k.value) ? ` (${plain(k.value)})` : ''}`;
    return `<span class="key"><b>${esc(names || '?')}</b> — ${esc(what.trim())}</span>`;
  }

  // A profile chosen for a car. The select is off while main.js asks the host; then the cell is drawn again from
  // what the host answered — or, when it refused, from what it had, which puts the select back.
  async function onPedalsChange(ev) {
    const select = ev.target.closest('select[data-car]');
    const bridge = rigBridge();
    if (!select || !bridge || !rig || !rig.pedals) return;
    const carPath = select.dataset.car;
    const cell = select.closest('td');
    const focused = document.activeElement === select;
    select.disabled = true;
    const note = cell.querySelector('.pedal-note');
    note.className = 'pedal-note';
    note.textContent = 'saving…';

    let result;
    try {
      result = await bridge.bindPedals(carPath, select.value === '' ? null : select.value);
    } catch (err) {
      result = { ok: false, error: err && err.message ? err.message : String(err) };
    }
    if (!rig || !rig.pedals) return;   // read again meanwhile, from a host without pedals
    if (result && result.ok) {
      if (result.car !== null && typeof result.car === 'object') rig.pedals.cars.set(carKey(carPath), { ...result.car, car_path: carPath });
      else rig.pedals.cars.delete(carKey(carPath));
      pedalNotes.set(carKey(carPath), { kind: 'saved', text: 'saved' });
    } else {
      const why = result && typeof result.error === 'string' && result.error ? result.error : 'no reason given';
      pedalNotes.set(carKey(carPath), { kind: 'failed', text: `not saved: ${why}` });
    }
    const car = drivenCars().find((c) => carKey(c.car_path) === carKey(carPath));
    if (!car || !cell.isConnected) {
      renderCarsList();   // drawn again while the host was asked: that list has the car as it was
      return;
    }
    cell.innerHTML = pedalsCell(car);
    // The keyboard stays where it was, unless the driver has moved on to something else meanwhile.
    const held = document.activeElement;
    const again = cell.querySelector('select');
    if (again && focused && (!held || held === document.body || !held.isConnected)) again.focus();
  }

  // ── Paints ───────────────────────────────────────────────
  // The livery manager (apps/paints/src) runs here as an island: apps/paints/build-island.mjs bundles it into
  // modules/desk/paints.bundle.js as window.RacingDeskPaints, mounted into the page the first time it is shown and
  // left mounted after. Its file operations are main.js's, reached over window.racingDesk.paints (preload.js). With
  // no bundle, or no bridge (a browser), the page says so instead.

  let paintsMounted = false;

  function mountPaints() {
    if (paintsMounted) return;
    const island = window.RacingDeskPaints;
    const bridge = window.racingDesk && window.racingDesk.paints;
    $('paints-unbuilt').hidden = !!island;
    $('paints-note').hidden = !island || !!bridge;
    if (!island || !bridge) return;
    island.mount($('paints-root'));
    paintsMounted = true;
  }

  // ── Settings ─────────────────────────────────────────────
  // The HUD's settings — modules/js/settings.js reads them from overlay-settings.json — edited through the
  // preload bridge. modules/desk/settings-model.js says which keys, how they group and what each control
  // shows. A change is a read-modify-write of the whole file (the HUD shares it; save-settings replaces it
  // whole), after which main.js sends the HUD settings-sync and it re-applies. Outside Electron there is no
  // bridge: the page shows the HUD's defaults, disabled, and says so.

  const SETTINGS_COLUMNS = [['layout', 'modules'], ['look', 'commentary']];

  function settingsBridge() {
    const bridge = window.racingDesk;
    return bridge && bridge.getSettings && bridge.saveSettings ? bridge : null;
  }

  async function renderSettings() {
    const bridge = settingsBridge();
    let saved = null;
    if (bridge) {
      try { saved = await bridge.getSettings(); } catch (_) { saved = null; }
    }
    const sections = SettingsModel.settingsView(saved || {});
    $('settings-note').hidden = !!bridge;
    $('settings-sections').innerHTML = SETTINGS_COLUMNS.map((ids) => `<div class="settings-col">${ids.map((id) => {
      const section = sections.find((s) => s.id === id);
      return `<section class="card" id="settings-${esc(id)}"><h2>${esc(section.title)}</h2>${section.fields.map((f) => fieldHtml(f, !bridge)).join('')}</section>`;
    }).join('')}</div>`).join('');
    await renderRemote();
  }

  // ── The HUD on an iPad ───────────────────────────────────
  // remote-server.js, switched from here: main.js starts and stops it (start-remote-server, stop-remote-server)
  // and answers with the server as it then stands. It is not a key of the settings file like the rest of the
  // page — switching it starts something listening on the network — so it has a card and handlers of its own.
  // The address holds the key, and the code beside it is that address: scanned once, the iPad remembers.

  // The QR code is a version 3: 42 characters and no more (modules/js/qr-code.js). Its canvas is 37 modules of 5
  // pixels: the 29 of the code and the four of white a camera needs on every side.
  const QR_MAX = 42;

  function remoteBridge() {
    const bridge = window.racingDesk;
    return bridge && bridge.getRemoteServerInfo && bridge.startRemoteServer && bridge.stopRemoteServer ? bridge : null;
  }

  let remoteBusy = false;
  // Each rendering is numbered: the page can be shown again while the server is being asked how it stands, and
  // what is on the card has to be the last thing asked for, not the last to arrive.
  let remoteAsked = 0;
  // What went wrong the last time the driver changed something here, until something goes right.
  let remoteError = null;

  async function renderRemote(answer) {
    const mine = ++remoteAsked;
    const el = $('settings-remote');
    const bridge = remoteBridge();
    let info = answer || null;
    if (!info && bridge) {
      try { info = await bridge.getRemoteServerInfo(); } catch (err) { info = { success: false, error: err.message }; }
      if (mine !== remoteAsked) return;
    }
    info = { ...(info || {}) };
    info.error = info.error || remoteError;
    const on = info.running === true;
    const port = Number.isInteger(info.port) ? info.port : 9090;
    const others = (info.addresses || []).filter((a) => a.url && a.url !== info.url);
    const off = !bridge || remoteBusy ? ' disabled' : '';

    el.innerHTML = `
      <h2>iPad</h2>
      <div class="field">
        <label class="name" for="remote-on">Show the HUD on an iPad or tablet</label>
        <span class="hint">The drive view, in a browser on your home network. It is sent the numbers the HUD reads, never a picture of the game, and nothing can be changed from there.</span>
        <span class="control"><input type="checkbox" class="switch" id="remote-on"${on ? ' checked' : ''}${off}></span>
      </div>
      <div class="field">
        <label class="name" for="remote-port">Port</label>
        <span class="hint">Only worth changing if another program has this one.</span>
        <span class="control"><input type="number" id="remote-port" min="1024" max="65535" step="1" value="${port}"${off}></span>
      </div>
      ${info.error ? `<p class="remote-error" role="alert">${esc(info.error)}</p>` : ''}
      ${on && info.url ? `
        <div class="remote-address">
          ${info.url.length <= QR_MAX ? '<canvas id="remote-qr" width="185" height="185" aria-label="The address, as a code to scan"></canvas>' : ''}
          <div>
            <p class="remote-say">Open this on the iPad, or scan the code with its camera:</p>
            <p class="remote-url"><code>${esc(info.url)}</code></p>
            ${others.length ? `<p class="remote-others">This rig has other addresses. If that one does not answer: ${others.map((a) => `<code title="${esc(a.name)}">${esc(a.url)}</code>`).join(', ')}</p>` : ''}
            <p class="remote-say">The end of the address is its key: anything on your network without it is refused. Add the page to the iPad's home screen and it opens full screen.</p>
            <p class="remote-say">Set the iPad's Auto-Lock to Never while you race, or it will sleep: a page cannot keep it awake.</p>
            <p><button type="button" id="remote-renew"${off}>New key</button> <span class="hint">Every address handed out before stops working.</span></p>
          </div>
        </div>` : ''}
      ${on && !info.url ? '<p class="remote-error" role="alert">The rig is not on a network, so there is no address to open yet.</p>' : ''}
      ${!on && bridge ? '<p class="remote-say">The first time it is switched on, Windows asks whether Racing Desk may be reached from your network. Allow it for the kind of network Windows has this one down as, private or public; without that the iPad gets no answer.</p>' : ''}
      ${!bridge ? '<p class="remote-say">This is switched from the Racing Desk app.</p>' : ''}`;

    if (on && info.url && info.url.length <= QR_MAX && typeof window.renderQRCode === 'function') window.renderQRCode('remote-qr', info.url);
  }

  async function changeRemote(ask) {
    if (remoteBusy) return;
    remoteBusy = true;
    let answer;
    try {
      answer = await ask(remoteBridge());
    } catch (err) {
      answer = { success: false, error: err.message };
    }
    remoteBusy = false;
    const stands = answer !== null && typeof answer === 'object';
    remoteError = stands && answer.success === true ? null : (stands && answer.error) || 'The app did not answer.';
    // What could not be done is said with the server as it now stands, which is what the switch then shows.
    await renderRemote(stands && 'running' in answer ? answer : undefined);
  }

  function remotePort() {
    const n = Number($('remote-port').value);
    return Number.isInteger(n) ? n : NaN;
  }

  function onRemoteChange(ev) {
    if (!remoteBridge()) return;
    if (ev.target.id === 'remote-on') {
      const on = ev.target.checked;
      changeRemote((bridge) => (on ? bridge.startRemoteServer({ port: remotePort() }) : bridge.stopRemoteServer()));
    } else if (ev.target.id === 'remote-port' && $('remote-on').checked) {
      // Running: another port is the server started again on it.
      changeRemote((bridge) => bridge.startRemoteServer({ port: remotePort() }));
    }
  }

  function onRemoteClick(ev) {
    if (ev.target.id !== 'remote-renew' || !remoteBridge()) return;
    changeRemote((bridge) => bridge.renewRemoteServerKey());
  }

  function fieldHtml(f, disabled) {
    const id = 'setting-' + f.key;
    const attrs = `id="${id}" data-key="${esc(f.key)}"${disabled ? ' disabled' : ''}`;
    let control;
    switch (f.type) {
      case 'switch':
        control = `<input type="checkbox" class="switch" ${attrs}${f.value ? ' checked' : ''}>`;
        break;
      case 'select':
        control = `<select ${attrs}>${f.options.map(([v, label]) => `<option value="${esc(v)}"${v === f.value ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
        break;
      case 'range':
        control = `<input type="range" ${attrs} min="${f.min}" max="${f.max}" step="${f.step}" value="${f.value}"><output for="${id}" class="num">${f.value}${esc(f.unit)}</output>`;
        break;
      case 'number':
        control = `<input type="number" ${attrs} min="${f.min}" max="${f.max}" step="${f.step}" value="${f.value}"><span class="unit">${esc(f.unit)}</span>`;
        break;
      default:
        control = `<input type="text" ${attrs} value="${esc(f.value)}" placeholder="${esc(f.placeholder || '')}">`;
    }
    return `<div class="field">
      <label class="name" for="${id}">${esc(f.label)}</label>
      ${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}
      <span class="control">${control}</span>
    </div>`;
  }

  // Saves run one after another: two quick changes would otherwise both read the file before either wrote it.
  let settingsSave = Promise.resolve();
  let settingsStatusTimer = null;

  function saveSetting(key, value) {
    settingsSave = settingsSave.then(async () => {
      const bridge = settingsBridge();
      if (!bridge) return;
      const settings = (await bridge.getSettings()) || {};
      settings[key] = value;
      await bridge.saveSettings(settings);
      settingsStatus('Saved — the HUD has it.');
    }).catch((err) => settingsStatus(`Not saved: ${err.message}`));
    return settingsSave;
  }

  function settingsStatus(text) {
    $('settings-status').textContent = text;
    clearTimeout(settingsStatusTimer);
    settingsStatusTimer = setTimeout(() => { $('settings-status').textContent = ''; }, 2500);
  }

  function onSettingChange(ev) {
    const el = ev.target.closest('[data-key]');
    const field = el && SettingsModel.fieldFor(el.dataset.key);
    if (!field) return;
    const value = SettingsModel.parseControlValue(field, field.type === 'switch' ? el.checked : el.value);
    if (field.type === 'number' || field.type === 'range') el.value = value; // what was typed, clamped
    saveSetting(field.key, value);
  }

  // ── Wiring ───────────────────────────────────────────────

  $('race-list').addEventListener('click', (ev) => {
    const row = ev.target.closest('.race-row');
    if (row) selectRace(row.dataset.id);
  });
  $('refresh').addEventListener('click', () => {
    load();
    if (currentPage === 'cars') loadCars();
  });
  $('cars-filter').addEventListener('input', () => { if (rig) renderCarsList(); });
  $('cars-list').addEventListener('change', onPedalsChange);
  $('next-race').addEventListener('click', (ev) => {
    const open = ev.target.closest('.open-iracing');
    if (open) { openExternal(raceLinkUrl(open.dataset.series)); return; }
    const toggle = ev.target.closest('.link-toggle');
    if (toggle) {
      const form = toggle.closest('li').querySelector('.link-form');
      form.hidden = !form.hidden;
      if (!form.hidden) form.querySelector('input').focus();
    }
  });
  $('next-race').addEventListener('submit', async (ev) => {
    const form = ev.target.closest('.link-form');
    if (!form) return;
    ev.preventDefault();
    const id = parseRaceLink(form.querySelector('input').value);
    if (!id) {
      form.querySelector('.link-note').textContent = 'Not a series link — copy it from the series page in the iRacing UI (…/racing/official/series-list/<id>/).';
      return;
    }
    await saveRaceLink(form.dataset.series, id);
    renderNextRace();
  });

  // A page's link is followed here, not by the browser, which would scroll to the element the hash names — and
  // #cars names the Desk page's Car affinity card, so the desk would be left scrolled down to it.
  document.querySelector('.nav').addEventListener('click', (ev) => {
    const link = ev.target.closest('a[data-page-link]');
    if (!link) return;
    ev.preventDefault();
    showPage(link.dataset.pageLink);
  });
  window.addEventListener('hashchange', () => showPage(pageFromHash()));
  if (window.racingDesk && window.racingDesk.onShowPage) window.racingDesk.onShowPage((page) => showPage(page));
  $('settings-sections').addEventListener('change', onSettingChange);
  $('settings-remote').addEventListener('change', onRemoteChange);
  $('settings-remote').addEventListener('click', onRemoteClick);
  $('settings-sections').addEventListener('input', (ev) => {
    // A slider's readout follows the thumb; the file is written when it is let go (change).
    const el = ev.target;
    const field = el.type === 'range' && SettingsModel.fieldFor(el.dataset.key);
    if (field) el.parentNode.querySelector('output').textContent = el.value + field.unit;
  });
  showPage(params.get('page') || pageFromHash());

  if (!Calc) {
    showOffline('The calc bundle is missing — run `npm run build -w @racing-desk/calc`.');
    return;
  }
  load();
  setInterval(pollStatus, STATUS_POLL_MS);
})();
