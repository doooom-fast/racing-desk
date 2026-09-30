/**
 * Headless Chromium on this machine draws in software and never opens the graphics driver (tests/software-browser.mjs
 * says why). Three things hold it to that: the test runner's config takes the flags; every script in the repo that
 * starts Chromium on its own takes them too, since a script that calls `chromium.launch` with no flags goes round the
 * config; and the browser this very test runs in is SwiftShader, not the card.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../../playwright.config.mjs';
import { SOFTWARE_GL_ARGS } from '../software-browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..', '..', '..');

// Where scripts live in this repo, and what is not source: other sessions' worktrees, build output, dependencies.
const SOURCE_ROOTS = ['apps', 'packages', 'scripts', 'tools'];
const SKIP = new Set(['node_modules', '.git', '.worktrees', 'dist', 'publish', 'bin', 'obj', 'build', 'out', 'target', '.venv', 'test-results', '__pycache__', 'win-unpacked']);
const SCRIPT = /\.(?:m?js|cjs|ts|tsx)$/i;
// A call that starts a browser, or an Electron app, by hand. The test runner's own launches go through the config.
const LAUNCHES = /\b(?:chromium|firefox|webkit|_electron|electron)\s*\.\s*launch(?:PersistentContext|Server)?\s*\(/;

function scripts(dir, found = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return found; }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) scripts(path.join(dir, entry.name), found);
    } else if (SCRIPT.test(entry.name)) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

test('the flags are the three that keep Chromium off the graphics card', () => {
  expect(SOFTWARE_GL_ARGS).toEqual(['--disable-gpu', '--use-angle=swiftshader', '--use-gl=angle']);
});

test('the test runner launches every browser with them', () => {
  const args = config.use.launchOptions.args;
  for (const flag of SOFTWARE_GL_ARGS) expect(args, flag).toContain(flag);
  const text = fs.readFileSync(path.join(here, '..', '..', 'playwright.config.mjs'), 'utf8');
  expect(text).toContain('SOFTWARE_GL_ARGS');
  // No project or test file puts its own launch options over the config's.
  for (const project of config.projects) expect(project.use && project.use.launchOptions, project.name).toBeUndefined();
});

test('every script in the repo that starts Chromium itself takes them too', () => {
  const launching = [];
  let looked = 0;
  for (const root of SOURCE_ROOTS) {
    for (const file of scripts(path.join(REPO, root))) {
      looked += 1;
      const text = fs.readFileSync(file, 'utf8');
      if (!LAUNCHES.test(text)) continue;
      launching.push({ file: path.relative(REPO, file).split(path.sep).join('/'), takes: text.includes('SOFTWARE_GL_ARGS') });
    }
  }
  expect(looked, 'the walk found the repo\'s scripts').toBeGreaterThan(50);
  // The Shatter renderer is one that launches by hand, so the list is not empty; the test runner's tests are not.
  expect(launching.map((l) => l.file)).toContain('packages/shatter/test/render.js');
  const without = launching.filter((l) => !l.takes).map((l) => l.file);
  expect(without, `launches Chromium without SOFTWARE_GL_ARGS (apps/overlay/tests/software-browser.mjs): ${without.join(', ')}`).toEqual([]);
});

test('the browser this test runs in is drawing in SwiftShader', async ({ page }) => {
  await page.setContent('<canvas id="c" width="8" height="8"></canvas>');
  const renderer = await page.evaluate(() => {
    const gl = document.getElementById('c').getContext('webgl');
    if (!gl) return null;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  expect(renderer, 'this browser has WebGL').not.toBeNull();
  expect(renderer).toMatch(/swiftshader/i);
  expect(renderer).not.toMatch(/nvidia|geforce|rtx|gtx/i);
});
