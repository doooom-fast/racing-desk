// The main process's log: where it is kept, and how it is kept from growing without end.
//
// From source it is racing-desk-debug.log beside main.js, as it always was. In the built app that place is inside
// app.asar, which cannot be written to, so every line main.js logged was lost — and the built app is the one that
// is run. There the log is overlay.log, beside the host's host.log in %LOCALAPPDATA%\Racing Desk. Past four
// megabytes the file becomes overlay.log.1, in place of the one before it, and a new one is begun: two files at
// most.
//
// A line that cannot be written is dropped. A failure to log is never a failure of the app: nothing here throws.
// No Electron in it, so the path and the turning over are tested as they are (tests/unit/hud-log.spec.mjs).
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_BYTES = 4 * 1024 * 1024;
const FROM_SOURCE = 'racing-desk-debug.log';
const BUILT = 'overlay.log';

// The folder is the host's data folder (modules/js/host-launcher.js hostLogPath, RacingDesk.Data/DataFolder.cs).
function logPath({ isPackaged, appDir, env = process.env, home = os.homedir() }) {
  if (!isPackaged) return path.join(appDir, FROM_SOURCE);
  const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  return path.join(local, 'Racing Desk', BUILT);
}

// The customer id is in the names of paint files and nowhere else, and a log is not the place for it: an error
// thrown over a paint carries the file's path, and what is thrown and not caught is logged whole.
function scrub(text) {
  return String(text)
    .replace(/_\d+(?=\.(?:tga|mip)\b)/gi, '_<id>')
    .replace(/\b(cust(?:omer)?[ _-]?id\W{0,3})\d+/gi, '$1<id>');
}

/**
 * write(message) appends "[time] message" to `file`. Its size is read once and counted from there; a line that
 * would take the file past maxBytes goes at the head of a new one.
 */
function createLog({ file, maxBytes = MAX_BYTES, now = () => new Date() }) {
  const kept = `${file}.1`;
  let size = null;      // not looked at yet
  let turnAt = maxBytes;

  function look() {
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch (e) { /* the write will say */ }
    try { return fs.statSync(file).size; } catch (e) { return 0; }
  }

  function turnOver() {
    try {
      fs.rmSync(kept, { force: true });
      fs.renameSync(file, kept);
      size = 0;
      turnAt = maxBytes;
    } catch (e) {
      // Held open by something: written on where it is, and tried again a megabyte on rather than at every line.
      turnAt = size + Math.max(1, Math.floor(maxBytes / 4));
    }
  }

  function write(message) {
    try {
      const line = `[${now().toISOString()}] ${scrub(message)}\n`;
      const bytes = Buffer.byteLength(line);
      if (size === null) size = look();
      if (size > 0 && size + bytes > turnAt) turnOver();
      fs.appendFileSync(file, line);
      size += bytes;
    } catch (e) { /* dropped */ }
  }

  return { file, write };
}

module.exports = { MAX_BYTES, logPath, scrub, createLog };
