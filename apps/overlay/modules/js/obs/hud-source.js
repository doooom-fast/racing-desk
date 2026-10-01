// "HUD drawn by OBS": the HUD as a browser source in his own scenes, from the page the loopback listener serves
// (remote-server.js, /obs), behind a switch that is off unless he turns it on. With it on, main.js first takes the
// HUD's own window out of every screen capture (setContentProtection, which takes effect at the next composition,
// so it is set before the source is enabled), then has OBS draw the page.
//
// His collection is his: the one input is made once (`Racing Desk HUD`, a browser_source; a second CreateInput of
// that name is refused by OBS), added to each scene as a scene item (CreateSceneItem), put just above his `game video`
// in each (SetSceneItemIndex: the facecam stays above the HUD) and given the game video's place and size
// (GetSceneItemTransform → SetSceneItemTransform, so the 2up scene scales the HUD with the game). Switched off, the
// items are disabled (SetSceneItemEnabled false) and never removed; nothing of his is ever removed. The source is
// refreshed on every connect (PressInputPropertiesButton refreshnocache: CEF 127 in OBS 32 has no handler for a page
// that failed to load, so a scene loaded while Racing Desk was closed would otherwise show whatever CEF shows for
// that until something reloads it) and disabled when Racing Desk quits, for the same reason.
//
// No Electron: the client, the page's address and the HUD's size are handed in, so tests/unit/obs-hud-source.spec.mjs
// runs it against the fake obs-websocket server.
const INPUT_NAME = 'Racing Desk HUD';
const INPUT_KIND = 'browser_source';
const GAME_VIDEO = /game\s*video/i;
const CAPTURE_KINDS = ['monitor_capture', 'game_capture', 'window_capture', 'screen_capture', 'display_capture'];
const REFRESH_BUTTON = 'refreshnocache';

const NOT_OPEN = "OBS isn't open, so the HUD source waits for it.";

