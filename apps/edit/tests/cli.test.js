// ═══════════════════════════════════════════════════════════════
// CLI TESTS — bin/racing-desk-edit.js over a recording's folder
// ═══════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'racing-desk-edit.js');
const env = { ...process.env, ANTHROPIC_API_KEY: '' };
const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env, timeout: 60000 });

const line = (o) => JSON.stringify(o) + '\n';

/** A recording's folder: two minutes and ten seconds, a pass for P4 at t 100, the file begun 3.5 s after t 0. */
function recording() {
  const dir = mkdtempSync(join(tmpdir(), 'rd-edit-cli-'));
  let text = line({ _type: 'header', schemaVersion: 1, startedAt: '2026-10-20T20:08:01.000Z', track: 'Zandvoort', producer: 'obs', kind: 'recording' });
  for (let t = 0; t <= 130; t += 0.5) {
    text += line({ t, frame: Math.round(t * 2), pos: t < 100 ? 5 : 4, totalCars: 20, lap: 1 + Math.floor(t / 90), speed: 150, gapAhead: 2.5, gapBehind: 3.5, incidents: 0, pit: false, flag: 'green' });
  }
  text += line({ _type: 'summary', frames: 261, videoOffsetMs: -3500, alignment: { method: 'chapters', pairs: 2, spreadMs: 30 } });
  writeFileSync(join(dir, '2026-10-20 20-08-01.telemetry.jsonl'), text);
  writeFileSync(join(dir, '2026-10-20 20-08-01.mp4'), 'not a video');
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('--help names every command and exits 0; nothing, or a command that is not one, is a usage error', () => {
  const help = run('--help');
  assert.strictEqual(help.status, 0, help.stderr);
  for (const c of ['ingest', 'analyze', 'preview', 'render', 'condense', 'clips']) assert.match(help.stdout, new RegExp(`^  ${c} `, 'm'));
  assert.strictEqual(run().status, 2);
  const bad = run('cut', '.');
  assert.strictEqual(bad.status, 2);
  assert.match(bad.stderr, /Not a command: cut/);
  assert.strictEqual(run('ingest').status, 2);
  assert.strictEqual(run('ingest', '.', '--no-such-flag').status, 2);
  assert.strictEqual(run('ingest', join(tmpdir(), 'rd-edit-no-such-folder')).status, 2);
});

test('ingest, analyze and a dry run of the clips: the pass at t 100 is cut at 1:33.5 of the video', () => {
  const { dir, done } = recording();
  try {
    const ingest = run('ingest', dir);
    assert.strictEqual(ingest.status, 0, ingest.stderr);
    assert.match(ingest.stdout, /261 frames/);
    assert.match(ingest.stdout, /position_change 1/);
    assert.match(ingest.stdout, /Video is telemetry time −3500 ms \(lined up by chapters\)\./);
    assert.ok(existsSync(join(dir, 'session.json')));

    const analyze = run('analyze', dir, '--no-claude');
    assert.strictEqual(analyze.status, 0, analyze.stderr);
    assert.match(analyze.stdout, /mechanical/);
    const edl = JSON.parse(readFileSync(join(dir, 'edit-decisions.json'), 'utf8'));
    assert.deepStrictEqual(edl.highlight_reel.segments.map((s) => [s.start, s.end]), [['1:37', '1:48']]);

    const clips = run('clips', dir, '--dry-run');
    assert.strictEqual(clips.status, 0, clips.stderr);
    assert.match(clips.stdout, /1:37–1:48 \(cockpit\) → video 00:01:33\.500–00:01:44\.500/);

    const render = run('render', dir, '--dry-run');
    assert.strictEqual(render.status, 0, render.stderr);
    assert.match(render.stdout, /→ video /);
    assert.doesNotMatch(render.stdout, /→ video -/);
  } finally { done(); }
});

test('analyze reads the telemetry first when there is no session.json; a failure says which command and exits 1', () => {
  const { dir, done } = recording();
  try {
    const analyze = run('analyze', dir, '--no-claude');
    assert.strictEqual(analyze.status, 0, analyze.stderr);
    assert.match(analyze.stdout, /reading the telemetry first/);
    assert.ok(existsSync(join(dir, 'edit-decisions.json')));

    rmSync(join(dir, '2026-10-20 20-08-01.mp4'));
    const render = run('render', dir, '--dry-run');
    assert.strictEqual(render.status, 1);
    assert.match(render.stderr, /render failed: Cockpit video not found/);
  } finally { done(); }
});
