---
name: livery-pipeline
description: |
  Designing and building iRacing liveries with the prodrive-livery pipeline — a livery is a
  YAML spec in car-space terms that renders to the TGA files iRacing loads (car_num_<id>.tga
  albedo + car_spec_<id>.tga material map), checks itself, and installs into
  Documents/iRacing/paint/<car_dirpath>/. Covers the spec grammar, car profiles (the flat
  model of a paint template), the mirroring rules that keep lettering readable on both
  flanks, materials and the spec map, race-number placement, sponsor logo tiers and clear
  space, remixing supplied source art, and bootstrapping a profile for a new car from a
  template PSD or a 3D bake. Use this skill when asked to make, change or art-direct a
  livery or paint scheme, when someone supplies sponsor logos or reference artwork to work
  from, when a paint is not showing up in the sim, or when they mention "livery", "paint
  scheme", "wrap", "spec map", "car_num", "paint template", "race number on the door", or
  "rim colour".
---

# iRacing livery pipeline

The tool lives in **`apps/livery/`** (Python, its own venv: `apps/livery/.venv`). Read
`apps/livery/docs/DESIGN.md` before changing the pipeline itself. This skill is about
*using* it to design liveries.

## The loop

```bash
livery art palette <reference.png>          # if they supplied art, start from its colours
livery new <car_dirpath> "<Name>"           # scaffolds liveries/<slug>.yaml
# …edit the spec…
livery build liveries/<slug>.yaml --preview # TGA + spec map + contact sheet + report
livery build liveries/<slug>.yaml --install # into the paint folder, mip busted
```

Then **read the build report**. Every warning names the layer, the zone, the measurement and
the fix. Never install a paint with unresolved warnings without saying so.

Show the user the contact sheet (`preview.png`) rather than describing the paint. The four
panels are: albedo · zones+orientation · materials · alpha. The sim's own 3D viewer
(iRacing UI → My Content → Cars) is the final arbiter — say so rather than claiming a paint
looks good.

## Author in car space, never in pixels

`u` runs **nose → tail**. `v` runs **top → bottom** (left → right on hood/roof/decklid).
Both are 0–1 within a zone. The same placement lands mirror-symmetrically on both flanks.

**Never flip anything by hand.** The pipeline handles all three mirroring cases:

- shapes (`band`, `stripes`, `gradient`, `pattern`) default to `orient: car` — mirror-
  symmetric across the car, like a real wrap;
- reading matter (`logo`, `text`, `image`) defaults to `orient: reading` — upright and
  correct on both sides;
- a UV island shared between flanks is detected from the profile's axes and its art is
  flipped automatically (`profile show` prints `MIRRORED`).

If a sponsor comes out backwards in the sim, the zone's `axes` are wrong in the profile —
fix the profile, never the art.

## Spec grammar

```yaml
version: 1
car: ferrari296gt3          # the iRacing car_dirpath = paint folder name
name: Night Runner
number_mode: custom         # custom = numbers baked in → car_num_<id>.tga
                            # sim_stamped = sim stamps them → car_<id>.tga, paint no numbers
art_direction: >
  Write the intent in words first. It is the brief you re-read on the next pass.

palette: {ink: "#0B0D10", signal: "#FF3B1F", bone: "#F2EFE8"}
base: {color: palette.ink, material: satin}

layers:
  - id: flank-band
    kind: band              # fill | band | stripes | gradient | pattern | image | logo | text
    zones: [side]           # part name → both flanks; door.left; @flank; rear_*
    sides: both             # both | left | right | center
    rect: [0.10, 0.50, 0.80, 0.28]      # u, v, w, h — or use at + size
    color: palette.signal
    material: gloss
    angle: 5                # band: rake. taper: narrow toward the tail. feather: soft edge
    opacity: 1.0
    blend: normal           # multiply | screen | overlay | add

sponsors:                   # sugar for kind: logo — keeps brand placement legible
  - logo: sponsor-id
    zones: [door]
    at: {u: 0.5, v: 0.15}   # anchor point; anchor: center|nose|tail|top|bottom|nose_top…
    size: {height_mm: 150}  # real millimetres — or {h: 0.3} / {w: 0.8} of the zone
    variant: light          # omit to let it pick light/dark for the panel behind it

numbers:
  value: "10"
  zones: [door.left, door.right, roof]
  color: palette.bone
  outline: {color: auto, width: 0.05}   # auto = max contrast against the fill
  size: {h: 0.5}
  at: {u: 0.5, v: 0.62}
  slant: 6
  per_zone: {roof: {size: {h: 0.8}, slant: 0, at: {u: 0.5, v: 0.5}}}

wheels: {color: "#C8A200", material: metallic}
spec_overrides: [{zones: [glass], material: unlit}]
```

