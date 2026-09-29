import { writeFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { shatterSvg } from '../mcp/src/svg.js';
import { resolveSettings } from '../mcp/src/settings.js';
// Shatters the same artwork with three presets, headlessly - no Illustrator, no browser.
// Run: npm run smoke
const OUT = new URL('./out/', import.meta.url);
await mkdir(OUT, { recursive: true });
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200" width="600" height="200">
  <rect width="600" height="200" fill="#0a0a0a"/>
  <text x="300" y="150" font-family="Impact, Haettenschweiler, sans-serif" font-size="150" fill="#DC3714" text-anchor="middle">DOOOOM</text>
</svg>`;
for (const preset of ['cracked-pane', 'glass-impact', 'doooom']) {
  const S = resolveSettings({ preset, settings: { seed: 1995 } });
  const out = shatterSvg(svg, S).svg;
  await writeFile(new URL(`${preset}.svg`, OUT), out, 'utf8');
  console.log(preset.padEnd(14), (out.length / 1024).toFixed(1) + ' KB  shards=' + S.shards + '  time=' + S.time);
}
