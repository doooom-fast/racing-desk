# Doooom Shatter

A 2026 recreation of **ShatterBox** — the glass-shatter filter from MetaTools' *KPT Vector Effects* (1995) — for Adobe Illustrator 2025/2026, plus an **MCP server** so agents can shatter artwork headlessly or drive Illustrator directly.

```
core/fracture.js          the engine: fracture patterns + explode physics (pure ES3 JS, shared by everything)
illustrator/*.template.jsx the Illustrator UI + document plumbing (ScriptUI dialog, clipping masks, re-shatter)
dist/DoooomShatter.jsx    built script — this is what you install in Illustrator
mcp/                      MCP server: shatter_svg, shatter_plan, illustrator_shatter, ...
test/                     geometry invariants + visual render harness
```

## Illustrator script

Copy `dist/DoooomShatter.jsx` to `<Illustrator>/Presets(.localized)/<lang>/Scripts/`, restart, then **File › Scripts › DoooomShatter** with artwork selected. Or run it once via **File › Scripts › Other Script…**. Works in Illustrator CC 2019–2026 (ExtendScript; UXP is still not public for Illustrator).

Select **any** artwork — paths, groups, live text, gradient and mesh fills, placed images. The dialog has a live wireframe preview.

| Panel | Control | Effect |
|---|---|---|
| Preset | | `cracked-pane` `glass-impact` `doooom` `kpt-1995` `confetti` `frozen-cracks` |
| Fracture | Pattern | **Radial impact** (radial cracks + jittered rings, like a hit pane) or **Classic slices** (the 1995 look) |
| | Shards, Irregularity, Fragmentation | count; crack jitter; chance a ring cell splits into triangles |
| | Crack gap | insets each shard so hairline cracks show even before anything moves |
| | Impact X/Y, Random impact, Seed | where the hit lands; reproducible randomness |
| Explode | Force, Time, Spin, Gravity, Randomness, Depth scale, Distance fade | AE-Shatter-style physics; Time 0 = intact cracked pane |
| Glass | Facet tint, Edge highlight, Edge width | Screen/Multiply facet film per shard, screen-mode edge strokes |
| Output | Cut method | **Clipping masks** (any art, default) or **Pathfinder true cut** (real geometry; paths only; slow) |
| | Keep original | hidden pristine copy kept inside the result |

**Non-destructive re-shatter.** The result is one group, `Doooom Shatter`, holding `Doooom Shards` and a hidden `Doooom Source`. Settings + seed live in the group's Note. Select it and run the script again → the dialog reopens pre-loaded and rebuilds from the original. Every shard is its own group, so you can still hand-tweak pieces.

## MCP server

The engine is pure JS, so the same shatter runs anywhere an agent does. Two modes:

- **Headless** — `shatter_svg` takes any SVG (text or path) and returns a shattered SVG: the source is kept intact in `<defs>` and each shard is a clipped `<use>` with its transform, tint and highlight. `shatter_plan` returns just polygons + physics for agents that render themselves (canvas, three.js, Figma…). Works on any OS, no Illustrator needed.
- **Live Illustrator** — `illustrator_selection_info` and `illustrator_shatter` talk to a running Illustrator through `osascript … do javascript` (macOS) or COM via PowerShell (Windows). The script is run with a `DOOOOM_SETTINGS` global, so the dialog is skipped and the result string comes back to the agent. Select artwork in Illustrator, ask the agent for "120 shards, glass-impact, impact top-left", done.

### Setup

```bash
npm install && npm run build
```

Claude Desktop / Claude Code / Cursor — add to your MCP config:

```json
{
  "mcpServers": {
    "doooom-shatter": {
      "command": "node",
      "args": ["/absolute/path/to/doooom-shatter/mcp/src/server.js"]
    }
  }
}
```

For Claude Code: `claude mcp add doooom-shatter -- node /absolute/path/to/doooom-shatter/mcp/src/server.js`

### Tools

| Tool | Input | Output |
|---|---|---|
| `list_presets` | — | defaults, presets, and a description of every setting |
| `shatter_plan` | `width`, `height`, `preset?`, `settings?` | shard polygons, centroids, dx/dy/rotation/scale/opacity, moved polygons |
| `shatter_svg` | `svg` or `svg_path`, `out_path?`, `background?`, `preset?`, `settings?` | shattered SVG text, or a summary when written to `out_path` |
| `illustrator_selection_info` | — | active doc, colour space, selected items (flags existing Doooom groups) |
| `illustrator_shatter` | `preset?`, `settings?` | status string from Illustrator (`OK 118 shards, seed 1995`) |

`settings` keys mirror the dialog: `pattern` (`"radial"`/`"classic"`), `shards`, `jitter`, `frag`, `gap`, `impactX`, `impactY`, `impactRandom`, `force`, `time`, `spin`, `gravity`, `random`, `depth`, `fade`, `tint`, `edge`, `edgeWidth`, `cut`, `keepOriginal`, `seed`. Explicit settings override a preset; omit `seed` for a fresh one — the response tells you which seed was used so you can reproduce or iterate ("same shatter, push time to 70").

macOS note: the first `illustrator_*` call triggers an Automation permission prompt for whatever process hosts the MCP server (Terminal, Claude, Cursor…). Allow it once.

## Development

```bash
npm test          # geometry invariants: exact tiling, determinism, physics direction, presets, 800-run stress
npm run build     # inlines core into the template → dist/DoooomShatter.jsx, parsed as strict ES3
npm run smoke -w mcp   # spins the MCP server over stdio and exercises every tool
npm run render    # renders the smoke-test SVGs to mcp/test/out/contact.png (needs Chromium)
```

`core/fracture.js` must stay ES3 (no `let`/`const`, arrows, `JSON`, array extras) because it is inlined into ExtendScript. The build fails if it isn't.

## The original

KPT Vector Effects 1.0 shipped from MetaTools in late 1995: 13 filters for FreeHand 5 and Illustrator 5.5+ — 3D Transform, ColorTweak, Emboss, Flare, Inset, Neon, Point Editor, ShadowLand, **ShatterBox**, Sketch, Vector Distort, Warp Frame (Simplify joined in 1.5). ShatterBox was the only Illustrator-exclusive filter; it "broke artwork into thousands of pieces resembling broken glass" and left everything as editable vectors. Version 1.5 (MetaCreations, Sept 1999, ≈$150) added Illustrator 7/8; Corel resold it briefly before it died with Classic Mac OS.

## License

MIT

## Without Illustrator

The fracture engine is plain JavaScript and the SVG writer only does string work, so the effect is
not tied to Illustrator at all - Illustrator is one front end for it. On a build machine, in a
container or in a cloud job, use the CLI:

```bash
npm install                                   # engine only; the rasteriser is optional
doooom-shatter presets
doooom-shatter shatter logo.svg -o shattered.svg --preset doooom --seed 1995
doooom-shatter raster shattered.svg -o shattered.png --width 3047 --trim
```

`shatter` reads any SVG - gradients, text, images - keeps the source in `<defs>` and emits one
clipped `<use>` per shard, so the result stays editable vector. `--set key=value` reaches every
setting the dialog exposes (`--set shards=240 --set time=70`), and the seed is reported so a look
can be reproduced.

`raster` renders through [resvg](https://github.com/yisibl/resvg-js), which ships prebuilt binaries
and needs no system libraries and no headless browser - a few seconds for a full-size sheet. It is
an optional dependency: shattering works without it. `--trim` crops to the ink, which matters when
the SVG came out of Illustrator carrying a much larger artboard than the art.

Round trip on a 2048px logo: 0.06s to shatter, ~3s to rasterise.
