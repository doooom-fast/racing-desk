// CAR MANUFACTURER LOGOS

  // ═══ CAR MANUFACTURER LOGOS (bundled SVGs in images/logos) ═══
  const CAR_LOGO_KEYS = ['bmw','mclaren','mazda','nissan','dallara','ferrari','porsche','audi',
    'mercedes','lamborghini','chevrolet','ford','toyota','hyundai','cadillac','astonmartin',
    'lotus','honda','honda_white','ligier','fia','radical','generic','none','iracing'];
  window.carLogos = {};
  window.carBrandColors = {};
  // The dashboard runs from file://, where fetch() can't read local files — so the logos are referenced, not
  // read: each entry is markup for the bundled SVG, dropped into #carLogoIcon as before.
  async function loadCarLogos() {
    for (const key of CAR_LOGO_KEYS) {
      window.carLogos[key] = '<img class="car-logo-img" src="images/logos/' + key + '.svg" alt="">';
    }
  }


  const carLogoOrder = ['bmw', 'mclaren', 'mazda', 'nissan', 'dallara', 'ferrari', 'porsche', 'audi', 'mercedes', 'lamborghini', 'chevrolet', 'ford', 'toyota', 'hyundai', 'cadillac', 'astonmartin', 'lotus', 'honda', 'ligier', 'fia', 'radical'];
  let currentCarLogoIdx = 0;
  // _currentCarLogo declared in config.js

  // _mfrBrandColors, _defaultLogoBg, _demoModels declared in config.js

  function cycleCarLogo() {
    currentCarLogoIdx = (currentCarLogoIdx + 1) % carLogoOrder.length;
    const key = carLogoOrder[currentCarLogoIdx];
    console.log('[RacingDesk] Logo cycle:', key);
    // Honda special case: use white-fill logo on red bg
    const svg = (key === 'honda') ? window.carLogos.honda_white : window.carLogos[key];
    document.getElementById('carLogoIcon').innerHTML = svg;
    document.getElementById('carModelLabel').textContent = _demoModels[key] || '';
    // Apply brand-colored background (or default dark bg)
    const sq = document.getElementById('carLogoSquare');
    sq.style.background = _mfrBrandColors[key] || _defaultLogoBg;
    sq.style.setProperty('--logo-tint', _mfrBrandColors[key] || _defaultLogoBg);
    _currentCarLogo = ''; // reset so setCarLogo always fires on first real data
  }

  // Strip brand name from model string so label shows just the model
  // e.g. "BMW M4 GT3" → "M4 GT3", "Porsche 911 GT3 R" → "911 GT3 R"
  const _brandStrips = [
    'aston martin', 'astonmartin', 'lamborghini', 'mercedes-benz', 'mercedes',
    'chevrolet', 'mclaren', 'ferrari', 'porsche', 'hyundai', 'cadillac',
    'dallara', 'nissan', 'toyota', 'mazda', 'honda', 'lotus', 'ligier', 'ford',
    'audi', 'bmw'
  ];
  function stripBrand(model) {
    if (!model) return '';
    let s = model.trim();
    const l = s.toLowerCase();
    for (const b of _brandStrips) {
      if (l.startsWith(b)) { s = s.substring(b.length).trim(); break; }
    }
    return s;
  }

  // Set car logo by manufacturer key + optional model string
  function setCarLogo(key, modelName) {
    if (key === _currentCarLogo && modelName === undefined) return;
    _currentCarLogo = key;
    // Honda special case: white-fill logo on red background
    const svg = (key === 'honda') ? (window.carLogos.honda_white || window.carLogos.honda) : (window.carLogos[key] || window.carLogos.generic);
    document.getElementById('carLogoIcon').innerHTML = svg;
    document.getElementById('carModelLabel').textContent = stripBrand(modelName);
    // Apply brand-colored background for white/mono logos, default dark bg otherwise
    // Prefer cloud-sourced hex colors, fall back to local HSLA colors
    const sq = document.getElementById('carLogoSquare');
    const cloudColor = window.carBrandColors && window.carBrandColors[key];
    sq.style.background = cloudColor || _mfrBrandColors[key] || _defaultLogoBg;
    // The same colour as a variable: the glance layout lays it over an opaque base (drive-view.css), so that a flag's
    // pattern does not show through the badge, which an inline background would otherwise let it.
    sq.style.setProperty('--logo-tint', cloudColor || _mfrBrandColors[key] || _defaultLogoBg);
    // Expose full-opacity brand color for map player dot
    const brandHsl = _mfrBrandColors[key];
    if (brandHsl) {
      // Convert 0.6x alpha HSLA to full-opacity for the map dot fill
      const solidColor = brandHsl.replace(/[\d.]+\)$/, '1)');
      document.documentElement.style.setProperty('--map-player-color', solidColor);
    } else {
      document.documentElement.style.setProperty('--map-player-color', 'var(--cyan)');
    }
  }

  // ═══ THE LIVERY BEHIND THE BADGE ═══
  // A section of the paint of the car he is in, under the logo (#carLivery in dashboard.html, .car-livery in
  // dashboard.css). The main process chooses it (modules/js/logo-livery.js) and hands it over as a data URL: in the
  // app through the preload (logo-livery, and get-logo-livery for a page that loaded after it was chosen); on an iPad
  // the page fetches it from the rig's own server at one fixed address when the car changes (poll-engine.js asks).
  // The page reads no file and builds no path. With nothing given — no paint, none chosen yet, a browser — the
  // layer is empty and the maker's colour set on the square shows.
  const LIVERY_PATH = '/livery-crop.png';
  // When the car changes the rig chooses a new crop once it has seen the same change, which takes it a moment, so
  // the iPad asks a few times over; an ask before the rig has chosen gets the last car's crop or nothing, and the
  // asks after put that right.
  const LIVERY_ASK_AT_MS = [0, 800, 2500, 6000, 14000];
  let _liveryUrl = null;
  let _liveryEtag = null;
  let _liveryAsk = 0;
  let _liveryTimers = [];

  function setCarLivery(url) {
    const layer = document.getElementById('carLivery');
    const sq = document.getElementById('carLogoSquare');
    if (!layer || !sq) return;
    if (_liveryUrl && _liveryUrl.startsWith('blob:')) {
      try { URL.revokeObjectURL(_liveryUrl); } catch (e) { /* already gone */ }
    }
    _liveryUrl = typeof url === 'string' && url.length ? url : null;
    if (_liveryUrl) {
      layer.style.backgroundImage = 'url("' + _liveryUrl + '")';
      sq.classList.add('has-livery');
    } else {
      layer.style.backgroundImage = '';
      sq.classList.remove('has-livery');
    }
    // The Racing Desk's own tile takes its two colours from the same crop (brand-livery.js); no paint, its own.
    if (window.RacingDeskBrandLivery) window.RacingDeskBrandLivery.followPaint(_liveryUrl);
  }
  window.setCarLivery = setCarLivery;

  async function fetchRemoteLivery(ask) {
    let resp;
    try {
      resp = await fetch(location.origin + LIVERY_PATH, { cache: 'no-store', credentials: 'same-origin' });
    } catch (e) {
      return;   // the rig did not answer; a later ask may
    }
    if (ask !== _liveryAsk) return;   // the car has changed again since
    if (resp.status === 404) {
      _liveryEtag = null;
      if (_liveryUrl) setCarLivery(null);
      return;
    }
    if (!resp.ok) return;
    const etag = resp.headers.get('ETag');
    if (etag && etag === _liveryEtag && _liveryUrl) return;   // the crop that is up already
    let blob;
    try { blob = await resp.blob(); } catch (e) { return; }
    if (ask !== _liveryAsk) return;
    _liveryEtag = etag;
    setCarLivery(URL.createObjectURL(blob));
  }

  // The car has changed (or he is back in it): the page that is not the rig's own window asks the server it came from
  // for the crop of his paint behind the badge, a few times over the first seconds in case the rig has not chosen it
  // yet: from the loopback listener in the pages OBS draws (window._obsMode, the iPad dashboard too: its badges are back,
  // 2026-10-08), from the rig's server on an iPad (window._remoteMode; he asked for the logos to go on 2026-09-30, and
  // for them back on 2026-10-08). fetchRemoteLivery is what asks.
  function requestRemoteLivery() {
    for (const t of _liveryTimers) clearTimeout(t);
    _liveryTimers = [];
    if (!(window._remoteMode || window._obsMode) || typeof fetch !== 'function') return;
    const ask = ++_liveryAsk;
    _liveryTimers = LIVERY_ASK_AT_MS.map((ms) => setTimeout(() => { fetchRemoteLivery(ask); }, ms));
  }
  window.requestRemoteLivery = requestRemoteLivery;
  window._fetchRemoteLivery = fetchRemoteLivery;

  // In the app the main process says: what it has chosen since, and what it had chosen before this page loaded.
  if (!window._remoteMode && !window._obsMode && window.racingDesk) {
    if (typeof window.racingDesk.onLogoLivery === 'function') {
      try { window.racingDesk.onLogoLivery((url) => setCarLivery(url)); } catch (e) { /* no bridge */ }
    }
    if (typeof window.racingDesk.getLogoLivery === 'function') {
      try {
        Promise.resolve(window.racingDesk.getLogoLivery()).then((url) => { if (typeof url === 'string' && url.length) setCarLivery(url); }, () => {});
      } catch (e) { /* no bridge */ }
    }
  }

  // ═══ TACHOMETER ═══
