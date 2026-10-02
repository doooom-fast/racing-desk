/**
 * "HUD drawn by OBS" (modules/js/obs/hud-source.js) over the real OBS client and the fake obs-websocket server on
 * 127.0.0.1, whose scene collection is shaped like his: three scenes, the game's display capture at the bottom of each
 * and the facecam above it. Held: the input is made once and never twice; an item of it goes into every scene that has a
 * game video, just above it and below the facecam, with its place and size (scaled up from the HUD's size in DIPs); the
 * page is reloaded unless it is alive; the HUD goes into the collection the switch was turned on in and no other, and
 * into no scene that has no game video; what he moved or hid in a scene is left as it is; off is applied at every connect,
 * and the window is in the capture only after OBS has stopped drawing; nothing of his is ever removed; with OBS closed
 * nothing is asked.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import { startFakeObs } from './fake-obs.mjs';

const require = createRequire(import.meta.url);
const { createObsClient } = require('../../modules/js/obs/client.js');
const { createHudSource, INPUT_NAME, REFRESH_BUTTON, LISTENER_DOWN, IPAD_SOURCE, IPAD_PLACE, LEAST_BOX } = require('../../modules/js/obs/hud-source.js');
// The size the iPad dashboard's page is laid out at for a box on the canvas: the box's own, or, for one smaller than the
// least iPad in its orientation (LEAST_BOX), the box's shape scaled up to it (OBS draws it into the box).
const laidOutAt = (w, h) => { const l = w > h ? LEAST_BOX.landscape : LEAST_BOX.portrait; const up = Math.max(1, l.width / w, l.height / h); return { width: Math.round(w * up), height: Math.round(h * up) }; };

const PASSWORD = 'horse-battery';
const until = async (what, timeoutMs = 4000) => {
  const start = Date.now();
  while (!what()) {
    if (Date.now() - start > timeoutMs) throw new Error('waited too long');
    await new Promise((r) => setTimeout(r, 15));
  }
};

let server;
test.beforeEach(async () => { server = await startFakeObs({ password: PASSWORD }); });
test.afterEach(async () => { await server.close(); });

// What is kept between runs, shared by the sources of one test (a source is made again at every start of the app).
function memory() {
  let saved = null;
  return { read: () => (saved ? JSON.parse(JSON.stringify(saved)) : null), write: (v) => { saved = JSON.parse(JSON.stringify(v)); }, get: () => saved };
}

// The two pages the listener serves, by the choice (main.js hands the same in).
const URLS = { rig: 'http://127.0.0.1:9091/obs', ipad: 'http://127.0.0.1:9091/obs-ipad' };

function rig({ port = server.port, url = URLS.rig, size = { width: 3440, height: 1440 }, view = 'rig', ready = () => true, pageAlive = () => false, state = memory(), followAfterMs = 60 } = {}) {
  const lines = [];
  const client = createObsClient({ port, password: () => PASSWORD, retryMs: 40, connectTimeoutMs: 500, log: (l) => lines.push(l) });
  const sizeBox = { value: size };
  const viewBox = { value: view };
  const source = createHudSource({ client, url: (which) => (url === URLS.rig ? URLS[which] : url), size: () => sizeBox.value, view: () => viewBox.value, ready, pageAlive, state, log: (l) => lines.push(l), followAfterMs });
  // As main.js wires it: an item moved or sized in OBS reaches the source.
  client.on('SceneItemTransformChanged', (d) => source.transformChanged(d));
  // The window's capture: each call is written down with the number of requests OBS had had by then, to say what came before it.
  const protectCalls = [];
  const protect = (value) => protectCalls.push({ value, at: server.requests.length });
  client.start();
  return { client, source, lines, state, sizeBox, viewBox, protect, protectCalls, dispose: () => client.stop() };
}

const sceneItems = (name) => server.state.scenes.find((s) => s.sceneName === name).items;
const names = (name) => sceneItems(name).map((i) => i.sourceName);
const ours = (name) => sceneItems(name).find((i) => i.sourceName === INPUT_NAME);
const requests = (type) => server.requests.filter((q) => q.type === type);
const indexOfRequest = (type, which = 0) => { let n = -1; for (let i = 0; i < server.requests.length; i++) if (server.requests[i].type === type && ++n === which) return i; return -1; };
const ALL = ['Large Video', 'Small Video', '2up'];

// A collection of his with no scene that has a game video: a SimHub window capture and a game capture of another name.
function otherCollection(name = 'sim video with voice') {
  const t = { positionX: 0, positionY: 0, rotation: 0, scaleX: 1, scaleY: 1, alignment: 5, boundsType: 'OBS_BOUNDS_NONE', boundsAlignment: 0, boundsWidth: 0, boundsHeight: 0, sourceWidth: 3440, sourceHeight: 1440, width: 3440, height: 1440 };
  server.state.inputs.push({ inputName: 'Lovely Dashboard Companion', inputKind: 'window_capture', settings: {} }, { inputName: 'first pov', inputKind: 'game_capture', settings: {} });
  server.state.collection = name;
  server.state.scenes = [{ sceneName: 'live', items: [
    { sceneItemId: 60, sourceName: 'Lovely Dashboard Companion', enabled: true, transform: { ...t, positionX: 3434, positionY: 1149, scaleX: 0.83, scaleY: 0.83, width: 400, height: 200 } },
    { sceneItemId: 61, sourceName: 'first pov', enabled: true, transform: { ...t } },
  ] }];
  server.state.currentScene = 'live';
}

test('switched on: one browser source, in every scene just above the game video and below the facecam, fitted to the game video, enabled, and reloaded; the window is out of the capture before anything of it is enabled', async () => {
  const r = rig();
  try {
    await until(() => r.client.identified());
    const answer = await r.source.apply({ on: true, fresh: true, protect: r.protect });
    expect(answer).toMatchObject({ ok: true, created: true, scenes: 3, problems: [] });
    expect(answer.did).toBe('The HUD is a browser source in 3 of your scenes, just above the game.');
    // The window was told to leave the capture once, and before the first thing of the HUD's was made or enabled in OBS.
    expect(r.protectCalls.map((c) => c.value)).toEqual([true]);
    for (const type of ['CreateInput', 'CreateSceneItem', 'SetSceneItemEnabled', 'SetSceneItemIndex', 'SetSceneItemTransform']) {
      expect(indexOfRequest(type), type).toBeGreaterThanOrEqual(r.protectCalls[0].at);
    }
    // One input, made once, with the page's address and the HUD's size, as a browser source that keeps its page.
    expect(requests('CreateInput')).toHaveLength(1);
    expect(requests('CreateInput')[0].data).toMatchObject({ sceneName: 'Large Video', inputName: INPUT_NAME, inputKind: 'browser_source', sceneItemEnabled: true });
    expect(requests('CreateInput')[0].data.inputSettings).toEqual({ url: 'http://127.0.0.1:9091/obs', width: 3440, height: 1440, fps_custom: false, shutdown: false, restart_when_active: false, reroute_audio: false });
    expect(server.state.inputs.filter((i) => i.inputName === INPUT_NAME)).toHaveLength(1);
    // The other scenes got an item of the same input (CreateSceneItem), not a second input.
    expect(requests('CreateSceneItem').map((q) => q.data.sceneName).sort()).toEqual(['2up', 'Small Video']);
    // In every scene: bottom to top, the game, the HUD, the facecam.
    for (const scene of ALL) {
      expect(names(scene), scene).toEqual(['game video', INPUT_NAME, 'Video Capture Device']);
      expect(ours(scene).enabled, scene).toBe(true);
    }
    // Its place and size are the game video's: the 2up scene's bounds, the full scenes' position and scale.
    expect(ours('2up').transform).toMatchObject({ positionX: 0, positionY: 360, boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 1720, boundsHeight: 720 });
    expect(ours('Large Video').transform).toMatchObject({ positionX: 0, positionY: 0, boundsType: 'OBS_BOUNDS_NONE', scaleX: 1, scaleY: 1 });
    // The page is reloaded, so that a page that failed to load while Racing Desk was closed is not left as it was.
    expect(server.state.pressed).toEqual([{ inputName: INPUT_NAME, propertyName: REFRESH_BUTTON }]);
    expect(REFRESH_BUTTON).toBe('refreshnocache');
    // Nothing of his was removed or made again.
    expect(requests('RemoveInput')).toHaveLength(0);
    expect(requests('RemoveSceneItem')).toHaveLength(0);
    expect(server.state.inputs.map((i) => i.inputName)).toEqual(['game video', 'Video Capture Device', 'mic', 'game audio', INPUT_NAME]);
    expect(r.source.status().last).toMatchObject({ ok: true, scenes: 3 });
    // The collection it was set up in is written down, with what the source was set up as.
    expect(r.state.get()).toEqual({ collection: 'sim race 2k', off: [], view: 'rig', ipad: {} });

    // Again (another connect): nothing is made twice; the address is kept current; the page is reloaded as it is not alive.
    const again = await r.source.apply({ on: true, protect: r.protect });
    expect(again).toMatchObject({ ok: true, created: false, scenes: 3 });
    expect(requests('CreateInput')).toHaveLength(1);
    expect(requests('CreateSceneItem')).toHaveLength(2);
    expect(requests('SetInputSettings')).toHaveLength(1);
    expect(requests('SetInputSettings')[0].data).toMatchObject({ inputName: INPUT_NAME, overlay: true });
    for (const scene of ALL) expect(names(scene), scene).toEqual(['game video', INPUT_NAME, 'Video Capture Device']);
    expect(server.state.pressed).toHaveLength(2);
  } finally { r.dispose(); }
});

test('a connect with the page alive and polling does not reload it: a reconnect in the middle of a race keeps the HUD\'s session; a page that was just made, or is not polling, is reloaded', async () => {
  let alive = false;
  const r = rig({ pageAlive: () => alive });
  try {
    await until(() => r.client.identified());
    await r.source.apply({ on: true, fresh: true, protect: r.protect });
    expect(server.state.pressed).toHaveLength(1);           // just made: loaded afresh
    alive = true;
    await r.source.apply({ on: true, protect: r.protect });  // a reconnect, the page polling
    expect(server.state.pressed).toHaveLength(1);
    alive = false;
    await r.source.apply({ on: true, protect: r.protect });  // OBS restarted: the page is not polling
    expect(server.state.pressed).toHaveLength(2);
  } finally { r.dispose(); }
});

test('off is applied at every connect, not only when the switch changes: an item left enabled (OBS closed with it on, a crash, a restart) is switched off, and the window goes back into the capture only after OBS has stopped drawing', async () => {
  // The switch was on; OBS saved its collection with the items enabled; Racing Desk is started with the switch off (it was
  // turned off while OBS was closed), and OBS answers: nothing was ever asked of it before this connect.
  const first = rig();
  await until(() => first.client.identified());
  await first.source.apply({ on: true, fresh: true, protect: first.protect });
  first.dispose();
  for (const scene of ALL) expect(ours(scene).enabled, scene).toBe(true);
  server.requests.length = 0;

  const r = rig();   // a Racing Desk that starts with the switch off: its first word to OBS is off
  try {
    await until(() => r.client.identified());
    const answer = await r.source.apply({ on: false, protect: r.protect });
    expect(answer).toMatchObject({ ok: true, scenes: 3, problems: [] });
    for (const scene of ALL) expect(ours(scene).enabled, scene).toBe(false);
    // The window is put back into the capture once, after the last of the items was switched off.
    expect(r.protectCalls.map((c) => c.value)).toEqual([false]);
    const lastOff = server.requests.map((q, i) => (q.type === 'SetSceneItemEnabled' && q.data.sceneItemEnabled === false ? i : -1)).filter((i) => i >= 0).pop();
    expect(r.protectCalls[0].at).toBeGreaterThan(lastOff);
    expect(requests('RemoveInput')).toHaveLength(0);
    expect(requests('RemoveSceneItem')).toHaveLength(0);
    // Applied again: nothing more to switch off, nothing asked to be enabled.
    await r.source.apply({ on: false, protect: r.protect });
    expect(requests('SetSceneItemEnabled').filter((q) => q.data.sceneItemEnabled === true)).toHaveLength(0);
  } finally { r.dispose(); }
});

test('what Racing Desk switched off it switches on again, and what he hid or moved he keeps: a scene he hid the HUD in stays hidden, an item he moved stays where it is', async () => {
  const state = memory();
  const r = rig({ state });
  try {
    await until(() => r.client.identified());
    await r.source.apply({ on: true, fresh: true, protect: r.protect });
    // He hides the HUD in the small scene and moves it in the large one.
    ours('Small Video').enabled = false;
    ours('Large Video').transform.positionX = 123;
    ours('Large Video').transform.scaleX = 0.5;
    // Racing Desk switches it off (the switch, or its quit), and on again.
    const off = await r.source.apply({ on: false, protect: r.protect });
    expect(off.scenes).toBe(3);
    expect(state.get().off.sort()).toEqual(['2up', 'Large Video']);   // not the one he had already hidden
    expect(ours('Large Video').enabled).toBe(false);
    const on = await r.source.apply({ on: true, fresh: true, protect: r.protect });
    expect(on).toMatchObject({ ok: true, created: false });
    expect(ours('Large Video').enabled).toBe(true);
    expect(ours('2up').enabled).toBe(true);
    expect(ours('Small Video').enabled).toBe(false);                    // his
    expect(ours('Large Video').transform).toMatchObject({ positionX: 123, scaleX: 0.5 });   // his
    expect(state.get().off).toEqual([]);
    // Connects with the switch on touch none of it either.
    await r.source.apply({ on: true, protect: r.protect });
    expect(ours('Small Video').enabled).toBe(false);
    expect(ours('Large Video').transform).toMatchObject({ positionX: 123, scaleX: 0.5 });
    // Only a change of the HUD's size fits it again, to the game video.
    r.sizeBox.value = { width: 2752, height: 1152 };
    await r.source.apply({ on: true, protect: r.protect });
    expect(ours('Large Video').transform).toMatchObject({ positionX: 0, positionY: 0, boundsType: 'OBS_BOUNDS_NONE' });
    expect(ours('Large Video').transform.scaleX).toBeCloseTo(3440 / 2752, 5);
    expect(ours('Small Video').enabled).toBe(false);
    // The state lost: what is disabled is Racing Desk's to enable once, rather than a HUD that never comes back.
    const lost = rig({ state: memory() });
    try {
      await until(() => lost.client.identified());
      await lost.source.apply({ on: true, protect: lost.protect });
      expect(ours('Small Video').enabled).toBe(true);
    } finally { lost.dispose(); }
  } finally { r.dispose(); }
});

test('the HUD goes into the collection the switch was turned on in, and no other: on another collection a connect leaves it alone, the window stays in the capture, and coming back puts it to rights; the switch turned on again takes the collection it is on', async () => {
  const state = memory();
  const r = rig({ state });
  try {
    await until(() => r.client.identified());
    await r.source.apply({ on: true, fresh: true, protect: r.protect });
    expect(state.get().collection).toBe('sim race 2k');
    // OBS is on another collection of his, with nothing of his to put the HUD above.
    const mine = JSON.parse(JSON.stringify(server.state.scenes));
    const mineInputs = server.state.inputs.slice();
    otherCollection('commentary');
    server.requests.length = 0;
    r.protectCalls.length = 0;
    const away = await r.source.apply({ on: true, protect: r.protect });
    expect(away).toMatchObject({ ok: true, away: true, scenes: 0 });
    expect(away.did).toBe('The HUD source is in the scene collection "sim race 2k"; OBS is on "commentary", so it was left alone.');
    expect(r.protectCalls.map((c) => c.value)).toEqual([false]);
    for (const type of ['CreateInput', 'CreateSceneItem', 'SetSceneItemEnabled', 'SetSceneItemIndex', 'SetSceneItemTransform', 'SetInputSettings', 'PressInputPropertiesButton']) expect(requests(type), type).toHaveLength(0);
    // Back on his sim collection: the HUD is as it was, the window out of the capture again.
    server.state.collection = 'sim race 2k';
    server.state.scenes = mine;
    server.state.inputs = mineInputs;
    server.state.currentScene = 'Large Video';
    r.protectCalls.length = 0;
    expect(await r.source.apply({ on: true, protect: r.protect })).toMatchObject({ ok: true, scenes: 3 });
    expect(r.protectCalls.map((c) => c.value)).toEqual([true]);
    // The switch turned on in the other collection (when it has a game video) makes that the one.
    server.state.collection = 'commentary';
    server.state.scenes = [{ sceneName: 'live', items: [] }];
    // (no game video there: nothing is added, and nothing is remembered)
    const none = await r.source.apply({ on: true, fresh: true, protect: r.protect });
    expect(none).toMatchObject({ ok: false, scenes: 0 });
    expect(none.did).toBe('None of the scenes in "commentary" has an item named game video to put the HUD above, so it was not added.');
  } finally { r.dispose(); }
});

test('a scene with no item named game video gets no HUD, and nothing is guessed from the captures it has: his sim video with voice has a SimHub window and a game capture of another name', async () => {
  otherCollection('sim video with voice');
  const r = rig();
  try {
    await until(() => r.client.identified());
    const answer = await r.source.apply({ on: true, fresh: true, protect: r.protect });
    expect(answer).toMatchObject({ ok: false, scenes: 0, created: false });
    expect(answer.did).toBe('None of the scenes in "sim video with voice" has an item named game video to put the HUD above, so it was not added.');
    for (const type of ['CreateInput', 'CreateSceneItem', 'SetSceneItemEnabled', 'SetSceneItemIndex', 'SetSceneItemTransform']) expect(requests(type), type).toHaveLength(0);
    expect(server.state.inputs.some((i) => i.inputName === INPUT_NAME)).toBe(false);
    // The window stays in the capture: the HUD OBS can still film is the one on the screen. Nothing is remembered.
    expect(r.protectCalls.map((c) => c.value)).toEqual([false]);
    expect(r.state.get()).toBeNull();
  } finally { r.dispose(); }
  // A collection with a scene that has a game video and one that has none: the first only (a fresh OBS, his sim race 2k).
  await server.close();
  server = await startFakeObs({ password: PASSWORD });
  server.state.scenes.push({ sceneName: 'Camera only', items: [] });
  server.state.scenes.push({ sceneName: 'Dashboard only', items: [{ sceneItemId: 70, sourceName: 'Lovely Dashboard Companion', enabled: true, transform: { positionX: 0, positionY: 0, rotation: 0, scaleX: 1, scaleY: 1, alignment: 5, boundsType: 'OBS_BOUNDS_NONE', boundsAlignment: 0, boundsWidth: 0, boundsHeight: 0, sourceWidth: 3440, sourceHeight: 1440, width: 3440, height: 1440 } }] });
  const r2 = rig();
  try {
    await until(() => r2.client.identified());
    const answer = await r2.source.apply({ on: true, fresh: true, protect: r2.protect });
    expect(answer).toMatchObject({ ok: true, scenes: 3 });
    expect(names('Camera only')).toEqual([]);
    expect(names('Dashboard only')).toEqual(['Lovely Dashboard Companion']);
    // Off: only the scenes that have it are touched.
    expect((await r2.source.apply({ on: false, protect: r2.protect })).scenes).toBe(3);
  } finally { r2.dispose(); }
});

test('the HUD is not given to OBS while nothing serves its page: the source is switched off, the window stays in the capture, and one sentence says why', async () => {
  let up = true;
  const r = rig({ ready: () => up });
  try {
    await until(() => r.client.identified());
    await r.source.apply({ on: true, fresh: true, protect: r.protect });
    for (const scene of ALL) expect(ours(scene).enabled, scene).toBe(true);
    up = false;   // the listener's port was taken, or it went away
    r.protectCalls.length = 0;
    server.requests.length = 0;
    const answer = await r.source.apply({ on: true, protect: r.protect });
    expect(answer).toMatchObject({ ok: false, reason: LISTENER_DOWN });
    expect(LISTENER_DOWN).toBe("The HUD's page is not being served on this PC (another program may hold its port), so OBS was not given the HUD.");
    expect(r.protectCalls.map((c) => c.value)).toEqual([false]);
    for (const scene of ALL) expect(ours(scene).enabled, scene).toBe(false);   // not a page that is not there
    expect(requests('CreateInput')).toHaveLength(0);
    expect(requests('SetInputSettings')).toHaveLength(0);
    // The page's address is the listener's own port, whatever the settings file says: it comes from where it is, here as an
    // address that is not there yet.
    const noAddress = rig({ url: null });
    try {
      await until(() => noAddress.client.identified());
      expect(await noAddress.source.apply({ on: true, protect: noAddress.protect })).toMatchObject({ ok: false, reason: LISTENER_DOWN });
    } finally { noAddress.dispose(); }
  } finally { r.dispose(); }
});

test('the source is the HUD\'s size in DIPs and OBS scales it up to the game video: an ultrawide at 125 % lays the page out in 2752 × 1152, as the rig\'s window does, and the item is 1.25 times that', async () => {
  const r = rig({ size: { width: 2752, height: 1152 } });
  try {
    await until(() => r.client.identified());
    await r.source.apply({ on: true, fresh: true, protect: r.protect });
    expect(requests('CreateInput')[0].data.inputSettings).toMatchObject({ width: 2752, height: 1152 });
    expect(ours('Large Video').transform.scaleX).toBeCloseTo(1.25, 5);
    expect(ours('Large Video').transform.scaleY).toBeCloseTo(1.25, 5);
    // A scene that scales the game to bounds scales the HUD to the same bounds.
    expect(ours('2up').transform).toMatchObject({ boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 1720, boundsHeight: 720 });
  } finally { r.dispose(); }
});

test('the switch thrown twice quickly: the last word is what stands, one at a time; after the quit nothing is enabled', async () => {
  const r = rig();
  try {
    await until(() => r.client.identified());
    const a = r.source.apply({ on: true, fresh: true, protect: r.protect });
    const b = r.source.apply({ on: false, protect: r.protect });
    const c = r.source.apply({ on: true, fresh: true, protect: r.protect });
    const answers = await Promise.all([a, b, c]);
    expect(answers[2]).toMatchObject({ ok: true, scenes: 3 });
    for (const scene of ALL) expect(ours(scene).enabled, scene).toBe(true);
    // The quit: switched off, and no apply after it enables anything.
    expect((await r.source.disable({ final: true })).scenes).toBe(3);
    const after = await r.source.apply({ on: true, protect: r.protect });
    expect(after.ok).not.toBe(true);
    for (const scene of ALL) expect(ours(scene).enabled, scene).toBe(false);
  } finally { r.dispose(); }
});

test('off, with no source in OBS yet, nothing is made; a connect reloads the page only if the source is there; with OBS closed nothing is asked, and the window follows the switch', async () => {
  const r = rig();
  try {
    await until(() => r.client.identified());
    expect(await r.source.disable()).toMatchObject({ ok: true, scenes: 0, did: 'OBS has no HUD source to switch off.' });
    expect(await r.source.refresh()).toMatchObject({ ok: false, reason: 'no HUD source in OBS' });
    expect(server.state.inputs.some((i) => i.inputName === INPUT_NAME)).toBe(false);
    await r.source.ensure({ fresh: true, protect: r.protect });
    expect(await r.source.refresh()).toEqual({ ok: true });
    expect(server.state.pressed).toHaveLength(2);
    // A scene OBS will not take the item into is said, and the rest are done.
    await r.source.disable();   // Racing Desk's own switching off: it is what it will switch on again
    server.fail('SetSceneItemEnabled', 702, 'the scene is locked');
    const partly = await r.source.ensure({ fresh: true, protect: r.protect });
    expect(partly.ok).toBe(false);
    expect(partly.problems).toEqual(['The HUD could not be put in the scene "Large Video": SetSceneItemEnabled: the scene is locked']);
    expect(partly.scenes).toBe(2);
    expect(r.source.status().last.problems).toHaveLength(1);
  } finally { r.dispose(); }
  // OBS closed: nothing is asked, in words.
  const closed = await startFakeObs({ password: PASSWORD });
  const freePort = closed.port;
  await closed.close();
  const r2 = rig({ port: freePort });
  try {
    await until(() => r2.client.state().phase === 'closed');
    expect(await r2.source.ensure()).toEqual({ ok: false, reason: "OBS isn't open, so the HUD source waits for it." });
    expect(await r2.source.disable()).toEqual({ ok: false, reason: "OBS isn't open, so the HUD source waits for it." });
    expect(await r2.source.refresh()).toEqual({ ok: false, reason: "OBS isn't open, so the HUD source waits for it." });
    // The window follows the switch, since OBS is not there to be asked: on, out of the capture; off, in.
    expect(await r2.source.apply({ on: true, protect: r2.protect })).toEqual({ ok: false, reason: "OBS isn't open, so the HUD source waits for it." });
    expect(await r2.source.apply({ on: false, protect: r2.protect })).toEqual({ ok: false, reason: "OBS isn't open, so the HUD source waits for it." });
    expect(r2.protectCalls.map((c) => c.value)).toEqual([true, false]);
  } finally { r2.dispose(); }
});

test('what the HUD source keeps is a file, written whole through a temp file; one that is not there or cannot be read is none, and a write that fails is said, not thrown', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { fileState } = require('../../modules/js/obs/hud-source.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-hud-state-'));
  try {
    const file = path.join(dir, 'sub', 'hud-source-state.json');
    const lines = [];
    const state = fileState(file, { log: (l) => lines.push(l) });
    expect(state.read()).toBeNull();
    state.write({ collection: 'sim race 2k', off: ['Large Video', '2up'] });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ collection: 'sim race 2k', off: ['Large Video', '2up'], view: 'rig', ipad: {} });
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    expect(state.read()).toEqual({ collection: 'sim race 2k', off: ['Large Video', '2up'], view: 'rig', ipad: {} });
    fs.writeFileSync(file, '{ not json');
    expect(state.read()).toBeNull();
    fs.writeFileSync(file, JSON.stringify({ collection: 5, off: ['a', 7, null] }));
    expect(state.read()).toEqual({ collection: null, off: ['a'], view: 'rig', ipad: {} });
    // The iPad dashboard's places: a scene with his transform (numbers and the bounds' word), one placed and never left
    // (null), and nothing that is not one of those. A file from before the choice is the rig HUD's.
    state.write({ collection: 'sim race 2k', off: [], view: 'ipad', ipad: { 'Large Video': { positionX: 40, positionY: 800, boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 829, boundsHeight: 576, name: 'no', bad: NaN }, '2up': null, Camera: 'yes', Other: [1] } });
    expect(state.read()).toEqual({ collection: 'sim race 2k', off: [], view: 'ipad', ipad: { 'Large Video': { positionX: 40, positionY: 800, boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 829, boundsHeight: 576 }, '2up': null } });
    fs.writeFileSync(file, JSON.stringify({ collection: 'x', off: [], view: 'television', ipad: 'none' }));
    expect(state.read()).toEqual({ collection: 'x', off: [], view: 'rig', ipad: {} });
    const failing = fileState(file, { fs: { ...fs.default, mkdirSync: () => { throw new Error('the disk is read-only'); } }, log: (l) => lines.push(l) });
    failing.write({ collection: 'x', off: [] });
    expect(lines).toEqual(['[RacingDesk] HUD source: its state file could not be written: the disk is read-only']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── "iPad dashboard": the other thing OBS may draw ──
// The loopback listener's /obs-ipad page at an iPad's size, placed once in the bottom-left corner of the game video at
// half its height and never moved or sized by Racing Desk again; the choice changes the source's address and
// size, and what he did to the item in OBS is his.

// A scene's key in the state file: its uuid, which the fake makes of its name.
const uuid = (name) => `uuid-${name}`;
const corner = (game, { width = IPAD_SOURCE.width, height = IPAD_SOURCE.height } = {}) => {
  const h = Math.round(game.height * IPAD_PLACE.height);
  const w = Math.round(h * width / height);
  const inset = Math.round(Math.min(game.width, game.height) * IPAD_PLACE.inset);
  return { positionX: game.left + inset, positionY: game.top + game.height - inset - h, alignment: 5, rotation: 0, boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsAlignment: 0, boundsWidth: w, boundsHeight: h };
};
const LARGE = { left: 0, top: 0, width: 3440, height: 1440 };
const TWO_UP = { left: 0, top: 360, width: 1720, height: 720 };

test('the iPad dashboard: the source is the /obs-ipad page at 1180 by 820, put in the bottom-left corner of the game video at half its height, once per scene; later connects leave it where it is, and so does a choice made again', async () => {
  const r = rig({ view: 'ipad' });
  try {
    await until(() => r.client.identified());
    const answer = await r.source.apply({ on: true, fresh: true, protect: r.protect });
    expect(answer).toMatchObject({ ok: true, created: true, scenes: 3, view: 'ipad', problems: [] });
    expect(answer.did).toBe('The iPad dashboard is a browser source in 3 of your scenes, in its corner over the game.');
    expect(IPAD_SOURCE).toEqual({ width: 1180, height: 820 });
    expect(IPAD_PLACE).toEqual({ height: 0.5, inset: 0.02 });
    expect(requests('CreateInput')[0].data.inputSettings).toEqual({ url: URLS.ipad, width: 1180, height: 820, fps_custom: false, shutdown: false, restart_when_active: false, reroute_audio: false });
    // Above the game, below the facecam, as the rig HUD is.
    for (const scene of ALL) expect(names(scene), scene).toEqual(['game video', INPUT_NAME, 'Video Capture Device']);
    // In the corner, scaled inside bounds that keep the page's shape: 720 high by 1036 wide on the 1440 canvas, 29 px in
    // from the bottom-left; in the 2up, inside the game's own box (360 by 518, 14 px in).
    expect(ours('Large Video').transform).toMatchObject(corner(LARGE));
    expect(ours('Large Video').transform).toMatchObject({ positionX: 29, positionY: 1440 - 29 - 720, boundsWidth: 1036, boundsHeight: 720 });
    expect(ours('Small Video').transform).toMatchObject(corner(LARGE));
    expect(ours('2up').transform).toMatchObject(corner(TWO_UP));
    expect(ours('2up').transform).toMatchObject({ positionX: 14, positionY: 360 + 720 - 14 - 360, boundsWidth: 518, boundsHeight: 360 });
    // Never stretched over the game: nothing fitted it to the game's bounds.
    expect(ours('2up').transform.boundsWidth).not.toBe(1720);
    expect(server.state.pressed).toHaveLength(1);
    // The page is laid out at the item's box: the source's size is the corner's in the scene OBS is on (1036 by 720 on
    // the 1440 canvas), not the iPad's it was made at. The item itself is not touched for it.
    // That is under the least iPad's 744 high, so the page is laid out at its shape scaled up to it, 1071 by 744, and OBS
    // draws it into the corner.
    expect(inputNow()).toMatchObject({ url: URLS.ipad, ...laidOutAt(1036, 720) });
    expect(inputNow()).toMatchObject({ width: 1071, height: 744 });
    expect(requests('SetInputSettings').filter((q) => 'width' in q.data.inputSettings).map((q) => q.data.inputSettings)).toEqual([{ width: 1071, height: 744 }]);
    expect(r.source.status().followed).toMatchObject({ sceneName: 'Large Video', width: 1071, height: 744 });
    // Written down: placed in each scene, nothing of his kept yet.
    expect(r.state.get()).toEqual({ collection: 'sim race 2k', off: [], view: 'ipad', ipad: { [uuid('Large Video')]: null, [uuid('Small Video')]: null, [uuid('2up')]: null } });

    // He moves it, sizes it, hides it in a scene. Another connect, and the choice made again: his, and the page is laid
    // out at the box he gave it.
    ours('Large Video').transform.positionX = 2400;
    ours('Large Video').transform.positionY = 100;
    ours('Large Video').transform.boundsWidth = 1200;
    ours('Large Video').transform.boundsHeight = 834;
    ours('Small Video').enabled = false;
    server.requests.length = 0;
    server.state.pressed.length = 0;
    const again = await r.source.apply({ on: true, protect: r.protect });
    expect(again).toMatchObject({ ok: true, created: false, scenes: 3, view: 'ipad' });
    expect(requests('SetSceneItemTransform')).toHaveLength(0);
    expect(requests('SetSceneItemIndex')).toHaveLength(0);
    // The address (and nothing of the size) kept current, then the size to his box: the page loaded afresh at it.
    expect(requests('SetInputSettings').map((q) => q.data.inputSettings)).toEqual([
      { url: URLS.ipad, fps_custom: false, shutdown: false, restart_when_active: false, reroute_audio: false },
      { width: 1200, height: 834 },
    ]);
    expect(inputNow()).toMatchObject({ url: URLS.ipad, width: 1200, height: 834 });
    expect(server.state.pressed).toHaveLength(1);
    expect(ours('Large Video').transform).toMatchObject({ positionX: 2400, positionY: 100, boundsWidth: 1200, boundsHeight: 834 });
    expect(ours('Small Video').enabled).toBe(false);
    // The rig's screen changing is nothing to the iPad dashboard's size or place; a box that has not changed asks nothing.
    r.sizeBox.value = { width: 2752, height: 1152 };
    server.requests.length = 0;
    await r.source.apply({ on: true, protect: r.protect });
    expect(requests('SetSceneItemTransform')).toHaveLength(0);
    expect(requests('SetInputSettings').filter((q) => 'width' in q.data.inputSettings)).toHaveLength(0);
    expect(ours('Large Video').transform).toMatchObject({ positionX: 2400, positionY: 100 });
    // A new scene with a game video gets it placed, in its corner, and the others are left alone.
    server.state.scenes.push({ sceneName: 'Night', items: [{ sceneItemId: 80, sourceName: 'game video', enabled: true, transform: { positionX: 100, positionY: 50, rotation: 0, scaleX: 0.5, scaleY: 0.5, alignment: 5, boundsType: 'OBS_BOUNDS_NONE', boundsAlignment: 0, boundsWidth: 0, boundsHeight: 0, sourceWidth: 3440, sourceHeight: 1440, width: 1720, height: 720 } }] });
    await r.source.apply({ on: true, protect: r.protect });
    expect(ours('Night').transform).toMatchObject(corner({ left: 100, top: 50, width: 1720, height: 720 }));
    expect(ours('Large Video').transform).toMatchObject({ positionX: 2400, positionY: 100 });
    expect(Object.keys(r.state.get().ipad).sort()).toEqual(['2up', 'Large Video', 'Night', 'Small Video'].map(uuid).sort());
  } finally { r.dispose(); }
});

test('the choice changed: from the rig HUD to the iPad dashboard the source gets the other address and size and the item is placed in the corner, once; back to the rig HUD it is fitted over the game again and his place for the dashboard is kept; chosen again, it goes back where he had it', async () => {
  const state = memory();
  const r = rig({ state });
  try {
    await until(() => r.client.identified());
    await r.source.apply({ on: true, fresh: true, protect: r.protect });   // the rig HUD, fitted to the game
    expect(ours('2up').transform).toMatchObject({ boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 1720, boundsHeight: 720 });
    expect(state.get().view).toBe('rig');
    // The iPad dashboard chosen on the desk.
    r.viewBox.value = 'ipad';
    server.requests.length = 0;
    const toIpad = await r.source.apply({ on: true, protect: r.protect });
    expect(toIpad).toMatchObject({ ok: true, created: false, scenes: 3, view: 'ipad' });
    expect(requests('CreateInput')).toHaveLength(0);
    // The other address (no size with it: the item's box is the size), then the page laid out at the corner it is put in.
    expect(requests('SetInputSettings')[0].data.inputSettings).toMatchObject({ url: URLS.ipad });
    expect(requests('SetInputSettings')[0].data.inputSettings).not.toHaveProperty('width');
    expect(ours('Large Video').transform).toMatchObject(corner(LARGE));
    expect(ours('2up').transform).toMatchObject(corner(TWO_UP));
    expect(inputNow()).toMatchObject({ url: URLS.ipad, ...laidOutAt(1036, 720) });
    expect(server.state.pressed).toHaveLength(2);   // the other page: loaded afresh
    expect(state.get()).toMatchObject({ view: 'ipad', ipad: { [uuid('Large Video')]: null, [uuid('Small Video')]: null, [uuid('2up')]: null } });
    // He puts it top right in the large scene and leaves the rest.
    Object.assign(ours('Large Video').transform, { positionX: 2500, positionY: 40, boundsWidth: 900, boundsHeight: 625 });
    // Back to the rig HUD: fitted over the game, and his place for the dashboard written down.
    r.viewBox.value = 'rig';
    server.requests.length = 0;
    const toRig = await r.source.apply({ on: true, protect: r.protect });
    expect(toRig).toMatchObject({ ok: true, scenes: 3, view: 'rig' });
    expect(toRig.did).toBe('The HUD is a browser source in 3 of your scenes, just above the game.');
    expect(requests('SetInputSettings')[0].data.inputSettings).toMatchObject({ url: URLS.rig, width: 3440, height: 1440 });
    expect(ours('Large Video').transform).toMatchObject({ positionX: 0, positionY: 0, boundsType: 'OBS_BOUNDS_NONE', scaleX: 1, scaleY: 1 });
    expect(ours('2up').transform).toMatchObject({ boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 1720, boundsHeight: 720 });
    expect(state.get().view).toBe('rig');
    expect(state.get().ipad[uuid('Large Video')]).toEqual({ positionX: 2500, positionY: 40, alignment: 5, rotation: 0, scaleX: 1, scaleY: 1, boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsAlignment: 0, boundsWidth: 900, boundsHeight: 625 });
    expect(state.get().ipad[uuid('2up')]).toMatchObject({ boundsWidth: 518, boundsHeight: 360 });
    // The iPad dashboard again: where he had it, not the corner, and the page laid out at that box.
    r.viewBox.value = 'ipad';
    await r.source.apply({ on: true, protect: r.protect });
    expect(ours('Large Video').transform).toMatchObject({ positionX: 2500, positionY: 40, boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 900, boundsHeight: 625 });
    expect(ours('2up').transform).toMatchObject(corner(TWO_UP));
    expect(inputNow()).toMatchObject({ url: URLS.ipad, ...laidOutAt(900, 625) });
    expect(inputNow()).toMatchObject({ width: 1071, height: 744 });
    // And a Racing Desk started afresh with the choice already made (the state file read at its start): nothing moved.
    r.dispose();
    const next = rig({ state, view: 'ipad' });
    try {
      await until(() => next.client.identified());
      server.requests.length = 0;
      await next.source.apply({ on: true, protect: next.protect });
      expect(requests('SetSceneItemTransform')).toHaveLength(0);
      expect(ours('Large Video').transform).toMatchObject({ positionX: 2500, positionY: 40 });
    } finally { next.dispose(); }
  } finally { /* disposed above */ }
});

