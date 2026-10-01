// Builds the Stream Deck plugin: streamdeck/racing-desk/src/plugin.js and the app's WebSocket client it requires,
// bundled by esbuild (which the workspace has) into com.doooom.racingdesk.sdPlugin/bin/plugin.js, beside a
// package.json that says the folder is CommonJS. Run by `npm run build` at the root before the exe is built; the
// .sdPlugin folder is in electron-builder's files and unpacked from the asar, and the app copies it into the Stream
// Deck's plugin folder at start (modules/js/streamdeck-install.js). `bin/` is build output and stays out of git.
//
//   node apps/overlay/streamdeck/build.mjs            → the plugin folder in the tree
//   buildPlugin({ outDir })                           → anywhere (the tests build into a temp folder)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export const PLUGIN_DIR = 'com.doooom.racingdesk.sdPlugin';
export const ENTRY = join(here, 'racing-desk', 'src', 'plugin.js');
export const DEFAULT_OUT_DIR = join(here, 'racing-desk', PLUGIN_DIR, 'bin');

export function buildPlugin({ outDir = DEFAULT_OUT_DIR } = {}) {
  const esbuild = require('esbuild');
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, 'plugin.js');
  esbuild.buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile,
    logLevel: 'silent',
    banner: { js: '// Built by apps/overlay/streamdeck/build.mjs from streamdeck/racing-desk/src/plugin.js. Do not edit.' },
  });
  writeFileSync(join(outDir, 'package.json'), '{ "type": "commonjs" }\n');
  return { outfile };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { outfile } = buildPlugin();
  console.log(`Stream Deck plugin built: ${outfile}`);
}
