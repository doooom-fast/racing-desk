// Trading Paints: what it is about to do to your paint folder. Ported from apps/paints/src-tauri/src/tradingpaints.rs.
//
// "Is TradingPaintsDownloader.exe running" is the weaker half of the question. The downloader keeps its settings
// in %APPDATA%\TradingPaints Downloader\config.xml, and the ones that decide whether your work survives are:
//
//   * Download my schemes — the "Update My Own Paints" switch. On, and the downloader pulls your paints from the
//     website over the top of the local files you just applied.
//   * Keep my paints synced from website — the same failure on a timer.
//   * Delete schemes before downloading / once session ends — both can take your applied files with them.
//
// The same file carries User ID, the customer id straight from the horse's mouth. It is returned to the caller
// (customer.js treats it as certain) and never written to any log from here — nothing in this module logs.
const fs = require('fs');
const path = require('path');
const processMod = require('./process');

const DOWNLOADER_EXE = 'TradingPaintsDownloader.exe';

// Setting names as the downloader spells them in its config file.
const KEY_USER_ID = 'User ID';
const KEY_DOWNLOAD_MINE = 'Download my schemes';
const KEY_DELETE_BEFORE = 'Delete schemes before downloading';
const KEY_DELETE_AFTER = 'Delete schemes once session ends';
const KEY_KEEP_SYNCED = 'Keep my paints synced from website';

function configPath(env = process.env) {
  const appdata = env.APPDATA;
  if (typeof appdata !== 'string' || !appdata.length) return null;
  return path.join(appdata, 'TradingPaints Downloader', 'config.xml');
}

// Consume up to and including the next <tag>…</tag> from the cursor, returning its contents or null.
function takeTag(cursor, tag) {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const at = cursor.rest.indexOf(open);
  if (at < 0) return null;
  const start = at + open.length;
  const endRel = cursor.rest.slice(start).indexOf(close);
  if (endRel < 0) return null;
  const value = cursor.rest.slice(start, start + endRel);
  cursor.rest = cursor.rest.slice(start + endRel + close.length);
  return value;
}

// Pull <configname>/<configvalue> pairs out of the downloader's config. The file is small, flat and
// machine-written, so a scan beats a dependency. Anything that does not match the expected shape is skipped
// rather than guessed at.
function parseConfig(xml) {
  // The downloader writes a UTF-8 BOM; left in place it becomes part of the first tag.
  const cursor = { rest: String(xml).replace(/^﻿+/, '') };
  const out = new Map();
  for (;;) {
    const name = takeTag(cursor, 'configname');
    if (name === null) break;
    const value = takeTag(cursor, 'configvalue');
    // A name with no value following it means the file is truncated; stop rather than pairing this name with
    // some later option's value.
    if (value === null) break;
    out.set(name.trim(), value.trim());
  }
  return out;
}

function asBool(map, key) {
  const v = map.get(key);
  if (v === undefined) return null;
  switch (v.trim().toLowerCase()) {
    case 'true': case '1': case 'yes': return true;
    case 'false': case '0': case 'no': return false;
    default: return null;
  }
}

function userIdOf(map) {
  const v = map.get(KEY_USER_ID);
  if (v === undefined) return null;
  const t = v.trim();
  return t.length && /^[0-9]+$/.test(t) ? t : null;
}

// True when something about the current setup can undo an apply.
function isRisky(tp) {
  return tp.warnings.length > 0;
}

// Read the downloader's settings and check whether it is running. `env` points at APPDATA; `isRunning` is the
// process check — both injectable so tests use a fake config.xml in a temp folder and start nothing.
async function inspect({ env = process.env, isRunning = (exe) => processMod.isRunning(exe) } = {}) {
  const cfg = configPath(env);
  let text = null;
  if (cfg) {
    try { text = fs.readFileSync(cfg, 'utf8'); } catch (e) { text = null; }
  }
  const map = text === null ? new Map() : parseConfig(text);

  const userId = userIdOf(map);
  const downloadMySchemes = asBool(map, KEY_DOWNLOAD_MINE);
  const deleteBeforeDownloading = asBool(map, KEY_DELETE_BEFORE);
  const deleteAfterSession = asBool(map, KEY_DELETE_AFTER);
  const keepSynced = asBool(map, KEY_KEEP_SYNCED);
  const running = Boolean(await isRunning(DOWNLOADER_EXE));

  const warnings = [];
  if (downloadMySchemes === true) {
    warnings.push('Trading Paints has "Download my schemes" switched on. It will pull your paints from the website '
      + 'over the top of whatever this app installs.');
  }
  if (keepSynced === true) {
    warnings.push('Trading Paints is set to keep your paints synced from the website, which can replace a local '
      + 'paint after it is applied.');
  }
  if (deleteBeforeDownloading === true && running) {
    warnings.push('Trading Paints deletes paints before downloading, and the downloader is running now. Applied '
      + 'files can disappear when the next session starts.');
  }
  if (deleteAfterSession === true) {
    warnings.push('Trading Paints deletes downloaded paints when a session ends. Your own applied files are named '
      + 'the same way and can be caught by this.');
  }
  if (running && warnings.length === 0) {
    warnings.push('The Trading Paints downloader is running. Its settings look safe, but it has the paint folder '
      + 'open.');
  }

  return {
    configFound: map.size > 0,
    configPath: cfg,
    running,
    userId,
    downloadMySchemes,
    deleteBeforeDownloading,
    deleteAfterSession,
    keepSynced,
    warnings,
  };
}

module.exports = {
  DOWNLOADER_EXE, KEY_USER_ID, KEY_DOWNLOAD_MINE, KEY_DELETE_BEFORE, KEY_DELETE_AFTER, KEY_KEEP_SYNCED,
  configPath, parseConfig, asBool, isRisky, inspect,
};
