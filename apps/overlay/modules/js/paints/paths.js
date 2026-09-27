// Finding Documents\iRacing\paint. Ported from apps/paints/src-tauri/src/paths.rs.
//
// The trap the plan calls out is real: when OneDrive backs up Documents there are two plausible Documents
// folders, and the sim reads one while you edit the other. The app never picks silently — it collects every
// candidate, scores them by what is actually in them, and hands the whole list to the UI so the chosen path is
// always on screen.
const fs = require('fs');
const path = require('path');
const roles = require('./roles');
const { run } = require('./exec');

// Where Windows records the Documents folder. `Shell Folders` holds the already expanded value; `User Shell
// Folders` is the authoritative one and may still contain %USERPROFILE%. Both are consulted, and both are
// expanded before use. The Rust read them with winreg; here `reg query` does the same with no dependency.
const REGISTRY_KEYS = [
  ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders', 'registry Shell Folders'],
  ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', 'registry User Shell Folders'],
];

// How many car folders are sampled for textures when ranking a candidate.
const SURVEY_SAMPLE = 12;

function envPath(env, key) {
  const v = env[key];
  return typeof v === 'string' && v.length ? v : null;
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

// Expand %NAME% references the way the registry stores them. Unknown names are left in place rather than
// blanked, so a bad expansion shows up as a visibly wrong path instead of silently becoming a plausible-looking
// one.
function expandEnv(raw, env = process.env) {
  let out = '';
  let rest = raw;
  for (;;) {
    const start = rest.indexOf('%');
    if (start < 0) break;
    out += rest.slice(0, start);
    const after = rest.slice(start + 1);
    const end = after.indexOf('%');
    if (end < 0) {
      out += '%';
      rest = after;
      break;
    }
    const name = after.slice(0, end);
    const value = env[name];
    out += typeof value === 'string' ? value : `%${name}%`;
    rest = after.slice(end + 1);
  }
  return out + rest;
}

// The `Personal` value out of `reg query` output:
//     HKEY_CURRENT_USER\...\Shell Folders
//         Personal    REG_SZ    C:\Users\x\Documents
function parseRegQuery(text) {
  const m = /^\s*Personal\s+REG_(?:EXPAND_)?SZ\s+(.*?)\s*$/m.exec(text || '');
  return m ? m[1] : null;
}

async function documentsFromRegistry({ exec = run, env = process.env, platform = process.platform } = {}) {
  if (platform !== 'win32') return [];
  const out = [];
  for (const [key, label] of REGISTRY_KEYS) {
    const res = await exec('reg', ['query', key, '/v', 'Personal']);
    if (!res || res.error || res.status !== 0) continue;
    const value = parseRegQuery(res.stdout);
    if (value == null) continue;
    out.push({ path: expandEnv(value, env), source: label });
  }
  return out;
}

// Count what is in a paint folder, cheaply. This only ranks candidates, so it reads one level of entries and
// samples a handful of car folders rather than walking thousands.
function survey(paint) {
  let entries;
  try {
    entries = fs.readdirSync(paint, { withFileTypes: true });
  } catch (e) {
    return { carFolders: 0, textureFiles: 0 };
  }
  let carFolders = 0;
  let textureFiles = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    carFolders += 1;
    if (carFolders <= SURVEY_SAMPLE) {
      let inner;
      try {
        inner = fs.readdirSync(path.join(paint, entry.name));
      } catch (e) {
        continue;
      }
      for (const name of inner) if (roles.parseInstalled(name)) textureFiles += 1;
    }
  }
  return { carFolders, textureFiles };
}

function looksLikeOneDrive(p) {
  return String(p).toLowerCase().includes('onedrive');
}

// Every place Documents\iRacing\paint could plausibly be, deduplicated and surveyed. `registry` (async, returns
// [{ path, source }]) and `env` are injectable so the tests can build the OneDrive trap in a temp folder.
async function detect({ env = process.env, registry, exec = run, platform = process.platform } = {}) {
  const roots = [];
  const fromRegistry = registry ? await registry() : await documentsFromRegistry({ exec, env, platform });
  for (const { path: doc, source } of fromRegistry) {
    roots.push({ doc, source, isOneDrive: looksLikeOneDrive(doc) });
  }
  const profile = envPath(env, 'USERPROFILE');
  if (profile) roots.push({ doc: path.join(profile, 'Documents'), source: '%USERPROFILE%', isOneDrive: false });
  for (const key of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const od = envPath(env, key);
    if (od) roots.push({ doc: path.join(od, 'Documents'), source: `%${key}%`, isOneDrive: true });
  }

  // Deduplicate on the final paint path, keeping the first (most authoritative) source.
  const seen = new Map();
  for (const { doc, source, isOneDrive } of roots) {
    const paint = path.join(doc, 'iRacing', 'paint');
    const key = paint.toLowerCase();
    if (seen.has(key)) continue;
    const exists = isDir(paint);
    const counts = exists ? survey(paint) : { carFolders: 0, textureFiles: 0 };
    seen.set(key, {
      path: paint,
      source,
      exists,
      isOneDrive: isOneDrive || looksLikeOneDrive(paint),
      carFolders: counts.carFolders,
      textureFiles: counts.textureFiles,
    });
  }
  const candidates = [...seen.values()];
  const live = candidates.filter((c) => c.exists);

  // Rank by what is actually in the folder, not by where the path came from. (Like Rust's max_by_key, a tie
  // goes to the later candidate.)
  let best = null;
  for (const c of live) {
    if (!best || c.textureFiles > best.textureFiles
      || (c.textureFiles === best.textureFiles && c.carFolders >= best.carFolders)) best = c;
  }
  const chosen = best ? best.path : null;

  const ambiguous = live.length > 1;
  const notes = [];
  if (ambiguous) {
    notes.push('More than one iRacing paint folder exists on this machine. OneDrive redirects Documents, and '
      + 'the sim can read one folder while you edit the other. Check the path below is the one the sim uses.');
  }
  if (live.length === 0) {
    notes.push('No iRacing paint folder found. Set it by hand if the sim keeps its files somewhere unusual.');
  }
  return { candidates, chosen, ambiguous, notes };
}

module.exports = { detect, expandEnv, parseRegQuery, documentsFromRegistry, survey, looksLikeOneDrive, REGISTRY_KEYS };
