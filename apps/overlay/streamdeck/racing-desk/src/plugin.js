// The Racing Desk Stream Deck plugin: every button is one of the app's actions, asked of the app's action route on
// this machine (remote-server.js, /api/action/<name>, with the header that says a program is asking). The Stream
// Deck app starts this with node and talks to it over a WebSocket on 127.0.0.1 — the plugin registers, is told of
// each key press, and answers with a tick (showOk) or a cross (showAlert) by what the app said.
//
// The route is the app's listener on 127.0.0.1 alone (port 9091, `localServerPort`), which is always up — the iPad
// view's switch has nothing to do with it. While a Toggle Recording key is on the deck the plugin asks the same
// listener how the recording stands (/api/status) every two seconds and writes it on the key: the time while
// recording, "OBS off" while OBS is not open, nothing otherwise.
//
// No dependency: the Stream Deck SDK and its bundler plugins are not in this tree, and the Stream Deck app runs this
// in its own Node 20 with nothing installed beside it, so the WebSocket is the app's own small client
// (modules/js/obs/ws-client.js), bundled in by apps/overlay/streamdeck/build.mjs into
// com.doooom.racingdesk.sdPlugin/bin/plugin.js. The manifest's UUIDs map to the action names here.
const { connect } = require('../../../modules/js/obs/ws-client');

const DEFAULT_PORT = 9091;
const ASK_WITHIN_MS = 3000;
// Recording is answered when OBS has answered: with OBS closed the press starts it (up to 30 s for its WebSocket) and
// waits for the recording to begin (up to 10 s), so the key waits as long, with a margin. At 3 s it showed a cross for
// a recording that had begun.
const RECORDING_ASK_WITHIN_MS = 45000;
const RECORDING_ACTIONS = new Set(['toggle-recording', 'start-recording', 'stop-recording', 'save-replay-buffer', 'tv-shots']);
const STATUS_EVERY_MS = 2000;
const STATUS_ACTION = 'com.doooom.racingdesk.toggle-recording';

/** How long a press of this action waits for the app's answer. */
function askWithin(name) {
  return RECORDING_ACTIONS.has(name) ? RECORDING_ASK_WITHIN_MS : ASK_WITHIN_MS;
}

// manifest.json's action UUIDs → the app's action names (remote-server.js ACTIONS).
const ACTIONS = Object.freeze({
  'com.doooom.racingdesk.toggle-settings': 'toggle-settings',
  'com.doooom.racingdesk.toggle-overlay': 'toggle-overlay',
  'com.doooom.racingdesk.toggle-drive-mode': 'toggle-drive-mode',
  'com.doooom.racingdesk.zoom-in': 'zoom-in',
  'com.doooom.racingdesk.zoom-out': 'zoom-out',
  'com.doooom.racingdesk.cycle-rating': 'cycle-rating',
  'com.doooom.racingdesk.cycle-car-logo': 'cycle-car-logo',
  'com.doooom.racingdesk.toggle-recording': 'toggle-recording',
  'com.doooom.racingdesk.save-replay-buffer': 'save-replay-buffer',
  'com.doooom.racingdesk.tv-shots': 'tv-shots',
  'com.doooom.racingdesk.pitbox-next-tab': 'pitbox-next-tab',
  'com.doooom.racingdesk.pitbox-prev-tab': 'pitbox-prev-tab',
  'com.doooom.racingdesk.dismiss-commentary': 'dismiss-commentary',
  'com.doooom.racingdesk.quit': 'quit',
});

/** The Stream Deck app's arguments: -port <n> -pluginUUID <id> -registerEvent <name> -info <json>. */
function parseArgs(argv) {
  const out = { port: null, pluginUUID: null, registerEvent: 'registerPlugin', info: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === '-port') { out.port = Number(v); i++; }
    else if (a === '-pluginUUID') { out.pluginUUID = v; i++; }
    else if (a === '-registerEvent') { out.registerEvent = v; i++; }
    else if (a === '-info') { try { out.info = JSON.parse(v); } catch (e) { out.info = null; } i++; }
  }
  return out;
}

