// CAR MANUFACTURER LOGOS

  // ═══ CAR MANUFACTURER LOGOS (fetched from cloud API, local fallback) ═══
  const CAR_LOGO_KEYS = ['bmw','mclaren','mazda','nissan','dallara','ferrari','porsche','audi',
    'mercedes','lamborghini','chevrolet','ford','toyota','hyundai','cadillac','astonmartin',
    'lotus','honda','honda_white','ligier','fia','radical','generic','none'];
  window.carLogos = {};
  window.carBrandColors = {};
  async function loadCarLogos() {
    // Try cloud API first (prodrive.racecor.io)
    try {
      const apiBase = (window._settings && window._settings.apiBase) || 'https://prodrive.racecor.io';
      const resp = await fetch(apiBase + '/api/logos');
      if (resp.ok) {
        const data = await resp.json();
        if (data.logos && data.logos.length > 0) {
          for (const logo of data.logos) {
            if (logo.logoSvg) window.carLogos[logo.brandKey] = logo.logoSvg;
            if (logo.brandColorHex) window.carBrandColors[logo.brandKey] = logo.brandColorHex;
          }
          console.log('[RaceCor] Loaded', data.logos.length, 'logos from cloud');
          // Still load special local-only logos (generic, none, honda_white, iracing)
          const localOnly = ['generic', 'none', 'honda_white', 'iracing'];
          await Promise.allSettled(localOnly.map(async key => {
            if (!window.carLogos[key]) {
              const r = await fetch('images/logos/' + key + '.svg');
              if (r.ok) window.carLogos[key] = await r.text();
            }
          }));
          return;
        }
      }
    } catch (e) {
      console.warn('[RaceCor] Cloud logo fetch failed, using local fallback:', e.message);
    }
    // Fallback: load all from local files
    await Promise.allSettled(
      CAR_LOGO_KEYS.map(async key => {
        const resp = await fetch('images/logos/' + key + '.svg');
        if (resp.ok) window.carLogos[key] = await resp.text();
      })
    );
  }


  const carLogoOrder = ['bmw', 'mclaren', 'mazda', 'nissan', 'dallara', 'ferrari', 'porsche', 'audi', 'mercedes', 'lamborghini', 'chevrolet', 'ford', 'toyota', 'hyundai', 'cadillac', 'astonmartin', 'lotus', 'honda', 'ligier', 'fia', 'radical'];
  let currentCarLogoIdx = 0;
  // _currentCarLogo declared in config.js

  // _mfrBrandColors, _defaultLogoBg, _demoModels declared in config.js

  function cycleCarLogo() {
    currentCarLogoIdx = (currentCarLogoIdx + 1) % carLogoOrder.length;
    const key = carLogoOrder[currentCarLogoIdx];
    console.log('[K10] Logo cycle:', key);
    // Honda special case: use white-fill logo on red bg
    const svg = (key === 'honda') ? window.carLogos.honda_white : window.carLogos[key];
    document.getElementById('carLogoIcon').innerHTML = svg;
    document.getElementById('carModelLabel').textContent = _demoModels[key] || '';
    // Apply brand-colored background (or default dark bg)
    const sq = document.getElementById('carLogoSquare');
    sq.style.background = _mfrBrandColors[key] || _defaultLogoBg;
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

  // ═══ TACHOMETER ═══
