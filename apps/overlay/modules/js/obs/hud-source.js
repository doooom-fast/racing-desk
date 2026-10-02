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
// What OBS draws is his choice, "Rig HUD" or "iPad dashboard" (`view`, 'rig' or 'ipad', from the settings): the rig HUD
// is the loopback listener's /obs page at the HUD window's size, fitted to the game video as above; the iPad dashboard
// is its /obs-ipad page (the glance layout the iPad is shown, over a transparent page), which is not stretched over the
// game: the first time Racing Desk adds it to a scene it is made at an iPad's size, 1180 by 820 (IPAD_SOURCE: the iPad
// Air and 11" Pro on their side, the size the layout is held to and the golden frames are made at), and put in the
// bottom-left corner (away from a facecam in the bottom right) at half the game video's height, and after that it is
// never moved or sized by Racing Desk again — his layout in OBS is his — and not when a scene is renamed.
//
// **The page is laid out at the size he gives the item** (he asked, 2026-10-01: "Make the iPad version flow to its
// bounds … in obs, it responds to its container if it can"). In OBS a browser source has a width and a height of its own
// — the page's viewport, what the page is laid out at — and the scene item has a transform: dragging an item's corner
// changes the item's scale or its bounds and never the source's size, so a page made at 1180 by 820 and dragged to a
// wide box was stretched into it. So the source's width and height follow the item's box (`followBox`): on every connect
// (the item in the scene OBS is on, else the first with a game video), and a moment after he lets go of the item
// (OBS's SceneItemTransformChanged, which main.js hands to `transformChanged`; FOLLOW_AFTER_MS after the last one, since
// OBS sends one for every pixel of a drag). The item is not moved or sized by it: an item scaled inside bounds (which is
// how it is placed) keeps its bounds and the page fills them edge to edge at a scale of one; an item he has set to no
// bounds and scaled has its scale put to one as the source takes its box, so the box is what it was, to the pixel. One
// source has one size, so with the dashboard in several scenes at different boxes it is laid out for the scene OBS is
// on, and scaled inside its bounds in the others. A size typed into the source's own settings is not kept: the box is
// what the page is laid out at. A change of the source's size recreates OBS's browser (a page loaded afresh), so it is
// done only when the box differs, to the pixel, from the size the source has. A box smaller than the least iPad in its
// orientation (LEAST_BOX) has the page laid out at its shape scaled up to that, drawn into the box by OBS.
//
// The state file says which scenes it has been placed in (`ipad`, by the scene's uuid, which a rename keeps; the name
// where OBS gives none), and when the choice goes back to the rig HUD his transform of it is written there, so that
// choosing the iPad dashboard again puts it back where he had it, not in the corner. An item that is in a scene with
// nothing written of it (the state file lost, the switch turned on afresh in another collection and back) is his too,
// unless it still covers the game video as the rig HUD's fit does, when it is the rig HUD and goes to the corner. A
// change of choice is the source's address changed (SetInputSettings) and, for the rig HUD, its size put to the HUD
// window's and the item fitted to the game again; for the iPad dashboard, the item put back and the page laid out at it.
//
// No Electron: the client, the pages' addresses (`url(view)`), the HUD's size (in DIPs: the page lays out in CSS pixels,
// as the rig's own HUD does, and OBS scales the source up to the canvas), the choice and the window's capture are
// handed in, so tests/unit/obs-hud-source.spec.mjs runs it against the fake obs-websocket server.
const path = require('path');
const nodeFs = require('fs');