test('the game video placed by its centre, or scaled with no bounds: the corner is worked out from the box it really covers', async () => {
  // The large scene's game video is set by its centre at half size; the small one's by its bottom-right corner.
  const large = sceneItems('Large Video').find((i) => i.sourceName === 'game video');
  Object.assign(large.transform, { alignment: 0, positionX: 1720, positionY: 720, scaleX: 0.5, scaleY: 0.5, width: 1720, height: 720 });
  const small = sceneItems('Small Video').find((i) => i.sourceName === 'game video');
  Object.assign(small.transform, { alignment: 2 | 8, positionX: 3440, positionY: 1440, scaleX: 1, scaleY: 1, width: 3440, height: 1440 });
  const r = rig({ view: 'ipad' });
  try {
    await until(() => r.client.identified());
    await r.source.apply({ on: true, fresh: true, protect: r.protect });
    expect(ours('Large Video').transform).toMatchObject(corner({ left: 860, top: 360, width: 1720, height: 720 }));
    expect(ours('Small Video').transform).toMatchObject(corner(LARGE));
  } finally { r.dispose(); }
});

test('with the switch off the iPad dashboard is switched off as the rig HUD is, and a state file from before the choice is the rig HUD\'s', async () => {
  const state = memory();
  state.write({ collection: 'sim race 2k', off: [] });   // a file from before: no view, no places
  const r = rig({ state, view: 'ipad' });
  try {
    await until(() => r.client.identified());
    await r.source.apply({ on: true, protect: r.protect });
    // Read as the rig HUD's: the choice is a change, and the item (new here) is placed in the corner.
    expect(ours('Large Video').transform).toMatchObject(corner(LARGE));
    expect(state.get()).toMatchObject({ view: 'ipad' });
    const off = await r.source.apply({ on: false, protect: r.protect });
    expect(off).toMatchObject({ ok: true, scenes: 3 });
    for (const scene of ALL) expect(ours(scene).enabled, scene).toBe(false);
    // What was written of the places survives the switching off.
    expect(state.get()).toMatchObject({ view: 'ipad', ipad: { [uuid('Large Video')]: null, [uuid('Small Video')]: null, [uuid('2up')]: null } });
    expect(state.get().off.sort()).toEqual(['2up', 'Large Video', 'Small Video']);
    // On again: enabled, not moved.
    Object.assign(ours('Large Video').transform, { positionX: 1000 });
    await r.source.apply({ on: true, fresh: true, protect: r.protect });
    for (const scene of ALL) expect(ours(scene).enabled, scene).toBe(true);
    expect(ours('Large Video').transform.positionX).toBe(1000);
  } finally { r.dispose(); }
});

