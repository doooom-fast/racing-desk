# Agentic livery pipeline — design

A personal tool for designing and building iRacing liveries: I art-direct or hand over
source art, an agent writes a spec, the pipeline renders the paint files, checks its own
work, and drops them where the sim looks. Not a product, not general-purpose.

---

## 1. What iRacing actually accepts

The pipeline has to end in files iRacing will load, so these constraints drive everything
upstream of them.

| Thing | What the sim wants |
|---|---|
| Format | 24-bit TGA, RLE compressed. 32-bit only where the car's template carries a glass alpha |
| Sim-stamped number paint | `car_<customerid>.tga` — the sim stamps your number on top |
| Custom number paint | `car_num_<customerid>.tga` — a *full car texture* with the number painted in, sim stamps nothing |
| Material map | `car_spec_<customerid>.tga` — R metallic · G roughness · B clear coat · A specular mask |
| Location | `Documents/iRacing/paint/<car_dirpath>/` |
| Caching | The sim generates a `.mip` beside the TGA and keeps using it until the TGA is newer or the mip is gone |
| Metal | Metallic and chrome need a far lighter albedo than the colour you think you want |

Two of these shape the whole design:

**The spec map is a second full-resolution texture aligned to the first.** Hand-painting it
after the fact is how materials end up one pixel out from the artwork they belong to. So
every mark this pipeline lays down carries a material as well as a colour, and the two
textures are painted by the same geometry in the same pass (`canvas.py`). A matte rocker is
matte exactly where the rocker is, down to its antialiased edge.

**The mip cache means a build can silently do nothing.** `livery install` deletes the mip;
`livery doctor <car>` flags any TGA whose mip is newer, which is the single most common
"why isn't my paint updating" case.

### Verify on your machine

These came from iRacing's docs and the painting community rather than from my own run
against the sim — iracing.com is unreachable from this sandbox. All
of them are one `livery doctor` and one in-sim look away from being confirmed, and all of
them are config or data rather than code, so correcting them is an edit not a rewrite:

1. **Spec map filename for custom-number paints.** We write `car_spec_<id>.tga` regardless
   of number mode. If the sim wants `car_num_spec_<id>.tga` alongside `car_num_`, change
   `spec_pattern` in `livery.yaml`.
2. **Spec channel meanings.** R/G/B/A = metallic/roughness/clear coat/specular mask, and
   roughness with 0 = smooth. `livery swatches <car>` builds a labelled material grid to
   look at in the 3D viewer; correct `src/livery/data/materials.yaml` from what you see.
3. **Per-car resolution.** Many cars are 2048², newer ones 4096². The profile's `canvas`
   comes from the real template, so this resolves itself per car.
4. **Glass alpha.** Cars whose template has an "alpha channel needed for glass" layer need
   a 32-bit TGA carrying that alpha (`alpha: glass` + `template.alpha` in the profile).
5. **Team paints** (`car_team_<teamid>.tga`) are not implemented — add a filename pattern if
   you want them.

---

## 2. The flat model

"Flat modeling" is the hard part. A template is one 2048² sheet of unrelated islands, and
nothing in the file says which rectangle is a door or which way is forward on it. Without
that, an agent can only place things in pixel coordinates it cannot reason about, per car,
forever.

So the pipeline keeps a **car profile** (`profiles/<car_dirpath>.yaml`): named zones, each
with a rect, which way it faces, and which pixel direction points at the car's nose. Specs
then address `door.left`, `@flank`, `rear_*` and never touch a pixel.

Three ways to get one, in increasing order of how much you can trust it:

| Route | How | Confidence |
|---|---|---|
| **Blank** | `livery profile bootstrap <car> --blank` — one zone, whole sheet. Enough to flood a base colour and look at it | `draft` |
| **From the template PSD** | `livery profile bootstrap <car> --psd <file>` — layer names → panels, layer bounds → rects | `draft` |
| **From a 3D bake** | `livery bake <car> --mesh <file>` then `livery profile from-bake <car>` | `checked` |

The PSD route is guesswork with good odds: iRacing's templates name their layers
(`Door RH`, `Rear Quarter LH`, `HOOD`), so `templates.py` classifies them and merges every
layer belonging to a panel into one box. It gets the rects roughly right and the
orientations from a default table, which is why it lands as `draft` and why
`livery preview --zones` draws every zone with a nose arrow over your actual paint.

The bake route is the one worth having. Given a mesh that carries the sim's UV layout,
Blender bakes three maps in UV space — object-space position, normal, and a panel id from
material names — and then everything a profile needs is *measured*:

- **which way is forward on this island** — from how position changes across the texture,
  so `axes` is data, not a guess;
- **which way the panel faces** — from its mean normal, giving `plane` and `side`;
- **how big things are** — metres per pixel, so `height_mm: 150` is 150mm on every car;
- **mirrored islands** — they fall out of the derived axes.

The catch is the premise: the mesh must carry iRacing's UVs. A model from anywhere else
gives a beautiful map of the wrong thing. `livery bake --check --template <png>` scores the
UV overlap before you build a profile on it.

---

## 3. Mirroring, the way race cars do it

This is the part a naive pipeline gets wrong, and it gets it wrong in a way you only notice
in a replay, from the other side.

Stand outside a car and look at its left flank: the nose is to your left, so lettering that
reads left-to-right runs nose→tail. Walk around to the right flank: the nose is now to your
right, so the same readable lettering runs tail→nose. The two sides are mirror images of
each other, but **the letters are never mirrored**.

The pipeline separates the two ideas:

- **Position is authored in car space.** `u` runs nose→tail, `v` runs top→bottom (or
  left→right on horizontal panels). One placement, written once, lands symmetrically on
  both flanks because each zone knows which pixel direction its own nose is in.