const INPUT_NAME = 'Racing Desk HUD';
const INPUT_KIND = 'browser_source';
const GAME_VIDEO = /^\s*game\s*video\s*$/i;
const REFRESH_BUTTON = 'refreshnocache';
// The iPad dashboard's source: an iPad on its side, in CSS pixels.
const IPAD_SOURCE = Object.freeze({ width: 1180, height: 820 });
// Where it goes the first time: the bottom-left corner of the game video, inset by a fiftieth of its shorter side, at
// half its height (on a 1440-high canvas, 720 by 1036: under a third of an ultrawide's width, and 0.88 of the page's
// own size). Smaller was too small for a recording: at two-fifths the layout's 11 px labels (the panels' titles, "Per
// lap") came out at 7.7 px of the canvas, and under 5 px once the video is scaled down for upload; at half they are
// 9.7 px, and the numbers (20 px and up) 17.6 px and up. It is one drag in OBS to change, and then it is his.
const IPAD_PLACE = Object.freeze({ height: 0.5, inset: 0.02 });
// The source follows the item's box this long after the last SceneItemTransformChanged of a drag.
const FOLLOW_AFTER_MS = 1200;
// What a browser source's width and height may be (obs-browser's own range), so a box OBS reports oddly cannot be asked for.
const SOURCE_SIZE = Object.freeze({ min: 64, max: 8192 });
// The least the page is laid out at: the glance layout's numbers have a floor (20px), and it is held to the iPads, the
// least of which are 1024 across and 744 high on its side (the 9.7" and the mini), 744 by 1024 upright. A box smaller than
// that in its orientation (the corner the game video gives it, 1036 by 720 on his 1440 canvas and 777 by 540 on a 1080p
// one; a square, a strip under 744 high; an item he shrinks) has the page laid out at the box's own shape scaled up until
// it is that big, and OBS draws it into the box: the same shape and every cell, a little smaller on the canvas, rather
// than a page cut off by its floors.
const LEAST_BOX = Object.freeze({ landscape: Object.freeze({ width: 1024, height: 744 }), portrait: Object.freeze({ width: 744, height: 1024 }) });
const VIEWS = Object.freeze(['rig', 'ipad']);
// obs-websocket's alignment flags (libobs: OBS_ALIGN_LEFT 1, RIGHT 2, TOP 4, BOTTOM 8; 0 is the centre).
const ALIGN = Object.freeze({ LEFT: 1, RIGHT: 2, TOP: 4, BOTTOM: 8 });

const NOT_OPEN = "OBS isn't open, so the HUD source waits for it.";
const LISTENER_DOWN = "The HUD's page is not being served on this PC (another program may hold its port), so OBS was not given the HUD.";

const viewOf = (value) => (VIEWS.includes(value) ? value : 'rig');

// The iPad dashboard's places are kept by the scene's uuid (OBS 30 and up give one, and a rename keeps it), by its name
// where there is none. A record written under the name before the uuid was known is found by it, and moved to the uuid.
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
function placeOf(ipad, target) {
  if (has(ipad, target.key)) return { found: true, value: ipad[target.key] };
  if (target.key !== target.sceneName && has(ipad, target.sceneName)) return { found: true, value: ipad[target.sceneName] };
  return { found: false, value: undefined };
}
function setPlace(ipad, target, value) {
  if (target.key !== target.sceneName) delete ipad[target.sceneName];
  ipad[target.key] = value;
}

