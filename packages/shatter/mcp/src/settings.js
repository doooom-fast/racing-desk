import { z } from 'zod';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const core = require('../../core/fracture.js');

const pct = (min = 0, max = 100) => z.number().min(min).max(max);

export const SettingsSchema = z.object({
  pattern: z.union([z.literal(0), z.literal(1), z.enum(['radial', 'classic'])])
    .describe('0/"radial" = radial impact fracture (glass pane); 1/"classic" = KPT-1995 random slices').optional(),
  shards: z.number().int().min(3).max(400).describe('target shard count').optional(),
  jitter: pct().describe('irregularity of cracks, 0 = perfect spider web').optional(),
  frag: pct().describe('radial only: chance a ring cell splits into two triangles').optional(),
  gap: pct(0, 20).describe('crack gap: each shard inset toward its centroid, % of its size').optional(),
  impactX: pct(-100, 100).describe('impact point X offset from center, % of half-width').optional(),
  impactY: pct(-100, 100).describe('impact point Y offset from center, % of half-height (+ is down)').optional(),
  impactRandom: z.boolean().optional(),
  force: pct().describe('outward velocity').optional(),
  time: pct().describe('how far along the explosion is; 0 = intact pane with cracks').optional(),
  spin: pct().describe('per-shard rotation, strongest near impact').optional(),
  gravity: pct().describe('downward pull (t^2)').optional(),
  random: pct().describe('velocity variation between shards').optional(),
  depth: pct().describe('pseudo-z scale variation').optional(),
  fade: pct().describe('opacity loss with distance from impact').optional(),
  tint: pct().describe('facet lighting film strength').optional(),
  edge: pct().describe('edge highlight opacity').optional(),
  edgeWidth: z.number().min(0).max(4).describe('edge highlight stroke width, pt').optional(),
  cut: z.union([z.literal(0), z.literal(1)]).describe('Illustrator only: 0 clipping masks (any art), 1 pathfinder true cut (paths only)').optional(),
  keepOriginal: z.boolean().describe('Illustrator only: keep hidden original for re-shatter').optional(),
  seed: z.number().int().min(1).max(2147483646).describe('random seed; omit for a fresh one').optional(),
}).strict();

export const PresetName = z.enum(Object.keys(core.PRESETS)).describe('named look; explicit settings override it');

/** Resolve DEFAULTS <- preset <- settings, normalise enum strings, ensure a seed. */
export function resolveSettings({ preset, settings } = {}) {
  const S = { ...core.DEFAULTS };
  if (preset) core.applyPreset(S, preset);
  if (settings) Object.assign(S, settings);
  if (S.pattern === 'radial') S.pattern = 0;
  if (S.pattern === 'classic') S.pattern = 1;
  if (!settings || settings.seed == null) S.seed = Math.floor(Math.random() * 2147483646) + 1;
  return S;
}
