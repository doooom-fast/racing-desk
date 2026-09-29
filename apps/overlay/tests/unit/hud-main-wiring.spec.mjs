/**
 * main.js, held to the rules the HUD's window is kept by. The rules themselves are tested where they are written
 * (hud-visibility.spec.mjs); what nothing tested is that main.js leaves them to it. main.js cannot be run here —
 * it is the Electron app, and starting it puts windows on the rig's screen — so it is read, as text, with its
 * comments taken out.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../main.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\s)\/\/.*$/gm, '$1');

// What is left of a call's arguments after the text that opens it, up to the bracket that closes the call.
function argumentsOf(opening) {
  const at = code.indexOf(opening);
  expect(at, `main.js has ${opening}`).toBeGreaterThanOrEqual(0);
  expect(code.indexOf(opening, at + 1), `main.js has ${opening} once`).toBe(-1);
  let depth = 0;
  for (let i = code.indexOf('(', at); i < code.length; i++) {
    if (code[i] === '(') depth++;
    if (code[i] === ')' && --depth === 0) return code.slice(at + opening.length, i);
  }
  throw new Error(`${opening} is never closed`);
}

const calls = (pattern) => [...code.matchAll(pattern)].map((m) => m[0]);

test.describe('the window', () => {
  test('is made hidden', () => {
    const options = argumentsOf('overlayWindow = new BrowserWindow(');
    expect(options).toMatch(/\bshow:\s*false\b/);
    expect(options).not.toMatch(/\bshow:\s*true\b/);
    expect(options).toMatch(/\bfocusable:\s*false\b/);
  });

  test('is shown and hidden by nothing in main.js: every show() and hide() in it is the desk window\'s', () => {
    const onTheHud = calls(/\boverlayWindow\s*\??\.\s*(show|showInactive|hide|focus|restore|minimize|maximize|moveTop)\s*\(/g);
    expect(onTheHud).toEqual([]);
    const shownOrHidden = [...code.matchAll(/([\w.]+?)\s*\??\.\s*(show|showInactive|hide)\s*\(/g)].map((m) => m[1]);
    expect(shownOrHidden.length).toBeGreaterThan(0);
    expect(shownOrHidden.filter((whose) => whose !== 'deskWindow')).toEqual([]);
  });

  test('is handed to hud-visibility, and to dev-mode.js in dev mode, and to nothing else', () => {
    expect(argumentsOf('hudVisibility.createHudVisibility(')).toMatch(/\bgetWindow:\s*\(\)\s*=>\s*overlayWindow\s*,/);
    // As an argument, or under another name.
    const handedOn = calls(/[\w.]+\(\s*(?:[^()]*,\s*)?overlayWindow\s*[,)]/g);
    expect(handedOn).toHaveLength(1);
    expect(handedOn[0]).toMatch(/^devMode\.attach\(overlayWindow,/);
    expect(calls(/(?:const|let|var)\s+\w+\s*=\s*overlayWindow\s*(?:[;,]|$)/gm)).toEqual([]);
  });
});

test.describe('the switch', () => {
  test('Ctrl+Shift+H and the Stream Deck go through hud.toggle as it is in the car only', () => {
    expect(code).toMatch(/'toggle-overlay':\s*\(\)\s*=>\s*hud\.toggle\(\)\s*,/);
    const key = argumentsOf("globalShortcut.register('CommandOrControl+Shift+H',");
    expect(key.replace(/\s+/g, ' ').trim()).toBe("() => { dispatchAction('toggle-overlay'); }");
  });

  test("the tray's goes through hud.toggle as it is anywhere, and ticks itself", () => {
    const item = code.split('\n').filter((line) => /id:\s*'hud'/.test(line));
    expect(item).toHaveLength(1);
    expect(item[0]).toMatch(/type:\s*'checkbox'/);
    expect(item[0]).toMatch(/click:\s*\(\)\s*=>\s*\{\s*hud\.toggle\(\{\s*anywhere:\s*true\s*\}\);\s*tickHudSwitch\(\);\s*\}/);
  });

  test('and there is no third way', () => {
    expect(calls(/\bhud\.toggle\([^)]*\)/g).sort()).toEqual(['hud.toggle()', 'hud.toggle({ anywhere: true })']);
    expect(calls(/dispatchAction\(\s*'toggle-overlay'\s*\)/g)).toHaveLength(1);
  });
});

test.describe('the page', () => {
  test('what becomes of it is said to hud-visibility, and nothing else decides to load it again after a crash', () => {
    expect(code).toMatch(/'did-start-navigation',\s*\(details\)\s*=>\s*\{\s*if\s*\(details\.isMainFrame\s*&&\s*!details\.isSameDocument\)\s*hud\.pageLoading\(\);/);
    expect(code).toMatch(/'did-finish-load',\s*\(\)\s*=>\s*\{\s*hud\.pageLoaded\(\);\s*\}/);
    expect(code).toMatch(/'did-fail-load'[\s\S]{0,300}?hud\.pageFailed\(\);/);
    const gone = code.match(/'render-process-gone',\s*\(_event,\s*details\)\s*=>\s*\{([\s\S]*?)\n  \}\);/);
    expect(gone).not.toBeNull();
    expect(gone[1]).toMatch(/hud\.pageGone\(details\.reason\);/);
    expect(gone[1]).not.toMatch(/loadDashboard|setTimeout|details\.reason\s*[!=]==/);
    expect(argumentsOf('hudVisibility.createHudVisibility(')).toMatch(/\bloadPage:\s*\(\)\s*=>\s*loadDashboard\(\)\s*,/);
  });

  test('every load says it has begun, before it begins', () => {
    const load = code.match(/function loadDashboard\(\)\s*\{([\s\S]*?)\n\}/);
    expect(load).not.toBeNull();
    expect(load[1].indexOf('hud.pageLoading()')).toBeGreaterThanOrEqual(0);
    expect(load[1].indexOf('hud.pageLoading()')).toBeLessThan(load[1].indexOf('overlayWindow.loadFile('));
    // And the page is loaded from nowhere else.
    expect(calls(/overlayWindow\s*\??\.\s*(?:webContents\s*\??\.\s*)?(loadFile|loadURL|reload|reloadIgnoringCache)\s*\(/g)).toHaveLength(1);
  });
});

test.describe('the log', () => {
  test('is app-log.js\'s, which knows the built app from the source', () => {
    expect(argumentsOf('appLog.createLog(')).toMatch(/appLog\.logPath\(\{\s*isPackaged:\s*app\.isPackaged,\s*appDir:\s*__dirname\s*\}\)/);
    const logToFile = code.match(/function logToFile\(msg\)\s*\{([\s\S]*?)\n\}/);
    expect(logToFile).not.toBeNull();
    expect(logToFile[1]).toMatch(/appLogFile\.write\(msg\);/);
    // Nothing is written beside main.js by name any more.
    expect(code).not.toMatch(/racing-desk-debug\.log/);
  });
});