/** Ask the app for an action. True when the app answered and said ok; false for anything else. */
async function fire(name, port = DEFAULT_PORT, { fetchFn = globalThis.fetch, timeoutMs = askWithin(name) } = {}) {
  const url = `http://127.0.0.1:${port}/api/action/${name}`;
  try {
    const res = await fetchFn(url, { headers: { 'X-Racing-Desk': '1' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return false;
    try {
      const body = await res.json();
      // The app answers { ok, reason } in words: a press it could not act on is a cross, not a tick.
      return body === null || typeof body !== 'object' || body.ok !== false;
    } catch (e) {
      return true;
    }
  } catch (e) {
    return false;
  }
}

/** What the app says of itself (/api/status), or null when it does not answer. */
async function askStatus(port = DEFAULT_PORT, { fetchFn = globalThis.fetch, timeoutMs = ASK_WITHIN_MS } = {}) {
  try {
    const res = await fetchFn(`http://127.0.0.1:${port}/api/status`, { headers: { 'X-Racing-Desk': '1' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const body = await res.json();
    return body && typeof body === 'object' ? body : null;
  } catch (e) {
    return null;
  }
}

function clock(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** The words on a Toggle Recording key for what the app said; '' when there is nothing to say. */
function statusTitle(status) {
  if (!status) return 'No app';
  const r = status.recording;
  if (!r || typeof r !== 'object') return '';
  if (r.tv && r.tv.running) return `TV ${r.tv.index || 0}/${r.tv.total || 0}`;
  if (r.recording) return `● ${clock(r.elapsedMs)}`;
  if (r.starting) return 'Starting';
  if (r.obs !== 'open') return 'OBS off';
  return '';
}

/**
 * Run the plugin against the Stream Deck app at `port`. Resolves when the connection closes. `log` gets a line per
 * event (the Stream Deck app keeps the plugin's stdout in its logs folder). `setTimer`/`clearTimer` are the clock's,
 * for the tests.
 */
function run({ port, pluginUUID, registerEvent }, { connectFn = connect, fetchFn = globalThis.fetch, log = () => {}, setTimer = setTimeout, clearTimer = clearTimeout, statusEveryMs = STATUS_EVERY_MS } = {}) {
  return new Promise((resolve) => {
    const ws = connectFn({ host: '127.0.0.1', port, path: '/', timeoutMs: 5000 });
    // The Toggle Recording keys on the deck, by context, with the app port each was set up with; asked for the app's
    // status while any is shown, and told its words.
    const shown = new Map();
    const titles = new Map();
    let statusTimer = null;
    const send = (obj) => { try { ws.send(JSON.stringify(obj)); } catch (e) { /* closing */ } };
    const tick = async () => {
      statusTimer = null;
      if (!shown.size) return;
      const ports = [...new Set([...shown.values()])];
      for (const appPort of ports) {
        const status = await askStatus(appPort, { fetchFn });
        const title = statusTitle(status);
        for (const [context, p] of shown) {
          if (p !== appPort || titles.get(context) === title) continue;
          titles.set(context, title);
          send({ event: 'setTitle', context, payload: { title, target: 0 } });
        }
      }
      if (shown.size && statusTimer === null) statusTimer = setTimer(tick, statusEveryMs);
    };
    const book = () => { if (statusTimer === null && shown.size) statusTimer = setTimer(tick, 0); };
    ws.on('open', () => {
      send({ event: registerEvent, uuid: pluginUUID });
      log(`registered as ${pluginUUID}`);
    });
    ws.on('message', async (text) => {
      let msg;
      try { msg = JSON.parse(text); } catch (e) { return; }
      if (!msg || typeof msg.event !== 'string') return;
      const settings = msg.payload && msg.payload.settings ? msg.payload.settings : {};
      const appPort = Number.isInteger(settings.port) && settings.port > 0 ? settings.port : DEFAULT_PORT;
      if (msg.event === 'willAppear' && msg.action === STATUS_ACTION && msg.context) { shown.set(msg.context, appPort); book(); return; }
      if (msg.event === 'willDisappear' && msg.context) { shown.delete(msg.context); titles.delete(msg.context); return; }
      if (msg.event !== 'keyDown') return;
      const name = ACTIONS[msg.action];
      const ok = name ? await fire(name, appPort, { fetchFn }) : false;
      log(`${msg.action}: ${name || 'unknown action'} → ${ok ? 'ok' : 'alert'}`);
      send({ event: ok ? 'showOk' : 'showAlert', context: msg.context });
      book();
    });
    ws.on('error', (err) => log(`socket error: ${err.message}`));
    ws.on('close', ({ code, reason }) => {
      if (statusTimer !== null) { clearTimer(statusTimer); statusTimer = null; }
      shown.clear();
      log(`closed (${code} ${reason})`);
      resolve({ code, reason });
    });
  });
}

module.exports = { ACTIONS, DEFAULT_PORT, ASK_WITHIN_MS, RECORDING_ASK_WITHIN_MS, STATUS_EVERY_MS, STATUS_ACTION, askWithin, parseArgs, fire, askStatus, statusTitle, run };

// Started by the Stream Deck app, with its arguments: run until it lets go, then end as the loop drains (nothing is
// left alive once the socket is closed; process.exit from inside a socket's close is what Node on Windows trips on).
if (process.argv.includes('-port')) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.port || !args.pluginUUID) {
    process.stderr.write('racing-desk: the Stream Deck app gave no -port or -pluginUUID\n');
    process.exitCode = 2;
  } else {
    run(args, { log: (line) => process.stdout.write(`[racing-desk] ${line}\n`) }).then(() => { process.exitCode = 0; });
  }
}
