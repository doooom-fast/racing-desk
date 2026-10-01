// Finding, starting and setting up OBS, without ever doing any of it unasked. Every file, process list and spawn
// is handed in, so the tests run the whole of it against temp folders and fakes and the real
// %APPDATA%\obs-studio is never opened by a test, nor obs64.exe started.
//
// What is here, and the rules each follows (docs/recording.md has the whole):
// - findObs: where obs64.exe is — the path he set (`obsPath`), else C:\Program Files\obs-studio. OBS finds its own
//   data relative to its working folder, so it is started from bin\64bit as cwd.
// - startObs: detached, stdio ignored, --minimize-to-tray (his SysTrayEnabled is on) and --disable-updater (the
//   update offer is a modal dialog, and the flag skips the check for that one launch). No --collection, --profile
//   or --websocket_* flags: the first two rewrite his defaults, and OBS writes its whole command line to its log.
//   Only ever called on a press from the desk, the tray or the Stream Deck while he is out of the car (main.js).
// - isObsRunning: tasklist, on a press only; OBS being open is otherwise noticed by the WebSocket answering.
// - The WebSocket: obs-websocket keeps its settings in plugin_config\obs-websocket\config.json. The server runs only
//   if server_enabled is true and no command-line flag turns it on, so Set up OBS writes that one key, atomically
//   (temp + rename), changing nothing else, and only while OBS is closed — OBS rewrites the file from memory when
//   its settings are saved. The password is read from the same file into memory and goes no further.
// - The profile: Hybrid MP4 (crash-safe files, chapters) and the replay buffer (20 s) are two keys of the current
//   profile's basic.ini, and the recording folder is a third; while OBS is closed they are written into the file
//   (the BOM and every other line kept), while OBS is open through SetProfileParameter and SetRecordDirectory, which
//   OBS saves to disk at once and takes up at its next start. Never a hop through another profile.
// - .sentinel: a folder OBS keeps a run_ file in while it runs. Non-empty with OBS not running means OBS did not
//   close cleanly last time and will ask about it when it starts.
// - Never a second OBS, and never OBS's files edited while it may be open: a tasklist that cannot say whether OBS runs
//   is "not known", and then nothing is started and nothing is written. Presses that come together share one start.
// - Never an OBS that could not answer: with its WebSocket switched off (the file says so, or has no such file yet) a
//   press says to press Set up OBS first and starts nothing.
const path = require('path');

const DEFAULT_OBS_DIR = 'C:\\Program Files\\obs-studio';
const EXE = 'obs64.exe';
const BIN = path.join('bin', '64bit');
const LAUNCH_FLAGS = Object.freeze(['--minimize-to-tray', '--disable-updater']);
const REPLAY_SECONDS = '20';
const WS_DEFAULT_PORT = 4455;

const NOT_KNOWN = 'Racing Desk could not tell whether OBS is open.';
const WS_OFF_OPEN = 'OBS is open with its WebSocket switched off. Quit OBS, then press Set up OBS.';
const WS_OFF_FIRST = "OBS's WebSocket is switched off, so Racing Desk could not use an OBS it started. Press Set up OBS first.";
const NOT_FOUND = `OBS was not found at ${DEFAULT_OBS_DIR}, so Racing Desk cannot start it. If you open OBS yourself, Racing Desk will find it.`;

// ── Where things are ─────────────────────────────────────────

function obsPaths(appData) {
  const root = path.join(appData, 'obs-studio');
  return {
    root,
    configJson: path.join(root, 'plugin_config', 'obs-websocket', 'config.json'),
    userIni: path.join(root, 'user.ini'),
    profilesDir: path.join(root, 'basic', 'profiles'),
    sentinelDir: path.join(root, '.sentinel'),
  };
}

