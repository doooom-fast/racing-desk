// "HUD drawn by OBS": the HUD as a browser source in his own scenes, from the page the loopback listener serves
// (remote-server.js, /obs), behind a switch that is off unless he turns it on. With it on, the HUD's own window is first
// taken out of every screen capture (setContentProtection, which takes effect at the next composition, so it is set
// before the source is enabled), then OBS draws the page. Off, OBS stops drawing it first and the window goes back into
// the capture after: for the moment between there would otherwise be two HUDs in the picture.
//
// His collections are his. The HUD goes into the one scene collection the switch was turned on in (kept in a small state
// file; the first connect with the switch on picks the collection OBS is on) and into no other: a connect, or a change of
// collection, while OBS is on another one leaves it alone, and the HUD's window stays in the capture there. In that
// collection it goes into every scene that has an item named `game video` — never one that has not, and never by a
// guess at which of a scene's captures is the game: the one input is made once (`Racing Desk HUD`, a browser_source; a
// second CreateInput of that name is refused by OBS), added to each such scene as a scene item (CreateSceneItem), put just
// above that item (SetSceneItemIndex: the facecam stays above the HUD) and given its place and size (GetSceneItemTransform
// → SetSceneItemTransform, so the 2up scene scales the HUD with the game). An item that is there already is left where
// he has put it: only when the HUD's size has changed (its screen moved) is it fitted again, and it is enabled again only
// if Racing Desk is what disabled it (on the way out, or when the switch went off: the scenes are written down), so a
// scene he hid it in stays so. Switched off, the items are disabled and never removed; nothing of his is ever removed.
// The source is refreshed when OBS answers (PressInputPropertiesButton refreshnocache: CEF 127 in OBS 32 has no handler
// for a page that failed to load, so a scene loaded while Racing Desk was closed would otherwise show whatever CEF shows
// for that until something reloads it) unless the page is alive and polling, which a reconnect in the middle of a race
// is: reloading it would lose the session best, the sparklines and the gap trend. It is disabled when Racing Desk quits,
// for the same reason.
//
// No Electron: the client, the page's address, the HUD's size (in DIPs: the page lays out in CSS pixels, as the rig's
// own HUD does, and OBS scales the source up to the canvas) and the window's capture are handed in, so
// tests/unit/obs-hud-source.spec.mjs runs it against the fake obs-websocket server.
const path = require('path');
const nodeFs = require('fs');

const INPUT_NAME = 'Racing Desk HUD';
const INPUT_KIND = 'browser_source';
const GAME_VIDEO = /^\s*game\s*video\s*$/i;
const REFRESH_BUTTON = 'refreshnocache';

const NOT_OPEN = "OBS isn't open, so the HUD source waits for it.";
const LISTENER_DOWN = "The HUD's page is not being served on this PC (another program may hold its port), so OBS was not given the HUD.";

