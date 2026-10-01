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
// - The recording encoder: the profile's recordEncoder.json, which OBS hands whole to the encoder named by [AdvOut]
//   RecEncoder (frontend/utility/AdvancedOutput.cpp:78,121 in 32.1.2). For NVENC the rate-control keys are
//   rate_control, target_quality and max_bitrate (plugins/obs-nvenc/nvenc-properties.c:5-15): "CQVBR" is a quality
//   target with a bitrate cap (nvenc.c:230-231,347-349,366-370). Set up OBS writes those three keys and no other,
//   only while OBS is closed (obs-websocket 5 has no request for an encoder's settings, and OBS writes the file from
//   memory when its Settings are saved), atomically, keeping the file as it was beside it the first time. A quality
//   target he has tuned himself (any CQVBR) is left as it is. OBS writes only the keys the user changed, so a key that
//   is not in the file is the plugin's own default (NVENC_DEFAULTS), and is read as that: a file with no bitrate records
//   at 10 Mbps, and a CQVBR with no cap has the plugin's 10 Mbps one.
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
const ENCODER_FILE = 'recordEncoder.json';
const ENCODER_KEEP = `${ENCODER_FILE}.before-racing-desk`;
const QUALITY_RATE_CONTROL = 'CQVBR';
// OBS's own "Indistinguishable Quality, Large File Size" level for NVENC (frontend/utility/SimpleOutput.cpp:520,543:
// CalcCRF(16) → cqp 16 at any output above 2000 px across): the nearest OBS has to his 100 Mbps CBR, which at the
// 2580x1080 60 fps his profile outputs (the canvas is 3440x1440; [Video] OutputCX/OutputCY scale it) is six tenths
// of a bit per pixel and all but transparent. On the same 1-51 scale as CQP (nvenc-properties.c:129-130,137); lower
// is better, and OBS's own default for the mode is 20.
const QUALITY_TARGET = 16;
// What the obs-nvenc plugin reads for a key the file does not have (nvenc-properties.c:41-47,60). OBS writes into
// recordEncoder.json only the keys the user changed (obs_data_get_json without defaults, libobs/obs-data.c:578), so a
// file is mostly what it leaves out; the encoder is made from the file with these under it.
const NVENC_DEFAULTS = Object.freeze({ rate_control: 'cbr', bitrate: 10000, max_bitrate: 10000, target_quality: 20 });
// The ids the obs-nvenc plugin registers (nvenc.c:1392-1489, nvenc-compat.c:299-400): the only encoders the keys mean
// anything to. The compat ids are rerouted to the obs_nvenc_* ones and read the same settings.
const NVENC_IDS = Object.freeze([
  'obs_nvenc_h264_tex', 'obs_nvenc_hevc_tex', 'obs_nvenc_av1_tex', 'obs_nvenc_h264_soft', 'obs_nvenc_hevc_soft', 'obs_nvenc_av1_soft',
  'obs_nvenc_h264_cuda', 'obs_nvenc_hevc_cuda', 'obs_nvenc_av1_cuda', 'jim_nvenc', 'jim_hevc_nvenc', 'jim_av1_nvenc', 'ffmpeg_nvenc', 'ffmpeg_hevc_nvenc',
]);

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
  return { profile: basic.Profile || dir, dir, ini: path.join(where.profilesDir, dir, 'basic.ini'), encoder: path.join(where.profilesDir, dir, ENCODER_FILE) };
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

/**
 * What a profile's basic.ini says against what is wanted: { hybrid, replayBuffer, replaySeconds, folder, ok }.
 * `replaySeconds` is the length of the buffer being the wanted one (a key that is not there is OBS's own 20 s).
 */