/** { exe, cwd } for OBS, from the path he set (an exe, its bin folder or the install folder), else the default. */
function findObs({ obsPath = null, exists }) {
  const candidates = [];
  if (typeof obsPath === 'string' && obsPath.trim()) {
    const p = obsPath.trim();
    if (/obs64\.exe$/i.test(p)) candidates.push(p);
    candidates.push(path.join(p, EXE));
    candidates.push(path.join(p, BIN, EXE));
  }
  candidates.push(path.join(DEFAULT_OBS_DIR, BIN, EXE));
  for (const exe of candidates) {
    if (exists(exe)) return { exe, cwd: path.dirname(exe) };
  }
  return null;
}

// ── Running or not ───────────────────────────────────────────

/** exec(file, args) resolves { stdout }. True when tasklist lists obs64.exe; a tasklist that fails is "not known". */
async function isObsRunning({ exec }) {
  try {
    const { stdout } = await exec('tasklist', ['/FI', `IMAGENAME eq ${EXE}`, '/FO', 'CSV', '/NH']);
    return /"obs64\.exe"/i.test(String(stdout || ''));
  } catch (e) {
    return null;
  }
}

/** Non-empty .sentinel with OBS not running: it did not close cleanly, and will ask about it at its next start. */
function crashedLastTime({ sentinelDir, readdir }) {
  try {
    return readdir(sentinelDir).some((name) => /^run_/i.test(String(name)));
  } catch (e) {
    return false;
  }
}

/** Start OBS detached, minimised to the tray, from its own bin folder. spawn is child_process.spawn's shape. */
function startObs({ exe, cwd, spawn, flags = LAUNCH_FLAGS }) {
  try {
    const child = spawn(exe, [...flags], { cwd, detached: true, stdio: 'ignore', windowsHide: false });
    if (child && typeof child.unref === 'function') child.unref();
    return { ok: true, pid: child && child.pid ? child.pid : null };
  } catch (err) {
    return { ok: false, reason: `OBS could not be started: ${err.message}` };
  }
}

/**
 * What a press has to do about OBS when it is not answering: nothing if it is running (its WebSocket may be off, or it
 * may be asking about its last crash), else start it detached and minimised. Resolves { ok, running?, pid?, reason? }.
 * Never a second OBS: a tasklist that cannot say is "not known" and starts nothing. Never an OBS that cannot answer:
 * with the WebSocket switched off the sentence is to press Set up OBS first.
 */
async function startIfClosed({ exec, paths, obsPath = null, exists, readdir, readFile, spawn, log = () => {} }) {
  const running = await isObsRunning({ exec });
  if (running === null) return { ok: false, reason: NOT_KNOWN };
  const cfg = readWebSocketConfig(paths.configJson, { readFile });
  if (running === true) {
    if (cfg.state === 'ok' && !cfg.enabled) return { ok: false, reason: WS_OFF_OPEN };
    return { ok: true, running: true };
  }
  if ((cfg.state === 'ok' && !cfg.enabled) || cfg.state === 'missing') return { ok: false, reason: WS_OFF_FIRST };
  const found = findObs({ obsPath, exists });
  if (!found) return { ok: false, reason: NOT_FOUND };
  if (crashedLastTime({ sentinelDir: paths.sentinelDir, readdir })) {
    log('[RacingDesk] OBS did not close cleanly last time: it will ask about it when it opens');
  }
  const started = startObs({ exe: found.exe, cwd: found.cwd, spawn });
  log(started.ok ? `[RacingDesk] OBS started (pid ${started.pid}), minimised to the tray` : `[RacingDesk] ${started.reason}`);
  return started;
}

/**
 * startIfClosed with its inputs given once, and one start at a time: a press that comes while another is still asking
 * tasklist (the tray's Open OBS and the Stream Deck's Record together) is given that one's answer, not a second launch.
 * `obsPath` may be a function, read afresh at each start.
 */
function createStarter(deps) {
  let inFlight = null;
  return {
    startIfClosed() {
      if (!inFlight) {
        inFlight = startIfClosed({ ...deps, obsPath: typeof deps.obsPath === 'function' ? deps.obsPath() : deps.obsPath })
          .catch((e) => ({ ok: false, reason: `OBS could not be started: ${e.message}` }))
          .finally(() => { inFlight = null; });
      }
      return inFlight;
    },
  };
}