- **Content follows one of two frames**, chosen per element by `orient`:
  - `car` (default for bands, stripes, gradients, patterns) — the art's own +x runs
    nose→tail, so the two flanks come out mirror-symmetric, like a real wrap;
  - `reading` (default for logos, text, images) — the art's +x runs along the viewer's
    right, so lettering reads correctly on both sides.

On top of that sits the case that actually bites: **a UV island shared between both flanks**.
Some cars map one island onto both sides, so art stamped into it appears mirrored on one.
The profile declares two of the panel's world axes, and `geom.py` checks the handedness:
if turning camera-right 90° clockwise does not give camera-down, the island is mirrored and
art is flipped before it is stamped. `profile show` prints `MIRRORED` next to those zones
and the zone overlay marks them `⇋`.

The demo profile deliberately includes one (`rear_quarter.right`) so the behaviour is
visible in the preview and locked down by a test.

---

## 4. Materials

`materials.yaml` maps names — `gloss`, `satin`, `matte`, `vinyl`, `metallic`, `chrome`,
`brushed_metal`, `carbon`, `carbon_matte`, `rubber`, `fluoro`, `unlit` — onto the four spec
channels. Anything drawn can carry one, and `spec_overrides` change material without
touching colour, which is how glass and trim get handled.

Two rules are enforced rather than documented:

- **Metal gets its albedo lifted.** `chrome` and `metallic` declare the HSV value their base
  needs; a `#050505` chrome becomes a near-white chrome and the build report says so.
  Otherwise metal reads as mud in the sim.
- **Mirror finishes over lettering are flagged.** Chrome numbers look great on a flat and
  disappear at 200 metres.

The numbers themselves are calibratable, not sacred — see §1's verify list.

---

## 5. Numbers, sponsors, wheels

**Numbers.** `number_mode: custom` bakes them in (output goes to `car_num_<id>.tga`);
`sim_stamped` leaves them to the sim and the spec must not paint any. Baked numbers are
placed per zone, in car space, with per-zone overrides for the roof (bigger, upright).
Contrast against whatever ended up behind them is measured and warned about, and
`outline: {color: auto}` picks black or white for maximum contrast against the fill.

**Sponsors.** A logo is not a PNG: `art/logos/<id>/logo.yaml` carries tier, clear space,
minimum legible height in millimetres, light/dark variants, panel affinity, and whether the
brand allows recolouring. The renderer picks the variant that suits the panel behind it,
converts the placed height to millimetres to check the legibility floor, and warns when two
marks break each other's clear space — the number-over-sponsor collision that ruins a door.

**Wheels.** On most cars rim colour is a paint-shop setting in the iRacing UI, not pixels in
the paint file. Rather than pretend, `wheels:` paints a wheel zone when the profile has one
and otherwise emits a **manual step** in the build report naming the colour and finish to
set in the UI. Manual steps are part of the deliverable, not a failure.

---

## 6. Remixing supplied art

Source art arrives as whatever the sponsor sent. `remix.py` covers the operations that turn
it into something usable: palette extraction (k-means++, so a red-and-blue reference does
not average into purple), background knockout by corner vote, recolouring that preserves
shading, tinting, knockouts, trimming to the ink, and tiling.

`livery art palette <image>` prints a palette block ready to paste into a spec, which is the
usual first move when you hand me a reference livery: pull its colours, then build something
new in them rather than tracing it.

---

## 7. The loop

```
you: art direction, or source art
 ↓
agent writes/edits liveries/<name>.yaml        ← car-space, no pixels
 ↓
livery build … --preview                       ← TGA + spec map + contact sheet + report
 ↓
agent reads the report                         ← warnings are specific and actionable
 ↓
livery install                                 ← paint folder + mip busted
 ↓
you look at it in the sim's 3D viewer          ← the only real arbiter
```

The build report is the feedback channel, and it is written for a reader who will act on it:
every warning names the layer, the zone, the measurement, and the fix. The spec digest hashes
the spec, the profile and every piece of art referenced, so a rebuild can tell whether what is
on disk is still what the spec describes.

Flat previews (`albedo`, `zones + orientation`, `materials`, `alpha`) exist so that only
finished paints get loaded into the sim — not to replace looking at the car.

---

## 8. All the cars

"Every car in iRacing" is a coverage problem, so it is tracked like one.

```
livery cars scan        # roster from the install's cars/ folder — car_dirpath is the paint folder
livery cars coverage    # how many cars have a profile, and how good it is
```

The registry is the car list; `profiles/` is the work. Coverage counts
`missing → draft → checked → verified`, so the roster is a number that goes up rather than a
vague ambition. The economics: a blank profile is seconds, a PSD bootstrap is seconds plus a
correction pass, a bake is minutes and lands at `checked` immediately. Do the cars you race
first; the demo profile shows what a finished one looks like.

A livery spec is portable across cars by construction — same zone names, same car-space
coordinates — so a design that is right on one GT3 is a `livery build` away on the next one,
modulo panels that car does not have.

---

## 9. Known limits

- **Zones are rectangles.** Real panels are not. A PNG mask per zone (`mask:`) handles the
  cases where a rect bleeds onto a neighbouring island; most panels do not need one.
- **No auto-placement yet.** Sponsors go where the spec says. Tier and affinity metadata is
  in the library specifically so `livery autoplace` can be built on it.
- **The Blender bake script has not run in CI** — there is no Blender in this sandbox. The
  analyser it feeds is tested against a synthetic bake, so the maths is locked down; the
  Blender-side script needs one real run (`--resolution 512`, then `livery bake --check`).
- **Team paints, helmets and suits** are out of scope for now; they are more filename
  patterns on the same machinery.
