// Installing the Stream Deck plugin: the .sdPlugin folder the app carries is copied into the Stream Deck app's
// plugin folder at every start, when it is not there or is not the one the app carries. The install failed at every
// start until 2026-09-30 with ENOENT on opendir: the folder was copied from inside app.asar, whose layer does not
// serve the directory walk a copy needs, and the plugin's bin/plugin.js is build output that was never in git, so a
// fresh checkout had none either. Now the folder is unpacked from the asar (electron-builder.yml asarUnpack), built
// by npm run build (streamdeck/build.mjs), and copied from app.asar.unpacked. No Electron here; the file system and
// the paths are handed in, so the tests run it over temp folders.
const path = require('path');
const fs = require('fs');

const PLUGIN_DIR = 'com.doooom.racingdesk.sdPlugin';
const OLD_PLUGIN_DIRS = Object.freeze(['com.k10motorsports.racecor.overlay.sdPlugin']);

/** The folder the plugin lives in beside main.js — in the built app, the unpacked copy beside the asar. */
function pluginSource(appDir) {
  const unpacked = String(appDir).replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked');
  return path.join(unpacked, 'streamdeck', 'racing-desk', PLUGIN_DIR);
}

/** Where the Stream Deck app keeps its plugins, or null on a platform without one. */
function pluginsDir({ platform = process.platform, env = process.env, home = require('os').homedir() } = {}) {
  if (platform === 'win32') return env.APPDATA ? path.join(env.APPDATA, 'Elgato', 'StreamDeck', 'Plugins') : null;
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'com.elgato.StreamDeck', 'Plugins');
  return null;
}

function readJson(fsModule, file) {
  try { return JSON.parse(String(fsModule.readFileSync(file, 'utf8')).replace(/^﻿/, '')); } catch (e) { return null; }
}

function sizeOf(fsModule, file) {
  try { return fsModule.statSync(file).size; } catch (e) { return -1; }
}

/**
 * install({ srcDir, pluginsDir, fs, log }) → { ok, did: 'copied' | 'kept' | 'skipped', reason }
 * The old plugin's folder is removed (Stream Deck would show both). The copy is made when the installed one is
 * missing, or differs from the app's in manifest version or in the size of bin/plugin.js; a plugin the Stream Deck
 * app holds open may refuse the copy, which is said and tried again at the next start.
 */
function install({ srcDir, pluginsDir: dir, fs: fsModule = fs, log = () => {}, oldDirs = OLD_PLUGIN_DIRS } = {}) {
  if (!dir) return { ok: false, did: 'skipped', reason: 'no Stream Deck plugin folder on this platform' };
  if (!fsModule.existsSync(dir)) return { ok: false, did: 'skipped', reason: `the Stream Deck app is not installed (no ${dir})` };
  for (const name of oldDirs) {
    const old = path.join(dir, name);
    if (!fsModule.existsSync(old)) continue;
    try {
      fsModule.rmSync(old, { recursive: true, force: true });
      log(`[RacingDesk] Stream Deck: removed the old plugin at ${old}`);
    } catch (err) {
      log(`[RacingDesk] Stream Deck: the old plugin at ${old} could not be removed: ${err.message}`);
    }
  }
  const srcManifest = path.join(srcDir, 'manifest.json');
  const srcCode = path.join(srcDir, 'bin', 'plugin.js');
  if (!fsModule.existsSync(srcManifest)) return { ok: false, did: 'skipped', reason: `the plugin is not in the app at ${srcDir}` };
  if (!fsModule.existsSync(srcCode)) return { ok: false, did: 'skipped', reason: `the plugin was not built (no ${srcCode}); npm run build builds it` };
  const installed = path.join(dir, PLUGIN_DIR);
  const have = readJson(fsModule, path.join(installed, 'manifest.json'));
  const want = readJson(fsModule, srcManifest);
  const same = have && want && have.Version === want.Version && sizeOf(fsModule, path.join(installed, 'bin', 'plugin.js')) === sizeOf(fsModule, srcCode);
  if (same) return { ok: true, did: 'kept', reason: `the plugin at ${installed} is the one the app carries` };
  try {
    fsModule.cpSync(srcDir, installed, { recursive: true, force: true });
    log(`[RacingDesk] Stream Deck: plugin copied to ${installed}`);
    return { ok: true, did: 'copied', reason: `copied to ${installed}` };
  } catch (err) {
    return { ok: false, did: 'skipped', reason: `the plugin could not be copied to ${installed}: ${err.message}` };
  }
}

module.exports = { PLUGIN_DIR, OLD_PLUGIN_DIRS, pluginSource, pluginsDir, install };
