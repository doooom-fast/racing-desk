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
  const RecordingModel = window.RacingDeskRecordingModel;

  const $ = (id) => document.getElementById(id);
  // The masthead's freshness line: its words are also the line's tooltip, for the windows too narrow to show them.
  const setFreshness = (text) => { $('freshness').textContent = text; $('freshness').parentNode.title = text; };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let desk = null;
  let lastStatus = null;
  let readBefore = false;   // the store has been read once: the next read is of something new
  let wasOffline = false;   // nothing answered the last time it was asked
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
    if (!res.ok) throw new Error(`${route}: HTTP ${res.status}`);
    return res.json();
  }

  // `refreshed` is Refresh, which has the Cars page read again by itself.
  async function load(refreshed) {
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
    tellCars(rows);   // the Cars page says when each car was last driven, from these rows
    const t0 = performance.now();
    desk = Calc.buildDesk(rows, { schedule: schedule && schedule.series && schedule.series.length ? schedule : null });
    const ms = Math.round(performance.now() - t0);
    if (Object.keys(desk.errors).length) console.warn('[desk] engine errors', desk.errors);
    $('offline').hidden = true;
    raceLinks = await loadRaceLinks();
    render();
    setFreshness(`${status.sessions.toLocaleString()} sessions · last ${ago(status.lastSessionAt)} · ${ms} ms`);
    // A Cars page that found no host — the desk can be up before the host is — reads again now that there is
    // one, its list of cars as well as their views and pedals: the cars have no names until the host gives
    // them. And so does one that is up when the store has something new, which is how a car just driven is
    // there to be looked at.
    if ((readBefore || wasOffline) && refreshed !== true) refreshCars();
    readBefore = true;
    wasOffline = false;
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
      else setFreshness(`${status.sessions.toLocaleString()} sessions · last ${ago(status.lastSessionAt)}`);
    } catch (_) { /* host restarting — the next poll retries */ }
  }

  function showOffline(reason) {
    wasOffline = true;
    $('offline-reason').textContent = NOTE ? `${reason} ${NOTE}` : reason;
    $('offline').hidden = false;
    setFreshness('Local host not running');
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
  // Desk, Cars and Settings are sections of this one window, shown one at a time. The hash remembers which;
  // main.js asks for one with ?page= (tray menu, first open) or 'show-page' (the window is already up).

  const PAGES = ['desk', 'cars', 'settings'];
  let currentPage = null;

  // Paints was a page of its own until it and Cars became one page: its name still leads there.
  function pageNamed(name) {
    if (PAGES.includes(name)) return name;
    return name === 'paints' ? 'cars' : 'desk';
  }

  function pageFromHash() {
    return pageNamed(location.hash.replace(/^#/, ''));
  }

  function showPage(page) {
    page = pageNamed(page);
    currentPage = page;
    for (const el of document.querySelectorAll('[data-page]')) el.hidden = el.dataset.page !== page;
    for (const a of document.querySelectorAll('.nav a')) {
      if (a.dataset.pageLink === page) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    $('offline').classList.toggle('off-page', page !== 'desk'); // the "no local data" notice is the desk page's
    // A page that paused its checks resumes, and the Cars page reads what the host keeps again.
    document.dispatchEvent(new CustomEvent('racingdesk:page', { detail: page }));
    if (location.hash !== '#' + page) {
      try { history.replaceState(null, '', '#' + page); } catch (_) { location.hash = page; }
    }
    if (page === 'cars') {
      mountCars();
      lookedAt();
    }
    if (page === 'settings') renderSettings();
  }

  // ── Cars ─────────────────────────────────────────────────
  // The one list of cars and the one place to look at a car: its liveries, the view it was last driven with and
  // its pedals. It is the livery manager's UI (apps/paints/src), which runs here as an island:
  // apps/paints/build-island.mjs bundles it into modules/desk/paints.bundle.js as window.RacingDeskPaints, mounted
  // into the page the first time it is shown and left mounted after. Its file operations are main.js's, reached
  // over window.racingDesk.paints, and what the host keeps per car is asked for by main.js too
  // (window.racingDesk.rig, preload.js): this page fetches none of it. With no bundle, or no bridge (a browser),
  // the page says so instead.
  //
  // Two things are said to the island from here. When each car was last driven, worked out from the session
  // rows this page has read anyway (setLastDriven) — the page opens on the car driven last, and lists the cars
  // driven, by it. And that there is something to read again (racingdesk:refresh): Refresh was pressed, the host
  // has come up, the store has something new — which a drive is. The island then reads the list of cars again
  // and what the host keeps for them.
  //
  // Neither is said while nobody is looking — another page up, or the window behind the sim with him driving,
  // which is when the store has something new. What the island does with them (the library, the install, the
  // car's files) is done in the process the HUD answers to. It is owed, and said when somebody next looks.

  let carsMounted = false;
  let carsOwed = false;
  let drivenOwed = null;
  let inFront = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
  const looking = () => inFront && !document.hidden && currentPage === 'cars';

  function mountCars() {
    if (carsMounted) return;
    const island = window.RacingDeskPaints;
    const bridge = window.racingDesk && window.racingDesk.paints;
    $('cars-unbuilt').hidden = !!island;
    $('cars-note').hidden = !island || !!bridge;
    if (!island || !bridge) return;
    island.mount($('cars-root'));
    carsMounted = true;
  }

  // Each car's path, and the start of the latest session driven in it.
  function lastDrivenByCar(rows) {
    const last = new Map();
    for (const row of rows || []) {
      if (row === null || typeof row !== 'object' || typeof row.car_path !== 'string' || !row.started_at) continue;
      const at = Date.parse(row.started_at);
      const known = last.get(row.car_path);
      if (!Number.isNaN(at) && (!known || at > known.at)) last.set(row.car_path, { at, iso: row.started_at });
    }
    return Object.fromEntries([...last].map(([car, { iso }]) => [car, iso]));
  }

  // An island not yet mounted takes the dates as they come: it does nothing with them until it is.
  function tellCars(rows) {
    const driven = lastDrivenByCar(rows);
    if (carsMounted && !looking()) {
      drivenOwed = driven;
      return;
    }
    drivenOwed = null;
    const island = window.RacingDeskPaints;
    if (island && island.setLastDriven) island.setLastDriven(driven);
  }

  // An island not yet mounted is owed nothing: it reads everything when it is.
  function refreshCars() {
    if (!carsMounted) return;
    if (!looking()) {
      carsOwed = true;
      return;
    }
    carsOwed = false;
    sayDriven();
    document.dispatchEvent(new CustomEvent('racingdesk:refresh'));
  }

  function sayDriven() {
    if (drivenOwed === null) return;
    const island = window.RacingDeskPaints;
    if (island && island.setLastDriven) island.setLastDriven(drivenOwed);
    drivenOwed = null;
  }

  // Somebody looks again: the window comes to the front, or back from being hidden.
  function lookedAt() {
    if (!carsMounted || !looking()) return;
    if (carsOwed) refreshCars();
    else sayDriven();
  }
  window.addEventListener('focus', () => { inFront = true; lookedAt(); });
  window.addEventListener('blur', () => { inFront = false; });
  document.addEventListener('visibilitychange', lookedAt);

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
    const sections = SettingsModel.settingsView(saved || {}, { hudScreens: await hudScreensNow(bridge) });
    $('settings-note').hidden = !!bridge;
    $('settings-sections').innerHTML = SETTINGS_COLUMNS.map((ids) => `<div class="settings-col">${ids.map((id) => {
      const section = sections.find((s) => s.id === id);
      return `<section class="card" id="settings-${esc(id)}"><h2>${esc(section.title)}</h2>${section.fields.map((f) => fieldHtml(f, !bridge)).join('')}</section>`;
    }).join('')}</div>`).join('');
    renderRecordingCard();
    await renderRemote();
  }

  // The screens the HUD can be on, and the one it is on, as the app says (main.js get-hud-displays). Null outside the
  // app, or from one that has no such call: the HUD screen then offers Automatic alone.
  async function hudScreensNow(bridge) {
    if (!bridge || typeof bridge.getHudDisplays !== 'function') return null;
    try {
      const answer = await bridge.getHudDisplays();
      return answer && typeof answer === 'object' ? answer : null;
    } catch (_) {
      return null;
    }
  }

  // The HUD screen's control and the note under it, read again: after the HUD's screen is changed (the app has moved the
  // HUD by the time the save is answered, and a choice that was not connected is gone from the list once it is
  // Automatic), and when the app says the screens, or where the HUD is, have changed while the page is open. The
  // control is kept and its options replaced, so it keeps the focus.
  async function refreshHudScreenField() {
    const select = $('setting-hudDisplay');
    const note = $('setting-hudDisplay-note');
    const bridge = settingsBridge();
    if (!select || !note || !bridge) return;
    const saved = (await bridge.getSettings()) || {};
    const field = SettingsModel.settingsView(saved, { hudScreens: await hudScreensNow(bridge) }).flatMap((section) => section.fields).find((f) => f.key === 'hudDisplay');
    select.innerHTML = optionsHtml(field);
    select.value = field.value;
    note.textContent = field.note || '';
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
        <span class="hint">The HUD as a full-screen data display, in a browser on your home network. It is sent the numbers the HUD reads, never a picture of the game, and nothing can be changed from there.</span>
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

  function optionsHtml(f) {
    return f.options.map(([v, label]) => `<option value="${esc(v)}"${v === f.value ? ' selected' : ''}>${esc(label)}</option>`).join('');
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
        control = `<select ${attrs}>${optionsHtml(f)}</select>`;
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
      ${f.screens ? `<span class="hint" id="${id}-note" role="status">${esc(f.note || '')}</span>` : ''}
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
      if (key === 'hudDisplay') await refreshHudScreenField();
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

  // ── Recording ────────────────────────────────────────────
  // OBS records; the app's keeper (modules/js/obs) mirrors it and says how it stands (window.racingDesk.recording).
  // The state is on the masthead of every page, as a pill with one button — Record or Stop — and on the Settings
  // page's Recording card with the rest: Save replay, Set up OBS, Open OBS, the folder, the switches, the password
  // when OBS wants one. It is never drawn on the HUD, which OBS films. modules/desk/recording-model.js says what each state reads;
  // this is the DOM and the asking. Outside the app the pill and the card are there, read-only, and say so.

  function recordingBridge() {
    const bridge = window.racingDesk;
    return bridge && bridge.recording && typeof bridge.recording.status === 'function' && typeof bridge.recording.command === 'function' ? bridge.recording : null;
  }

  let recordingStatus = null;   // the last status the app sent
  let recordingBusy = false;    // a command is under way
  let recordingSaid = null;     // what the last command answered: { ok, did, problems, reason }
  let recordingTicker = null;   // the pill's clock while recording
  let recordingCardHtml = null; // what the card was last built from: a card that would read the same is left alone

  async function loadRecording() {
    const bridge = recordingBridge();
    if (!bridge) { renderRecording(); return; }
    try {
      const status = await bridge.status();
      recordingStatus = status && typeof status === 'object' && !status.error ? status : null;
    } catch (_) {
      recordingStatus = null;
    }
    renderRecording();
  }

  function renderRecording() {
    renderRecordingPill();
    if (currentPage === 'settings') renderRecordingCard();
    const recordingNow = !!(recordingStatus && recordingStatus.recording);
    if (recordingNow && recordingTicker === null) recordingTicker = setInterval(renderRecordingPill, 1000);
    if (!recordingNow && recordingTicker !== null) { clearInterval(recordingTicker); recordingTicker = null; }
  }

  // The status as it stands now: the app's, with the clock run on from when it was sent.
  function recordingNow() {
    if (!recordingStatus) return null;
    if (!recordingStatus.recording || !recordingStatus.startedAt) return recordingStatus;
    return { ...recordingStatus, elapsedMs: Math.max(0, Date.now() - recordingStatus.startedAt) };
  }

  function renderRecordingPill() {
    const el = $('recording-pill');
    if (!el || !RecordingModel) return;
    const inApp = !!recordingBridge();
    const view = RecordingModel.pill(recordingNow(), { inApp });
    const off = !view.button.enabled || recordingBusy;
    el.dataset.state = view.state;
    el.title = view.detail || '';
    // The clock ticks once a second while recording, and only its text is touched then: the button is built again only
    // when what it says or whether it can be pressed changes. A button replaced under the pointer between its
    // mousedown and its mouseup is never clicked.
    const shape = `${view.button.command}|${view.button.label}|${off}`;
    const text = el.querySelector('.recording-text');
    if (text && el.dataset.shape === shape) {
      if (text.textContent !== view.text) text.textContent = view.text;
      return;
    }
    el.dataset.shape = shape;
    el.innerHTML = `<span class="recording-dot" aria-hidden="true"></span><span class="recording-text">${esc(view.text)}</span>`
      + `<button type="button" class="recording-button" data-recording-cmd="${esc(view.button.command)}"${off ? ' disabled' : ''}>${esc(view.button.label)}</button>`;
  }

  function renderRecordingCard() {
    const el = $('settings-recording');
    if (!el || !RecordingModel) return;
    const inApp = !!recordingBridge();
    const status = recordingNow();
    const view = RecordingModel.card(status, { inApp });
    const off = recordingBusy ? ' disabled' : '';
    const button = (cmd, label, enabled) => `<button type="button" data-recording-cmd="${esc(cmd)}"${enabled && !recordingBusy ? '' : ' disabled'}>${esc(label)}</button>`;
    const said = recordingSaid ? [
      ...(recordingSaid.did || []).map((s) => `<p class="recording-said" role="status">${esc(s)}</p>`),
      ...(recordingSaid.problems || []).map((s) => `<p class="recording-error" role="alert">${esc(s)}</p>`),
      recordingSaid.ok === false && recordingSaid.reason && !(recordingSaid.problems || []).length ? `<p class="recording-error" role="alert">${esc(recordingSaid.reason)}</p>` : '',
    ].join('') : '';
    const html = `
      <h2>Recording</h2>
      <p class="recording-line" id="recording-line">${esc(view.line)}</p>
      ${view.details.map((d) => `<p class="recording-detail">${esc(d)}</p>`).join('')}
      ${said}
      <p class="recording-buttons">
        ${button('toggle', view.record.label, view.record.enabled)}
        ${view.saveReplay.show ? button('saveReplay', 'Save replay', view.saveReplay.enabled) : ''}
        ${view.openObs.show ? button('openObs', 'Open OBS', view.openObs.enabled) : ''}
        ${view.setup.show ? button('setup', 'Set up OBS', view.setup.enabled) : ''}
        ${button('openFolder', 'Open folder', view.openFolder.enabled && inApp)}
      </p>
      ${view.password.show ? `
      <form class="recording-password" id="recording-password">
        <label class="name" for="recording-password-field">OBS's WebSocket password</label>
        <span class="hint">${esc(view.password.hint)}</span>
        <span class="control"><input type="password" id="recording-password-field" autocomplete="off"${off}> <button type="submit"${off}>Keep</button></span>
      </form>` : ''}
      <div class="field">
        <label class="name" for="recording-folder">Folder</label>
        <span class="hint">OBS records into this folder, with the telemetry file beside each video. Set up OBS points OBS at it.</span>
        <span class="control"><input type="text" id="recording-folder" value="${esc(view.folder)}" readonly> ${button('chooseFolder', 'Choose…', view.chooseFolder.enabled && inApp)}</span>
      </div>
      ${view.switches.map((s) => `
      <div class="field">
        <label class="name" for="recording-${esc(s.key)}">${esc(s.label)}</label>
        <span class="hint">${esc(s.hint)}</span>
        <span class="control"><input type="checkbox" class="switch" id="recording-${esc(s.key)}" data-recording-key="${esc(s.key)}"${s.value ? ' checked' : ''}${s.enabled && !recordingBusy ? '' : ' disabled'}></span>
      </div>`).join('')}
      ${!inApp ? `<p class="remote-say">${esc(RecordingModel.FROM_THE_APP)}</p>` : ''}`;
    // A card that would read the same is left alone, and one that has to change keeps what he is typing: the password
    // field, its text and its focus, which a rebuilt form would have emptied under his hands.
    if (recordingCardHtml === html) return;
    const field = el.querySelector('#recording-password-field');
    const typing = field ? { value: field.value, focused: document.activeElement === field, from: field.selectionStart, to: field.selectionEnd } : null;
    recordingCardHtml = html;
    el.innerHTML = html;
    const again = typing && el.querySelector('#recording-password-field');
    if (again && (typing.value || typing.focused)) {
      again.value = typing.value;
      if (typing.focused) {
        again.focus();
        try { again.setSelectionRange(typing.from, typing.to); } catch (_) { /* not selectable */ }
      }
    }
  }

  async function recordingCommand(name, value) {
    const bridge = recordingBridge();
    if (!bridge || recordingBusy) return;
    recordingBusy = true;
    renderRecording();
    let answer;
    try {
      answer = await bridge.command(name, value);
    } catch (err) {
      answer = { ok: false, reason: err.message };
    }
    recordingBusy = false;
    const stands = answer !== null && typeof answer === 'object';
    // What a command answered is shown on the card until the next one: Set up OBS's sentences, or what went wrong.
    recordingSaid = stands ? { ok: answer.ok !== false, did: answer.did || [], problems: answer.problems || [], reason: answer.reason || null } : { ok: false, reason: 'The app did not answer.' };
    if (recordingSaid.ok && !recordingSaid.did.length) recordingSaid = null;
    await loadRecording();
  }

  function onRecordingClick(ev) {
    const button = ev.target.closest('[data-recording-cmd]');
    if (!button || button.disabled) return;
    recordingCommand(button.dataset.recordingCmd);
  }

  function onRecordingChange(ev) {
    const el = ev.target.closest('[data-recording-key]');
    if (!el || !recordingBridge()) return;
    const key = el.dataset.recordingKey;
    if (!RecordingModel.SWITCHES.some((s) => s.key === key)) return;
    saveSetting(key, !!el.checked).then(loadRecording);
  }

  function onRecordingSubmit(ev) {
    const form = ev.target.closest('#recording-password');
    if (!form) return;
    ev.preventDefault();
    const field = form.querySelector('#recording-password-field');
    const value = field ? field.value : '';
    if (field) field.value = '';
    recordingCommand('password', value);
  }

  // ── Wiring ───────────────────────────────────────────────

  $('race-list').addEventListener('click', (ev) => {
    const row = ev.target.closest('.race-row');
    if (row) selectRace(row.dataset.id);
  });
  $('refresh').addEventListener('click', () => {
    load(true);
    refreshCars();
  });
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
  // A screen plugged in or taken out, or the HUD moved, while Settings is open: the HUD screen's list is read again.
  if (window.racingDesk && window.racingDesk.onHudDisplaysChanged) {
    window.racingDesk.onHudDisplaysChanged(() => { if (currentPage === 'settings') refreshHudScreenField().catch(() => {}); });
  }
  $('settings-sections').addEventListener('change', onSettingChange);
  $('settings-remote').addEventListener('change', onRemoteChange);
  $('settings-remote').addEventListener('click', onRemoteClick);
  $('settings-recording').addEventListener('click', onRecordingClick);
  $('settings-recording').addEventListener('change', onRecordingChange);
  $('settings-recording').addEventListener('submit', onRecordingSubmit);
  $('recording-pill').addEventListener('click', onRecordingClick);
  if (recordingBridge() && typeof recordingBridge().onState === 'function') {
    recordingBridge().onState((status) => { recordingStatus = status && typeof status === 'object' ? status : null; renderRecording(); });
  }
  loadRecording();
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