/**
 * What Racing Desk's own start does about OBS, with "Start OBS with Racing Desk" on: { start } when it may; { wait }
 * when the telemetry has not answered yet (a host just started answers a few seconds late, and no answer says nothing
 * about the car); otherwise why not. Never from the relaunch Ctrl+Shift+G makes — a key held only in the car — and
 * never while he is in the car: OBS's modal dialogs (the crash question, a failed replay buffer) land over the sim.
 */
function startWithApp({ enabled, relaunched = false, answered, inCar }) {
  if (!enabled) return { start: false, wait: false, why: 'the switch is off' };
  if (relaunched) return { start: false, wait: false, why: 'this start is the relaunch a key in the car makes' };
  if (!answered) return { start: false, wait: true, why: 'the telemetry has not answered yet' };
  if (inCar) return { start: false, wait: false, why: 'he is in the car' };
  return { start: true, wait: false, why: null };
}

// ── The WebSocket's settings file ────────────────────────────

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * { state: 'ok' | 'missing' | 'unreadable', enabled, port, authRequired, password }. The password is for the caller's
 * memory and nowhere else: it is never logged, written to the settings file or sent to a page.
 */
function readWebSocketConfig(file, { readFile }) {
  let raw;
  try {
    raw = readFile(file, 'utf8');
  } catch (e) {
    return { state: e && e.code === 'ENOENT' ? 'missing' : 'unreadable', enabled: null, port: WS_DEFAULT_PORT, authRequired: null, password: null };
  }
  let json;
  try {
    json = JSON.parse(stripBom(String(raw)));
  } catch (e) {
    json = null;
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return { state: 'unreadable', enabled: null, port: WS_DEFAULT_PORT, authRequired: null, password: null };
  }
  const port = Number.isInteger(json.server_port) && json.server_port > 0 && json.server_port < 65536 ? json.server_port : WS_DEFAULT_PORT;
  return {
    state: 'ok',
    enabled: json.server_enabled === true,
    port,
    authRequired: json.auth_required !== false,
    password: typeof json.server_password === 'string' && json.server_password.length ? json.server_password : null,
  };
}

/**
 * server_enabled: true, and nothing else changed — the same keys in the same order, the same two-space layout OBS
 * writes. A temp file and a rename, so a cut-short write leaves the old file. Only while OBS is closed (the caller
 * checks): OBS writes the file from memory when its WebSocket settings are saved, which would undo this.
 * A file that is missing is made with the one key (OBS fills in the rest, and asks for a password... it generates one).
 */
