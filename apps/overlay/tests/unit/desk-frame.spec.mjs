// The desk window shows desk.html and nothing else (modules/js/desk-frame.js): its IPC channel writes his files, so it is answered
// to the desk's own page alone. The address of a file is the desk's own whatever its query and hash; a frame that is
// anywhere else, or gone, is not the desk; and the window is held to its page — a navigation the page starts to any other address,
// a redirect, a frame's navigation and a window it opens are all stopped.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const frames = require('../../modules/js/desk-frame.js');

const DESK = path.resolve(path.join('C:', path.sep, 'Users', 'Owner', 'Documents', 'GitHub', 'racing-desk', 'apps', 'overlay', 'desk.html'));
const OWN = pathToFileURL(DESK).href;

test.describe('the desk\'s own address', () => {
  test('the file itself, whatever its query and hash, is the desk', () => {
    for (const url of [OWN, `${OWN}?host=${encodeURIComponent('http://127.0.0.1:18889')}`, `${OWN}?host=x&page=cars#cars`, `${OWN}#settings`]) {
      expect(frames.isDeskUrl(url, DESK), url).toBe(true);
    }
  });

  test('a file with spaces and other characters in its path is found by what it decodes to', () => {
    const odd = path.resolve(path.join('C:', path.sep, 'Program Files', 'Racing Desk', 'resources', 'app.asar', 'desk.html'));
    expect(frames.isDeskUrl(pathToFileURL(odd).href, odd)).toBe(true);
    expect(frames.isDeskUrl(pathToFileURL(odd).href, DESK)).toBe(false);
  });

  test('anything else is not: another file, another folder, a lookalike, another scheme, a share, no address', () => {
    const elsewhere = pathToFileURL(path.resolve(path.join('C:', path.sep, 'Users', 'Owner', 'Documents', 'evil.html'))).href;
    const sibling = pathToFileURL(path.resolve(path.join(path.dirname(DESK), 'dashboard.html'))).href;
    const lookalike = pathToFileURL(`${DESK}.html`).href;
    const parent = pathToFileURL(path.resolve(path.join(path.dirname(DESK), '..', 'desk.html'))).href;
    for (const url of [
      elsewhere, sibling, lookalike, parent, pathToFileURL(path.dirname(DESK)).href,
      'https://example.com/', 'http://127.0.0.1:8889/racing-desk/', 'about:blank', 'data:text/html,<script>1</script>', 'javascript:alert(1)',
      'blob:file:///x', 'chrome://gpu', 'file://server/share/desk.html', 'file://attacker/C:/Users/Owner/Documents/GitHub/racing-desk/apps/overlay/desk.html',
      `file://user:pass@/${OWN.slice('file:///'.length)}`, '', '   ', 'not a url', null, undefined, 42, {},
    ]) {
      expect(frames.isDeskUrl(url, DESK), String(url)).toBe(false);
    }
    expect(frames.isDeskUrl(OWN, ''), 'no desk file named').toBe(false);
    expect(frames.isDeskUrl(OWN, null)).toBe(false);
  });

  test('a path that climbs out and back in is the same file once resolved; one that does not end up there is not', () => {
    const climbed = `${pathToFileURL(path.dirname(DESK)).href}/../overlay/desk.html`;
    expect(frames.isDeskUrl(climbed, DESK)).toBe(true);
    expect(frames.isDeskUrl(`${pathToFileURL(path.dirname(DESK)).href}/../desk.html`, DESK)).toBe(false);
  });
});

test.describe('the frame that sent a message', () => {
  test('is the desk when it is at the file; not when it is elsewhere, has no address, or is gone', () => {
    expect(frames.isDeskFrame({ url: `${OWN}?host=x` }, DESK)).toBe(true);
    expect(frames.isDeskFrame({ url: 'https://example.com/' }, DESK)).toBe(false);
    expect(frames.isDeskFrame({ url: '' }, DESK)).toBe(false);
    expect(frames.isDeskFrame({}, DESK)).toBe(false);
    expect(frames.isDeskFrame({ url: 42 }, DESK)).toBe(false);
    expect(frames.isDeskFrame(null, DESK), 'senderFrame is null once the frame has navigated or been destroyed').toBe(false);
    expect(frames.isDeskFrame(undefined, DESK)).toBe(false);
  });
});

test.describe('the window is held to its page', () => {
  function window_() {
    const contents = new EventEmitter();
    contents.handler = null;
    contents.setWindowOpenHandler = (fn) => { contents.handler = fn; };
    const log = [];
    frames.guardWindow(contents, DESK, { log: (line) => log.push(line) });
    // What Electron does: a listener may stop the navigation, and the listener gets the details first.
    const go = (event, url, extra = {}) => {
      const details = { url, prevented: false, preventDefault() { this.prevented = true; }, ...extra };
      contents.emit(event, details, url);
      return details;
    };
    return { contents, log, go };
  }

  test('a navigation to the desk\'s own file goes on; to anything else it is stopped, and said in the log without its query', () => {
    const w = window_();
    expect(w.go('will-navigate', `${OWN}?host=x&page=cars`).prevented).toBe(false);
    expect(w.go('will-navigate', OWN).prevented).toBe(false);
    const away = w.go('will-navigate', 'https://example.com/login?token=secret');
    expect(away.prevented).toBe(true);
    expect(w.log).toHaveLength(1);
    expect(w.log[0]).toContain('https://example.com/login');
    expect(w.log[0]).not.toContain('secret');
    expect(w.log[0]).toMatch(/a navigation to .* was stopped: the desk window shows its own page and no other/);
  });

  test('so are a frame\'s navigation and a redirect', () => {
    const w = window_();
    for (const event of ['will-frame-navigate', 'will-redirect', 'will-navigate']) {
      expect(w.go(event, 'file:///C:/Windows/System32/calc.exe').prevented, event).toBe(true);
      expect(w.go(event, 'data:text/html,<h1>x</h1>').prevented, event).toBe(true);
      expect(w.go(event, OWN).prevented, event).toBe(false);
    }
    expect(w.log).toHaveLength(6);
  });

  test('the old positional url of will-navigate is read when the details do not carry one', () => {
    const w = window_();
    const details = { prevented: false, preventDefault() { this.prevented = true; } };
    w.contents.emit('will-navigate', details, 'https://example.com/');
    expect(details.prevented).toBe(true);
  });

  test('a window the page opens is refused, whatever it asks for', () => {
    const w = window_();
    expect(w.contents.handler({ url: 'https://example.com/', frameName: '', features: '', disposition: 'foreground-tab' })).toEqual({ action: 'deny' });
    expect(w.contents.handler({ url: OWN })).toEqual({ action: 'deny' });
    expect(w.contents.handler(undefined)).toEqual({ action: 'deny' });
    expect(w.log).toHaveLength(3);
    expect(w.log[0]).toContain('a new window to https://example.com/ was refused');
  });
});
