// Layout v2 contract tests — guards the schema shared with the WinUI
// host (prodrive-windows). The host embeds byte-identical copies of
// layout-registry.json and this fixture; its C# test suite runs the
// mirror-image checks plus a drift test against this repo when both
// checkouts are present. Plan: prodrive-windows/docs/overlay-layout-v2.md.
//
// Run: npm run test:contract  (plain node:test — no browser needed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(readFileSync(join(root, 'layout-registry.json'), 'utf8'));
const fixture = JSON.parse(readFileSync(join(root, 'tests/fixtures/layout-v2-settings.json'), 'utf8'));

const ANCHORS = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];

/** Flatten member slots (string | string[]) to a flat id list. */
function flattenMembers(group) {
  return group.members.flatMap((slot) => (Array.isArray(slot) ? slot : [slot]));
}

test('registry: modules are complete and well-formed', () => {
  assert.equal(registry.version, 2);
  assert.ok(registry.modules.length >= 16, 'expected the full module inventory');

  const ids = new Set();
  for (const m of registry.modules) {
    assert.ok(m.id && m.label && m.selector, `module missing id/label/selector: ${JSON.stringify(m)}`);
    assert.ok(!ids.has(m.id), `duplicate module id: ${m.id}`);
    ids.add(m.id);
    if (m.placeable) {
      assert.ok(m.showKey, `placeable module ${m.id} needs a showKey`);
      assert.ok(m.nominal && m.nominal.w > 0 && m.nominal.h > 0, `placeable module ${m.id} needs a nominal size`);
    }
  }
});

test('registry: every selector resolves to known markup', () => {
  // Cheap existence check — dashboard.html for static elements, plus
  // game-logo.js for the dynamically created #gameLogoOverlay. Trips
  // when someone renames a DOM id/class without updating the registry.
  const haystack =
    readFileSync(join(root, 'dashboard.html'), 'utf8') +
    readFileSync(join(root, 'modules/js/game-logo.js'), 'utf8');
  for (const m of registry.modules) {
    const bare = m.selector.replace(/^[.#]/, '');
    assert.ok(haystack.includes(bare), `selector ${m.selector} (module ${m.id}) not found in markup`);
  }
});

test('registry: showKeys are wired into the overlay', () => {
  // Every showKey must exist in both the visibility map (settings.js)
  // and the defaults (config.js) — this is the inventory-drift guard
  // that caught dead showFuel/showTyres and missing showMaps/showTimer.
  const settingsJs = readFileSync(join(root, 'modules/js/settings.js'), 'utf8');
  const configJs = readFileSync(join(root, 'modules/js/config.js'), 'utf8');
  for (const m of registry.modules) {
    if (!m.showKey) continue;
    assert.ok(settingsJs.includes(m.showKey), `${m.showKey} missing from settings.js _MODULE_VISIBILITY`);
    assert.ok(new RegExp(`\\b${m.showKey}\\s*:`).test(configJs), `${m.showKey} missing from config.js _defaultSettings`);
  }
});

test('defaultLayout: groups are valid and cover every placeable module exactly once', () => {
  const layout = registry.defaultLayout;
  assert.equal(layout.version, 2);

  const placeable = new Set(registry.modules.filter((m) => m.placeable).map((m) => m.id));
  const seen = new Map(); // moduleId → groupId
  const groupIds = new Set();

  for (const g of layout.groups) {
    assert.ok(!groupIds.has(g.id), `duplicate group id: ${g.id}`);
    groupIds.add(g.id);
    assert.ok(ANCHORS.includes(g.anchor), `group ${g.id}: bad anchor ${g.anchor}`);
    assert.ok(g.x >= 0 && g.x <= 1 && g.y >= 0 && g.y <= 1, `group ${g.id}: x/y must be normalized 0..1`);
    assert.ok(['row', 'column'].includes(g.flow), `group ${g.id}: bad flow ${g.flow}`);
    assert.equal(typeof g.locked, 'boolean', `group ${g.id}: locked must be boolean`);

    for (const id of flattenMembers(g)) {
      assert.ok(placeable.has(id), `group ${g.id}: member ${id} is not a placeable module`);
      assert.ok(!seen.has(id), `module ${id} appears in both ${seen.get(id)} and ${g.id}`);
      seen.set(id, g.id);
    }
  }

  for (const id of placeable) {
    assert.ok(seen.has(id), `placeable module ${id} missing from defaultLayout`);
  }
});

test('fixture: layout block matches the registry defaultLayout byte-for-byte', () => {
  // One canonical seed. The fixture exists so both repos round-trip
  // the SAME document; if the default layout changes, change both.
  assert.deepEqual(fixture.layout, registry.defaultLayout);
});

test('fixture: legacy keys coexist with the v2 layout block', () => {
  assert.equal(fixture.layoutPosition, 'top-right');
  assert.equal(fixture.zoom, 165);
  assert.equal(fixture.showMaps, true);
  assert.equal(fixture.showTimer, true);
});
