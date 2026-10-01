/**
 * Two guards on what is left behind when a piece is taken out of the overlay (the Electron recorder went on 2026-09-30,
 * with its ffmpeg and its bundle writer):
 *  - no script of the app requires a file that is not there, and
 *  - the root package-lock.json says of apps/overlay what its package.json says.
 * Both were true of nothing the day after: a smoke test still required the deleted bundle writer (and electron-builder
 * packs everything under modules/), and the lockfile still listed ffmpeg-static as a dependency of the app.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const overlay = path.resolve(here, '..', '..');
const root = path.resolve(overlay, '..', '..');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-electron', '.git', 'bin', 'out']);
const SKIP_FILE = /\.bundle\.js$|-build\.html$/;

function scripts(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) scripts(path.join(dir, entry.name), found);
    } else if (/\.(js|cjs)$/.test(entry.name) && !SKIP_FILE.test(entry.name)) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

function resolves(from, wanted) {
  const base = path.resolve(path.dirname(from), wanted);
  const candidates = [base, `${base}.js`, `${base}.cjs`, `${base}.json`, `${base}.node`, path.join(base, 'index.js'), path.join(base, 'package.json')];
  return candidates.some((c) => fs.existsSync(c) && fs.statSync(c).isFile());
}

test('every relative require in the app\'s scripts is a file that is there', () => {
  const files = scripts(overlay);
  expect(files.length).toBeGreaterThan(50);   // it reads the app, not an empty folder
  const missing = [];
  for (const file of files) {
    const text = withoutComments(fs.readFileSync(file, 'utf8'));
    for (const m of text.matchAll(/\brequire\(\s*['"](\.{1,2}\/[^'"]*)['"]\s*\)/g)) {
      if (!resolves(file, m[1])) missing.push(`${path.relative(overlay, file)} requires ${m[1]}`);
    }
  }
  expect(missing).toEqual([]);
});

test('the check reads what it is meant to: a require of a deleted file is found', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP || process.env.TMPDIR || '/tmp'), 'rd-sources-'));
  try {
    const a = path.join(dir, 'a.js');
    fs.writeFileSync(path.join(dir, 'b.js'), 'module.exports = 1;\n');
    fs.writeFileSync(a, "const b = require('./b');\nconst gone = require('../bundle-writer');\n// require('./commented')\n");
    const text = withoutComments(fs.readFileSync(a, 'utf8'));
    const wanted = [...text.matchAll(/\brequire\(\s*['"](\.{1,2}\/[^'"]*)['"]\s*\)/g)].map((m) => m[1]);
    expect(wanted).toEqual(['./b', '../bundle-writer']);
    expect(wanted.filter((w) => !resolves(a, w))).toEqual(['../bundle-writer']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the lockfile says of apps/overlay what its package.json says', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(overlay, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const locked = lock.packages['apps/overlay'];
  expect(locked, 'the lockfile has apps/overlay').toBeTruthy();
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    expect(locked[field] || {}, field).toEqual(pkg[field] || {});
  }
  // And what the app no longer carries is not in the tree at all.
  expect(pkg.dependencies && pkg.dependencies['ffmpeg-static']).toBeUndefined();
  expect(Object.keys(lock.packages).filter((k) => /(^|\/)ffmpeg-static(\/|$)/.test(k))).toEqual([]);
});