function createHudSource({ client, url, size = () => null, ready = () => true, pageAlive = () => false, state = null, log = () => {} } = {}) {
  if (!client) throw new Error('the HUD source needs the OBS client');
  let last = null;     // { at, did, scenes, problems }
  let busy = false;
  let closing = false; // Racing Desk is quitting: nothing is enabled any more
  let chain = Promise.resolve();
  let waiting = null;

  const pageUrl = () => (typeof url === 'function' ? url() : url);
  const hudSize = () => {
    try { const s = typeof size === 'function' ? size() : size; return s && s.width > 0 && s.height > 0 ? { width: Math.round(s.width), height: Math.round(s.height) } : null; } catch (e) { return null; }
  };

  // What is kept between runs: { collection, off } — the scene collection the HUD was set up in, and the scenes whose item
  // Racing Desk disabled and so enables again. null while nothing has been written.
  let mem = null;
  const kept = () => {
    if (state && typeof state.read === 'function') { try { return state.read(); } catch (e) { return null; } }
    return mem;
  };
  const keep = (value) => {
    if (state && typeof state.write === 'function') { try { state.write(value); } catch (e) { log(`[RacingDesk] HUD source: its state could not be kept: ${e.message}`); } return; }
    mem = value;
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

  async function collectionNow() {
    const answer = await client.request('GetSceneCollectionList');
    return answer && typeof answer.currentSceneCollectionName === 'string' ? answer.currentSceneCollectionName : null;
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

  // His game capture in a scene: the item named game video, and nothing else. A scene that has none is not one of the
  // HUD's (his "sim video with voice" has a SimHub window and a game capture of another name, and a guess put the HUD
  // among them).
  function gameVideoOf(items) {
    return items.find((i) => i && typeof i.sourceName === 'string' && GAME_VIDEO.test(i.sourceName)) || null;
  }

  function ourItemIn(items) {
    const have = items.find((i) => i && i.sourceName === INPUT_NAME);
    return have ? { id: have.sceneItemId, index: have.sceneItemIndex, enabled: have.sceneItemEnabled !== false } : null;
  }

  async function createItem(sceneName, items) {
    const made = await client.request('CreateSceneItem', { sceneName, sourceName: INPUT_NAME, sceneItemEnabled: true });
    return { id: made.sceneItemId, index: items.length, enabled: true };
  }

  // Just above the game video: the facecam, the mic's meter and whatever else he has stay above the HUD.
  async function placeAbove(sceneName, ours, game) {
    if (!game || !Number.isInteger(game.sceneItemIndex)) return;
    const target = ours.index < game.sceneItemIndex ? game.sceneItemIndex : game.sceneItemIndex + 1;
    if (ours.index === target) return;
    await client.request('SetSceneItemIndex', { sceneName, sceneItemId: ours.id, sceneItemIndex: target });
    ours.index = target;
  }

  // The game video's place and size, so that a scene that scales the game (his 2up) scales the HUD with it. A source of
  // the HUD's size in DIPs is scaled up to the game's pixels here: the page is laid out as the rig's HUD is, and OBS
  // does the rest.
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
   * The switch is on and OBS answers: the HUD put into the collection it belongs to, where it belongs. `fresh` is the
   * switch having just been turned on: the collection it was set up in is forgotten, so that this one is the one. `protect`
   * is told whether the HUD's own window is to be out of the capture, and always before anything is enabled. Resolves
   * { ok, did, scenes, created, problems } — and `away: true` when OBS is on another collection.
   */
  async function ensure({ fresh = false, protect = () => {} } = {}) {
    if (!client.identified()) return { ok: false, reason: NOT_OPEN };
    if (closing) return { ok: false, reason: 'Racing Desk is closing.' };
    if (busy) return { ok: false, reason: 'The HUD source is being set up.' };
    busy = true;
    const problems = [];
    let created = false;
    let placed = 0;
    try {
      if (!ready() || !pageUrl()) {
        // Nothing serves the page: whatever the source holds from before would show a page that is not there, and the window
        // stays in the capture, which is the HUD OBS can still film.
        const off = await disableNow({ quiet: true });
        protect(false);
        return remember({ ok: false, did: LISTENER_DOWN, scenes: off.scenes || 0, created, problems: off.problems || [], reason: LISTENER_DOWN });
      }
      const collection = await collectionNow();
      const stored = kept();
      if (!fresh && stored && stored.collection && collection !== null && stored.collection !== collection) {
        protect(false);
        return remember({ ok: true, away: true, did: `The HUD source is in the scene collection "${stored.collection}"; OBS is on "${collection}", so it was left alone.`, scenes: 0, created, problems });
      }
      // What was written down of another collection says nothing of this one: the switch just turned on makes this the one.
      const before = stored && (!stored.collection || collection === null || stored.collection === collection) ? stored : null;
      const { list, current } = await scenes();
      const targets = [];
      for (const scene of list) {
        const items = await itemsOf(scene.sceneName);
        const game = gameVideoOf(items);
        if (game) targets.push({ sceneName: scene.sceneName, items, game });
      }
      if (!targets.length) {
        protect(false);
        return remember({ ok: false, did: `None of the scenes in "${collection || 'this collection'}" has an item named game video to put the HUD above, so it was not added.`, scenes: 0, created, problems });
      }
      keep({ collection, off: before && Array.isArray(before.off) ? before.off : [] });
      // Out of the capture before anything is enabled.
      protect(true);
      const known = before !== null;
      const off = new Set(known && Array.isArray(before.off) ? before.off : []);
      const first = targets.find((t) => t.sceneName === current) || targets[0];
      let input = await findInput();
      let resized = false;
      if (!input) {
        await client.request('CreateInput', { sceneName: first.sceneName, inputName: INPUT_NAME, inputKind: INPUT_KIND, inputSettings: inputSettings(), sceneItemEnabled: true });
        created = true;
        first.items = await itemsOf(first.sceneName);
        log(`[RacingDesk] HUD source: made the browser source "${INPUT_NAME}" in "${first.sceneName}"`);
      } else {
        // The address and the size are kept current (the port, the screen); his other settings on it are his.
        const now = inputSettings();
        let have = null;
        try { have = (await client.request('GetInputSettings', { inputName: INPUT_NAME })).inputSettings; } catch (e) { have = null; }
        resized = !have || have.width !== now.width || have.height !== now.height;
        await client.request('SetInputSettings', { inputName: INPUT_NAME, inputSettings: now, overlay: true });
      }
      for (const target of targets) {
        try {
          const items = target.items;
          let ours = ourItemIn(items);
          let isNew = false;
          if (!ours) { ours = await createItem(target.sceneName, items); isNew = true; }
          // Where he has put it stays where he put it; only a new item, or one the screen's change has made the wrong size,
          // is placed and fitted.
          if (isNew || resized || created) {
            await placeAbove(target.sceneName, ours, target.game);
            await fitTo(target.sceneName, ours, target.game);
          }
          // Enabled: a new item, and one that Racing Desk switched off (or one nothing is known of, once). Not one he hid.
          if (isNew || (!ours.enabled && (!known || off.has(target.sceneName)))) {
            await client.request('SetSceneItemEnabled', { sceneName: target.sceneName, sceneItemId: ours.id, sceneItemEnabled: true });
          }
          off.delete(target.sceneName);
          placed++;
        } catch (e) {
          problems.push(`The HUD could not be put in the scene "${target.sceneName}": ${e.message}`);
        }
      }
      keep({ collection, off: [...off] });
      // The page is reloaded unless it is alive and polling: a reconnect in the middle of a race keeps its state. A page
      // that was just made, or given another size, is loaded afresh anyway.
      if (created || resized || !pageAlive()) {
        try { await refreshInput(); } catch (e) { problems.push(`The HUD page was not reloaded in OBS: ${e.message}`); }
      }
      const did = placed ? `The HUD is a browser source in ${placed === 1 ? 'your scene' : `${placed} of your scenes`}, just above the game.` : 'The HUD was not put in any scene.';
      return remember({ ok: placed > 0 && problems.length === 0, did, scenes: placed, created, problems });
    } catch (e) {
      return remember({ ok: false, did: null, scenes: placed, created, problems: [...problems, `OBS did not take the HUD source: ${e.message}`] });
    } finally {
      busy = false;
    }
  }

  // Every item of ours enabled in this collection is disabled, and the scenes are written down, so that what Racing Desk
  // switched off is what it switches on again.
  async function disableNow({ quiet = false } = {}) {
    const problems = [];
    let off = 0;
    try {
      if (!(await findInput())) return quiet ? { ok: true, scenes: 0, problems } : remember({ ok: true, did: 'OBS has no HUD source to switch off.', scenes: 0, created: false, problems });
      const collection = await collectionNow();
      const before = kept();
      const mine = !before || !before.collection || collection === null || before.collection === collection;
      const switched = new Set(before && Array.isArray(before.off) && mine ? before.off : []);
      const { list } = await scenes();
      for (const scene of list) {
        try {
          const ours = ourItemIn(await itemsOf(scene.sceneName));
          if (!ours) continue;
          if (ours.enabled) {
            await client.request('SetSceneItemEnabled', { sceneName: scene.sceneName, sceneItemId: ours.id, sceneItemEnabled: false });
            switched.add(scene.sceneName);
          }
          off++;
        } catch (e) {
          problems.push(`The HUD could not be hidden in the scene "${scene.sceneName}": ${e.message}`);
        }
      }
      if (mine && (before || switched.size)) keep({ collection: before && before.collection ? before.collection : collection, off: [...switched] });
      if (quiet) return { ok: problems.length === 0, scenes: off, problems };
      return remember({ ok: problems.length === 0, did: `The HUD source is switched off in ${off === 1 ? 'your scene' : `${off} scenes`}; it stays in OBS, hidden.`, scenes: off, created: false, problems });
    } catch (e) {
      if (quiet) return { ok: false, scenes: off, problems: [...problems, `OBS did not take it: ${e.message}`] };
      return remember({ ok: false, did: null, scenes: off, created: false, problems: [...problems, `OBS did not take it: ${e.message}`] });
    }
  }

  /**
   * The switch is off, or Racing Desk is quitting: every item of ours disabled; nothing removed. `final` is the quit: nothing
   * is enabled after it.
   */
  async function disable({ final = false } = {}) {
    if (final) closing = true;
    if (!client.identified()) return { ok: false, reason: NOT_OPEN };
    return disableNow();
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

  /**
   * The switch as it stands, applied: called when OBS answers, when the collection changes, when the switch is thrown and
   * when the HUD's screen moves. One at a time, and only the latest asked for after the one under way. `on` is the switch;
   * `fresh` that it was just turned on; `protect(bool)` puts the HUD's own window out of the capture or back into it.
   *
   * Off is always applied: OBS may be showing an item that was left enabled (the switch was turned off while OBS was
   * closed, or Racing Desk crashed), and the window must not be back in the capture before OBS has stopped drawing the HUD.
   */
  function apply({ on = false, fresh = false, protect = () => {} } = {}) {
    const mine = {};
    waiting = mine;
    const run = async () => {
      if (waiting !== mine) return { ok: true, superseded: true };
      if (!client.identified()) {
        // OBS is not there to be asked: the window follows the switch, and OBS is dealt with when it answers.
        protect(!!on);
        return { ok: false, reason: NOT_OPEN };
      }
      if (!on) {
        const off = await disable();
        protect(false);
        return off;
      }
      return ensure({ fresh, protect });
    };
    chain = chain.then(run, run);
    return chain;
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

  return { apply, ensure, disable, refresh, status, INPUT_NAME };
}

/**
 * What the HUD source keeps between runs — { collection, off } — in a file, written whole and atomically (a temp file and a
 * rename). A file that is not there, or cannot be read, is none: the source then enables what it finds disabled, once,
 * rather than leave a HUD that never comes back.
 */
function fileState(file, { fs: fsModule = nodeFs, log = () => {} } = {}) {
  return {
    read() {
      try {
        const value = JSON.parse(String(fsModule.readFileSync(file, 'utf8')));
        if (!value || typeof value !== 'object') return null;
        return { collection: typeof value.collection === 'string' ? value.collection : null, off: Array.isArray(value.off) ? value.off.filter((x) => typeof x === 'string') : [] };
      } catch (e) {
        return null;
      }
    },
    write(value) {
      try {
        fsModule.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        fsModule.writeFileSync(tmp, JSON.stringify({ collection: value.collection || null, off: value.off || [] }));
        fsModule.renameSync(tmp, file);
      } catch (e) {
        log(`[RacingDesk] HUD source: its state file could not be written: ${e.message}`);
      }
    },
  };
}

module.exports = { INPUT_NAME, INPUT_KIND, REFRESH_BUTTON, NOT_OPEN, LISTENER_DOWN, createHudSource, fileState };