function profileCheck(iniText, folder) {
  const adv = readIniKeys(iniText, 'AdvOut', ['RecFormat2', 'RecRB', 'RecRBTime', 'RecFilePath']);
  const f = toForwardSlashes(folder).toLowerCase();
  const hybrid = adv.RecFormat2 === 'hybrid_mp4';
  const replayBuffer = adv.RecRB === 'true';
  const replaySeconds = adv.RecRBTime === null || adv.RecRBTime === REPLAY_SECONDS;
  const current = adv.RecFilePath ? toForwardSlashes(adv.RecFilePath).toLowerCase() : null;
  const folderOk = current === f;
  return { hybrid, replayBuffer, replaySeconds, folder: folderOk, recFilePath: adv.RecFilePath, ok: hybrid && replayBuffer && replaySeconds && folderOk };
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

// ── The profile's recording encoder (recordEncoder.json) ─────

/**
 * Which encoder the profile records with, from its basic.ini: { id, applies }. The encoder file is read by OBS only
 * for Advanced output's Standard recording with an encoder of its own (AdvancedOutput.cpp:61-78,120-122; "none" is
 * the stream encoder's streamEncoder.json), and the keys here are the obs-nvenc plugin's: `applies` is all of that.
 */
function profileEncoder(iniText) {
  const mode = readIniKeys(iniText, 'Output', ['Mode']).Mode;
  const adv = readIniKeys(iniText, 'AdvOut', ['RecEncoder', 'RecType']);
  const id = adv.RecEncoder || null;
  const advanced = mode === 'Advanced';
  const standard = adv.RecType === null || adv.RecType === 'Standard';
  const nvenc = id !== null && NVENC_IDS.includes(id);
  return { id, advanced, standard, sameAsStream: id === 'none', nvenc, applies: advanced && standard && nvenc };
}

/**
 * The size of the video the profile records, "2580x1080", or null where the profile does not say. The recording is the
 * size of OBS's output ([Video] OutputCX x OutputCY: his canvas is 3440x1440 and the output scales it), unless the
 * recording is rescaled on its own: a scale filter other than "disable" (0, which an absent key reads as) and a size
 * in RecRescaleRes (AdvancedOutput.cpp:330,353-358).
 */
function profileOutputSize(iniText) {
  const adv = readIniKeys(iniText, 'AdvOut', ['RecRescaleFilter', 'RecRescaleRes']);
  const rescale = String(adv.RecRescaleRes || '').trim().match(/^(\d+)x(\d+)$/);
  const filter = Number(adv.RecRescaleFilter);
  if (adv.RecRescaleFilter !== null && Number.isInteger(filter) && filter !== 0 && rescale && +rescale[1] > 0 && +rescale[2] > 0) return `${+rescale[1]}x${+rescale[2]}`;
  const video = readIniKeys(iniText, 'Video', ['OutputCX', 'OutputCY']);
  const cx = Number(video.OutputCX);
  const cy = Number(video.OutputCY);
  return Number.isInteger(cx) && cx > 0 && Number.isInteger(cy) && cy > 0 ? `${cx}x${cy}` : null;
}

/** { state: 'ok' | 'missing' | 'unreadable', json, text }: the encoder file as OBS would parse it (an object, or nothing). */
function readEncoderFile(file, { readFile }) {
  let text;
  try {
    text = String(readFile(file, 'utf8'));
  } catch (e) {
    return { state: e && e.code === 'ENOENT' ? 'missing' : 'unreadable', json: null, text: null };
  }
  let json;
  try { json = JSON.parse(stripBom(text)); } catch (e) { json = null; }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return { state: 'unreadable', json: null, text };
  return { state: 'ok', json, text };
}

const posInt = (v) => Number.isInteger(v) && v > 0;

/**
 * What the encoder's rate control is, as the plugin reads it (nvenc-properties.c:5-15, a key the file lacks being the
 * plugin's default, NVENC_DEFAULTS; the mode is compared without case, nvenc.c:230-233): { rateControl, targetQuality,
 * maxBitrate, bitrate, capKbps, qualityTarget }. `qualityTarget` is any CQVBR: one he has tuned himself, or left at the
 * plugin's own level and 10 Mbps cap, is his, and is left alone. `capKbps` is the ceiling the file records under today,
 * which is what Set up OBS keeps: a VBR's or CQVBR's own cap, else the fixed bitrate (the default 10 Mbps where the
 * file names none).
 */
function encoderCheck(json) {
  const j = json && typeof json === 'object' ? json : {};
  const rateControl = typeof j.rate_control === 'string' ? j.rate_control : NVENC_DEFAULTS.rate_control;
  const cqvbr = rateControl.toLowerCase() === QUALITY_RATE_CONTROL.toLowerCase();
  const vbr = rateControl.toLowerCase() === 'vbr';
  const targetQuality = posInt(j.target_quality) ? j.target_quality : NVENC_DEFAULTS.target_quality;
  const maxBitrate = posInt(j.max_bitrate) ? j.max_bitrate : NVENC_DEFAULTS.max_bitrate;
  const bitrate = posInt(j.bitrate) ? j.bitrate : NVENC_DEFAULTS.bitrate;
  const capKbps = cqvbr || vbr ? maxBitrate : bitrate;
  return { rateControl, targetQuality, maxBitrate, bitrate, capKbps, qualityTarget: cqvbr };
}

/** The three keys Set up OBS writes, for a file as it is: the quality target, capped at what the file records under today. */
function encoderWanted(json) {
  return { rate_control: QUALITY_RATE_CONTROL, target_quality: QUALITY_TARGET, max_bitrate: encoderCheck(json).capKbps };
}

/**
 * The quality target into the encoder file: the three rate-control keys set, every other key kept as it is and in its
 * place (an unknown key too: OBS keeps what it does not read and writes it back), in the compact one-line JSON OBS
 * writes (obs_data_get_json: JSON_COMPACT | JSON_PRESERVE_ORDER). A temp file and a rename, so a cut-short write
 * leaves the old file; the first time, the file as it was is written beside it as recordEncoder.json.before-racing-desk
 * (never overwritten after). Only while OBS is closed — the caller checks. A missing file is made with the three keys
 * (OBS fills in its defaults; there is then nothing to keep); an unreadable one is left as it is.
 */
function setEncoderQuality(file, { readFile, writeFile, rename, exists }) {
  const current = readEncoderFile(file, { readFile });
  if (current.state === 'unreadable') return { changed: false, state: 'unreadable', kept: false, reason: "The profile's encoder settings file could not be read, so the recordings' size was left as it is." };
  const before = encoderCheck(current.json);
  if (before.qualityTarget) return { changed: false, state: 'ok', kept: false, before, after: before };
  const json = { ...(current.json || {}), ...encoderWanted(current.json) };
  let kept = false;
  const keep = `${file}.before-racing-desk`;
  if (current.state === 'ok' && !exists(keep)) {
    writeFile(keep, current.text, 'utf8');
    kept = true;
  }
  const tmp = `${file}.racing-desk.tmp`;
  writeFile(tmp, JSON.stringify(json), 'utf8');
  rename(tmp, file);
  return { changed: true, state: current.state, kept, before, after: encoderCheck(json) };
}

/**
 * Where the current profile's recording stands on size, for the card and the keeper: { applies, encoder, state,
 * qualityTarget, capKbps, bitrateKbps, size, file }. `applies` false is a profile the keys mean nothing to (Simple
 * output, a custom FFmpeg output, the stream encoder, x264...): nothing is said of size then. `size` is the video's, as
 * the profile has it ("2580x1080"), null when it does not say. Reading only.
 */
function encoderStatus({ appData, readFile }) {
  const none = { applies: false, encoder: null, state: null, qualityTarget: null, capKbps: null, bitrateKbps: null, size: null, file: null, profile: null };
  const profile = currentProfileIni({ appData, readFile });
  if (!profile) return none;
  let ini;
  try { ini = String(readFile(profile.ini, 'utf8')); } catch (e) { return { ...none, profile: profile.profile }; }
  const enc = profileEncoder(ini);
  if (!enc.applies) return { ...none, encoder: enc.id, profile: profile.profile, file: profile.encoder };
  const read = readEncoderFile(profile.encoder, { readFile });
  const check = encoderCheck(read.json);
  return {
    applies: true, encoder: enc.id, state: read.state, profile: profile.profile, file: profile.encoder,
    qualityTarget: read.state === 'unreadable' ? null : check.qualityTarget,
    capKbps: check.capKbps, bitrateKbps: check.bitrate, size: profileOutputSize(ini),
  };
}

/**
 * When the profile's encoder file was last written, in ms: the moment the settings the next recording is made with
 * began (OBS writes the file only when the encoder's settings are changed in its Settings, and Set up OBS writes it;
 * both are while OBS is not recording, so a recording that began after was made with what the file says). Null where
 * the keys mean nothing (not NVENC, not Advanced output) or the file is not there: every recording counts then.
 * `mtimeOf(file)` is fs.statSync(file).mtimeMs.
 */
function encoderChangedAt({ appData, readFile, mtimeOf }) {
  const profile = currentProfileIni({ appData, readFile });
  if (!profile) return null;
  let ini;
  try { ini = String(readFile(profile.ini, 'utf8')); } catch (e) { return null; }
  if (!profileEncoder(ini).applies) return null;
  try {
    const at = mtimeOf(profile.encoder);
    return Number.isFinite(at) ? at : null;
  } catch (e) {
    return null;
  }
}

const mbps = (kbps) => `${Math.round((Number(kbps) || NVENC_DEFAULTS.bitrate) / 1000)} Mbps`;
// The size is said as it is — the recordings stay what the profile makes them, which is not always the canvas — never as "full size".
const SIZE_NEXT_TIME = (capKbps, size = null) => `The size change (a quality target instead of a fixed ${mbps(capKbps)}${size ? `; the recordings stay ${size}` : ''}) happens the next time Set up OBS runs with OBS closed.`;

/**
 * Everything Set up OBS does while OBS is closed: the WebSocket switched on and its password read; the profile keys
 * written into the current profile's basic.ini; the quality target into its recordEncoder.json; the recording folder
 * made. Returns { did, problems, password, wsPort }: `did` and `problems` are sentences for the card, `password` is
 * for memory and nothing else.
 */
function setupWhileClosed({ appData, folder, readFile, writeFile, rename, mkdir, exists = null }) {
  const where = obsPaths(appData);
  const did = [];
  const problems = [];
  let password = null;
  let wsPort = WS_DEFAULT_PORT;
  const fileExists = exists || ((p) => { try { readFile(p, 'utf8'); return true; } catch (e) { return false; } });

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
    // Nothing to do about it: OBS makes the password the first time it opens with the server on, and Racing Desk reads it
    // from OBS's file each time OBS asks for it.
    if (after.state === 'ok' && after.authRequired && !password) did.push("OBS's WebSocket has no password in its settings file yet; OBS makes one the first time it opens with the server on, and Racing Desk reads it from there.");
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
        else if (!before.replaySeconds) changed.push(`the replay buffer ${REPLAY_SECONDS} s long`);
        if (!before.folder) changed.push(`recordings into ${folder}`);
        did.push(`The profile "${profile.profile}" now has ${changed.join(', ')}.`);
      }
    } catch (e) {
      problems.push(`The profile's settings could not be written: ${e.message}`);
    }
    // The recordings' size: a quality target with a cap instead of a fixed bitrate, into the profile's encoder file, for
    // the encoders the keys mean something to. Every other key of the file — the preset, the keyframes, the B-frames, the
    // lookahead — stays as he has it.
    let ini = null;
    try { ini = String(readFile(profile.ini, 'utf8')); } catch (e) { ini = null; }   // said above already
    try {
      const enc = ini === null ? null : profileEncoder(ini);
      if (!enc) { /* nothing to go by */ } else if (enc.applies) {
        const result = setEncoderQuality(profile.encoder, { readFile, writeFile, rename, exists: fileExists });
        if (result.state === 'unreadable') problems.push(result.reason);
        else if (result.changed) {
          const kept = result.kept ? ` (its encoder settings as they were are kept beside it as ${ENCODER_KEEP})` : '';
          const size = profileOutputSize(ini);
          did.push(`The profile "${profile.profile}" now records with a quality target instead of a fixed ${mbps(result.before.capKbps)}${size ? `, still at ${size}` : ''}${kept}.`);
        }
      } else if (enc.advanced && enc.standard && enc.id && !enc.sameAsStream) {
        did.push(`The recordings' size was left as it is: the profile records with ${enc.id}, not NVENC.`);
      }
    } catch (e) {
      problems.push(`The profile's encoder settings could not be written: ${e.message}`);
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
    // The length is said too, whichever way it was wrong: a buffer that was off is "a 20 s replay buffer" above; one that
    // was on and 30 s long is "the replay buffer 20 s long". A key that is not there is OBS's own 20 s.
    if (before.RecRBTime !== null && before.RecRBTime !== undefined && before.RecRBTime !== REPLAY_SECONDS) {
      await set('AdvOut', 'RecRBTime', REPLAY_SECONDS);
      if (before.RecRB === 'true') changed.push(`the replay buffer ${REPLAY_SECONDS} s long`);
    }
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
async function setupObs({ client, exec, appData, folder, readFile, writeFile, rename, mkdir, exists = null }) {
  if (client.identified()) {
    const result = await setupWhileOpen(client, { folder });
    try { mkdir(folder, { recursive: true }); } catch (e) { result.problems.push(`The recording folder ${folder} could not be made: ${e.message}`); }
    // The encoder's settings cannot be set over the WebSocket, and OBS writes the file from memory when its Settings are
    // saved: the size change waits for a run with OBS closed, said in one sentence. Reading the file is fine.
    try {
      const enc = encoderStatus({ appData, readFile });
      if (enc.applies && enc.qualityTarget === false) result.did.push(SIZE_NEXT_TIME(enc.capKbps, enc.size));
    } catch (e) { /* nothing to say of it */ }
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
  const result = setupWhileClosed({ appData, folder, readFile, writeFile, rename, mkdir, exists });
  return { ok: result.problems.length === 0, did: result.did, problems: result.problems, password: result.password, ran: 'closed' };
}

module.exports = {
  DEFAULT_OBS_DIR, EXE, BIN, LAUNCH_FLAGS, REPLAY_SECONDS, WS_DEFAULT_PORT,
  ENCODER_FILE, ENCODER_KEEP, QUALITY_RATE_CONTROL, QUALITY_TARGET, NVENC_DEFAULTS, NVENC_IDS, SIZE_NEXT_TIME,
  NOT_KNOWN, WS_OFF_OPEN, WS_OFF_FIRST, NOT_FOUND,
  obsPaths, findObs, isObsRunning, crashedLastTime, startObs, startIfClosed, createStarter, startWithApp,
  readWebSocketConfig, enableWebSocket,
  currentProfileIni, readIniKeys, setIniKeys, toForwardSlashes, profileWanted, profileCheck, profileRecordFolder,
  profileEncoder, profileOutputSize, readEncoderFile, encoderCheck, encoderWanted, setEncoderQuality, encoderStatus, encoderChangedAt,
  setupWhileClosed, setupWhileOpen, setupObs,
};
