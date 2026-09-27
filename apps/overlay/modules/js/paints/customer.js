// Working out which customer id is *yours*. Ported from apps/paints/src-tauri/src/customer.rs.
//
// The plan proposes "most frequent car_<digits>.tga wins". On a clean install that is right. On a real one it
// is not: Trading Paints fills the paint folder with every driver you have shared a session with, so the paint
// folder here holds 3,200 car textures across 85 cars and the most frequent id belongs to a stranger. The
// owner's own id appeared three times and ranked eighteenth.
//
// So detection is a cascade, strongest signal first, and every step reports how much it trusts itself. The user
// can always override.
//
//   1. Trading Paints' own config — it stores User ID. Authoritative.
//   2. A car_spec_<id>.tga on disk — the downloader delivers other drivers' spec maps pre-cooked as .mip, so a
//      spec map still in .tga form was almost certainly put there by hand.
//   3. Most frequent car_<id>.tga — the plan's heuristic, kept as a last resort.
const fs = require('fs');
const path = require('path');
const roles = require('./roles');
const tradingpaints = require('./tradingpaints');

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Tally every customer id that appears in the paint folder, best first.
function tally(paintDir) {
  const byId = new Map();
  let cars;
  try {
    cars = fs.readdirSync(paintDir, { withFileTypes: true });
  } catch (e) {
    return [];
  }
  for (const car of cars) {
    if (!car.isDirectory()) continue;
    let files;
    try {
      files = fs.readdirSync(path.join(paintDir, car.name));
    } catch (e) {
      continue;
    }
    // An id counts once per car folder however many files it has there.
    const seenHere = new Set();
    for (const name of files) {
      const parsed = roles.parseInstalled(name);
      if (!parsed) continue;
      if (parsed.ext !== roles.TEXTURE_EXT) continue;   // .mip is the sim's cache, not evidence of a source file
      let entry = byId.get(parsed.id);
      if (!entry) {
        entry = { paints: 0, specs: 0, folders: 0 };
        byId.set(parsed.id, entry);
      }
      if (parsed.role === 'car') entry.paints += 1;
      else if (parsed.role === 'car_spec') entry.specs += 1;
      seenHere.add(parsed.id);
    }
    for (const id of seenHere) byId.get(id).folders += 1;
  }

  const out = [...byId.entries()].map(([id, c]) => ({
    id, paints: c.paints, localSpecMaps: c.specs, carFolders: c.folders,
  }));
  // Hand-installed spec maps outrank raw frequency.
  out.sort((a, b) => (b.localSpecMaps - a.localSpecMaps)
    || (b.paints - a.paints)
    || (b.carFolders - a.carFolders)
    || cmp(a.id, b.id));
  return out;
}

// Run the cascade against a paint folder. `tradingPaints` is the (async) inspector, injectable so tests never
// read the real downloader config.
async function detect(paintDir, { tradingPaints = () => tradingpaints.inspect() } = {}) {
  const candidates = tally(paintDir);
  const notes = [];

  // 1. Trading Paints knows, because it has to.
  const tp = await tradingPaints();
  if (tp && tp.userId) {
    notes.push(`Trading Paints is configured for customer ${tp.userId}, which is where this came from.`);
    return { id: tp.userId, confidence: 'certain', source: 'Trading Paints downloader config', candidates, notes };
  }

  // 2. A spec map still in .tga form was installed by hand.
  const best = candidates.find((c) => c.localSpecMaps > 0);
  if (best) {
    // Only trust it if nothing else also has hand-installed spec maps.
    const contenders = candidates.filter((c) => c.localSpecMaps > 0).length;
    if (contenders === 1) {
      notes.push(`Customer ${best.id} is the only id with spec maps in .tga form. Trading Paints delivers other `
        + 'drivers\' spec maps pre-cooked as .mip, so those were installed by hand.');
      return { id: best.id, confidence: 'likely', source: 'hand-installed spec maps', candidates, notes };
    }
    notes.push(`${contenders} ids have hand-installed spec maps, so that signal did not settle it.`);
  }

  // 3. Frequency, with a health warning. (Like Rust's max_by_key, a tie goes to the later candidate.)
  let most = null;
  for (const c of candidates) if (!most || c.paints >= most.paints) most = c;
  if (most) {
    notes.push('This is the most common id in the paint folder, which is a weak signal: Trading Paints downloads '
      + 'other drivers\' paints into the same folders. Check it before applying.');
    return { id: most.id, confidence: 'guess', source: 'most frequent id in the paint folder', candidates, notes };
  }
  notes.push('No car textures found, so there was nothing to infer an id from.');
  return { id: null, confidence: null, source: null, candidates, notes };
}

// A customer id is digits and nothing else.
function isValid(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 12 && /^[0-9]+$/.test(id);
}

module.exports = { tally, detect, isValid };
