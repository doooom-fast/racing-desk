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
| `livery tp <spec>` | stage the paint + the sim's spec `.mip` for Trading Paints and open the upload form |
| `livery preview <spec>` | contact sheet: albedo · zones+orientation · materials · alpha |
| `livery doctor [car]` | paths, deps, customer id, Blender, stale mips, profile confidence |
| `livery new <car> <name>` | scaffold a spec |
| `livery cars scan/list/coverage` | the roster (from the install, no login), and how much of it can be painted |
| `livery profile list/show/bootstrap/from-bake` | the flat model |
| `livery art list/import/palette` | the sponsor library and palettes from reference art |
| `livery bake <car> --mesh <file>` | UV-space bake in Blender (`--check` to verify one) |
| `livery materials` / `livery swatches <car>` | material presets, and a calibration paint |

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

## Trading Paints

A paint that only lives in the paint folder does not survive a race: the Trading Paints Downloader,
with "Update my own paints" on, deletes the paint files of every driver in the session and downloads
what each has assigned on tradingpaints.com — yours included. `livery doctor` says whether that is
how the Downloader is set here, and `livery install` reminds you after each install.

There is no API, so the upload is the website's form. `livery tp <spec>` gets everything the form
takes into `build/<car>/<livery>/tradingpaints/` and opens it:

1. `livery build <spec> --install`
2. load the car in the sim once (the paint viewer under My Content is enough) — that's what turns
   `car_spec_<id>.tga` into the `.mip` Trading Paints wants
3. `livery tp <spec>` — checks the `.mip` is this build's, stages the paint and the `.mip` with the
   number type to pick, then opens the upload page and the folder

Custom Number paints (`number_mode: custom`) need a Trading Paints Pro membership to assign.

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
