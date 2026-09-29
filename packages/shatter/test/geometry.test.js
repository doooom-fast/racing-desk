// Geometry invariants for core/fracture.js. Run: npm test
const assert = require('assert');
const api = require('../core/fracture.js');

const base = { ...api.DEFAULTS, seed: 12345 };
const W = 400, H = 260;

function coverage(b) { return b.shards.reduce((s, sh) => s + Math.abs(api.polyArea(sh.poly)), 0) / (W * H); }

// 1. Intact panes tile the bounding box exactly (no gap, no overlap) in both patterns
for (const pattern of [0, 1]) {
  const b = api.buildShards(W, H, { ...base, pattern, force: 0, time: 0, gap: 0 });
  assert(Math.abs(coverage(b) - 1) < 1e-6, `pattern ${pattern} coverage ${coverage(b)}`);
  for (const sh of b.shards) for (const [x, y] of sh.poly) assert(x >= -1e-9 && x <= W + 1e-9 && y >= -1e-9 && y <= H + 1e-9, 'shard leaves bbox');
}

// 2. Classic slices hit the requested count exactly
assert.strictEqual(api.buildShards(W, H, { ...base, pattern: 1, shards: 80, gap: 0 }).shards.length, 80);

// 3. Deterministic per seed, different across seeds
const a1 = JSON.stringify(api.buildShards(W, H, base)), a2 = JSON.stringify(api.buildShards(W, H, base));
assert.strictEqual(a1, a2, 'same seed must reproduce');
assert.notStrictEqual(a1, JSON.stringify(api.buildShards(W, H, { ...base, seed: 54321 })), 'different seed must differ');

// 4. Physics sanity: gravity pulls down (+y local), force pushes away from impact, time 0 = no motion
const still = api.buildShards(W, H, { ...base, time: 0 });
assert(still.shards.every(sh => sh.dx === 0 && sh.dy === 0 && sh.rot === 0 && sh.scale === 1), 'time 0 must be motionless');
const grav = api.buildShards(W, H, { ...base, force: 0, gravity: 50, time: 80 });
assert(grav.shards.every(sh => sh.dy > 0), 'gravity must push +y (down)');
const blast = api.buildShards(W, H, { ...base, force: 60, gravity: 0, time: 60 });
for (const sh of blast.shards) {
  const r0 = Math.hypot(sh.c[0] - blast.impact[0], sh.c[1] - blast.impact[1]);
  const r1 = Math.hypot(sh.c[0] + sh.dx - blast.impact[0], sh.c[1] + sh.dy - blast.impact[1]);
  assert(r1 >= r0 - 1e-6, 'shards must move away from impact');
}

// 5. Settings note round-trips, and legacy ShatterBox notes still decode
const enc = api.encodeSettings(base);
assert(enc.startsWith('DoooomShatter:'));
assert.deepStrictEqual(api.decodeSettings(enc), base);
assert.deepStrictEqual(api.decodeSettings('ShatterBox:{shards:5,seed:9}'), { shards: 5, seed: 9 });
assert.strictEqual(api.decodeSettings('random note'), null);

// 6. Presets apply and every preset builds
for (const name of Object.keys(api.PRESETS)) {
  const S = { ...base }; assert(api.applyPreset(S, name));
  const b = api.buildShards(W, H, S); assert(b.shards.length > 2, `preset ${name} produced ${b.shards.length}`);
}
assert.strictEqual(api.applyPreset({}, 'nope'), false);

// 7. Stress: extreme settings over many seeds produce no degenerate output
for (let seed = 1; seed < 400; seed++) for (const pattern of [0, 1]) {
  const b = api.buildShards(300, 120, { ...base, pattern, seed, shards: 200, jitter: 100, frag: 100, impactX: 95, impactY: -95, force: 100, time: 100, spin: 100, depth: 100 });
  assert(b.shards.length > 0);
  for (const sh of b.shards) {
    assert(sh.poly.length >= 3);
    for (const v of [sh.dx, sh.dy, sh.rot, sh.scale, sh.opacity]) assert(Number.isFinite(v));
    assert(sh.scale > 0 && sh.opacity >= 0 && sh.opacity <= 1);
  }
}
console.log('geometry: all checks passed');
