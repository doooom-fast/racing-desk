/**
 * Content hashing for "which version is applied": a known SHA-256, cache invalidation on change, and a missing
 * file being an error rather than a hash. Port of the tests in apps/paints/src-tauri/src/digest.rs.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const digest = require('../../modules/js/paints/digest.js');

let dir;
test.beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'racing-desk-paints-digest-')); });
test.afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('hashes to a known value and notices a rewrite', () => {
  const p = path.join(dir, 'a.bin');
  fs.writeFileSync(p, 'hello');
  const first = digest.fileSha256(p);
  // Known value, so a broken hasher cannot quietly agree with itself.
  expect(first).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  expect(digest.fileSha256(p)).toBe(first);   // memoised

  // A rewrite of a different length must invalidate the cache even if the clock is too coarse to notice the
  // mtime change.
  fs.writeFileSync(p, 'hello world');
  const second = digest.fileSha256(p);
  expect(second).not.toBe(first);
  expect(second).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
});

test('a file larger than one read chunk hashes correctly', () => {
  const p = path.join(dir, 'big.bin');
  const bytes = Buffer.alloc(700 * 1024, 0xab);
  fs.writeFileSync(p, bytes);
  const expected = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  expect(digest.fileSha256(p)).toBe(expected);
});

test('a missing file is an error, not a hash', () => {
  expect(() => digest.fileSha256(path.join(dir, 'no-such-file.tga'))).toThrow();
});

test('clearCache forgets, and the next call re-reads', () => {
  const p = path.join(dir, 'c.bin');
  fs.writeFileSync(p, 'one');
  const one = digest.fileSha256(p);
  digest.clearCache();
  expect(digest.fileSha256(p)).toBe(one);
  fs.writeFileSync(p, 'three');
  digest.clearCache();
  expect(digest.fileSha256(p)).not.toBe(one);
});

test('the cache key is case-insensitive, as the filesystem is', () => {
  const p = path.join(dir, 'Case.bin');
  fs.writeFileSync(p, 'x');
  expect(digest.fileSha256(p)).toBe(digest.fileSha256(p.toUpperCase()));
});

// A file rewritten to the same length at the same time is one the memo cannot tell from the old: what a copy
// that keeps its source's time can do to a paint folder. Whether a hash was read again shows by that.
const THEN = new Date(2026, 0, 1, 12, 0, 0);
function writeAt(p, text) {
  fs.writeFileSync(p, text);
  fs.utimesSync(p, THEN, THEN);
}
const rewriteUnseen = writeAt;

test('forgetUnder forgets a folder and what is beneath it, and nothing beside it', () => {
  digest.clearCache();
  const paint = path.join(dir, 'paint', 'lotus79');
  const beside = path.join(dir, 'paint', 'lotus79 two');
  const library = path.join(dir, 'library', 'lotus79', 'shatter');
  for (const d of [paint, path.join(paint, 'deeper'), beside, library]) fs.mkdirSync(d, { recursive: true });
  const files = {
    installed: path.join(paint, 'car_424242.tga'),
    deeper: path.join(paint, 'deeper', 'car_424242.tga'),
    beside: path.join(beside, 'car_424242.tga'),
    library: path.join(library, 'car_424242.tga'),
  };
  const before = {};
  for (const [k, p] of Object.entries(files)) {
    writeAt(p, 'one');
    before[k] = digest.fileSha256(p);
  }
  for (const p of Object.values(files)) rewriteUnseen(p, 'two');

  expect(digest.forgetUnder(paint.toUpperCase())).toBe(2);

  expect(digest.fileSha256(files.installed)).not.toBe(before.installed);   // read again
  expect(digest.fileSha256(files.deeper)).not.toBe(before.deeper);
  expect(digest.fileSha256(files.beside)).toBe(before.beside);             // "lotus79 two" is not under "lotus79"
  expect(digest.fileSha256(files.library)).toBe(before.library);           // and the library was not touched
  expect(digest.forgetUnder(path.join(dir, 'nothing here'))).toBe(0);
});

test('the memo is kept in a file, and a new start reads no paint it has read before', () => {
  digest.clearCache();
  const file = path.join(dir, 'kept', 'hashes.json');
  const p = path.join(dir, 'kept.bin');
  const gone = path.join(dir, 'gone.bin');
  writeAt(p, 'one');
  fs.writeFileSync(gone, 'one');

  expect(digest.keepIn(file)).toBe(0);                  // no file yet: an empty memo, not an error
  const one = digest.fileSha256(p);
  digest.fileSha256(gone);
  fs.rmSync(gone);
  expect(digest.save()).toBe(true);
  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(written.version).toBe(1);
  expect(written.files.map((row) => row[0])).toEqual([p.toLowerCase()]);   // a file that is gone is left out
  expect(fs.readdirSync(path.dirname(file))).toEqual(['hashes.json']);

  // A new start: nothing in memory, the file taken in, and the paint not read.
  digest.keepIn(null);
  digest.clearCache();
  rewriteUnseen(p, 'two');
  expect(digest.keepIn(file)).toBe(1);
  expect(digest.fileSha256(p)).toBe(one);

  // A file changed since is read, whatever the memo holds.
  fs.writeFileSync(p, 'three!');
  expect(digest.fileSha256(p)).not.toBe(one);
  digest.keepIn(null);
});

test('a memo file that is not one is an empty memo', () => {
  digest.clearCache();
  const file = path.join(dir, 'bad.json');
  for (const text of ['not json', '[]', '{"version":9,"files":[["a",1,1,"00"]]}',
    JSON.stringify({ version: 1, files: [['a', 1, 1, 'not a hash'], ['b', 'x', 1, 'a'.repeat(64)], 'row', null] })]) {
    fs.writeFileSync(file, text);
    expect(digest.keepIn(file)).toBe(0);
  }
  digest.keepIn(null);
});
