# prodrive-livery

Agentic iRacing livery design and build pipeline. A livery is a YAML spec written in
car-space terms; the pipeline renders it to the TGA files iRacing loads, checks its own work,
and installs it.

Personal tool. See [docs/DESIGN.md](docs/DESIGN.md) for how it works and why.

```
livery build liveries/demo-night-runner.yaml --customer-id 123456 --preview --install
```

## Install

```bash
python -m venv .venv && .venv/Scripts/python -m pip install -e ".[dev]"   # add [templates] for PSD bootstrap
livery doctor                    # checks paths, deps, customer id, Blender
```

Then set your details in `livery.yaml` (or `LIVERY_CUSTOMER_ID` / `LIVERY_IRACING_PAINT_DIR`):

```yaml
customer_id: 123456
iracing_paint_dir: "C:/Users/you/Documents/iRacing/paint"
blender: "C:/Program Files/Blender Foundation/Blender 4.2/blender.exe"
```

## A first livery

```bash
livery cars scan                          # learn your installed cars' folder names (no login)
livery profile bootstrap ferrari296gt3 --psd templates/ferrari296gt3/ferrari296gt3.psd
livery new ferrari296gt3 "Night Runner"   # scaffolds liveries/night-runner.yaml
livery build liveries/night-runner.yaml --preview
livery preview liveries/night-runner.yaml --out zones.png   # check the profile's zones
livery build liveries/night-runner.yaml --install
```

The demo car (`profiles/_demo_gt3.yaml`) is synthetic and needs no iRacing content, so
`livery build liveries/demo-night-runner.yaml --customer-id 1 --preview` works on a fresh
clone. That spec is also the worked example of the grammar.

## Writing a spec

Positions are in **car space**: `u` runs nose→tail, `v` runs top→bottom (left→right on
horizontal panels). The same placement lands mirror-symmetrically on both flanks, and
lettering stays readable on both sides — you never flip anything by hand.

```yaml
car: ferrari296gt3
name: Night Runner
number_mode: custom          # or sim_stamped

palette: {ink: "#0B0D10", signal: "#FF3B1F"}
base: {color: palette.ink, material: satin}

layers:
  - id: flank-band
    kind: band               # fill band stripes gradient pattern image logo text
    zones: [side]            # door / @flank / rear_* / door.left — never pixels
    rect: [0.10, 0.50, 0.80, 0.28]
    color: palette.signal
    material: gloss

sponsors:
  - logo: my-sponsor
    zones: [door]
    at: {u: 0.5, v: 0.15}
    size: {height_mm: 150}   # real millimetres on the car

numbers:
  value: "10"
  zones: [door.left, door.right, roof]
  outline: {color: auto, width: 0.05}

wheels: {color: "#C8A200", material: metallic}
spec_overrides:
  - {zones: [glass], material: unlit}
```

## Commands

| | |
|---|---|
| `livery build <spec>` | render → `build/<car>/<livery>/` (`--install`, `--preview`, `--strict`, `--json`) |
| `livery install <spec>` | copy into the paint folder, snapshot what it replaces, bust the mip |
| `livery preview <spec>` | contact sheet: albedo · zones+orientation · materials · alpha |
| `livery doctor [car]` | paths, deps, customer id, Blender, stale mips, profile confidence |
| `livery new <car> <name>` | scaffold a spec |
| `livery cars scan/list/coverage` | the roster (from the install, no login), and how much of it can be painted |
| `livery profile list/show/bootstrap/from-bake` | the flat model |
| `livery art list/import/palette` | the sponsor library and palettes from reference art |
| `livery bake <car> --mesh <file>` | UV-space bake in Blender (`--check` to verify one) |
| `livery materials` / `livery swatches <car>` | material presets, and a calibration paint |

## The fleet build

One livery on every car: the DOOOOM shard field, in both directions (`shatter`, black with
orange shards, and `shatter-inverted`), built from each car's own paint template and written
into the livery library the desk's Paints page reads. It is the pipeline that painted the first
seventeen cars, brought in from the library's `design/fleet` scripts and the three `iracing-*`
skills, with every path an argument (`src/livery/fleet`).

| | |
|---|---|
| `livery fleet status` | the cars on the rig: which have the livery, which can be built, which have no template address |
| `livery fleet build [car ...]` | build into the library; with no car named, every car that lacks it (`--limit`, `--force`, `--uncompressed`) |
| `livery fleet panels <car>` | a car's panels, numbered over its own stock scheme, to write its panel map from |
| `livery fleet logos <car>` | fit the marks onto a car that has a panel map (`src/livery/data/panels/<car>.json`) |

What a build needs from a car is its template, and iRacing publishes those with no login
(`src/livery/data/paint_templates.tsv`). A template is fetched once into
`%LOCALAPPDATA%\Racing Desk\templates\<car>\`, the guide layers and the spec map are read out
of it into `work\`, and the PSD is dropped. Templates are iRacing's files: they are never
committed and never passed on.

The rules a build keeps:

- **It does nothing while the sim runs.** A car is a minute of hard work; the build asks before
  each one and waits.
- **It never writes over a paint it did not make.** A version is this build's when its
  `meta.json` says so; `--force` rebuilds those and leaves every other alone.
- **The customer id is in file names and nowhere else**: not in a log line, the report or
  `meta.json`. It is read from the library's own paints unless given.
- **Logos need a look at the car.** The shard field lands on any sheet. A mark has to land on a
  panel, the right way up, and which panel is which is read off the car's own stock schemes.

`art/doooom/` holds the driver's marks and the shard field; `art/sponsors/` the sponsors'.
`design/` is the library's scripts as they were written, for reading.

```bash
pip install -e ".[fleet,dev]"      # psd-tools and scipy
```

## Art library

```
art/logos/<id>/default.png       artwork (light.png / dark.png variants optional)
art/logos/<id>/logo.yaml         tier, clear_space, min_height_mm, affinity, lock_color
art/sources/                     reference art to remix — no metadata needed
```

`livery art import <file> <id>` trims it, knocks out the background, derives light/dark
variants and writes the metadata. `sample-primary` and `sample-associate` are placeholder
artwork for the demo — replace them with real logos; regenerate with
`python scripts/make_sample_art.py`.

## Tests

```bash
python -m pytest -q
```

The mirroring rules, the bake analyser, the spec grammar and the output files are all
covered. The Blender-side bake script is not (no Blender in CI) — run it once at
`--resolution 512` and check it with `livery bake --check`.

## In the monorepo

Imported from prodrive-agents#19 into `apps/livery/`; the agent-facing half is
`.claude/skills/livery-pipeline/`. It keeps its own `pyproject.toml`, venv and tests — Python
sits beside the npm workspaces and the .NET solution rather than inside either. The monorepo's
ground rules apply: nothing here talks to an authenticated iRacing endpoint, so the car roster
comes from the install (`livery cars scan`), not the Data API.
