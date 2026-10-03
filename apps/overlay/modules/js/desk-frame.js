// Which page is the desk: desk.html, a file of this app, and nothing else. The desk window's IPC channel writes his files (his
// paints, a car's pedals, undo of what Racing Desk changed), so it is answered to the desk's own page and to no other — whatever
// is loaded into the window.
//
// Two things hold it to that (main.js):
//   - the window cannot be taken anywhere else: a navigation the page starts (a link, window.location, a redirect, a frame) to
//     anything but the desk's own file is stopped, and a window it opens is refused (guardWindow);
//   - a message is answered only when the frame that sent it is at that file (isDeskFrame, in main.js's fromDesk), because the
//     window's webContents is the same webContents whatever it is showing.
// The query and the hash of the desk's own address change (desk.html?host=…&page=…#cars) and are not looked at.
//
// Pure: no Electron in it, so the unit tests run it.
const path = require('path');
const { fileURLToPath } = require('url');

function samePath(a, b) {
  const x = path.resolve(a);
  const y = path.resolve(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/**
 * Whether `url` is the desk's own file: a file: address with no host, user or password, whose path is `deskHtml`.
 * Anything else — another file, another folder, a network share, https:, data:, about:blank, javascript: — is not.
 */
function isDeskUrl(url, deskHtml) {
  if (typeof url !== 'string' || !url || typeof deskHtml !== 'string' || !deskHtml) return false;
  let parsed;
  try { parsed = new URL(url); } catch (e) { return false; }
  if (parsed.protocol !== 'file:') return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.hostname !== '' && parsed.hostname !== 'localhost') return false;
  let file;
  try { file = fileURLToPath(parsed); } catch (e) { return false; }
  return samePath(file, deskHtml);
}

/** A frame of a message (event.senderFrame): null once it has navigated away or been destroyed, which is not the desk. */
function isDeskFrame(frame, deskHtml) {
  return !!frame && typeof frame.url === 'string' && isDeskUrl(frame.url, deskHtml);
}

// What goes in the log of an address: where it points, without its query or hash.
function shown(url) {
  return typeof url === 'string' ? url.split(/[?#]/)[0].slice(0, 160) : '(no address)';
}

/**
 * Holds a window to its own page. `contents` is its webContents; `log(line)` hears what was stopped.
 * will-navigate and will-frame-navigate are the page's own navigations (not loadFile's, which are the app's), will-redirect a
 * redirect on the way; setWindowOpenHandler decides every window the page opens, and the answer is no.
 */
function guardWindow(contents, deskHtml, { log = () => {} } = {}) {
  const refuse = (what) => (details, urlArg) => {
    const url = details && typeof details.url === 'string' ? details.url : urlArg;
    if (isDeskUrl(url, deskHtml)) return;
    if (details && typeof details.preventDefault === 'function') details.preventDefault();
    log(`[RacingDesk] Desk: ${what} to ${shown(url)} was stopped: the desk window shows its own page and no other`);
  };
  contents.on('will-navigate', refuse('a navigation'));
  contents.on('will-frame-navigate', refuse('a frame\'s navigation'));
  contents.on('will-redirect', refuse('a redirect'));
  contents.setWindowOpenHandler((details) => {
    log(`[RacingDesk] Desk: a new window to ${shown(details && details.url)} was refused: the desk window opens none`);
    return { action: 'deny' };
  });
}

module.exports = { isDeskUrl, isDeskFrame, guardWindow };
