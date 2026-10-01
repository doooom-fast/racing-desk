/**
 * "HUD drawn by OBS" (modules/js/obs/hud-source.js) over the real OBS client and the fake obs-websocket server on
 * 127.0.0.1, whose scene collection is shaped like his: three scenes, the game's display capture at the bottom of each
 * and the facecam above it. Held: the input is made once and never twice; an item of it goes into every scene, just
 * above the game video and below the facecam, with the game video's place and size; the page is reloaded; off, every
 * item is disabled and nothing of his is removed; a connect reloads the page; with OBS closed nothing is asked.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import { startFakeObs } from './fake-obs.mjs';

const require = createRequire(import.meta.url);
const { createObsClient } = require('../../modules/js/obs/client.js');
const { createHudSource, INPUT_NAME, REFRESH_BUTTON } = require('../../modules/js/obs/hud-source.js');

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

function rig({ port = server.port, url = 'http://127.0.0.1:9091/obs', size = { width: 3440, height: 1440 } } = {}) {
  const lines = [];
  const client = createObsClient({ port, password: () => PASSWORD, retryMs: 40, connectTimeoutMs: 500, log: (l) => lines.push(l) });
  const source = createHudSource({ client, url: () => url, size: () => size, log: (l) => lines.push(l) });
  client.start();
  return { client, source, lines, dispose: () => client.stop() };
}

const sceneItems = (name) => server.state.scenes.find((s) => s.sceneName === name).items;
const names = (name) => sceneItems(name).map((i) => i.sourceName);
const ours = (name) => sceneItems(name).find((i) => i.sourceName === INPUT_NAME);
const requests = (type) => server.requests.filter((q) => q.type === type);

test('switched on: one browser source, in every scene just above the game video and below the facecam, fitted to the game video, enabled, and reloaded', async () => {
  const r = rig();
  try {
    await until(() => r.client.identified());
    const answer = await r.source.ensure();
    expect(answer).toMatchObject({ ok: true, created: true, scenes: 3, problems: [] });
    expect(answer.did).toBe('The HUD is a browser source in 3 of your scenes, just above the game.');
    // One input, made once, with the page's address and the HUD's size, as a browser source that keeps its page.
    expect(requests('CreateInput')).toHaveLength(1);
    expect(requests('CreateInput')[0].data).toMatchObject({ sceneName: 'Large Video', inputName: INPUT_NAME, inputKind: 'browser_source', sceneItemEnabled: true });
    expect(requests('CreateInput')[0].data.inputSettings).toEqual({ url: 'http://127.0.0.1:9091/obs', width: 3440, height: 1440, fps_custom: false, shutdown: false, restart_when_active: false, reroute_audio: false });
    expect(server.state.inputs.filter((i) => i.inputName === INPUT_NAME)).toHaveLength(1);
    // The other scenes got an item of the same input (CreateSceneItem), not a second input.
    expect(requests('CreateSceneItem').map((q) => q.data.sceneName).sort()).toEqual(['2up', 'Small Video']);
    // In every scene: bottom to top, the game, the HUD, the facecam.
    for (const scene of ['Large Video', 'Small Video', '2up']) {
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

    // Again (the switch thrown again, another connect): nothing is made twice; the address is kept current.
    const again = await r.source.ensure();
    expect(again).toMatchObject({ ok: true, created: false, scenes: 3 });
    expect(requests('CreateInput')).toHaveLength(1);
    expect(requests('CreateSceneItem')).toHaveLength(2);
    expect(requests('SetInputSettings')).toHaveLength(1);
    expect(requests('SetInputSettings')[0].data).toMatchObject({ inputName: INPUT_NAME, overlay: true });
    for (const scene of ['Large Video', 'Small Video', '2up']) expect(names(scene), scene).toEqual(['game video', INPUT_NAME, 'Video Capture Device']);
    expect(server.state.pressed).toHaveLength(2);
  } finally { r.dispose(); }
});

test('switched off: every item of it is disabled and stays in his scenes; on again, enabled again; a scene with no game video puts the HUD on top', async () => {
  // A fourth scene of his with no game capture, and one where he had moved the facecam below the game.
  server.state.scenes.push({ sceneName: 'Camera only', items: [] });
  const r = rig();
  try {
    await until(() => r.client.identified());
    await r.source.ensure();
    expect(names('Camera only')).toEqual([INPUT_NAME]);
    const off = await r.source.disable();
    expect(off).toMatchObject({ ok: true, scenes: 4, problems: [] });
    expect(off.did).toBe('The HUD source is switched off in 4 scenes; it stays in OBS, hidden.');
    for (const scene of ['Large Video', 'Small Video', '2up', 'Camera only']) {
      expect(ours(scene), scene).toBeTruthy();
      expect(ours(scene).enabled, scene).toBe(false);
    }
    expect(server.state.inputs.some((i) => i.inputName === INPUT_NAME)).toBe(true);
    expect(requests('RemoveInput')).toHaveLength(0);
    expect(requests('RemoveSceneItem')).toHaveLength(0);
    // On again: enabled, nothing made again.
    const on = await r.source.ensure();
    expect(on).toMatchObject({ ok: true, created: false, scenes: 4 });
    for (const scene of ['Large Video', 'Small Video', '2up', 'Camera only']) expect(ours(scene).enabled, scene).toBe(true);
    expect(requests('CreateInput')).toHaveLength(1);
    expect(requests('CreateSceneItem')).toHaveLength(3);
    // The facecam he had put under the game is left where he put it: the HUD goes above the game, and that is all.
    const small = sceneItems('Small Video');
    const cam = small.find((i) => i.sourceName === 'Video Capture Device');
    small.splice(small.indexOf(cam), 1); small.unshift(cam);
    await r.source.ensure();
    expect(names('Small Video')).toEqual(['Video Capture Device', 'game video', INPUT_NAME]);
  } finally { r.dispose(); }
});

test('off, with no source in OBS yet, nothing is made; a connect reloads the page only if the source is there; with OBS closed nothing is asked', async () => {
  const r = rig();
  try {
    await until(() => r.client.identified());
    expect(await r.source.disable()).toMatchObject({ ok: true, scenes: 0, did: 'OBS has no HUD source to switch off.' });
    expect(await r.source.refresh()).toMatchObject({ ok: false, reason: 'no HUD source in OBS' });
    expect(server.state.inputs.some((i) => i.inputName === INPUT_NAME)).toBe(false);
    await r.source.ensure();
    expect(await r.source.refresh()).toEqual({ ok: true });
    expect(server.state.pressed).toHaveLength(2);
    // A scene OBS will not take the item into is said, and the rest are done.
    server.fail('SetSceneItemEnabled', 702, 'the scene is locked');
    const partly = await r.source.ensure();
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
  } finally { r2.dispose(); }
});