function createHudSource({ client, url, size = () => null, view = () => 'rig', ipadSize = IPAD_SOURCE, ready = () => true, pageAlive = () => false, state = null, log = () => {}, followAfterMs = FOLLOW_AFTER_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (!client) throw new Error('the HUD source needs the OBS client');
  let last = null;     // { at, did, scenes, problems }
  let busy = false;
  let closing = false; // Racing Desk is quitting: nothing is enabled any more
  let chain = Promise.resolve();
  let waiting = null;
  // The iPad dashboard's items, by scene, from the last ensure: what a SceneItemTransformChanged is matched against.
  const placedIn = new Map();
  let followTimer = null;
  let followNext = null;   // { sceneName, sceneItemId, transform }: the last transform event of ours, waiting its moment
  let lastFollow = null;   // { at, sceneName, width, height }

  const pageUrl = (which) => (typeof url === 'function' ? url(which) : url);
  const viewNow = () => { try { return viewOf(typeof view === 'function' ? view() : view); } catch (e) { return 'rig'; } };
  const hudSize = () => {
    try { const s = typeof size === 'function' ? size() : size; return s && s.width > 0 && s.height > 0 ? { width: Math.round(s.width), height: Math.round(s.height) } : null; } catch (e) { return null; }
  };
  const ipadSource = () => ({ width: Math.round(ipadSize.width), height: Math.round(ipadSize.height) });

  // What is kept between runs: { collection, off, view, ipad } — the scene collection the HUD was set up in, the scenes
  // whose item Racing Desk disabled and so enables again, what the source was last set up as, and the scenes the iPad
  // dashboard has been placed in (each with his transform of it, written when the choice went back to the rig HUD, or
  // null). null while nothing has been written.
  let mem = null;
  const kept = () => {
    if (state && typeof state.read === 'function') { try { return state.read(); } catch (e) { return null; } }
    return mem;
  };
  const keep = (value) => {
    const whole = { collection: value.collection || null, off: value.off || [], view: viewOf(value.view), ipad: value.ipad && typeof value.ipad === 'object' ? value.ipad : {} };
    if (state && typeof state.write === 'function') { try { state.write(whole); } catch (e) { log(`[RacingDesk] HUD source: its state could not be kept: ${e.message}`); } return; }
    mem = whole;
  };

  // The source's settings: its address and, for the rig HUD, the HUD window's size; for the iPad dashboard its first size
  // when it is made (`withSize`), and no size after — the item's box is its size (followBox, below).
  function inputSettings(which, { withSize = true } = {}) {
    const s = which === 'ipad' ? ipadSource() : (hudSize() || { width: 1920, height: 1080 });
    // fps_custom off: OBS drives CEF at the canvas's rate. shutdown off: the page keeps its session state (the
    // session best, the sparklines) across scene switches. restart_when_active off: likewise.
    const settings = { url: pageUrl(which), fps_custom: false, shutdown: false, restart_when_active: false, reroute_audio: false };
    if (withSize) Object.assign(settings, { width: s.width, height: s.height });
    return settings;
  }

  // A browser source's size for a box on the canvas: the box's own in whole pixels, or, for a box smaller than LEAST_BOX
  // in its orientation, the box's shape scaled up to it; within what obs-browser takes.
  function sizeForBox(box) {
    const least = box.width > box.height ? LEAST_BOX.landscape : LEAST_BOX.portrait;   // a square is upright, as CSS has it
    const up = Math.max(1, least.width / box.width, least.height / box.height);
    const fit = (v) => Math.max(SOURCE_SIZE.min, Math.min(SOURCE_SIZE.max, Math.round(v * up)));
    return { width: fit(box.width), height: fit(box.height) };
  }

  // The source laid out at the item's box: its width and height set to the box's (sizeForBox), if they are not already;
  // an item with no bounds (he set it so and scaled it) has its scale put to what keeps its box on the canvas as it was
  // (one, or less for a box smaller than LEAST_BOX).
  // Resolves true when the source's size was changed (OBS then loads the page afresh at that size).
  async function followBox(sceneName, ours, transform) {
    const box = boxOf(transform);
    if (!box) return false;
    const want = sizeForBox(box);
    let have = null;
    try { have = (await client.request('GetInputSettings', { inputName: INPUT_NAME })).inputSettings; } catch (e) { have = null; }
    const same = have && have.width === want.width && have.height === want.height;
    if (!same) await client.request('SetInputSettings', { inputName: INPUT_NAME, inputSettings: { width: want.width, height: want.height }, overlay: true });
    const bounded = transform.boundsType && transform.boundsType !== 'OBS_BOUNDS_NONE' && transform.boundsWidth > 0 && transform.boundsHeight > 0;
    const scaleX = box.width / want.width, scaleY = box.height / want.height;
    if (!bounded && (Math.abs((transform.scaleX ?? 1) - scaleX) > 1e-3 || Math.abs((transform.scaleY ?? 1) - scaleY) > 1e-3)) {
      await client.request('SetSceneItemTransform', { sceneName, sceneItemId: ours.id, sceneItemTransform: { scaleX, scaleY } });
    }
    if (!same) {
      lastFollow = { at: Date.now(), sceneName, width: want.width, height: want.height };
      log(`[RacingDesk] HUD source: the iPad dashboard's page is laid out at ${want.width} by ${want.height}, the size of its item in "${sceneName}"`);
    }
    return !same;
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

  // The game video's box on the canvas: its bounds when it is scaled to bounds (the 2up), else its scaled size; its
  // top-left corner from its position and alignment (OBS places an item by the point its alignment names).
  function boxOf(t) {
    const bounded = t.boundsType && t.boundsType !== 'OBS_BOUNDS_NONE' && t.boundsWidth > 0 && t.boundsHeight > 0;
    const width = bounded ? t.boundsWidth : (t.width > 0 ? t.width : (t.sourceWidth || 0) * (t.scaleX || 1));
    const height = bounded ? t.boundsHeight : (t.height > 0 ? t.height : (t.sourceHeight || 0) * (t.scaleY || 1));
    if (!(width > 0) || !(height > 0)) return null;
    const align = Number.isInteger(t.alignment) ? t.alignment : 0;
    const left = (t.positionX || 0) - (align & ALIGN.RIGHT ? width : align & ALIGN.LEFT ? 0 : width / 2);
    const top = (t.positionY || 0) - (align & ALIGN.BOTTOM ? height : align & ALIGN.TOP ? 0 : height / 2);
    return { left, top, width, height };
  }

  // The iPad dashboard's first place in a scene: the bottom-left corner of the game video, at half its height, scaled
  // inside bounds so the page keeps its shape. Once, and never again (ensure, below).
  async function placeInCorner(sceneName, ours, game) {
    if (!game) return false;
    const answer = await client.request('GetSceneItemTransform', { sceneName, sceneItemId: game.sceneItemId });
    const box = answer && answer.sceneItemTransform ? boxOf(answer.sceneItemTransform) : null;
    if (!box) return false;
    const source = ipadSource();
    const height = Math.round(box.height * IPAD_PLACE.height);
    const width = Math.round(height * source.width / source.height);
    const inset = Math.round(Math.min(box.width, box.height) * IPAD_PLACE.inset);
    await client.request('SetSceneItemTransform', { sceneName, sceneItemId: ours.id, sceneItemTransform: {
      positionX: Math.round(box.left + inset), positionY: Math.round(box.top + box.height - inset - height),
      alignment: ALIGN.TOP | ALIGN.LEFT, rotation: 0, scaleX: 1, scaleY: 1,
      boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsAlignment: 0, boundsWidth: width, boundsHeight: height,
    } });
    return true;
  }

  // His transform of an item, as it can be set again: the place, the alignment, the rotation, the scale, and the bounds
  // when there are any (obs-websocket refuses a bounds width or height under one).
  async function transformOf(sceneName, ours) {
    const answer = await client.request('GetSceneItemTransform', { sceneName, sceneItemId: ours.id });
    const t = answer && answer.sceneItemTransform;
    if (!t) return null;
    const out = { positionX: t.positionX, positionY: t.positionY, alignment: t.alignment, rotation: t.rotation || 0, scaleX: t.scaleX, scaleY: t.scaleY, boundsType: t.boundsType || 'OBS_BOUNDS_NONE', boundsAlignment: t.boundsAlignment || 0 };
    if (out.boundsType !== 'OBS_BOUNDS_NONE' && t.boundsWidth > 0 && t.boundsHeight > 0) Object.assign(out, { boundsWidth: t.boundsWidth, boundsHeight: t.boundsHeight });
    for (const key of Object.keys(out)) if (out[key] === undefined || (typeof out[key] === 'number' && !Number.isFinite(out[key]))) delete out[key];
    return out;
  }

  async function restore(sceneName, ours, transform) {
    await client.request('SetSceneItemTransform', { sceneName, sceneItemId: ours.id, sceneItemTransform: { ...transform } });
  }

  // Whether the item still covers the game video's box, as the rig HUD's fit leaves it (the game's bounds, or its scaled
  // size, at its place): to the pixel or two. An iPad dashboard that has been in a corner, or that he has moved or sized,
  // is never that.
  async function coversGame(sceneName, ours, game) {
    if (!game) return false;
    const [mine, theirs] = await Promise.all([
      client.request('GetSceneItemTransform', { sceneName, sceneItemId: ours.id }),
      client.request('GetSceneItemTransform', { sceneName, sceneItemId: game.sceneItemId }),
    ]);
    const a = mine && mine.sceneItemTransform ? boxOf(mine.sceneItemTransform) : null;
    const b = theirs && theirs.sceneItemTransform ? boxOf(theirs.sceneItemTransform) : null;
    if (!a || !b) return false;
    return ['left', 'top', 'width', 'height'].every((k) => Math.abs(a[k] - b[k]) <= 2);
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
    const which = viewNow();
    try {
      if (!ready() || !pageUrl(which)) {
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
        if (game) targets.push({ sceneName: scene.sceneName, key: typeof scene.sceneUuid === 'string' && scene.sceneUuid ? scene.sceneUuid : scene.sceneName, items, game });
      }
      if (!targets.length) {
        protect(false);
        return remember({ ok: false, did: `None of the scenes in "${collection || 'this collection'}" has an item named game video to put the HUD above, so it was not added.`, scenes: 0, created, problems });
      }
      const known = before !== null;
      const lastView = known ? viewOf(before.view) : null;
      const ipad = { ...(known && before.ipad && typeof before.ipad === 'object' ? before.ipad : {}) };
      keep({ collection, off: known && Array.isArray(before.off) ? before.off : [], view: lastView || which, ipad });
      // Out of the capture before anything is enabled.
      protect(true);
      const off = new Set(known && Array.isArray(before.off) ? before.off : []);
      const first = targets.find((t) => t.sceneName === current) || targets[0];
      let input = await findInput();
      let resized = false;   // the source is not the size it is to be (the screen moved, the choice changed, or the item's box did)
      let changed = false;   // the page OBS draws changed (the rig HUD to the iPad dashboard, or back)
      if (!input) {
        await client.request('CreateInput', { sceneName: first.sceneName, inputName: INPUT_NAME, inputKind: INPUT_KIND, inputSettings: inputSettings(which), sceneItemEnabled: true });
        created = true;
        first.items = await itemsOf(first.sceneName);
        log(`[RacingDesk] HUD source: made the browser source "${INPUT_NAME}" in "${first.sceneName}" (${which === 'ipad' ? 'the iPad dashboard' : 'the rig HUD'})`);
      } else {
        // The address is kept current (the port, the choice), and for the rig HUD the size (the screen); his other
        // settings on it are his. The iPad dashboard's size is its item's box, taken once the items are placed (below).
        const now = inputSettings(which, { withSize: which !== 'ipad' });
        changed = lastView !== null && lastView !== which;
        if (which !== 'ipad') {
          let have = null;
          try { have = (await client.request('GetInputSettings', { inputName: INPUT_NAME })).inputSettings; } catch (e) { have = null; }
          resized = !have || have.width !== now.width || have.height !== now.height;
        }
        await client.request('SetInputSettings', { inputName: INPUT_NAME, inputSettings: now, overlay: true });
      }
      placedIn.clear();
      let follow = null;     // the iPad dashboard's item whose box the source is laid out at: the scene OBS is on, else the first
      for (const target of targets) {
        try {
          const items = target.items;
          let ours = ourItemIn(items);
          let isNew = false;
          if (!ours) { ours = await createItem(target.sceneName, items); isNew = true; }
          if (which === 'ipad') {
            // The iPad dashboard: placed in the corner the first time it is in a scene, and never moved or sized again —
            // not when its source's size was changed in OBS and is put back (the item is scaled inside its bounds and keeps
            // its box), and not when the scene was renamed (the place is kept by the scene's uuid). Only the choice moves
            // it: from the rig HUD it is put back where he had it, or in the corner if nothing was kept.
            const was = placeOf(ipad, target);
            if (isNew || created) {
              await placeAbove(target.sceneName, ours, target.game);
              await placeInCorner(target.sceneName, ours, target.game);
              setPlace(ipad, target, null);
            } else if (!was.found) {
              // There, and nothing written of it: the state file was lost, or the switch was turned on afresh in another
              // collection and back, or OBS gave no uuid and the scene was renamed. It is his, unless it is still the
              // rig HUD fitted over the game (or the choice has just changed to this).
              if (changed || await coversGame(target.sceneName, ours, target.game)) {
                await placeAbove(target.sceneName, ours, target.game);
                await placeInCorner(target.sceneName, ours, target.game);
              }
              setPlace(ipad, target, null);
            } else if (changed) {
              if (was.value && typeof was.value === 'object') await restore(target.sceneName, ours, was.value);
              else await placeInCorner(target.sceneName, ours, target.game);
              setPlace(ipad, target, null);
            } else if (target.key !== target.sceneName) {
              setPlace(ipad, target, was.value);   // a record under the name, now under the uuid
            }
            placedIn.set(target.sceneName, ours.id);
            if (!follow || target.sceneName === current) follow = { sceneName: target.sceneName, ours };
          } else {
            // The rig HUD: where he has put it stays where he put it; only a new item, or one the screen's change (or the
            // choice's) has made the wrong size, is placed and fitted. Leaving the iPad dashboard, his transform of it
            // is written down first, for when he chooses it again.
            if (changed && !isNew && placeOf(ipad, target).found) {
              try { setPlace(ipad, target, await transformOf(target.sceneName, ours)); } catch (e) { /* kept as it was */ }
            }
            if (isNew || resized || created) {
              await placeAbove(target.sceneName, ours, target.game);
              await fitTo(target.sceneName, ours, target.game);
            }
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
      keep({ collection, off: [...off], view: which, ipad });
      // The iPad dashboard's page is laid out at its item's box (the item is not touched).
      if (follow) {
        try {
          const answer = await client.request('GetSceneItemTransform', { sceneName: follow.sceneName, sceneItemId: follow.ours.id });
          if (answer && answer.sceneItemTransform && await followBox(follow.sceneName, follow.ours, answer.sceneItemTransform)) resized = true;
        } catch (e) {
          problems.push(`The iPad dashboard's page could not be laid out at its item's size: ${e.message}`);
        }
      }
      // The page is reloaded unless it is alive and polling: a reconnect in the middle of a race keeps its state. A page
      // that was just made, or given another size or address, is loaded afresh anyway.
      if (created || resized || changed || !pageAlive()) {
        try { await refreshInput(); } catch (e) { problems.push(`The HUD page was not reloaded in OBS: ${e.message}`); }
      }
      const what = which === 'ipad' ? 'The iPad dashboard' : 'The HUD';
      const where = which === 'ipad' ? 'in its corner over the game' : 'just above the game';
      const did = placed ? `${what} is a browser source in ${placed === 1 ? 'your scene' : `${placed} of your scenes`}, ${where}.` : `${what} was not put in any scene.`;
      return remember({ ok: placed > 0 && problems.length === 0, did, scenes: placed, created, view: which, problems });
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
      if (mine && (before || switched.size)) keep({ ...(before || {}), collection: before && before.collection ? before.collection : collection, off: [...switched] });
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

  /**
   * OBS says an item was moved or sized (SceneItemTransformChanged: { sceneName, sceneItemId, sceneItemTransform }). If
   * it is the iPad dashboard's item, the source is laid out at its box a moment after the last such event (a drag is
   * one event a pixel). Anything else — another item, the rig HUD chosen, an event with nothing in it — is nothing.
   */
  function transformChanged(event) {
    if (!event || typeof event !== 'object' || viewNow() !== 'ipad') return false;
    const { sceneName, sceneItemId, sceneItemTransform } = event;
    if (typeof sceneName !== 'string' || !Number.isInteger(sceneItemId) || !sceneItemTransform || typeof sceneItemTransform !== 'object') return false;
    if (placedIn.get(sceneName) !== sceneItemId) return false;
    followNext = { sceneName, sceneItemId, transform: sceneItemTransform };
    if (followTimer !== null) clearTimer(followTimer);
    followTimer = setTimer(() => { followTimer = null; follow(); }, followAfterMs);
    if (followTimer && typeof followTimer.unref === 'function') followTimer.unref();
    return true;
  }

  /** The source laid out at the box of the last event's item, after the ensure under way if there is one. */
  function follow() {
    const next = followNext;
    followNext = null;
    if (!next) return Promise.resolve({ ok: false, reason: 'nothing to follow' });
    const run = async () => {
      if (closing || !client.identified() || viewNow() !== 'ipad') return { ok: false, reason: NOT_OPEN };
      try {
        const resized = await followBox(next.sceneName, { id: next.sceneItemId }, next.transform);
        return { ok: true, resized, sceneName: next.sceneName };
      } catch (e) {
        log(`[RacingDesk] HUD source: the iPad dashboard's page could not be laid out at its item's size: ${e.message}`);
        return { ok: false, reason: e.message };
      }
    };
    chain = chain.then(run, run);
    return chain;
  }

  function status() {
    return { last, busy, followed: lastFollow };
  }

  return { apply, ensure, disable, refresh, status, transformChanged, follow, INPUT_NAME };
}

// The iPad dashboard's places as the state file holds them: scene → his transform (an object of numbers and the
// bounds' words) or null. Anything else is not one.
function ipadOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [scene, t] of Object.entries(value)) {
    if (typeof scene !== 'string') continue;
    if (t === null) { out[scene] = null; continue; }
    if (!t || typeof t !== 'object' || Array.isArray(t)) continue;
    const kept = {};
    for (const [key, v] of Object.entries(t)) {
      if (['boundsType'].includes(key) && typeof v === 'string') kept[key] = v;
      else if (typeof v === 'number' && Number.isFinite(v)) kept[key] = v;
    }
    out[scene] = Object.keys(kept).length ? kept : null;
  }
  return out;
}

/**
 * What the HUD source keeps between runs — { collection, off, view, ipad } — in a file, written whole and atomically (a
 * temp file and a rename). A file that is not there, or cannot be read, is none: the source then enables what it finds
 * disabled, once, rather than leave a HUD that never comes back. A file from before the choice (no `view`) is the rig
 * HUD's, with no scene the iPad dashboard was placed in.
 */
function fileState(file, { fs: fsModule = nodeFs, log = () => {} } = {}) {
  return {
    read() {
      try {
        const value = JSON.parse(String(fsModule.readFileSync(file, 'utf8')));
        if (!value || typeof value !== 'object') return null;
        return {
          collection: typeof value.collection === 'string' ? value.collection : null,
          off: Array.isArray(value.off) ? value.off.filter((x) => typeof x === 'string') : [],
          view: viewOf(value.view),
          ipad: ipadOf(value.ipad),
        };
      } catch (e) {
        return null;
      }
    },
    write(value) {
      try {
        fsModule.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        fsModule.writeFileSync(tmp, JSON.stringify({ collection: value.collection || null, off: value.off || [], view: viewOf(value.view), ipad: ipadOf(value.ipad) }));
        fsModule.renameSync(tmp, file);
      } catch (e) {
        log(`[RacingDesk] HUD source: its state file could not be written: ${e.message}`);
      }
    },
  };
}

module.exports = { INPUT_NAME, INPUT_KIND, REFRESH_BUTTON, IPAD_SOURCE, IPAD_PLACE, FOLLOW_AFTER_MS, SOURCE_SIZE, LEAST_BOX, VIEWS, NOT_OPEN, LISTENER_DOWN, createHudSource, fileState };
