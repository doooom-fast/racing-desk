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