function createHudSource({ client, url, size = () => null, log = () => {} } = {}) {
  if (!client) throw new Error('the HUD source needs the OBS client');
  let last = null;     // { at, did, scenes, problems }
  let busy = false;

  const pageUrl = () => (typeof url === 'function' ? url() : url);
  const hudSize = () => {
    try { const s = typeof size === 'function' ? size() : size; return s && s.width > 0 && s.height > 0 ? { width: Math.round(s.width), height: Math.round(s.height) } : null; } catch (e) { return null; }
  };

  function inputSettings() {
    const s = hudSize() || { width: 1920, height: 1080 };
    // fps_custom off: OBS drives CEF at the canvas's rate. shutdown off: the page keeps its session state (the
    // session best, the sparklines) across scene switches. restart_when_active off: likewise.
    return { url: pageUrl(), width: s.width, height: s.height, fps_custom: false, shutdown: false, restart_when_active: false, reroute_audio: false };
  }

  async function scenes() {
    const answer = await client.request('GetSceneList');
    const list = Array.isArray(answer && answer.scenes) ? answer.scenes.filter((s) => s && typeof s.sceneName === 'string') : [];
    return { list, current: answer && typeof answer.currentProgramSceneName === 'string' ? answer.currentProgramSceneName : null };
  }

  async function findInput() {
    const answer = await client.request('GetInputList', { inputKind: INPUT_KIND });
    const inputs = Array.isArray(answer && answer.inputs) ? answer.inputs : [];
    return inputs.find((i) => i && i.inputName === INPUT_NAME) || null;
  }

  async function itemsOf(sceneName) {
    const answer = await client.request('GetSceneItemList', { sceneName });
    return Array.isArray(answer && answer.sceneItems) ? answer.sceneItems : [];
  }

  // His game capture in a scene: the item named game video, else the first capture of a screen or a game.
  function gameVideoOf(items) {
    return items.find((i) => i && typeof i.sourceName === 'string' && GAME_VIDEO.test(i.sourceName))
      || items.find((i) => i && CAPTURE_KINDS.includes(String(i.inputKind || '').replace(/_v\d+$/, '')))
      || null;
  }

  // Our item in a scene, made if it is not there yet.
  async function ourItemIn(sceneName, items, { create }) {
    const have = items.find((i) => i && i.sourceName === INPUT_NAME);
    if (have) return { id: have.sceneItemId, index: have.sceneItemIndex, created: false };
    if (!create) return null;
    const made = await client.request('CreateSceneItem', { sceneName, sourceName: INPUT_NAME, sceneItemEnabled: true });
    return { id: made.sceneItemId, index: items.length, created: true };
  }

  // Just above the game video: the facecam, the mic's meter and whatever else he has stay above the HUD.
  async function placeAbove(sceneName, ours, game) {
    if (!game || !Number.isInteger(game.sceneItemIndex)) return;
    const target = ours.index < game.sceneItemIndex ? game.sceneItemIndex : game.sceneItemIndex + 1;
    if (ours.index === target) return;
    await client.request('SetSceneItemIndex', { sceneName, sceneItemId: ours.id, sceneItemIndex: target });
    ours.index = target;
  }

  // The game video's place and size, so that a scene that scales the game (his 2up) scales the HUD with it.
  async function fitTo(sceneName, ours, game) {
    if (!game) return;
    const answer = await client.request('GetSceneItemTransform', { sceneName, sceneItemId: game.sceneItemId });
    const t = answer && answer.sceneItemTransform;
    if (!t) return;
    const next = { positionX: t.positionX, positionY: t.positionY, alignment: t.alignment, rotation: 0 };
    if (t.boundsType && t.boundsType !== 'OBS_BOUNDS_NONE' && t.boundsWidth > 0 && t.boundsHeight > 0) {
      Object.assign(next, { boundsType: t.boundsType, boundsAlignment: t.boundsAlignment, boundsWidth: t.boundsWidth, boundsHeight: t.boundsHeight });
    } else {
      const hud = hudSize();
      if (hud && t.width > 0 && t.height > 0) Object.assign(next, { boundsType: 'OBS_BOUNDS_NONE', scaleX: t.width / hud.width, scaleY: t.height / hud.height });
    }
    await client.request('SetSceneItemTransform', { sceneName, sceneItemId: ours.id, sceneItemTransform: next });
  }

  async function refreshInput() {
    await client.request('PressInputPropertiesButton', { inputName: INPUT_NAME, propertyName: REFRESH_BUTTON });
  }

  /**
   * The switch is on: the input made once, an item of it in every scene just above the game video, fitted to it,
   * enabled, and the page reloaded. Resolves { ok, did, scenes, created, problems }.
   */
  async function ensure() {
    if (!client.identified()) return { ok: false, reason: NOT_OPEN };
    if (busy) return { ok: false, reason: 'The HUD source is being set up.' };
    busy = true;
    const problems = [];
    let created = false;
    let placed = 0;
    try {
      const { list, current } = await scenes();
      if (!list.length) return remember({ ok: false, did: 'OBS has no scenes to put the HUD in.', scenes: 0, created, problems });
      const first = list.find((s) => s.sceneName === current) || list[0];
      let input = await findInput();
      if (!input) {
        await client.request('CreateInput', { sceneName: first.sceneName, inputName: INPUT_NAME, inputKind: INPUT_KIND, inputSettings: inputSettings(), sceneItemEnabled: true });
        created = true;
        log(`[RacingDesk] HUD source: made the browser source "${INPUT_NAME}" in "${first.sceneName}"`);
      } else {
        // The address and the size are kept current (the port, the screen); his other settings on it are his.
        await client.request('SetInputSettings', { inputName: INPUT_NAME, inputSettings: inputSettings(), overlay: true });
      }
      for (const scene of list) {
        try {
          const items = await itemsOf(scene.sceneName);
          const ours = await ourItemIn(scene.sceneName, items, { create: true });
          const game = gameVideoOf(items);
          await placeAbove(scene.sceneName, ours, game);
          await fitTo(scene.sceneName, ours, game);
          await client.request('SetSceneItemEnabled', { sceneName: scene.sceneName, sceneItemId: ours.id, sceneItemEnabled: true });
          placed++;
        } catch (e) {
          problems.push(`The HUD could not be put in the scene "${scene.sceneName}": ${e.message}`);
        }
      }
      try { await refreshInput(); } catch (e) { problems.push(`The HUD page was not reloaded in OBS: ${e.message}`); }
      const did = placed ? `The HUD is a browser source in ${placed === 1 ? 'your scene' : `${placed} of your scenes`}, just above the game.` : 'The HUD was not put in any scene.';
      return remember({ ok: placed > 0 && problems.length === 0, did, scenes: placed, created, problems });
    } catch (e) {
      return remember({ ok: false, did: null, scenes: placed, created, problems: [...problems, `OBS did not take the HUD source: ${e.message}`] });
    } finally {
      busy = false;
    }
  }

  /** The switch is off, or Racing Desk is quitting: every item of ours disabled; nothing removed. */
  async function disable() {
    if (!client.identified()) return { ok: false, reason: NOT_OPEN };
    const problems = [];
    let off = 0;
    try {
      if (!(await findInput())) return remember({ ok: true, did: 'OBS has no HUD source to switch off.', scenes: 0, created: false, problems });
      const { list } = await scenes();
      for (const scene of list) {
        try {
          const ours = await ourItemIn(scene.sceneName, await itemsOf(scene.sceneName), { create: false });
          if (!ours) continue;
          await client.request('SetSceneItemEnabled', { sceneName: scene.sceneName, sceneItemId: ours.id, sceneItemEnabled: false });
          off++;
        } catch (e) {
          problems.push(`The HUD could not be hidden in the scene "${scene.sceneName}": ${e.message}`);
        }
      }
      return remember({ ok: problems.length === 0, did: `The HUD source is switched off in ${off === 1 ? 'your scene' : `${off} scenes`}; it stays in OBS, hidden.`, scenes: off, created: false, problems });
    } catch (e) {
      return remember({ ok: false, did: null, scenes: off, created: false, problems: [...problems, `OBS did not take it: ${e.message}`] });
    }
  }

  /** OBS has just answered: the page reloaded, if the source is there (a page that failed to load stays failed otherwise). */
  async function refresh() {
    if (!client.identified()) return { ok: false, reason: NOT_OPEN };
    try {
      if (!(await findInput())) return { ok: false, reason: 'no HUD source in OBS' };
      await refreshInput();
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  function remember(result) {
    last = { at: Date.now(), ...result };
    if (result.problems && result.problems.length) log(`[RacingDesk] HUD source: ${result.problems.join(' ')}`);
    else if (result.did) log(`[RacingDesk] HUD source: ${result.did}`);
    return result;
  }

  function status() {
    return { last, busy };
  }

  return { ensure, disable, refresh, status, INPUT_NAME };
}

module.exports = { INPUT_NAME, INPUT_KIND, REFRESH_BUTTON, NOT_OPEN, createHudSource };
