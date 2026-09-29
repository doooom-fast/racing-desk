#!/usr/bin/env node
// Doooom Shatter MCP server (stdio). Tools: list_presets, shatter_plan, shatter_svg, illustrator_selection_info, illustrator_shatter
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile, writeFile } from 'node:fs/promises';
import { core, SettingsSchema, PresetName, resolveSettings } from './settings.js';
import { shatterSvg, shatterPlan } from './svg.js';
import { illustratorShatter, illustratorSelectionInfo } from './illustrator.js';

const server = new McpServer({ name: 'doooom-shatter', version: '0.1.0' });

const text = (s) => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: `Error: ${e.message || e}` }] });

server.registerTool('list_presets', {
  title: 'List presets',
  description: 'Named Doooom Shatter looks (cracked-pane, glass-impact, doooom, kpt-1995, confetti, frozen-cracks) with their settings, plus the defaults and the meaning of every setting.',
  inputSchema: {},
}, async () => text({
  defaults: core.DEFAULTS,
  presets: core.PRESETS,
  settings: Object.fromEntries(Object.entries(SettingsSchema.shape).map(([k, v]) => [k, v.description || ''])),
}));

server.registerTool('shatter_plan', {
  title: 'Plan a shatter',
  description: 'Compute shard polygons and explode physics for a WxH rectangle without rendering anything. Local space: origin top-left, y down. Each shard has its clipped polygon, centroid, translation, rotation (deg), scale, opacity, and the polygon after motion ("moved"). Use this when you will draw the shards yourself (canvas, Figma, three.js, etc.).',
  inputSchema: { width: z.number().positive(), height: z.number().positive(), preset: PresetName.optional(), settings: SettingsSchema.optional() },
}, async ({ width, height, preset, settings }) => {
  try { return text(shatterPlan(width, height, resolveSettings({ preset, settings }))); } catch (e) { return fail(e); }
});

server.registerTool('shatter_svg', {
  title: 'Shatter an SVG',
  description: 'Shatter SVG artwork headlessly. Pass the SVG as text (svg) or a file path (svg_path). Returns the shattered SVG (source kept intact in <defs>, one clipped <use> per shard with transforms, facet tint and edge highlights), or writes it to out_path and returns a summary. Any SVG works: gradients, text, images.',
  inputSchema: {
    svg: z.string().optional(), svg_path: z.string().optional(), out_path: z.string().optional(),
    background: z.string().optional().describe('optional background fill colour for the output'),
    preset: PresetName.optional(), settings: SettingsSchema.optional(),
  },
}, async ({ svg, svg_path, out_path, background, preset, settings }) => {
  try {
    if (!svg && !svg_path) throw new Error('provide svg or svg_path');
    const input = svg ?? await readFile(svg_path, 'utf8');
    const r = shatterSvg(input, resolveSettings({ preset, settings }), { background });
    if (out_path) { await writeFile(out_path, r.svg, 'utf8'); return text({ written: out_path, shards: r.shards, impact: r.impact, settings: r.settings }); }
    return { content: [{ type: 'text', text: r.svg }, { type: 'text', text: JSON.stringify({ shards: r.shards, impact: r.impact, seed: r.settings.seed }) }] };
  } catch (e) { return fail(e); }
});

server.registerTool('illustrator_selection_info', {
  title: 'Inspect Illustrator selection',
  description: 'Reports the active Adobe Illustrator document and its current selection (types, names, sizes, and whether an item is an existing Doooom Shatter group that can be re-shattered). Requires Illustrator running locally on macOS or Windows.',
  inputSchema: {},
}, async () => { try { return text(await illustratorSelectionInfo()); } catch (e) { return fail(e); } });

server.registerTool('illustrator_shatter', {
  title: 'Shatter in Illustrator',
  description: 'Shatter the CURRENT SELECTION in the running Adobe Illustrator (macOS/Windows) with the given preset/settings, non-interactively. Result is a "Doooom Shatter" group with hidden original and settings stored in its Note; select that group and call again to re-shatter with new settings (seed, time, force...). Returns the status string from Illustrator.',
  inputSchema: { preset: PresetName.optional(), settings: SettingsSchema.optional() },
}, async ({ preset, settings }) => { try { return text(await illustratorShatter(resolveSettings({ preset, settings }))); } catch (e) { return fail(e); } });

const transport = new StdioServerTransport();
await server.connect(transport);
