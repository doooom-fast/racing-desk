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
    expect(code).toMatch(/'CommandOrControl\+Shift\+H':\s*\(\)\s*=>\s*\{\s*dispatchAction\('toggle-overlay'\);\s*\},/);
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

test.describe('quitting', () => {
  test('the overlay is quit by putting the HUD away: the key, the Stream Deck and the remote all go through the one action', () => {
    expect(code).toMatch(/'quit':\s*\(\)\s*=>\s*hud\.putAway\(\)\s*,/);
    expect(code).toMatch(/'CommandOrControl\+Shift\+Q':\s*\(\)\s*=>\s*\{\s*dispatchAction\('quit'\);\s*\},/);
    expect(calls(/\bhud\.putAway\(\)/g)).toHaveLength(1);
    expect(calls(/dispatchAction\(\s*'quit'\s*\)/g)).toHaveLength(1);
  });

  test('the app is quit from the tray and by closing the desk, and by nothing a page or a key can ask for', () => {
    const quits = code.split('\n').filter((line) => /\bapp\.quit\(\)/.test(line)).map((line) => line.trim());
    expect(quits).toEqual([
      'if (!isFirstInstance) app.quit();',                                  // a second copy, which hands over to the first
      "deskWindow.on('close', () => { if (!quitting) app.quit(); });",
      "{ label: 'Quit Racing Desk', click: () => app.quit() },",
      'app.quit();',                                                        // the HUD's window could not be made
      'app.quit();',                                                        // every window closed
    ]);
    expect(code).toMatch(/catch \(err\) \{\s*logToFile\(`\[RacingDesk\] FATAL: createOverlay\(\) threw[^\n]*\n\s*app\.quit\(\);/);
    expect(code).toMatch(/app\.on\('window-all-closed', \(\) => \{\s*app\.quit\(\);\s*\}\);/);
    expect(code).not.toMatch(/quit-app/);
    const preload = readFileSync(new URL('../../preload.js', import.meta.url), 'utf8');
    expect(preload).not.toMatch(/quit/i);
  });
});

test.describe('the keys', () => {
  // A key registered here is taken from every other program on the machine for as long as it is.
  test('the app holds one for as long as it runs: the desk', () => {
    const held = calls(/globalShortcut\.register\(\s*'([^']+)'/g).map((call) => call.match(/'([^']+)'/)[1]);
    expect(held).toEqual(['CommandOrControl+Shift+O']);
  });

  test("the HUD's are held while he is in the car, which hud-visibility says", () => {
    const keys = code.match(/const HUD_KEYS = \{([\s\S]*?)\n\};/);
    expect(keys).not.toBeNull();
    const named = [...keys[1].matchAll(/^  '(CommandOrControl\+Shift\+\w)':/gm)].map((m) => m[1].slice(-1));
    // Q among them: in a browser Ctrl+Shift+Q closes every window it has.
    expect(named.sort().join('')).toBe('BDFGHIMPQRV');
    expect(named).not.toContain('O');

    const made = argumentsOf('createHudKeys(');
    expect(made).toMatch(/\bkeys:\s*HUD_KEYS\s*,/);
    expect(made).toMatch(/register:\s*\(key,\s*act\)\s*=>\s*globalShortcut\.register\(key,\s*act\)/);
    expect(made).toMatch(/unregister:\s*\(key\)\s*=>\s*globalShortcut\.unregister\(key\)/);
    expect(argumentsOf('hudVisibility.createHudVisibility(')).toMatch(/\bonInCar:\s*\(inCar\)\s*=>\s*hudKeys\.hold\(inCar\)\s*,/);
    // Held by nothing else, but dev mode, whose window is always there.
    expect(calls(/hudKeys\.hold\([^)]*\)/g).sort()).toEqual(['hudKeys.hold(inCar)', 'hudKeys.hold(true)']);
    expect(code).toMatch(/if \(isDev\) hudKeys\.hold\(true\);/);
  });
});

test.describe('the page', () => {
  test('what becomes of it is said to hud-visibility, and nothing else decides to load it again after a crash', () => {
    expect(code).toMatch(/'did-start-navigation',\s*\(details\)\s*=>\s*\{\s*if\s*\(details\.isMainFrame\s*&&\s*!details\.isSameDocument\)\s*hud\.pageLoading\(\);/);
    expect(code).toMatch(/'did-finish-load',\s*\(\)\s*=>\s*\{\s*hud\.pageLoaded\(\);\s*\}/);
    // A load given up for a newer one (-3), or a frame within the page, is not the page having failed: said so,
    // the load that is under way would be taken for over, and another begun on top of it.
    const failed = code.match(/'did-fail-load',\s*\(_event,\s*errorCode,\s*errorDescription,\s*_url,\s*isMainFrame\)\s*=>\s*\{([\s\S]*?)\n  \}\);/);
    expect(failed).not.toBeNull();
    expect(failed[1]).toMatch(/^\s*if\s*\(!isMainFrame\s*\|\|\s*errorCode\s*===\s*-3\)\s*return;[\s\S]*hud\.pageFailed\(\);/);
    // A page that hangs has its process ended, and is loaded again as one that died is.
    const hung = code.match(/'unresponsive',\s*\(\)\s*=>\s*\{([\s\S]*?)\n  \}\);/);
    expect(hung).not.toBeNull();
    expect(hung[1]).toMatch(/overlayWindow\.webContents\.forcefullyCrashRenderer\(\)/);
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

test.describe('the screen', () => {
  // The HUD was put on the primary screen, whichever screen the sim was on. hud-display.js chooses (its own spec holds the
  // rule); what is held here is that main.js leaves the placing to it: no window of the HUD is moved from anywhere else.
  test('the HUD is placed by hud-display and by nothing in main.js: no setBounds, no other way to move a window', () => {
    expect(code).not.toMatch(/\.\s*(setBounds|setPosition|setSize|setContentBounds|center)\s*\(/);
    expect(code).not.toMatch(/\bmaximize\s*\(|\bsetFullScreen\s*\(/);
  });

  test("no primary screen is looked at but to say which screen is the primary one: its id, and nothing of its bounds", () => {
    const uses = calls(/getPrimaryDisplay\s*\(\s*\)[^\n;]*/g);
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatch(/^getPrimaryDisplay\(\)\.id\b/);
    expect(code).not.toMatch(/\.getPrimaryDisplay\(\)\s*\.\s*(bounds|workArea|size|workAreaSize)/);
    // Where it is: in the function that lists the screens for hud-display, and that gives it no bounds of the primary's own.
    const listing = code.match(/function connectedDisplays\(\)\s*\{([\s\S]*?)\n\}/);
    expect(listing).not.toBeNull();
    expect(listing[1]).toMatch(/getPrimaryDisplay\(\)\.id/);
    expect(listing[1]).toMatch(/primary:\s*d\.id\s*===\s*primaryId/);
  });

  test('the window is made where hud-display says, hidden all the same', () => {
    expect(code).toMatch(/const startAt = hudScreen\.initialBounds\(\) \|\| \{\};/);
    const options = argumentsOf('overlayWindow = new BrowserWindow(');
    expect(options).toMatch(/\bx:\s*startAt\.x\b/);
    expect(options).toMatch(/\by:\s*startAt\.y\b/);
    expect(options).toMatch(/\bwidth:\s*startAt\.width\b/);
    expect(options).toMatch(/\bheight:\s*startAt\.height\b/);
    expect(options).not.toMatch(/primary|screen\./i);
    // Made on the wrong scale it can come out at the wrong size, so it is looked at once it is there.
    expect(code).toMatch(/overlayWindow\.setAlwaysOnTop\(true, 'screen-saver'\);\s*(?:\/\/[^\n]*\n\s*)?hudScreen\.place\(\);/);
  });

  test('hud-display is given the window by a function, and the screens, the ini and the host by the ones the app has', () => {
    const made = argumentsOf('hudDisplay.createHudDisplay(');
    expect(made).toMatch(/\bgetWindow:\s*\(\)\s*=>\s*overlayWindow\s*,/);
    expect(made).toMatch(/\bgetDisplays:\s*connectedDisplays\s*,/);
    expect(made).toMatch(/\bgetChoice:\s*\(\)\s*=>\s*loadSettingsSync\(\)\.hudDisplay\s*,/);
    expect(made).toMatch(/\breadIni:\s*\(\)\s*=>\s*hudDisplay\.readSimIni\(app\.getPath\('documents'\)\)\s*,/);
    // The sim's window is asked of the app's own host, on the address the desk uses for it, and never waited for long.
    expect(made).toMatch(/\baskSimWindow:\s*\(\)\s*=>\s*hudDisplay\.fetchSimWindow\(`\$\{localHostUrl\(\)\}\$\{hudDisplay\.SIM_WINDOW_PATH\}`\)\s*,/);
    expect(made).toMatch(/\btoDipRect:\s*\(rect\)\s*=>\s*screen\.screenToDipRect\(null,\s*rect\)\s*,/);
    // Dev mode's window is dev-mode.js's.
    expect(made).toMatch(/\bkeepAsIs:\s*isDev\s*,/);
    expect(hudDisplay_calls()).toEqual(['hudDisplay.createHudDisplay(', 'hudDisplay.readSimIni(', 'hudDisplay.fetchSimWindow(']);
  });

  test('he gets in: hud-visibility has the window put right before it is revealed', () => {
    expect(argumentsOf('hudVisibility.createHudVisibility(')).toMatch(/\bbeforeReveal:\s*\(\)\s*=>\s*hudScreen\.refresh\(\)\s*,/);
    // Asked here, when a screen is added or removed (one helper), and when one changes: nowhere else.
    expect(calls(/hudScreen\.refresh\(\)/g)).toHaveLength(3);
  });

  test('a screen added, removed or changed — any screen — is asked about again', () => {
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
      expect(code, event).toMatch(new RegExp(String.raw`screen\.on\('${event}',`));
    }
    const changed = code.match(/screen\.on\('display-metrics-changed',\s*\(\)\s*=>\s*\{([\s\S]*?)\n  \}\);/);
    expect(changed).not.toBeNull();
    expect(changed[1]).toMatch(/hudScreen\.refresh\(\);/);
    // Not only the primary's: the handler no longer looks at which screen it was.
    expect(changed[1]).not.toMatch(/primary|display\.id|changedMetrics/);
    const helper = code.match(/const screensChanged = \(why\) => \(\) => \{([\s\S]*?)\n  \};/);
    expect(helper).not.toBeNull();
    expect(helper[1]).toMatch(/hudScreen\.refresh\(\);/);
    expect(code).toMatch(/screen\.on\('display-added',\s*screensChanged\(/);
    expect(code).toMatch(/screen\.on\('display-removed',\s*screensChanged\(/);
  });

  test('Ctrl+Shift+R and the Stream Deck put it back where the rule says, through one action', () => {
    expect(code).toMatch(/'CommandOrControl\+Shift\+R':\s*\(\)\s*=>\s*\{\s*dispatchAction\('reset-window'\);\s*\},/);
    const reset = code.match(/'reset-window':\s*\(\)\s*=>\s*\{([\s\S]*?)\n  \},/);
    expect(reset).not.toBeNull();
    expect(reset[1]).toMatch(/hudScreen\.reset\(\);/);
    expect(reset[1]).toMatch(/return \{ ok: true \};/);
    expect(calls(/dispatchAction\(\s*'reset-window'\s*\)/g)).toHaveLength(1);
  });

  test("a screen chosen in Settings applies when the settings are saved, and the desk is told the screens", () => {
    const save = code.match(/ipcMain\.handle\('save-settings'[\s\S]*?\n\}\);/);
    expect(save).not.toBeNull();
    expect(save[0]).toMatch(/await hudScreen\.settingsChanged\(\);\s*return true;/);
    expect(code).toMatch(/ipcMain\.handle\('get-hud-displays',\s*async\s*\(\)\s*=>\s*hudScreen\.describe\(\)\);/);
    const watcher = code.match(/function startSettingsWatcher\(\)\s*\{([\s\S]*?)\n\}/);
    expect(watcher).not.toBeNull();
    expect(watcher[1]).toMatch(/hudScreen\.settingsChanged\(\);/);
  });

  test("hud-display.js moves the window and never shows, hides or focuses it: that is hud-visibility's alone", () => {
    const module = readFileSync(new URL('../../modules/js/hud-display.js', import.meta.url), 'utf8')
      .replace(/\r\n/g, '\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');
    expect(module).toMatch(/\bwin\.setBounds\(/);
    expect(module).not.toMatch(/\.\s*(show|showInactive|hide|focus|blur|restore|minimize|maximize|moveTop|setAlwaysOnTop|setVisibleOnAllWorkspaces)\s*\(/);
    expect(module).not.toMatch(/getPrimaryDisplay|require\(['"]electron['"]\)/);
  });
});

// The calls main.js makes on the hud-display module, in the order they are first made.
function hudDisplay_calls() {
  return [...new Set([...code.matchAll(/hudDisplay\.\w+\(/g)].map((m) => m[0]))];
}

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
