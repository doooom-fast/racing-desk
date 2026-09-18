// Racing Desk — career, form and race history from the local store.
// Rows come from RaceCor.Host (:8889/racecor-io-pro-drive/data/); window.RaceCorCalc (packages/calc) turns
// them into everything shown here. No network beyond localhost.
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const HOST = (params.get('host') || 'http://localhost:8889').replace(/\/+$/, '');
  const DATA = HOST + '/racecor-io-pro-drive/data/';
  const STATUS_POLL_MS = 30000;
  const Calc = window.RaceCorCalc;

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
    if (!res.ok) throw new Error(`${route}: HTTP ${res.status}`);
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
      showOffline(`${HOST} is answering, but not with RaceCor.Host's data API (is SimHub's plugin on that port?).`);
      setTimeout(load, 15000);
      return;
    }
    lastStatus = status;
    const [rows, schedule] = await Promise.all([
      getJson('sessions'),
      getJson('schedule').catch(() => null),
    ]);
    const t0 = performance.now();
    desk = Calc.buildDesk(rows, { schedule: schedule && schedule.series && schedule.series.length ? schedule : null });
    const ms = Math.round(performance.now() - t0);
    if (Object.keys(desk.errors).length) console.warn('[desk] engine errors', desk.errors);
    $('offline').hidden = true;
    raceLinks = await loadRaceLinks();
    render();
    $('freshness').textContent = `${status.sessions.toLocaleString()} sessions · last ${ago(status.lastSessionAt)} · ${ms} ms`;
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
    if (window.k10 && window.k10.openExternal) window.k10.openExternal(url);
    else location.href = url; // outside Electron the browser asks the OS for the scheme's handler
  }

  async function loadRaceLinks() {
    if (!window.k10 || !window.k10.getSettings) return {};
    try {
      const settings = await window.k10.getSettings();
      return (settings && settings.raceLinks) || {};
    } catch (err) {
      return {};
    }
  }

  // The HUD shares overlay-settings.json and saveSettings replaces the file whole: read, set one key, write.
  async function saveRaceLink(series, id) {
    if (window.k10 && window.k10.getSettings && window.k10.saveSettings) {
      const settings = (await window.k10.getSettings()) || {};
      settings.raceLinks = { ...(settings.raceLinks || {}), [series]: id };
      await window.k10.saveSettings(settings);
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
    $('offline-reason').textContent = reason;
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

  // ── Wiring ───────────────────────────────────────────────

  $('race-list').addEventListener('click', (ev) => {
    const row = ev.target.closest('.race-row');
    if (row) selectRace(row.dataset.id);
  });
  $('refresh').addEventListener('click', () => load());
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

  if (!Calc) {
    showOffline('The calc bundle is missing — run `npm run build -w @prodrive/calc`.');
    return;
  }
  load();
  setInterval(pollStatus, STATUS_POLL_MS);
})();
