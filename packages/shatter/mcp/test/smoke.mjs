// Spawns the MCP server over stdio and exercises the headless tools. Run: npm run smoke (in mcp/)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(here, '..', 'src', 'server.js')] }));

const tools = (await client.listTools()).tools.map((t) => t.name).sort();
assert.deepStrictEqual(tools, ['illustrator_selection_info', 'illustrator_shatter', 'list_presets', 'shatter_plan', 'shatter_svg']);

const presets = JSON.parse((await client.callTool({ name: 'list_presets', arguments: {} })).content[0].text);
assert('doooom' in presets.presets);

const plan = JSON.parse((await client.callTool({ name: 'shatter_plan', arguments: { width: 300, height: 200, preset: 'glass-impact', settings: { seed: 7 } } })).content[0].text);
assert(plan.count > 50 && plan.shards[0].polygon.length >= 3);

const sample = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260">
  <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#ff3b30"/><stop offset="1" stop-color="#5856d6"/></linearGradient></defs>
  <rect width="400" height="260" rx="24" fill="url(#g)"/>
  <text x="200" y="150" font-family="Impact, sans-serif" font-size="96" text-anchor="middle" fill="#fff">DOOOOM</text>
</svg>`;
const r = await client.callTool({ name: 'shatter_svg', arguments: { svg: sample, preset: 'doooom', settings: { seed: 1995 }, background: '#111' } });
assert(!r.isError, r.content?.[0]?.text);
const out = r.content[0].text;
assert(out.startsWith('<svg') && out.includes('id="doooom-src"') && (out.match(/class="shard"/g) || []).length > 100);
await mkdir(join(here, 'out'), { recursive: true });
await writeFile(join(here, 'out', 'doooom.svg'), out);

const r2 = await client.callTool({ name: 'shatter_svg', arguments: { svg: sample, preset: 'kpt-1995', settings: { seed: 1 }, out_path: join(here, 'out', 'kpt.svg') } });
assert(JSON.parse(r2.content[0].text).written);

const bad = await client.callTool({ name: 'shatter_svg', arguments: { svg: 'not svg' } });
assert(bad.isError);

// Illustrator bridge should fail gracefully off macOS/Windows (and when AI isn't running)
const ai = await client.callTool({ name: 'illustrator_selection_info', arguments: {} });
console.log('illustrator bridge:', ai.isError ? ai.content[0].text.slice(0, 90) : 'connected');

await client.close();
console.log('mcp smoke: all checks passed');
