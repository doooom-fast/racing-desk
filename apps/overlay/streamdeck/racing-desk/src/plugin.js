// The Racing Desk Stream Deck plugin: every button is one of the app's actions, asked of the app's action route on
// this machine (remote-server.js, /api/action/<name>, with the header that says a program is asking). The Stream
// Deck app starts this with node and talks to it over a WebSocket on 127.0.0.1 — the plugin registers, is told of
// each key press, and answers with a tick (showOk) or a cross (showAlert) by what the app said.
//
// No dependency: the Stream Deck SDK and its bundler plugins are not in this tree, and the Stream Deck app runs this
// in its own Node 20 with nothing installed beside it, so the WebSocket is the app's own small client
// (modules/js/obs/ws-client.js), bundled in by apps/overlay/streamdeck/build.mjs into
// com.doooom.racingdesk.sdPlugin/bin/plugin.js. The manifest's UUIDs map to the action names here.
const { connect } = require('../../../modules/js/obs/ws-client');

const DEFAULT_PORT = 9090;
const ASK_WITHIN_MS = 3000;

// manifest.json's action UUIDs → the app's action names (remote-server.js ACTIONS).
const ACTIONS = Object.freeze({
  'com.doooom.racingdesk.toggle-settings': 'toggle-settings',
  'com.doooom.racingdesk.toggle-overlay': 'toggle-overlay',
  'com.doooom.racingdesk.toggle-drive-mode': 'toggle-drive-mode',
  'com.doooom.racingdesk.toggle-rating-editor': 'toggle-rating-editor',
  'com.doooom.racingdesk.zoom-in': 'zoom-in',
  'com.doooom.racingdesk.zoom-out': 'zoom-out',
  'com.doooom.racingdesk.reset-trackmap': 'reset-trackmap',
  'com.doooom.racingdesk.restart-demo': 'restart-demo',
  'com.doooom.racingdesk.cycle-rating': 'cycle-rating',
  'com.doooom.racingdesk.cycle-car-logo': 'cycle-car-logo',
  'com.doooom.racingdesk.toggle-leaderboard': 'toggle-leaderboard',
  'com.doooom.racingdesk.toggle-recording': 'toggle-recording',
  'com.doooom.racingdesk.save-replay-buffer': 'save-replay-buffer',
  'com.doooom.racingdesk.pitbox-next-tab': 'pitbox-next-tab',
  'com.doooom.racingdesk.pitbox-prev-tab': 'pitbox-prev-tab',
  'com.doooom.racingdesk.dismiss-commentary': 'dismiss-commentary',
  'com.doooom.racingdesk.preset-broadcast': 'preset-broadcast',
  'com.doooom.racingdesk.preset-practice': 'preset-practice',
  'com.doooom.racingdesk.preset-qualifying': 'preset-qualifying',
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
async function fire(name, port = DEFAULT_PORT, { fetchFn = globalThis.fetch, timeoutMs = ASK_WITHIN_MS } = {}) {
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

/**
 * Run the plugin against the Stream Deck app at `port`. Resolves when the connection closes. `log` gets a line per
 * event (the Stream Deck app keeps the plugin's stdout in its logs folder).
 */
function run({ port, pluginUUID, registerEvent }, { connectFn = connect, fetchFn = globalThis.fetch, log = () => {} } = {}) {
  return new Promise((resolve) => {
    const ws = connectFn({ host: '127.0.0.1', port, path: '/', timeoutMs: 5000 });
    ws.on('open', () => {
      ws.send(JSON.stringify({ event: registerEvent, uuid: pluginUUID }));
      log(`registered as ${pluginUUID}`);
    });
    ws.on('message', async (text) => {
      let msg;
      try { msg = JSON.parse(text); } catch (e) { return; }
      if (!msg || msg.event !== 'keyDown') return;
      const name = ACTIONS[msg.action];
      const settings = msg.payload && msg.payload.settings ? msg.payload.settings : {};
      const appPort = Number.isInteger(settings.port) && settings.port > 0 ? settings.port : DEFAULT_PORT;
      const ok = name ? await fire(name, appPort, { fetchFn }) : false;
      log(`${msg.action}: ${name || 'unknown action'} → ${ok ? 'ok' : 'alert'}`);
      ws.send(JSON.stringify({ event: ok ? 'showOk' : 'showAlert', context: msg.context }));
    });
    ws.on('error', (err) => log(`socket error: ${err.message}`));
    ws.on('close', ({ code, reason }) => { log(`closed (${code} ${reason})`); resolve({ code, reason }); });
  });
}

module.exports = { ACTIONS, DEFAULT_PORT, parseArgs, fire, run };

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