// ── What is his stays his: his size for the source, a renamed scene, a state file that was lost ──

// OBS 30 and up give every scene a uuid that a rename keeps; the fake's is made of the name, so here it is made of the
// scene's place in the list instead. `none` is an OBS that gives no uuid at all.
function uuidsFollowTheScene({ none = false } = {}) {
  const original = server.handlers.GetSceneList;
  server.handlers.GetSceneList = (d, session) => {
    const answer = original(d, session);
    return { ...answer, scenes: answer.scenes.map((sc) => { const { sceneUuid, ...rest } = sc; return none ? rest : { ...rest, sceneUuid: `scene-${sc.sceneIndex}` }; }) };
  };
}
const inputNow = () => server.state.inputs.find((i) => i.inputName === INPUT_NAME).settings;
const HE_PUT_IT = { positionX: 2400, positionY: 100, boundsWidth: 1200, boundsHeight: 834 };

test('he sizes the item in OBS (wide, tall, small): the next connect lays the page out at the item\'s box — the source\'s width and height are the box\'s, or its shape scaled up to the least iPad for a box smaller than that — and moves nothing in any scene; a size typed into the source\'s own settings is not kept', async () => {
  const r = rig({ view: 'ipad' });
  try {
    await until(() => r.client.identified());
    await r.source.apply({ on: true, fresh: true, protect: r.protect });
    expect(inputNow()).toMatchObject({ width: 1071, height: 744 });
    // A wide strip, a tall column, a 1080p box, a small corner: the box he drags the item to in the scene OBS is on.
    for (const box of [{ boundsWidth: 1600, boundsHeight: 600 }, { boundsWidth: 800, boundsHeight: 1200 }, { boundsWidth: 1920, boundsHeight: 1080 }, { boundsWidth: 500.4, boundsHeight: 347.6 }]) {
      Object.assign(ours('Large Video').transform, HE_PUT_IT, box);
      server.requests.length = 0;
      server.state.pressed.length = 0;
      const again = await r.source.apply({ on: true, protect: r.protect });
      expect(again).toMatchObject({ ok: true, created: false, scenes: 3, view: 'ipad', problems: [] });
      // The page is laid out at the box, to the pixel (and loaded again at that size), or at its shape scaled up to the
      // least the layout holds; nothing is moved or sized.
      expect(inputNow()).toMatchObject({ url: URLS.ipad, ...laidOutAt(box.boundsWidth, box.boundsHeight) });
      expect(server.state.pressed).toHaveLength(1);
      expect(requests('SetSceneItemTransform')).toHaveLength(0);
      expect(requests('SetSceneItemIndex')).toHaveLength(0);
      expect(ours('Large Video').transform).toMatchObject({ ...HE_PUT_IT, ...box });
      expect(ours('Small Video').transform).toMatchObject(corner(LARGE));
      expect(ours('2up').transform).toMatchObject(corner(TWO_UP));
    }
    // The small corner (500 by 348, smaller than the least iPad): its shape scaled up, OBS drawing it into the box.
    expect(inputNow()).toMatchObject({ width: 1071, height: 744 });
    // 1366 by 1024 typed into the source's settings (an iPad Pro 13" on its side): the box is the size, and comes back.
    Object.assign(inputNow(), { width: 1366, height: 1024 });
    server.requests.length = 0;
    await r.source.apply({ on: true, protect: r.protect });
    expect(inputNow()).toMatchObject({ url: URLS.ipad, width: 1071, height: 744 });
    expect(requests('SetSceneItemTransform')).toHaveLength(0);
    // The scene OBS is on is the one the page is laid out for: on the 2up, its corner there (518 by 360: its shape at the least iPad's height).
    server.state.currentScene = '2up';
    await r.source.apply({ on: true, protect: r.protect });
    expect(inputNow()).toMatchObject({ width: 1071, height: 744 });
    expect(ours('Large Video').transform).toMatchObject({ boundsWidth: 500.4, boundsHeight: 347.6 });
  } finally { r.dispose(); }
});

