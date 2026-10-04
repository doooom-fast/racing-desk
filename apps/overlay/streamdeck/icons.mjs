// The Stream Deck plugin's images, drawn from Lucide (lucide-static): the icon set the other apps use (lucide-react in
// prodrive-windows and prodrive-server). He asked on 2026-10-03: "Our string deck icons are pretty bad. Let's use an
// icon library that we've used elsewhere." The old ones were a small purple glyph with its name set beneath, one 144px
// picture for all four sizes.
//
// For each action, in imgs/actions/<action>/:
//   icon.png 20x20, icon@2x.png 40x40    the action list's icon: white strokes on nothing, as Elgato asks for the list
//   key.png 72x72, key@2x.png 144x144    the key: the icon in white on the dark key, its name beneath in sentence case
// and imgs/plugin/category-icon.png 28x28 (@2x 56x56) for the category in the list. Each size is drawn at its own size,
// not scaled from another, so the strokes stay sharp. The marketplace picture is left as it is.
//
// Run by hand after changing one (it draws with the Chromium the workspace has for its tests); the PNGs are committed,
// so the build does not run it. Raise the manifest's Version with them: the app copies the plugin into the Stream Deck
// only when its version (or its code) has changed (modules/js/streamdeck-install.js).
//
//   node apps/overlay/streamdeck/icons.mjs
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PLUGIN = join(here, 'racing-desk', 'com.doooom.racingdesk.sdPlugin');
const LUCIDE = join(dirname(require.resolve('lucide-static/package.json')), 'icons');
const { SOFTWARE_GL_ARGS } = await import(new URL('../tests/software-browser.mjs', import.meta.url).href);
const { chromium } = require('playwright');

// Each action: its Lucide icon, the name on its key, and a colour where the action has one of its own.
export const ACTIONS = {
  'toggle-settings':      { icon: 'settings',          label: 'Settings' },
  'toggle-overlay':       { icon: 'eye',               label: 'Show / hide' },
  'toggle-drive-mode':    { icon: 'layout-dashboard',  label: 'Drive mode' },
  'zoom-in':              { icon: 'zoom-in',           label: 'Zoom in' },
  'zoom-out':             { icon: 'zoom-out',          label: 'Zoom out' },
  'cycle-rating':         { icon: 'award',             label: 'Rating / position' },
  'cycle-car-logo':       { icon: 'car-front',         label: 'Car logo' },
  'toggle-recording':     { icon: 'circle-dot',        label: 'Record', colour: '#f05252' },
  'save-replay-buffer':   { icon: 'history',           label: 'Save replay' },
  'tv-shots':             { icon: 'tv',                label: 'TV shots' },
  'pitbox-next-tab':      { icon: 'chevron-right',     label: 'Next tab' },
  'pitbox-prev-tab':      { icon: 'chevron-left',      label: 'Previous tab' },
  'dismiss-commentary':   { icon: 'message-square-x',  label: 'Dismiss' },
  'quit':                 { icon: 'power',             label: 'Quit' },
};
const CATEGORY_ICON = 'gauge';

const KEY_BG = '#121419';
const KEY_FG = '#ffffff';
const LABEL = '#c3c8d2';

/** A Lucide icon's SVG at a size, a colour and a stroke. */
function svg(name, size, colour, stroke) {
  const src = readFileSync(join(LUCIDE, `${name}.svg`), 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim();
  return src
    .replace(/\swidth="24"/, ` width="${size}"`)
    .replace(/\sheight="24"/, ` height="${size}"`)
    .replace(/stroke="currentColor"/, `stroke="${colour}"`)
    .replace(/stroke-width="2"/, `stroke-width="${stroke}"`);
}

/** The list's icon: the strokes alone, white, a little heavier than Lucide's own at this small size. */
function iconPage(name, size) {
  return `<!doctype html><html><body style="margin:0;background:transparent">
    <div id="shot" style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">${svg(name, Math.round(size * 0.9), '#ffffff', 2)}</div>
  </body></html>`;
}

/** The key: the icon above the middle and the name beneath, on the dark key; s is 1 at 144px. */
function keyPage(name, label, colour, size) {
  const s = size / 144;
  return `<!doctype html><html><head><style>
    body { margin: 0; background: transparent; }
    #shot { width: ${size}px; height: ${size}px; background: ${KEY_BG}; position: relative; overflow: hidden; }
    .icon { position: absolute; left: 0; right: 0; top: ${24 * s}px; display: flex; justify-content: center; }
    .label { position: absolute; left: ${6 * s}px; right: ${6 * s}px; top: ${104 * s}px; text-align: center; white-space: nowrap;
             font: 600 ${17 * s}px/1.2 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; color: ${LABEL}; letter-spacing: 0.01em; }
  </style></head><body>
    <div id="shot"><div class="icon">${svg(name, Math.round(68 * s), colour || KEY_FG, 1.75)}</div><div class="label">${label}</div></div>
  </body></html>`;
}

async function shoot(page, html, file) {
  await page.setContent(html);
  // A long name is made smaller until it fits the key.
  await page.evaluate(() => {
    const el = document.querySelector('.label');
    if (!el) return;
    let px = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth && px > 6) { px -= 0.5; el.style.fontSize = `${px}px`; }
  });
  await page.locator('#shot').screenshot({ path: file, omitBackground: true });
}

const browser = await chromium.launch({ headless: true, args: SOFTWARE_GL_ARGS });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [action, a] of Object.entries(ACTIONS)) {
    const dir = join(PLUGIN, 'imgs', 'actions', action);
    mkdirSync(dir, { recursive: true });
    await shoot(page, iconPage(a.icon, 20), join(dir, 'icon.png'));
    await shoot(page, iconPage(a.icon, 40), join(dir, 'icon@2x.png'));
    await shoot(page, keyPage(a.icon, a.label, a.colour, 72), join(dir, 'key.png'));
    await shoot(page, keyPage(a.icon, a.label, a.colour, 144), join(dir, 'key@2x.png'));
  }
  const plugin = join(PLUGIN, 'imgs', 'plugin');
  await shoot(page, iconPage(CATEGORY_ICON, 28), join(plugin, 'category-icon.png'));
  await shoot(page, iconPage(CATEGORY_ICON, 56), join(plugin, 'category-icon@2x.png'));
  console.log(`${Object.keys(ACTIONS).length} actions and the category drawn from Lucide into ${PLUGIN}\\imgs`);
} finally {
  await browser.close();
}
