// Is the sim, or the downloader, holding the paint folder open? Ported from apps/paints/src-tauri/src/process.rs.
//
// `tasklist` is used rather than a process-enumeration dependency: it is on every Windows box, and the answer
// is a yes/no that the UI turns into a warning. It runs with no console window, and `exec` is injectable so
// the tests can answer with a canned process list instead of starting anything.
const { run } = require('./exec');

// The sim itself. Holds textures open while it runs, so a copy can half-succeed.
const SIM_EXES = Object.freeze(['iRacingSim64DX11.exe', 'iRacingSim64.exe']);
// The launcher/UI. Does not lock textures, but tells you the sim is about to start.
const UI_EXES = Object.freeze(['iRacingUI.exe', 'iRacingService.exe']);

// CSV rows look like: "image.exe","1234","Console","1","12,345 K"
function parseTasklist(text) {
  const names = new Set();
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('"')) continue;
    const rest = line.slice(1);
    const end = rest.indexOf('"');
    if (end < 0) continue;
    names.add(rest.slice(0, end).toLowerCase());
  }
  return names;
}

async function runningImageNames({ exec = run, platform = process.platform } = {}) {
  if (platform !== 'win32') return new Set();
  const res = await exec('tasklist', ['/FO', 'CSV', '/NH']);
  if (!res || res.error) return new Set();
  return parseTasklist(res.stdout);
}

// Whether a named executable is running. Case-insensitive, exact image name.
async function isRunning(exe, deps) {
  return (await runningImageNames(deps)).has(String(exe).toLowerCase());
}

// One `tasklist` call answering every question the UI asks about iRacing.
async function simState(deps) {
  const names = await runningImageNames(deps);
  const hit = (list) => list.filter((e) => names.has(e.toLowerCase()));
  const sim = hit(SIM_EXES);
  const ui = hit(UI_EXES);
  return { simRunning: sim.length > 0, uiRunning: ui.length > 0, matched: [...sim, ...ui] };
}

module.exports = { SIM_EXES, UI_EXES, parseTasklist, runningImageNames, isRunning, simState };
