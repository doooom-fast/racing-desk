// What is in the sim's folder for one car right now, and which library version it is. Ported from
// apps/paints/src-tauri/src/installed.rs.
//
// "Which version is applied" is answered by hashing, not by remembering what the app last did: a file can change
// under the app at any time — Trading Paints, a manual copy, the design pipeline writing straight into the sim —
// and a remembered answer would be a lie.
const fs = require('fs');
const path = require('path');
const digest = require('./digest');
const roles = require('./roles');

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The Windows read-only attribute, as Node reports it: every write bit cleared.
function isReadOnly(mode) {
  return (mode & 0o222) === 0;
}

function emptyState(simFolder, folderExists) {
  return {
    simFolder,
    folderExists,
    files: [],
    cooked: [],
    cookedOtherDrivers: 0,
    appliedVersionId: null,
    matchKind: 'none',
    anyReadOnly: false,
  };
}

// Read every car*_<id>.* file in the sim's folder for one car.
function read(paintDir, simFolder, customerId) {
  if (simFolder == null) return emptyState(null, false);
  const dir = path.join(paintDir, simFolder);
  let entries;
  try {
    const st = fs.statSync(dir);
    if (!st.isDirectory()) return emptyState(simFolder, false);
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (e && e.code === 'ENOENT') return emptyState(simFolder, false);
    throw e;
  }

  const files = [];
  const cooked = [];
  let cookedOtherDrivers = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parsed = roles.parseInstalled(entry.name);
    if (!parsed) continue;
    const filePath = path.join(dir, entry.name);

    if (parsed.ext === roles.COOKED_EXT) {
      if (parsed.id === customerId) cooked.push(filePath);
      else cookedOtherDrivers += 1;
      continue;
    }
    if (parsed.id !== customerId) continue;

    const md = fs.statSync(filePath);
    files.push({
      role: parsed.role,
      roleLabel: roles.roleLabel(parsed.role),
      fileName: entry.name,
      path: filePath,
      size: md.size,
      sha256: digest.fileSha256(filePath),
      readOnly: isReadOnly(md.mode),
    });
  }

  files.sort((a, b) => cmp(a.fileName, b.fileName));
  cooked.sort(cmp);

  return {
    simFolder,
    folderExists: true,
    files,
    cooked,
    cookedOtherDrivers,
    appliedVersionId: null,
    matchKind: 'none',
    anyReadOnly: files.some((f) => f.readOnly),
  };
}

function hashOf(files, role) {
  const f = files.find((x) => x.role === role);
  return f ? f.sha256 : null;
}

// Compare what is installed against each version and mark the one that is live. Mutates `state` and returns
// it. Exact beats paint-only, and the first exact match wins. Two versions with identical bytes are genuinely
// indistinguishable on disk, so picking either is honest.
function identify(state, versions) {
  let best = null;

  for (const version of versions) {
    if (!version.files.length) continue;
    const allMatch = version.files.every((vf) => hashOf(state.files, vf.role) === vf.sha256);
    // Extra car textures installed that this version does not carry mean the folder holds something this version
    // did not put there.
    const noExtras = state.files.every((inst) => version.files.some((vf) => vf.role === inst.role));

    let kind;
    if (allMatch && noExtras) {
      kind = 'exact';
    } else {
      const paint = version.files.find((vf) => vf.role === 'car');
      const paintMatches = paint ? hashOf(state.files, 'car') === paint.sha256 : false;
      kind = paintMatches ? 'paint-only' : 'none';
    }

    if (kind === 'exact') {
      best = { version, kind };
      break;
    }
    if (kind === 'paint-only' && !best) best = { version, kind };
  }

  if (best) {
    state.appliedVersionId = best.version.id;
    state.matchKind = best.kind;
  } else {
    state.appliedVersionId = null;
    state.matchKind = 'none';
  }
  return state;
}

module.exports = { read, identify, isReadOnly };