function enableWebSocket(file, { readFile, writeFile, rename, mkdir = null }) {
  const current = readWebSocketConfig(file, { readFile });
  if (current.state === 'unreadable') return { changed: false, state: 'unreadable', reason: "OBS's WebSocket settings file could not be read, so it was left as it is." };
  let json = {};
  if (current.state === 'ok') json = JSON.parse(stripBom(String(readFile(file, 'utf8'))));
  if (json.server_enabled === true) return { changed: false, state: current.state };
  json.server_enabled = true;
  if (mkdir) mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.racing-desk.tmp`;
  writeFile(tmp, JSON.stringify(json, null, 2) + '\n', 'utf8');
  rename(tmp, file);
  return { changed: true, state: current.state };
}

// ── The profile's basic.ini ──────────────────────────────────

/** Which profile is current: user.ini's [Basic] ProfileDir, and its basic.ini. Null when it cannot be read. */
function currentProfileIni({ appData, readFile }) {
  const where = obsPaths(appData);
  let text;
  try { text = stripBom(String(readFile(where.userIni, 'utf8'))); } catch (e) { return null; }
  const basic = readIniKeys(text, 'Basic', ['ProfileDir', 'Profile']);
  const dir = basic.ProfileDir || basic.Profile;
  if (!dir || /[\\/]|\.\./.test(dir)) return null;
  return { profile: basic.Profile || dir, dir, ini: path.join(where.profilesDir, dir, 'basic.ini') };
}

function unescapeIni(value) {
  return value.replace(/\\\\/g, '\\');
}

/** The values of `keys` in `[section]`, as OBS reads them (a doubled backslash is one); null where not set. */
function readIniKeys(text, section, keys) {
  const out = {};
  for (const k of keys) out[k] = null;
  const lines = stripBom(String(text)).split(/\r?\n/);
  let inSection = false;
  for (const line of lines) {
    const head = line.match(/^\s*\[([^\]]*)\]\s*$/);
    if (head) { inSection = head[1] === section; continue; }
    if (!inSection) continue;
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    if (keys.includes(key)) out[key] = unescapeIni(line.slice(at + 1));
  }
  return out;
}

/**
 * The text with `changes` ({ [section]: { [key]: value } }) set: a key that is there is replaced in place, one that
 * is not is added at the end of its section, a section that is not is added at the end. Every other line, the BOM
 * and the newline style are kept. Values are written as they are given (forward slashes in paths need no escaping).
 */
function setIniKeys(text, changes) {
  const str = String(text);
  const bom = str.charCodeAt(0) === 0xfeff ? '\ufeff' : '';
  const body = bom ? str.slice(1) : str;
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(/\r?\n/);
  const trailingBlank = lines.length && lines[lines.length - 1] === '';
  if (trailingBlank) lines.pop();
  const pending = {};
  for (const [section, keys] of Object.entries(changes)) pending[section] = { ...keys };

  const out = [];
  let section = null;
  const flush = () => {
    if (section !== null && pending[section]) {
      for (const [key, value] of Object.entries(pending[section])) out.push(`${key}=${value}`);
      delete pending[section];
    }
  };
  for (const line of lines) {
    const head = line.match(/^\s*\[([^\]]*)\]\s*$/);
    if (head) {
      flush();
      section = head[1];
      out.push(line);
      continue;
    }
    const at = line.indexOf('=');
    if (section !== null && pending[section] && at > 0) {
      const key = line.slice(0, at).trim();
      if (key in pending[section]) {
        out.push(`${key}=${pending[section][key]}`);
        delete pending[section][key];
        continue;
      }
    }
    out.push(line);
  }
  flush();
  for (const [name, keys] of Object.entries(pending)) {
    if (!Object.keys(keys).length) continue;
    out.push(`[${name}]`);
    for (const [key, value] of Object.entries(keys)) out.push(`${key}=${value}`);
  }
  return bom + out.join(eol) + eol;
}

function toForwardSlashes(p) {
  return String(p).replace(/\\/g, '/').replace(/\/+$/, '');
}

/** The profile keys Set up OBS writes, for a recording folder. */
function profileWanted(folder) {
  const f = toForwardSlashes(folder);
  return {
    AdvOut: { RecFormat2: 'hybrid_mp4', RecRB: 'true', RecRBTime: REPLAY_SECONDS, RecFilePath: f },
    SimpleOutput: { FilePath: f },
  };
}

/** What a profile's basic.ini says against what is wanted: { hybrid, replayBuffer, folder, ok }. */
function profileCheck(iniText, folder) {
  const adv = readIniKeys(iniText, 'AdvOut', ['RecFormat2', 'RecRB', 'RecRBTime', 'RecFilePath']);
  const f = toForwardSlashes(folder).toLowerCase();
  const hybrid = adv.RecFormat2 === 'hybrid_mp4';
  const replayBuffer = adv.RecRB === 'true';
  const current = adv.RecFilePath ? toForwardSlashes(adv.RecFilePath).toLowerCase() : null;
  const folderOk = current === f;
  return { hybrid, replayBuffer, folder: folderOk, recFilePath: adv.RecFilePath, ok: hybrid && replayBuffer && folderOk };
}

/** The folder the current profile records into, as its basic.ini says (Advanced or Simple output); null if unknown. */
function profileRecordFolder({ appData, readFile }) {
  const profile = currentProfileIni({ appData, readFile });
  if (!profile) return null;
  let text;
  try { text = String(readFile(profile.ini, 'utf8')); } catch (e) { return null; }
  const mode = readIniKeys(text, 'Output', ['Mode']).Mode;
  const folder = mode === 'Simple' ? readIniKeys(text, 'SimpleOutput', ['FilePath']).FilePath : readIniKeys(text, 'AdvOut', ['RecFilePath']).RecFilePath;
  return folder || null;
}

/**
 * Everything Set up OBS does while OBS is closed: the WebSocket switched on and its password read; the profile keys
 * written into the current profile's basic.ini; the recording folder made. Returns { did, problems, password,
 * wsPort }: `did` and `problems` are sentences for the card, `password` is for memory and nothing else.
 */
function setupWhileClosed({ appData, folder, readFile, writeFile, rename, mkdir }) {
  const where = obsPaths(appData);
  const did = [];
  const problems = [];
  let password = null;
  let wsPort = WS_DEFAULT_PORT;

  try {
    mkdir(folder, { recursive: true });
  } catch (e) {
    problems.push(`The recording folder ${folder} could not be made: ${e.message}`);
  }

  try {
    const ws = enableWebSocket(where.configJson, { readFile, writeFile, rename, mkdir });
    if (ws.state === 'unreadable') problems.push(ws.reason);
    else if (ws.changed) did.push("OBS's WebSocket is switched on.");
    const after = readWebSocketConfig(where.configJson, { readFile });
    password = after.password;
    wsPort = after.port;
    if (after.state === 'ok' && after.authRequired && !password) problems.push("OBS's WebSocket has no password in its settings file yet; OBS makes one the first time it opens with the server on, so press Set up OBS again after that, or type the password below.");
  } catch (e) {
    problems.push(`OBS's WebSocket settings could not be written: ${e.message}`);
  }

  const profile = currentProfileIni({ appData, readFile });
  if (!profile) {
    problems.push("OBS's current profile could not be found, so Hybrid MP4, the replay buffer and the folder were not set.");
  } else {
    try {
      const text = String(readFile(profile.ini, 'utf8'));
      const before = profileCheck(text, folder);
      if (before.ok) {
        did.push(`The profile "${profile.profile}" already records Hybrid MP4 with a replay buffer into ${folder}.`);
      } else {
        const next = setIniKeys(text, profileWanted(folder));
        const tmp = `${profile.ini}.racing-desk.tmp`;
        writeFile(tmp, next, 'utf8');
        rename(tmp, profile.ini);
        const changed = [];
        if (!before.hybrid) changed.push('Hybrid MP4');
        if (!before.replayBuffer) changed.push(`a ${REPLAY_SECONDS} s replay buffer`);
        if (!before.folder) changed.push(`recordings into ${folder}`);
        did.push(`The profile "${profile.profile}" now has ${changed.join(', ')}.`);
      }
    } catch (e) {
      problems.push(`The profile's settings could not be written: ${e.message}`);
    }
  }
  return { did, problems, password, wsPort };
}