Materials: `gloss satin matte vinyl metallic chrome brushed_metal carbon carbon_matte rubber
fluoro unlit`, or `{base: satin, roughness: 60}`. `livery materials` lists them.

## Design judgment

What separates a generated livery from a designed one:

- **One loud idea.** A band, a fade, a block — then let it breathe. Competing graphics read
  as noise at speed.
- **Number first.** It is the only part of the livery that has a job. Put it on a quiet
  field, keep contrast ≥ 4.5:1 against what is behind it, and outline it if the panel under
  it changes colour. The pipeline warns below 3:1.
- **Sponsor hierarchy by tier.** `primary` gets doors, rear quarters, hood. `secondary` gets
  rear wing, front fenders. `associate` gets rockers and the small panels. Do not put an
  associate logo on a door because there is room.
- **Respect clear space and the millimetre floor.** Use `height_mm`, not fractions, for
  logos — 150mm reads on a broadcast, 40mm smears. The pipeline warns on both.
- **Materials are punctuation.** Satin body, gloss on the loud element, matte low on the car
  to kill reflections, carbon on aero. Chrome is one accent at most and never under
  lettering.
- **Dark cars need an edge.** A dark body reads as a silhouette on stream; give it one light
  element high on the car so it separates from the track.
- **Both sides, and the roof.** Spotters and broadcast see the roof; leave the number there
  upright.

When art-directed loosely ("something aggressive in team colours"), make the call, build it,
show the contact sheet, and name the two or three decisions you made so they can be argued
with.

## Working from supplied art

1. `livery art palette <file>` — pull the real colours out; build the spec's `palette` from
   them rather than eyeballing hex codes.
2. Logos: `livery art import <file> <id> --tier primary --min-height-mm 110`, then edit
   `art/logos/<id>/logo.yaml` for clear space, affinity and `lock_color` if the brand
   forbids recolouring (the renderer refuses to tint those and says so).
3. Reference liveries are for remixing, not tracing: take the palette and the proportions,
   build the design in this pipeline's terms.
4. `image` layers can `knockout` the background, `recolor` pairs of colours (shading
   preserved) and `tint`.

## New car, no profile

```bash
livery cars scan                                   # the cars installed on the rig
livery profile bootstrap <car> --psd <template.psd>   # layer names → draft zones
livery preview <a spec on that car>                # check the zone overlay, fix the yaml
```

A bootstrapped profile is `confidence: draft` — its rects and axes are guesses. Fix them
against the zone overlay before trusting placements, then set `confidence: checked`. If a
UV-matched mesh exists, `livery bake <car> --mesh <file>` + `livery profile from-bake <car>`
measures the axes and scale instead of guessing them.

## When a paint does not show up

`livery doctor <car>` covers the usual causes in order: wrong `car_dirpath`, wrong Documents
folder (OneDrive moves it), missing customer id, and a stale `.mip` the sim keeps loading
instead of the new TGA. `livery install` busts the mip itself.

Rim colour is a paint-shop setting in the iRacing UI on most cars, not pixels — the build
report emits it as a manual step. Pass it on rather than assuming the wheels came out gold.
