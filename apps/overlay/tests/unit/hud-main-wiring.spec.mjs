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
      'stopOwnedRecording().finally(() => app.quit());',                    // the quit going through once the recording Racing Desk started is stopped
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
    // Q among them: in a browser Ctrl+Shift+Q closes every window it has. M is held by nothing: the track map is the
    // host's, from the driver's own laps, and there is nothing to reset.
    expect(named.sort().join('')).toBe('BDFGHIPQRV');
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
    // The screens' real sizes too: Electron's are DIPs, rounded up, and cannot be turned back into the panel's.
    expect(made).toMatch(/\baskMonitors:\s*\(\)\s*=>\s*hudDisplay\.fetchMonitors\(`\$\{localHostUrl\(\)\}\$\{hudDisplay\.MONITORS_PATH\}`\)\s*,/);
    expect(made).toMatch(/\btoDipRect:\s*\(rect\)\s*=>\s*screen\.screenToDipRect\(null,\s*rect\)\s*,/);
    // Dev mode's window is dev-mode.js's.
    expect(made).toMatch(/\bkeepAsIs:\s*isDev\s*,/);
    expect(hudDisplay_calls()).toEqual(['hudDisplay.createHudDisplay(', 'hudDisplay.readSimIni(', 'hudDisplay.fetchSimWindow(', 'hudDisplay.fetchMonitors(']);
  });

  test('the desk is told when the screens, or where the HUD is, have changed: the desk window, if there is one', () => {
    const made = argumentsOf('hudDisplay.createHudDisplay(');
    // ...and, with "HUD drawn by OBS" on and OBS answering, the HUD source is fitted to the new size (it is its size in DIPs).
    expect(made).toMatch(/\bonChange:\s*\(\)\s*=>\s*\{\s*if \(deskWindow && !deskWindow\.isDestroyed\(\)\) deskWindow\.webContents\.send\('hud-displays-changed'\);\s*if \(hudSourceOn\(\) && obsClient\.identified\(\)\) applyHudSource\('the HUD changed screen'\);\s*\},/);
    const preload = readFileSync(new URL('../../preload.js', import.meta.url), 'utf8');
    expect(preload).toMatch(/onHudDisplaysChanged:\s*\(callback\)\s*=>\s*\{\s*ipcRenderer\.on\('hud-displays-changed',/);
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

test.describe('recording', () => {
  // OBS records (modules/js/obs). The Electron recorder — the page's getDisplayMedia, granted by main.js without a
  // picker, its chunks written here, ffmpeg, the .rcpdv bundles, the "native" backend on port 50965 and the sidecar
  // IPC — went on 2026-09-30, and nothing of it comes back through main.js.
  test('main.js grants no screen capture, writes no video and talks to no recorder of its own', () => {
    expect(code).not.toMatch(/desktopCapturer|setDisplayMediaRequestHandler|setPermissionRequestHandler|setPermissionCheckHandler/);
    expect(code).not.toMatch(/ffmpeg|bundleWriter|rcpdv|replayDirector|keyboardSender|captureScreen/i);
    expect(code).not.toMatch(/50965|hostControlPort|hostControlRequest/);
    // The old IPC: the page's chunks, the sidecar's lines, the transcode and the bundle. (start-recording and
    // stop-recording are action names now, for the Stream Deck, and go to the keeper.)
    expect(code).not.toMatch(/ipcMain\.(?:handle|on)\('(?:start-recording|stop-recording|write-recording-chunk|get-recording-state|sidecar-(?:start|write|stop)|save-replay-buffer|transcode-recording|bundle-recording|read-bundle-header|get-ffmpeg-info)'/);
    expect(code).not.toMatch(/getDisplayMedia|MediaRecorder/);
    const preload = readFileSync(new URL('../../preload.js', import.meta.url), 'utf8');
    expect(preload).not.toMatch(/startRecording|writeRecordingChunk|sidecarWrite|saveReplayBuffer|ReplayDirector|getFfmpegInfo|NativeRecording/);
  });

  test('the HUD keys for recording go through the action dispatcher, saying they are keys, so OBS is never started from the car', () => {
    expect(code).toMatch(/'CommandOrControl\+Shift\+V':\s*\(\)\s*=>\s*\{\s*dispatchAction\('toggle-recording',\s*\{\s*source:\s*'key'\s*\}\);\s*\},/);
    expect(code).toMatch(/'CommandOrControl\+Shift\+B':\s*\(\)\s*=>\s*\{\s*dispatchAction\('save-replay-buffer',\s*\{\s*source:\s*'key'\s*\}\);\s*\},/);
    expect(code).toMatch(/'CommandOrControl\+Shift\+P':\s*\(\)\s*=>\s*\{\s*dispatchAction\('tv-shots',\s*\{\s*source:\s*'key'\s*\}\);\s*\},/);
    // The actions hand the source on to the keeper, which decides; the Stream Deck's route names none and is one.
    expect(code).toMatch(/'toggle-recording':\s*\(\{\s*source\s*=\s*'streamdeck'\s*\}\s*=\s*\{\}\)\s*=>\s*recording\.toggle\(\{\s*source\s*\}\)/);
    expect(code).toMatch(/'stop-recording':\s*\(\)\s*=>\s*recording\.stop\(\)/);
    expect(code).toMatch(/'save-replay-buffer':\s*\(\{\s*source\s*=\s*'streamdeck'\s*\}\s*=\s*\{\}\)\s*=>\s*recording\.saveReplay\(\{\s*source\s*\}\)/);
    expect(code).toMatch(/function dispatchAction\(name, context = \{\}\)/);
    // The tray's Record and Save replay are presses from the tray.
    expect(code).toMatch(/dispatchAction\('toggle-recording',\s*\{\s*source:\s*'tray'\s*\}\)/);
    expect(code).toMatch(/dispatchAction\('save-replay-buffer',\s*\{\s*source:\s*'tray'\s*\}\)/);
    // Auto-record and the replay buffer are fed the payload the HUD's keeper polls, and nothing else polls for them.
    expect(code).toMatch(/livery\.feed\(payload\);\s*recording\.feed\(payload\);/);
    expect(calls(/recording\.feed\(/g)).toHaveLength(1);
    // The desk's Save replay is the same keeper call, from the desk.
    expect(code).toMatch(/case 'saveReplay': return await recording\.saveReplay\(\{ source: 'desk' \}\);/);
    // Nothing of a recording is sent to the HUD's page to draw: it is in the picture. The two sentences it may be
    // told go through the keeper's notice, to the one channel.
    expect(code).not.toMatch(/webContents\.send\('(?:toggle-recording|save-replay-buffer|recording-state|recording-debug|toggle-replay-director)'[^)]*overlayWindow/);
    const toOverlay = calls(/overlayWindow\.webContents\.send\('([\w-]+)'/g).map((c) => c.match(/'([\w-]+)'/)[1]);
    expect(toOverlay.filter((ch) => /record|replay|obs/i.test(ch))).toEqual([]);
    expect(toOverlay).toContain('hud-notice');
    expect(code).toMatch(/notice:\s*\(text\)\s*=>\s*\{\s*if \(overlayWindow && !overlayWindow\.isDestroyed\(\)\) overlayWindow\.webContents\.send\('hud-notice', text\);\s*\},/);
  });

  test('OBS is started by nothing but a press: never at start unless Record by itself is on, never from a key', () => {
    const starts = calls(/startObsIfClosed\(\)/g);
    // Two callers: Open OBS (a press) and the app's start behind the switch (startObsWithApp, below); and the keeper's
    // startObs (a press, out of the car, by its own rule), handed the function itself.
    expect(starts).toHaveLength(2);
    expect(code).toMatch(/if \(!isDev && loadSettingsSync\(\)\.recordingAutoRecord !== false\) \{\s*startObsWithApp\(\)/);
    expect(code).toMatch(/startObs:\s*startObsIfClosed\s*,/);
    // One start at a time, and never a second OBS: the launcher's starter (a tasklist that cannot say starts nothing).
    expect(code).toMatch(/const obsStarter = obs\.launcher\.createStarter\(\{/);
    expect(code).toMatch(/const startObsIfClosed = \(\) => obsStarter\.startIfClosed\(\);/);
    // The app's own start asks the telemetry first and starts OBS only if it says he is out of the car, and never from
    // the relaunch Ctrl+Shift+G makes (--no-obs-start): that key is held only in the car.
    const withApp = code.match(/async function startObsWithApp\(\) \{([\s\S]*?)\n\}\n/);
    expect(withApp).not.toBeNull();
    expect(withApp[1]).toMatch(/hudVisibility\.fetchPayload\(hudTelemetryUrl\(\)\)/);
    expect(withApp[1]).toMatch(/obs\.launcher\.startWithApp\(\{/);
    expect(withApp[1]).toMatch(/relaunched:\s*process\.argv\.includes\(NO_OBS_START\)/);
    expect(withApp[1]).toMatch(/inCar:\s*RacingDeskInCar\.inCar\(payload\)/);
    expect(withApp[1].indexOf('startWithApp(')).toBeLessThan(withApp[1].indexOf('await startObsIfClosed()'));
    expect(code).toMatch(/const NO_OBS_START = '--no-obs-start';/);
    expect(code).toMatch(/async function openObs\(\)\s*\{\s*if \(hud\.state\(\)\.inCar\) return \{ ok: false, reason: 'OBS is not opened from the car' \};/);
    // obs64 is spawned in the launcher module and nowhere here.
    expect(code).not.toMatch(/spawn\(\s*['"`]/);
    expect(code).not.toMatch(/obs64/);
    // OBS is never quit or killed from here.
    expect(code).not.toMatch(/taskkill|obs64.*kill|StopOBS|\.kill\(\s*['"]?obs/i);
  });

  test('every quit path stops the recording Racing Desk started, and his own are left alone; the Ctrl+Shift+G relaunch is not a quit, and leaves it running for the relaunched app', () => {
    const beforeQuit = code.match(/app\.on\('before-quit', \(event\) => \{([\s\S]*?)\n\}\);/);
    expect(beforeQuit).not.toBeNull();
    expect(beforeQuit[1]).toMatch(/recording\.needsStopForQuit\(\)/);
    expect(beforeQuit[1]).toMatch(/event\.preventDefault\(\);\s*stopOwnedRecording\(\)\.finally\(\(\) => app\.quit\(\)\);/);
    // A real quit that comes while the relaunch is waiting is a quit after all: before-quit gives the relaunch up (it was
    // waiting for a STARTED or a filing, and ending here would leave the recording running with no app) and takes the quit
    // path whatever else it finds to stop.
    expect(beforeQuit[1]).toMatch(/const relaunchGivenUp = relaunchPending;\s*relaunchPending = false;/);
    expect(beforeQuit[1]).toMatch(/!stoppedForQuit && \(relaunchGivenUp \|\| recording\.needsStopForQuit\(\)/);
    // The desk closing and the tray's Quit go through app.quit, so through before-quit.
    expect(code).toMatch(/deskWindow\.on\('close', \(\) => \{ if \(!quitting\) app\.quit\(\); \}\);/);
    expect(code).toMatch(/\{ label: 'Quit Racing Desk', click: \(\) => app\.quit\(\) \}/);
    // Ctrl+Shift+G relaunches with app.exit, which skips before-quit. A restart is not a quit: the recording and the
    // replay buffer Racing Desk started are left running (the keeper's leaveForRelaunch keeps the state file and closes
    // the sidecar to be gone on in), and the relaunched app takes them over when OBS answers — the race stays one video.
    const green = code.match(/'CommandOrControl\+Shift\+G': \(\) => \{([\s\S]*?)\n  \},/);
    expect(green).not.toBeNull();
    // ...and the new instance does not start OBS with the app: this key is held only in the car (--no-obs-start); nor does
    // it open the desk over the sim (--no-desk): closing the desk is a quit, and the desk that popped up mid-race would
    // be one click from stopping the recording the restart was meant to keep. The relaunch goes only if nothing gave it up.
    expect(green[1]).toMatch(/leaveForRelaunch\(\)\.then\(\(go\) => \{\s*if \(!go\) return;\s*app\.relaunch\(\{ args: \[\.\.\.process\.argv\.slice\(1\)\.filter\(\(a\) => a !== NO_OBS_START && a !== NO_DESK\), NO_OBS_START, NO_DESK\] \}\);\s*app\.exit\(0\);\s*\}\);/);
    expect(green[1]).not.toMatch(/stopOwnedRecording|stopOwnedForQuit|app\.quit/);
    expect(code).toMatch(/const NO_DESK = '--no-desk';/);
    expect(code).toMatch(/if \(!process\.argv\.includes\(NO_DESK\)\) showDesk\(\);/);
    expect(code).not.toMatch(/process\.argv\.includes\('--no-desk'\)/);
    expect(calls(/app\.relaunch\(/g)).toHaveLength(1);
    expect(calls(/app\.exit\(/g)).toHaveLength(1);
    const leave = code.match(/function leaveForRelaunch\(\) \{([\s\S]*?)\n\}\n/);
    expect(leave).not.toBeNull();
    expect(leave[1]).toMatch(/tvOff\.then\(\(\) => \(relaunchPending \? recording\.leaveForRelaunch\(\) : null\)\)/);
    expect(leave[1]).not.toMatch(/stopOwnedForQuit|StopRecord|StopReplayBuffer|hudSource|app\.quit/);
    // One caller each: the quit's stop is the keeper's stopOwnedForQuit, the relaunch's leaving is its leaveForRelaunch.
    expect(calls(/recording\.stopOwnedForQuit\(/g)).toHaveLength(1);
    expect(calls(/recording\.leaveForRelaunch\(/g)).toHaveLength(1);
    expect(calls(/\bleaveForRelaunch\(\)\.then\(/g)).toHaveLength(1);
    // Neither runs over the other. The relaunch is not a quit (it does not set the quit's flag, so before-quit still sees
    // a real quit that comes meanwhile) and is not started while a quit is under way or another relaunch is waiting; it
    // resolves to whether it is to go on, which before-quit's giving it up makes false. The quit is once.
    expect(leave[1]).toMatch(/if \(stoppedForQuit \|\| relaunchPending\) return Promise\.resolve\(false\);\s*relaunchPending = true;/);
    expect(leave[1]).not.toMatch(/stoppedForQuit = true/);
    expect(leave[1]).toMatch(/\.then\(\(\) => relaunchPending\);\s*$/);
    expect(calls(/relaunchPending = true;/g)).toHaveLength(1);
    // The wait for the stop is not the whole wait: a recording that has just stopped is filed before the app goes, and
    // the cap on the quit allows for that (the keeper itself is bounded by the same constant); the relaunch waits as long.
    const helper = code.match(/function stopOwnedRecording\(\) \{([\s\S]*?)\n\}\n/);
    expect(helper).not.toBeNull();
    expect(helper[1]).toMatch(/if \(stoppedForQuit\) return Promise\.resolve\(\);\s*stoppedForQuit = true;/);
    expect(helper[1]).toMatch(/obs\.recording\.QUIT_WAIT_MS \+ obs\.recording\.FILING_QUIT_WAIT_MS/);
    expect(leave[1]).toMatch(/obs\.recording\.QUIT_WAIT_MS \+ obs\.recording\.FILING_QUIT_WAIT_MS/);
    // will-quit lets the client and the keeper go.
    expect(code).toMatch(/app\.on\('will-quit', \(\) => \{[\s\S]*?recording\.dispose\(\); obsClient\.stop\(\);/);
  });

  test('Set up OBS goes through the launcher, which leaves OBS\'s files alone while it may be open; a password read from the file replaces one typed', () => {
    const setup = code.match(/async function setupObs\(\) \{([\s\S]*?)\n\}\n/);
    expect(setup).not.toBeNull();
    expect(setup[1]).toMatch(/obs\.launcher\.setupObs\(\{/);
    expect(setup[1]).not.toMatch(/setupWhileClosed|writeFile\(|isObsRunning/);
    expect(setup[1]).toMatch(/if \(result\.password && typeof loadSettingsSync\(\)\[OBS_PASSWORD_KEY\] === 'string'\) \{[\s\S]*?delete settings\[OBS_PASSWORD_KEY\];/);
  });

  test('the Stream Deck\'s Open Settings opens the desk\'s Settings page, not the old app\'s protocol', () => {
    expect(code).not.toMatch(/racing-desk-native/);
    const settings = code.match(/'toggle-settings': \(\) => \{([\s\S]*?)\n  \},/);
    expect(settings).not.toBeNull();
    expect(settings[1]).toMatch(/showDesk\('settings'\);/);
  });

  test('a press in the car that finds OBS not answering asks tasklist before anything goes on the HUD, and the floor looks where OBS records', () => {
    const made = argumentsOf('obs.createRecordingKeeper(');
    expect(made).toMatch(/obsRunning:\s*\(\) => obs\.launcher\.isObsRunning\(\{ exec: execFileAsync \}\),/);
    expect(made).toMatch(/obsFolder:\s*\(\) => obs\.launcher\.profileRecordFolder\(/);
  });

  test('the OBS password reaches no page and no log line: safeStorage, stripped like the iPad\'s key', () => {
    expect(code).toMatch(/const OBS_PASSWORD_KEY = 'obsWebSocketPasswordEnc';/);
    expect(code).toMatch(/const PRIVATE_SETTINGS = \[\.\.\.REMOTE_SETTINGS, OBS_PASSWORD_KEY\];/);
    expect(code).toMatch(/const \{ remoteServerKey, \[OBS_PASSWORD_KEY\]: obsPassword, \.\.\.rest \} = settings;/);
    expect(code).toMatch(/for \(const key of PRIVATE_SETTINGS\) \{\s*if \(key in onDisk\) settings\[key\] = onDisk\[key\];/);
    expect(code).toMatch(/safeStorage\.encryptString\(value\)\.toString\('base64'\)/);
    expect(code).toMatch(/safeStorage\.decryptString\(/);
    // The client is given a function for the password, never a value; and every log line about it says set or none.
    expect(code).toMatch(/obs\.createObsClient\(\{\s*port:\s*obsPort,\s*password:\s*obsPassword,\s*log:\s*logToFile\s*\}\)/);
    const logs = calls(/logToFile\([^;]*\);/g);
    expect(logs.some((l) => /password: \$\{result\.password \? 'set' : 'none'\}/.test(l))).toBe(true);
    for (const l of logs) {
      // A password's value is never interpolated: only whether there is one.
      expect(l, l).not.toMatch(/typedObsPassword\(|obsPassword\(\)|server_password|\.password(?!\s*\?)|OBS_PASSWORD_KEY\]/);
    }
    // The desk's recording commands and status are the desk window's.
    expect(code).toMatch(/ipcMain\.handle\('recording:status', async \(event\) => \{\s*if \(!fromDesk\(event\)\)/);
    expect(code).toMatch(/ipcMain\.handle\('recording:command', async \(event, command, value\) => \{\s*if \(!fromDesk\(event\)\)/);
  });
});

test.describe('TV shots', () => {
  // modules/js/obs/tv-shots.js does the take; main.js gives it the OBS client, the keeper and the host's replay route,
  // and wires the desk's race detail, the tray and the Stream Deck to it. No key presses anything.
  test('the director is given the keeper and the host\'s replay route; the action names the race\'s folder from the desk and the latest recording otherwise; a key in the car is told no', () => {
    expect(code).toMatch(/const tvShots = obs\.createTvShots\(\{/);
    const made = argumentsOf('obs.createTvShots(');
    expect(made).toMatch(/\bclient:\s*obsClient\b/);
    expect(made).toMatch(/\brecording\b,/);
    expect(made).toMatch(/\breplay:\s*hostReplay\b/);
    expect(made).toMatch(/\binCar:\s*\(\)\s*=>\s*hud\.state\(\)\.inCar/);
    // The replay route is the app's own host's, asked by this process.
    expect(code).toMatch(/status:\s*\(\)\s*=>\s*askHost\('GET',\s*'\/racing-desk\/data\/replay'\)/);
    expect(code).toMatch(/command:\s*\(body\)\s*=>\s*askHost\('POST',\s*'\/racing-desk\/data\/replay',\s*body\)/);
    expect(code).toMatch(/fetch\(`\$\{localHostUrl\(\)\}\$\{route\}`/);
    // The action: the desk names the folder, the tray and the Stream Deck mean the latest, a key in the car is told no.
    expect(code).toMatch(/'tv-shots':\s*\(\{\s*source\s*=\s*'streamdeck',\s*folder\s*=\s*null\s*\}\s*=\s*\{\}\)\s*=>\s*\(source === 'key' \? \{ ok: false, reason: obs\.tvShots\.IN_CAR \} : startTvShots\(\{ source, folder \}\)\)/);
    const start = code.match(/async function startTvShots\(\{ source = 'desk', folder = null \} = \{\}\) \{([\s\S]*?)\n\}/);
    expect(start).not.toBeNull();
    expect(start[1]).toMatch(/if \(hud\.state\(\)\.inCar\) return \{ ok: false, reason: obs\.tvShots\.IN_CAR \};/);
    expect(start[1]).toMatch(/obs\.recordingsIndex\.latest\(/);
    expect(start[1]).toMatch(/tvShots\.start\(\{ folder: where \}\)/);
    expect(code).toMatch(/dispatchAction\('tv-shots',\s*\{\s*source:\s*'tray'\s*\}\)/);
    // The desk's commands.
    expect(code).toMatch(/case 'tvShots': \{ const answer = await startTvShots\(\{ source: 'desk', folder:/);
    expect(code).toMatch(/case 'tvShotsCancel': \{ const answer = tvShots\.cancel\(\);/);
    expect(code).toMatch(/case 'recordingFor': return \{ ok: true, recording: recordingForRace\(/);
    // A take under way ends when the app quits and his facecam is shown again before the quit goes on (bounded), and a
    // take that has hidden it is something a quit waits for even while nothing is recording (the first seek).
    const helper = code.match(/function stopOwnedRecording\(\) \{([\s\S]*?)\n\}\n/);
    expect(helper[1]).toMatch(/const tvOff = Promise\.race\(\[tvShots\.stopForQuit\(\), new Promise\(\(resolve\) => setTimeout\(resolve, 1500\)\)\]\)/);
    expect(helper[1]).toMatch(/Promise\.all\(\[recording\.stopOwnedForQuit\(\), hudOff, tvOff\]\)/);
    expect(code).toMatch(/recording\.needsStopForQuit\(\) \|\| tvShots\.needsStopForQuit\(\)/);
    // The Ctrl+Shift+G relaunch ends a take the same way: nothing drives the replay once this process is gone.
    const leave = code.match(/function leaveForRelaunch\(\) \{([\s\S]*?)\n\}\n/);
    expect(leave[1]).toMatch(/const tvOff = Promise\.race\(\[tvShots\.stopForQuit\(\), new Promise\(\(resolve\) => setTimeout\(resolve, 1500\)\)\]\)/);
    expect(leave[1]).toMatch(/tvOff\.then\(\(\) => \(relaunchPending \? recording\.leaveForRelaunch\(\) : null\)\)/);
    // What a take hid is written to a file of its own, so that a crash does not leave the facecam hidden.
    expect(made).toMatch(/\bstateFile:\s*path\.join\(app\.getPath\('userData'\), 'tv-state\.json'\)/);
    // Nothing presses a key, in main.js or in the director.
    expect(code).not.toMatch(/keybd_event|SendKeys|sendKey|keyboard-sender/i);
    const director = readFileSync(new URL('../../modules/js/obs/tv-shots.js', import.meta.url), 'utf8');
    expect(director).not.toMatch(/keybd_event|SendKeys|sendKey|keyboard-sender|child_process|powershell/i);
  });
});

test.describe('"HUD drawn by OBS"', () => {
  // modules/js/obs/hud-source.js does the OBS side — and the ordering, which tests/unit/obs-hud-source.spec.mjs holds against
  // a fake OBS: the window out of the capture before the source is enabled, back in only after OBS has stopped drawing it,
  // "off" applied at every connect. main.js throws the switch where it has to and hands the module what it needs.
  test('the source is given where the listener is, whether it is up, whether the page is alive, the HUD\'s size in DIPs and a file to keep what it did; the window\'s capture is its protect callback and the one place it is set', () => {
    expect(code).toMatch(/const hudSource = obs\.createHudSource\(\{/);
    const made = argumentsOf('obs.createHudSource(');
    // The address is where the listener is, never where the settings say it ought to be (the port may have been taken),
    // and which page is the choice's: /obs for the rig HUD, /obs-ipad for the iPad dashboard.
    expect(made).toMatch(/\burl:\s*\(view\) => \{ const info = localServer\.getInfo\(\); return info\.running \? `http:\/\/127\.0\.0\.1:\$\{info\.port\}\$\{view === 'ipad' \? remoteServer\.OBS_IPAD_PATH : remoteServer\.OBS_PATH\}` : null; \}/);
    expect(made).not.toMatch(/localServerPort\(/);
    // The choice is read from the file each time, strictly (recording-settings.js hudViewOf: 'ipad' only when it says so).
    expect(made).toMatch(/\bview:\s*\(\) => hudSourceView\(\)/);
    expect(code).toMatch(/const hudSourceView = \(\) => recordingSettings\.hudViewOf\(loadSettingsSync\(\)\);/);
    expect(made).toMatch(/\bready:\s*\(\) => localServer\.isRunning\(\)/);
    expect(made).toMatch(/\bpageAlive:\s*\(\) => localServer\.servedWithin\(OBS_PAGE_ALIVE_MS\)/);
    expect(made).toMatch(/\bsize:\s*hudSourceSize\b/);
    expect(made).toMatch(/\bstate:\s*obs\.hudSource\.fileState\(path\.join\(app\.getPath\('userData'\), 'hud-source-state\.json'\)/);
    // The size is the window's in DIPs, as the rig's page is laid out: no scale factor in it.
    const size = code.match(/function hudSourceSize\(\) \{([\s\S]*?)\n\}/);
    expect(size).not.toBeNull();
    expect(size[1]).toMatch(/return \{ width: bounds\.width, height: bounds\.height \};/);
    expect(size[1]).not.toMatch(/scaleFactor|getDisplayMatching|\* scale/);
    // The switch applied: "off" is not gated on the switch having changed.
    const apply = code.match(/function applyHudSource\(why, \{ fresh = false \} = \{\}\) \{([\s\S]*?)\n\}/);
    expect(apply).not.toBeNull();
    expect(apply[1]).toMatch(/hudSource\.apply\(\{ on: hudSourceWas, fresh, protect \}\)/);
    expect(apply[1]).not.toMatch(/changed|\?\s*hudSource\.disable|hudSource\.ensure/);
    expect(calls(/setContentProtection\(/g)).toHaveLength(1);
    expect(apply[1]).toMatch(/overlayWindow\.setContentProtection\(flag\)/);
    // Thrown: at start, when OBS answers, when the collection changes, when the desk saves the switch, when the file changes,
    // when the HUD changes screen, and when the listener comes up.
    expect(code).toMatch(/applyHudSource\('start'\)/);
    expect(code).toMatch(/if \(state\.phase === 'identified'\) applyHudSource\('OBS answered'\);/);
    expect(code).toMatch(/obsClient\.on\('CurrentSceneCollectionChanged', \(\) => applyHudSource\('the scene collection changed'\)\);/);
    expect(code).toMatch(/if \(\(settings\.obsHudSource === true\) !== hudSourceBefore\) applyHudSource\('the switch', \{ fresh: settings\.obsHudSource === true \}\);/);
    expect(code).toMatch(/if \(\(settings\.obsHudSource === true\) !== hudSourceWas\) applyHudSource\('the settings file changed', \{ fresh: settings\.obsHudSource === true \}\);/);
    // The choice of what OBS draws, changed with the switch on: applied, and not as a fresh switch (the collection stays).
    expect(code).toMatch(/else if \(settings\.obsHudSource === true && recordingSettings\.hudViewOf\(settings\) !== hudViewBefore\) applyHudSource\('the choice'\);/);
    expect(code).toMatch(/else if \(settings\.obsHudSource === true && recordingSettings\.hudViewOf\(settings\) !== hudViewWas\) applyHudSource\('the choice changed in the settings file'\);/);
    expect(apply[1]).toMatch(/hudViewWas = hudSourceView\(\);/);
    // The desk is told the choice and the OBS slider with the rest of the recording's status.
    expect(code).toMatch(/obsHudView: recordingSettings\.hudViewOf\(settings\),/);
    expect(code).toMatch(/obsPanelBackground: typeof settings\.obsPanelBackground === 'number'/);
    // Ctrl+Shift+G is the restart alone: the green-screen key nothing read is gone from the file and from here.
    expect(code).not.toMatch(/greenScreen/);
    expect(code).toMatch(/if \(hudSourceOn\(\) && obsClient\.identified\(\)\) applyHudSource\('the HUD changed screen'\);/);
    expect(code).toMatch(/onUp: \(\) => \{ if \(hudSourceOn\(\) && obsClient\.identified\(\)\) applyHudSource\('the listener is up'\); \}/);
    // On quit, with the switch on and OBS answering: disabled for good, within a bound — and not by the relaunch Ctrl+Shift+G
    // makes mid-race, which comes back in seconds and leaves the page in OBS loaded (leaveForRelaunch touches no source).
    const helper = code.match(/function stopOwnedRecording\(\) \{([\s\S]*?)\n\}\n/);
    expect(helper).not.toBeNull();
    expect(helper[1]).toMatch(/const hudOff = hudSourceOn\(\) && obsClient\.identified\(\)/);
    expect(helper[1]).toMatch(/hudSource\.disable\(\{ final: true \}\)/);
    expect(code).toMatch(/recording\.needsStopForQuit\(\) \|\| tvShots\.needsStopForQuit\(\) \|\| \(hudSourceOn\(\) && obsClient\.identified\(\)\)/);
    const green = code.match(/'CommandOrControl\+Shift\+G': \(\) => \{([\s\S]*?)\n  \},/);
    expect(green[1]).toMatch(/leaveForRelaunch\(\)\.then\(/);
    expect(green[1]).not.toMatch(/hudSource/);
    expect(code.match(/function leaveForRelaunch\(\) \{([\s\S]*?)\n\}\n/)[1]).not.toMatch(/hudSource|setContentProtection/);
    // Nothing of his is removed from here or from the module.
    expect(code).not.toMatch(/RemoveInput|RemoveSceneItem/);
    const module = readFileSync(new URL('../../modules/js/obs/hud-source.js', import.meta.url), 'utf8');
    expect(module).not.toMatch(/RemoveInput|RemoveSceneItem|RemoveScene/);
  });
});

test.describe('the loopback listener', () => {
  // remote-server.js's second server: on 127.0.0.1 alone, always up, for the Stream Deck and for OBS (the HUD page at
  // /obs). It is given the app's state and his settings whole; the server keeps the allowlist of what a page may see.
  test('is created as the loopback one, started at every start whatever the iPad switch, and given the status and the settings by function', () => {
    expect(code).toMatch(/const localServer = remoteServer\.createServer\(\{ loopback: true \}\);/);
    expect(calls(/remoteServer\.createServer\(/g)).toHaveLength(1);
    expect(code).toMatch(/maybeStartRemoteServer\(\);\s*startLocalServer\(\);/);
    const start = code.match(/function startLocalServer\(\) \{([\s\S]*?)\n\}\n/);
    expect(start).not.toBeNull();
    // Tried again until it is up, the port read afresh at each try; the HUD source is applied when it comes up.
    expect(start[1]).toMatch(/remoteServer\.startWithRetry\(localServer, \(\) => \(\{/);
    expect(start[1]).not.toMatch(/localServer\.start\(/);
    expect(start[1]).toMatch(/port:\s*localServerPort\(\)/);
    expect(start[1]).toMatch(/status:\s*localStatus/);
    expect(start[1]).toMatch(/displaySettings:\s*\(\)\s*=>\s*loadSettingsSync\(\)/);
    expect(start[1]).not.toMatch(/host:/);   // the server binds 127.0.0.1 by itself; nothing here could put it on the LAN
    // Its port is the settings file's localServerPort, else the server's own default; never the iPad's 9090.
    const port = code.match(/function localServerPort\(\) \{([\s\S]*?)\n\}/);
    expect(port).not.toBeNull();
    expect(port[1]).toMatch(/loadSettingsSync\(\)\.localServerPort/);
    expect(port[1]).toMatch(/remoteServer\.LOCAL_DEFAULT_PORT/);
    expect(port[1]).not.toMatch(/9090/);
    // What it says of the app: in the car, the HUD on screen, the recording in short — never a path of the settings file.
    const status = code.match(/function localStatus\(\) \{([\s\S]*?)\n\}/);
    expect(status).not.toBeNull();
    expect(status[1]).toMatch(/inCar:\s*h\.inCar/);
    expect(status[1]).toMatch(/hudVisible:\s*h\.visible/);
    // His HUD switch, which the page OBS draws hides itself by, and the page-only actions pressed on the rig.
    expect(status[1]).toMatch(/hudOff:\s*h\.hudOff === true/);
    expect(status[1]).toMatch(/hudActions:\s*\{ seq: hudPageActions\.seq, recent: hudPageActions\.recent\.slice\(\) \}/);
    expect(status[1]).toMatch(/recording:\s*\{/);
    expect(status[1]).not.toMatch(/loadSettingsSync|password|Key/);
  });
});

test.describe('the page-only actions', () => {
  // A Stream Deck key on the rig's HUD that changes the rig's page alone (zoom, cycle, the pit box tabs, the commentary)
  // is saved nowhere, so the page OBS draws cannot get it from the settings: it is noted in the listener's status.
  test('every action that reaches the rig\'s page by a channel and is saved nowhere is noted before the window is looked for, and no other is', () => {
    const set = code.match(/const HUD_PAGE_ACTIONS = new Set\(\[([^\]]*)\]\);/);
    expect(set).not.toBeNull();
    expect([...set[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()).toEqual(['cycle-car-logo', 'cycle-rating', 'dismiss-commentary', 'pitbox-next-tab', 'pitbox-prev-tab', 'zoom-in', 'zoom-out']);
    const send = code.match(/function _sendRenderer\(channel\) \{([\s\S]*?)\n\}/);
    expect(send).not.toBeNull();
    expect(send[1].indexOf('noteHudAction(channel);')).toBeGreaterThanOrEqual(0);
    expect(send[1].indexOf('noteHudAction(channel);')).toBeLessThan(send[1].indexOf('no window'));
    // The ring is bounded, and numbered: the page does what is newer than what it has done.
    const note = code.match(/function noteHudAction\(name\) \{([\s\S]*?)\n\}/);
    expect(note[1]).toMatch(/hudPageActions\.seq \+= 1;/);
    expect(note[1]).toMatch(/hudPageActions\.recent\.length > 16\) hudPageActions\.recent\.shift\(\);/);
    // Each is the channel's own name, as the action handlers have it.
    for (const name of ['zoom-in', 'zoom-out', 'cycle-rating', 'cycle-car-logo', 'pitbox-next-tab', 'pitbox-prev-tab', 'dismiss-commentary']) {
      expect(code, name).toContain(`() => _sendRenderer('${name}')`);
    }
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