/**
 * The profile keys through the WebSocket while OBS is open: SetProfileParameter saves to disk at once and takes
 * effect at OBS's next start; SetRecordDirectory refuses while a recording runs. `client.request` is the OBS
 * client's. The WebSocket itself cannot be switched on from here (it is on, or we would not be talking).
 */
async function setupWhileOpen(client, { folder }) {
  const did = [];
  const problems = [];
  const wanted = profileWanted(folder);
  const set = async (category, name, value) => {
    await client.request('SetProfileParameter', { parameterCategory: category, parameterName: name, parameterValue: value });
  };
  try {
    const before = {};
    for (const name of ['RecFormat2', 'RecRB', 'RecRBTime', 'RecFilePath']) {
      const answer = await client.request('GetProfileParameter', { parameterCategory: 'AdvOut', parameterName: name });
      before[name] = answer.parameterValue;
    }
    const changed = [];
    if (before.RecFormat2 !== 'hybrid_mp4') { await set('AdvOut', 'RecFormat2', 'hybrid_mp4'); changed.push('Hybrid MP4'); }
    if (before.RecRB !== 'true') { await set('AdvOut', 'RecRB', 'true'); changed.push(`a ${REPLAY_SECONDS} s replay buffer`); }
    if (before.RecRBTime !== REPLAY_SECONDS) await set('AdvOut', 'RecRBTime', REPLAY_SECONDS);
    const current = before.RecFilePath ? toForwardSlashes(before.RecFilePath).toLowerCase() : null;
    if (current !== toForwardSlashes(folder).toLowerCase()) {
      try {
        await client.request('SetRecordDirectory', { recordDirectory: wanted.AdvOut.RecFilePath });
        changed.push(`recordings into ${folder}`);
      } catch (e) {
        if (e && e.code === 500) problems.push(`The recording folder was not changed while OBS is recording; press Set up OBS again after it stops.`);
        else throw e;
      }
    }
    if (changed.length) did.push(`The profile now has ${changed.join(', ')}. Crash-safe files and instant replay start the next time OBS opens.`);
    else did.push(`The profile already records Hybrid MP4 with a replay buffer into ${folder}.`);
  } catch (e) {
    problems.push(`OBS did not take the profile change: ${e.message}`);
  }
  return { did, problems };
}

