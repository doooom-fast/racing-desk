// ═══════════════════════════════════════════════════════════════
// Dev mode — `electron . --dev [--replay-port=N] [--devtools]`
//
// Turns the click-through, hidden-until-in-car HUD into a normal window
// for design work:
//   · visible immediately, interactive, not always-on-top, on the second
//     monitor when there is one
//   · CSS under modules/styles hot-swaps on save (no page reload)
//   · JS / HTML changes reload the page
//   · --replay-port redirects every localhost:8889 request (polls and
//     ?action= calls) to a replay server on that port, so replay can run
//     while SimHub still owns :8889
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { screen, session } = require('electron');

function readArgs(argv = process.argv) {
  const get = (name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };
  const port = Number(get('replay-port') ?? process.env.PRODRIVE_REPLAY_PORT);
  return {
    replayPort: Number.isInteger(port) && port > 0 ? port : null,
    devtools: argv.includes('--devtools'),
  };
}

function redirectPluginTraffic(port, log) {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://localhost:8889/*', 'http://127.0.0.1:8889/*'] },
    (details, callback) => callback({ redirectURL: details.url.replace(':8889/', `:${port}/`) })
  );
  log(`[dev] redirecting localhost:8889 → localhost:${port}`);
}

function placeOnDevDisplay(win) {
  const primary = screen.getPrimaryDisplay();
  const other = screen.getAllDisplays().find((d) => d.id !== primary.id);
  const target = (other || primary).workArea;
  win.setBounds(target);
}

// Swap a stylesheet without a flash of unstyled content: load the new
// <link> alongside the old one, then remove the old one once it applies.
const swapStylesheetsJs = (fileName) => `
  (() => new Promise((resolve) => {
    const links = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .filter((l) => !/^https?:/.test(l.getAttribute('href') || ''));
    const matching = links.filter((l) => (l.getAttribute('href') || '').split('?')[0].endsWith(${JSON.stringify(fileName)}));
    const targets = matching.length ? matching : links;
    let pending = targets.length;
    if (!pending) return resolve(0);
    for (const old of targets) {
      const fresh = old.cloneNode();
      fresh.setAttribute('href', old.getAttribute('href').split('?')[0] + '?v=' + Date.now());
      const done = () => { old.remove(); if (--pending === 0) resolve(targets.length); };
      fresh.addEventListener('load', done, { once: true });
      fresh.addEventListener('error', done, { once: true });
      old.after(fresh);
    }
  }))()`;

function watchSources(win, rootDir, log) {
  const timers = new Map();
  const debounce = (key, fn) => {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(fn, 40));
  };

  const onCss = (file) => debounce(`css:${file}`, async () => {
    if (win.isDestroyed()) return;
    const started = Date.now();
    try {
      const n = await win.webContents.executeJavaScript(swapStylesheetsJs(path.basename(file)));
      log(`[dev] css ${file} → ${n} stylesheet(s) swapped in ${Date.now() - started}ms`);
    } catch (err) {
      log(`[dev] css swap failed (${err.message}) — reloading page`);
      win.webContents.reloadIgnoringCache();
    }
  });
  const onPage = (file) => debounce('page', () => {
    if (win.isDestroyed()) return;
    log(`[dev] ${file} changed → reloading page`);
    win.webContents.reloadIgnoringCache();
  });

  const watchers = [];
  const watch = (dir, handler) => {
    const abs = path.join(rootDir, dir);
    if (!fs.existsSync(abs)) return;
    watchers.push(fs.watch(abs, { recursive: true }, (_event, name) => {
      if (!name) return;
      const rel = path.join(dir, name).replace(/\\/g, '/');
      if (rel.includes('__tests__')) return;
      handler(rel);
    }));
  };
  watch('modules/styles', (f) => { if (f.endsWith('.css')) onCss(f); });
  watch('modules/js', (f) => { if (f.endsWith('.js')) onPage(f); });
  watchers.push(fs.watch(rootDir, (_event, name) => {
    if (name === 'dashboard.html') onPage(name);
    if (name === 'main.js' || name === 'preload.js' || name === 'dev-mode.js') log(`[dev] ${name} changed — restart npm run dev to pick it up`);
  }));
  win.on('closed', () => watchers.forEach((w) => w.close()));
}

// Called from createOverlay() after the window exists, before the dashboard loads.
function attach(win, { rootDir, log = console.log } = {}) {
  const args = readArgs();
  if (args.replayPort) redirectPluginTraffic(args.replayPort, log);

  placeOnDevDisplay(win);
  win.setIgnoreMouseEvents(false);
  win.setFocusable(true);
  win.setAlwaysOnTop(false);
  win.setSkipTaskbar(false);
  win.setResizable(true);
  win.webContents.once('did-finish-load', () => { if (!win.isDestroyed()) win.show(); });
  if (args.devtools) win.webContents.openDevTools({ mode: 'detach' });

  watchSources(win, rootDir, log);
  log('[dev] dev mode on — interactive window, CSS hot reload, JS/HTML reload');
}

module.exports = { attach, readArgs };