test('he sizes the item while OBS is open: a moment after the last of OBS\'s transform events the page is laid out at the box, once for a whole drag; another item\'s event, and the rig HUD chosen, are nothing', async () => {
  const r = rig({ view: 'ipad', followAfterMs: 60 });
  try {
    await until(() => r.client.identified());
    await r.source.apply({ on: true, fresh: true, protect: r.protect });
    const id = ours('Large Video').sceneItemId;
    const sized = (w, h) => ({ ...ours('Large Video').transform, boundsWidth: w, boundsHeight: h });
    const TRANSFORM_INTENT = 1 << 19;
    server.requests.length = 0;
    // A drag: one event a pixel, and the last one is where he let go.
    for (const [w, h] of [[1100, 764], [1200, 834], [1300, 903], [1400, 973]]) {
      Object.assign(ours('Large Video').transform, { boundsWidth: w, boundsHeight: h });
      server.emit('SceneItemTransformChanged', { sceneName: 'Large Video', sceneItemId: id, sceneItemTransform: sized(w, h) }, TRANSFORM_INTENT);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    await until(() => inputNow().width === 1400, 4000);
    expect(inputNow()).toMatchObject({ width: 1400, height: 973 });
    expect(requests('SetInputSettings')).toHaveLength(1);
    expect(requests('SetSceneItemTransform')).toHaveLength(0);
    expect(r.source.status().followed).toMatchObject({ sceneName: 'Large Video', width: 1400, height: 973 });
    // The facecam moved: nothing. An item of ours in a scene that is not the one named: nothing.
    server.requests.length = 0;
    server.emit('SceneItemTransformChanged', { sceneName: 'Large Video', sceneItemId: 2, sceneItemTransform: { ...ours('Large Video').transform, boundsWidth: 300, boundsHeight: 200 } }, TRANSFORM_INTENT);
    server.emit('SceneItemTransformChanged', { sceneName: 'Small Video', sceneItemId: id, sceneItemTransform: sized(640, 445) }, TRANSFORM_INTENT);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(requests('SetInputSettings')).toHaveLength(0);
    expect(inputNow()).toMatchObject({ width: 1400, height: 973 });
    // The box he lets go of is the one the source has already: nothing is asked of OBS but its settings.
    server.emit('SceneItemTransformChanged', { sceneName: 'Large Video', sceneItemId: id, sceneItemTransform: sized(1400, 973) }, TRANSFORM_INTENT);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(requests('SetInputSettings')).toHaveLength(0);
    // With the rig HUD chosen, an event for the item is nothing.
    r.viewBox.value = 'rig';
    server.emit('SceneItemTransformChanged', { sceneName: 'Large Video', sceneItemId: id, sceneItemTransform: sized(900, 625) }, TRANSFORM_INTENT);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(requests('SetInputSettings')).toHaveLength(0);
    expect(inputNow()).toMatchObject({ width: 1400, height: 973 });
    // What the source is handed that is not an event of OBS's is nothing too.
    for (const bad of [null, 'x', {}, { sceneName: 'Large Video' }, { sceneName: 'Large Video', sceneItemId: id }]) expect(r.source.transformChanged(bad)).toBe(false);
  } finally { r.dispose(); }
});

test('an item he has set to no bounds and scaled: the source takes the box it covers and the scale goes to one, so the box is what it was to the pixel; nothing else of the item is written', async () => {
  const r = rig({ view: 'ipad' });
  try {
    await until(() => r.client.identified());
    await r.source.apply({ on: true, fresh: true, protect: r.protect });
    // 1036 by 720 at a scale of 1.5: a box of 1554 by 1080, as obs-websocket reports it (width and height are the scaled size).
    Object.assign(ours('Large Video').transform, { boundsType: 'OBS_BOUNDS_NONE', boundsWidth: 0, boundsHeight: 0, scaleX: 1.5, scaleY: 1.5, sourceWidth: 1036, sourceHeight: 720, width: 1554, height: 1080, positionX: 2400, positionY: 100 });
    server.requests.length = 0;
    await r.source.apply({ on: true, protect: r.protect });
    expect(inputNow()).toMatchObject({ width: 1554, height: 1080 });
    expect(requests('SetSceneItemTransform').map((q) => q.data)).toEqual([{ sceneName: 'Large Video', sceneItemId: ours('Large Video').sceneItemId, sceneItemTransform: { scaleX: 1, scaleY: 1 } }]);
    expect(ours('Large Video').transform).toMatchObject({ positionX: 2400, positionY: 100, scaleX: 1, scaleY: 1, boundsType: 'OBS_BOUNDS_NONE' });
    // Again: the scale is one and the size the box's, so nothing is written.
    Object.assign(ours('Large Video').transform, { width: 1554, height: 1080 });
    server.requests.length = 0;
    await r.source.apply({ on: true, protect: r.protect });
    expect(requests('SetSceneItemTransform')).toHaveLength(0);
    expect(requests('SetInputSettings').filter((q) => 'width' in q.data.inputSettings)).toHaveLength(0);
    // Shrunk to 777 by 540 (a scale of a half on the 1554 by 1080 source): under the least the layout holds, so the page
    // is laid out at the box's shape scaled up to the least iPad's (1071 by 744), and the scale is what keeps the box.
    Object.assign(ours('Large Video').transform, { scaleX: 0.5, scaleY: 0.5, sourceWidth: 1554, sourceHeight: 1080, width: 777, height: 540 });
    server.requests.length = 0;
    await r.source.apply({ on: true, protect: r.protect });
    expect(inputNow()).toMatchObject(laidOutAt(777, 540));
    expect(inputNow()).toMatchObject({ width: 1071, height: 744 });
    const set = requests('SetSceneItemTransform').map((q) => q.data.sceneItemTransform);
    expect(set).toHaveLength(1);
    expect(set[0].scaleX).toBeCloseTo(777 / 1071, 4);
    expect(set[0].scaleY).toBeCloseTo(540 / 744, 4);
  } finally { r.dispose(); }
});

test('he renames a scene in OBS: the item he moved stays where it is, because the place is kept by the scene\'s uuid; a place written under the name before is found by it and kept by the uuid from then on', async () => {
  const state = memory();
  // First run with an OBS that gives no uuid: the places are written under the scenes' names.
  uuidsFollowTheScene({ none: true });
  const first = rig({ view: 'ipad', state });
  try {
    await until(() => first.client.identified());
    await first.source.apply({ on: true, fresh: true, protect: first.protect });
    expect(Object.keys(state.get().ipad).sort()).toEqual(['2up', 'Large Video', 'Small Video']);
  } finally { first.dispose(); }
  Object.assign(ours('Large Video').transform, HE_PUT_IT);
  // The next, with an OBS that gives them (OBS updated): the places are found by name and kept by uuid from then on.
  uuidsFollowTheScene();
  const r = rig({ view: 'ipad', state });
  try {
    await until(() => r.client.identified());
    server.requests.length = 0;
    await r.source.apply({ on: true, protect: r.protect });
    expect(requests('SetSceneItemTransform')).toHaveLength(0);
    expect(Object.keys(state.get().ipad).sort()).toEqual(['scene-0', 'scene-1', 'scene-2']);
    // He renames the large scene (and OBS is on it). Nothing is "never placed", so nothing is moved.
    server.state.scenes[0].sceneName = 'Race';
    server.state.currentScene = 'Race';
    server.requests.length = 0;
    const renamed = await r.source.apply({ on: true, protect: r.protect });
    expect(renamed).toMatchObject({ ok: true, scenes: 3, view: 'ipad', problems: [] });
    expect(requests('SetSceneItemTransform')).toHaveLength(0);
    expect(requests('SetSceneItemIndex')).toHaveLength(0);
    expect(ours('Race').transform).toMatchObject(HE_PUT_IT);
    expect(Object.keys(state.get().ipad).sort()).toEqual(['scene-0', 'scene-1', 'scene-2']);
    // Choosing the rig HUD writes his place for the renamed scene, and the dashboard comes back to it.
    r.viewBox.value = 'rig';
    await r.source.apply({ on: true, protect: r.protect });
    expect(state.get().ipad['scene-2']).toMatchObject(HE_PUT_IT);   // the list is numbered from the bottom: the large scene is first in the fake, so scene-2
    r.viewBox.value = 'ipad';
    await r.source.apply({ on: true, protect: r.protect });
    expect(ours('Race').transform).toMatchObject(HE_PUT_IT);
  } finally { r.dispose(); }
});

test('an OBS that gives no scene uuid, and a scene renamed: the item he moved is left where it is and written down under its new name; nothing is moved for want of a record', async () => {
  uuidsFollowTheScene({ none: true });
  const state = memory();
  const r = rig({ view: 'ipad', state });
  try {
    await until(() => r.client.identified());
    await r.source.apply({ on: true, fresh: true, protect: r.protect });
    Object.assign(ours('Large Video').transform, HE_PUT_IT);
    server.state.scenes[0].sceneName = 'Race';
    server.state.currentScene = 'Race';
    server.requests.length = 0;
    await r.source.apply({ on: true, protect: r.protect });
    expect(requests('SetSceneItemTransform')).toHaveLength(0);
    expect(ours('Race').transform).toMatchObject(HE_PUT_IT);
    expect(state.get().ipad.Race).toBeNull();
  } finally { r.dispose(); }
});

test('nothing written of an item that is there (the state file lost, or the switch turned on afresh in another collection and back): his item stays where he put it; the rig HUD left fitted over the game goes to the corner', async () => {
  // The rig HUD, fitted over the game in every scene, by a Racing Desk whose state is then lost.
  const rigState = memory();
  const before = rig({ state: rigState });
  try {
    await until(() => before.client.identified());
    await before.source.apply({ on: true, fresh: true, protect: before.protect });
    expect(ours('Large Video').transform).toMatchObject({ positionX: 0, positionY: 0, scaleX: 1, scaleY: 1 });
  } finally { before.dispose(); }
  // The iPad dashboard chosen, with no state (the file lost): the item covers the game, so it is the rig HUD's.
  const lost = memory();
  const afterLoss = rig({ view: 'ipad', state: lost });
  try {
    await until(() => afterLoss.client.identified());
    await afterLoss.source.apply({ on: true, protect: afterLoss.protect });
    for (const scene of ['Large Video', 'Small Video']) expect(ours(scene).transform, scene).toMatchObject(corner(LARGE));
    expect(ours('2up').transform).toMatchObject(corner(TWO_UP));
    expect(Object.values(lost.get().ipad)).toEqual([null, null, null]);
    // He moves two of them and sizes the third.
    Object.assign(ours('Large Video').transform, HE_PUT_IT);
    Object.assign(ours('2up').transform, { positionX: 900, positionY: 400, boundsWidth: 700, boundsHeight: 486 });
    Object.assign(ours('Small Video').transform, { boundsWidth: 1180, boundsHeight: 820 });
  } finally { afterLoss.dispose(); }
  // The switch turned on afresh in another collection and back: the state says another collection, so what was written of
  // this one is gone. His items are not the rig HUD's fit, and stay.
  const other = memory();
  other.write({ collection: 'commentary', off: [], view: 'ipad', ipad: {} });
  const back = rig({ view: 'ipad', state: other });
  try {
    await until(() => back.client.identified());
    server.requests.length = 0;
    const answer = await back.source.apply({ on: true, fresh: true, protect: back.protect });
    expect(answer).toMatchObject({ ok: true, scenes: 3, view: 'ipad' });
    expect(requests('SetSceneItemTransform')).toHaveLength(0);
    expect(ours('Large Video').transform).toMatchObject(HE_PUT_IT);
    expect(ours('2up').transform).toMatchObject({ positionX: 900, positionY: 400, boundsWidth: 700, boundsHeight: 486 });
    expect(ours('Small Video').transform).toMatchObject({ boundsWidth: 1180, boundsHeight: 820 });
    // Written down as placed now, so that the choice going to the rig HUD and back finds his place.
    expect(Object.values(other.get().ipad)).toEqual([null, null, null]);
  } finally { back.dispose(); }
});