/**
 * Set up OBS, whichever way OBS stands: over the WebSocket while it answers; in OBS's files while it is closed; and
 * nothing at all while it may be open and cannot be talked to (its WebSocket off, a password refused, tasklist not
 * saying), because OBS writes its files from memory when it closes and would undo what was written. Resolves
 * { ok, did, problems, ran, password? } — `password` is the one read from OBS's file, for memory and nothing else.
 */
async function setupObs({ client, exec, appData, folder, readFile, writeFile, rename, mkdir }) {
  if (client.identified()) {
    const result = await setupWhileOpen(client, { folder });
    try { mkdir(folder, { recursive: true }); } catch (e) { result.problems.push(`The recording folder ${folder} could not be made: ${e.message}`); }
    return { ok: result.problems.length === 0, did: result.did, problems: result.problems, ran: 'open' };
  }
  const running = await isObsRunning({ exec });
  if (running !== false) {
    const state = client.state();
    const problem = running === null
      ? `${NOT_KNOWN} OBS's files were left as they are.`
      : state.authFailed
        ? 'OBS refused the password. Type the one from OBS below, or quit OBS and press Set up OBS again.'
        : state.passwordMissing
          ? 'OBS wants a password and Racing Desk has none. Type the one from OBS below, or quit OBS and press Set up OBS again.'
          : 'OBS is open with its WebSocket switched off. Quit OBS, then press Set up OBS again.';
    return { ok: false, did: [], problems: [problem], ran: null };
  }
  const result = setupWhileClosed({ appData, folder, readFile, writeFile, rename, mkdir });
  return { ok: result.problems.length === 0, did: result.did, problems: result.problems, password: result.password, ran: 'closed' };
}

module.exports = {
  DEFAULT_OBS_DIR, EXE, BIN, LAUNCH_FLAGS, REPLAY_SECONDS, WS_DEFAULT_PORT,
  NOT_KNOWN, WS_OFF_OPEN, WS_OFF_FIRST, NOT_FOUND,
  obsPaths, findObs, isObsRunning, crashedLastTime, startObs, startIfClosed, createStarter, startWithApp,
  readWebSocketConfig, enableWebSocket,
  currentProfileIni, readIniKeys, setIniKeys, toForwardSlashes, profileWanted, profileCheck, profileRecordFolder,
  setupWhileClosed, setupWhileOpen, setupObs,
};
