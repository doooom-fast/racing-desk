# Where this came from

`alternatekev/doooom-shatter` at `c330dc3`, brought in whole on 2026-09-28 so liveries can be made
inside the desk. The files are as they were there; `README.md` is its own.

What is wired here and what is not:

| Part | State |
|---|---|
| `core/fracture.js` | The engine. Plain JavaScript, no dependencies. `npm test -w @racing-desk/shatter` runs its geometry tests. |
| `mcp/src/svg.js` | SVG in, shattered SVG out. String work only, no dependencies. |
| `bin/doooom-shatter.mjs` | `shatter` and `presets` work as they are. `raster` needs `@resvg/resvg-js` (and `sharp` for `--trim`), which are not installed. |
| `mcp/` | The MCP server. Needs `@modelcontextprotocol/sdk` and `zod`, which are not installed. |
| `illustrator/`, `dist/`, `scripts/build.js` | The Illustrator script and its build. The build needs `acorn`, which is not installed. |
| `test/render.js`, `test/presets.mjs` | Need `playwright` and `zod`. |

Nothing was added to the monorepo's dependencies for this. The rasteriser is the one the desk will
want first: a shard field is a raster (`apps/livery/src/livery/fleet/shatter.py`,
`field_from_raster`), and `raster` is what turns a shattered SVG into one.

The field every fleet car wears today was not made here. It was recovered from the paints
themselves (`apps/livery/art/doooom/README.md`), because the raster it came from stayed on the
machine that made it, and its seed with it.
