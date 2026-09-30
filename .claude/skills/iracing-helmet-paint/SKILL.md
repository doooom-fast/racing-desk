---
name: iracing-helmet-paint
description: |
  Make iRacing driver helmets: fetch the official helmet template, read its UV sheet (shell,
  visor, sunstrip, balaclava, belts, colour chips), build a helmet_<id>.tga that matches a car
  livery, and put it where the sim loads it - per car, or as the account default. Includes an
  orientation probe helmet for checking in the sim which way the shell is unwrapped. Use when the
  user wants a helmet, "matching helmet", "helmet for this livery", helmet_<id>.tga, a sunstrip,
  or asks where helmet files go. Pairs with iracing-paint-install (naming and copying),
  iracing-paint-templates (car templates) and iracing-livery-placement (car art).
---

# iRacing helmet paints

One template serves every car: the helmet is a separate 1024² UV sheet, not part of any car's
template. What makes a helmet *match* a livery is where the file is put.

```bash
S=<this skill>/scripts          # needs numpy scipy pillow; `template` also needs psd-tools
python3 $S/helmet.py template --out ~/helmet/guides                 # download + extract guides
python3 $S/helmet.py probe    --guides ~/helmet/guides --out ~/helmet/probe --id 424242
python3 $S/helmet.py build    spec.json --out helmet_424242.tga --preview preview.png
python3 $S/helmet.py preview  helmet_424242.tga --guides ~/helmet/guides --out preview.png
```

## Where helmet files go

| Path | Effect |
|---|---|
| `Documents/iRacing/paint/<car folder>/helmet_<id>.tga` | helmet for that car only; wins over the default |
| `Documents/iRacing/paint/helmet_<id>.tga` | default helmet for every car without its own |
| `suit_<id>.tga` | same two rules for the suit |

So a matching helmet is just the helmet file sitting in the same car folder as `car_<id>.tga`.
`<id>` is the customer ID, as for the car (see `iracing-paint-install`). The format is 24-bit TGA,
up to 2048². The template is 1024² and scales up cleanly; `build` writes 2048 by default.

**No spec map for helmets.** iRacing documents spec maps for cars only; nothing reads a
`helmet_spec_<id>.tga`. Matte-on-gloss tricks from the car don't carry over, so contrast on the
helmet has to be tonal (the car pipeline's "gray fallback" idea: lighter art, not rougher art).

Trading Paints has its own helmet upload, which is how other drivers see it; the local file is for
iterating and for you.

## The template

`helmet.zip` from `ir-core-sites.iracing.com/members/member_images/misctemplates/`, public, 27 MB,
one `Helmet.psd`. `driver_suit.zip` sits beside it. `template` downloads it and writes, without
Photoshop:

- `g_Wire.png`, `g_Mask.png` (opaque brown = unpaintable, clear = paintable), `g_Decal.png`,
  `g_License.png`
- `base.png`: the paintable area with no pattern and no default helmet colour, so the visor tint,
  sunstrip and belt labels are there to keep
- `islands.png`: label map, value = 1 + index into `islands.json`
- `patterns/` with `--patterns`: iRacing's 69 stock helmet designs rendered, the best clue to
  which way the shell faces

psd-tools composites layers inside hidden groups as empty; the script reads each layer's own
pixels instead. That is why Wire and the patterns come out at all.

## Reading the sheet

`scripts/islands.json` names every island with a bbox, a seed pixel and a confidence
(`sim` = checked in the sim, `sheet` = read off the template, `guess`).

- **shell** is the big dome across the bottom (y 567–1020). The eye port is **not** cut out of the
  mask: it is the mesh-free loop in the wireframe at about x 324–722, y 796–893, ringed by the dense
  gasket band. iRacing's flame patterns start at the bottom centre and lick outward and upward,
  which reads as chin at the bottom, sides left and right, back along the top edge.
- **visor** (top right) carries a grey tint texture; keep it. **visor_b** and **visor_c** are
  visor-shaped islands without much wireframe, probably other helmet models' visors.
- **sunstrip** (top, 609–944 × 9–50). iRacing's own text sits upright on the sheet here.
- **balaclava** is the face oval and the HANS collar, as one island. **belts** and **belt_labels**
  sit in the notch cut into the top of the shell.
- **Colour chips** on the right edge are read for a colour, never mapped: `Lotus Helmet` (the Lotus
  79's vintage helmet takes its colour from here), `Seat Belt Color`, and one unnamed.

**Orientation is unconfirmed.** Every shell anchor in `islands.json` is a `guess` until the probe
has been looked at in the sim. The probe cuts the shell into a 4×3 grid of coloured cells, each
with a letter that shows turning or mirroring (F G J K L N P Q R S Z 7) and an arrow to the sheet's
top, and gives every other island its own colour and name. Install it for one car, look at the
driver from outside, and note which letter is on each side, the brow, the chin, the crown and the
back, and how it reads. Then set each anchor's `at`, `rot` and `confidence: "sim"`. The legend is
written beside the probe as `probe_legend.txt`.

## Building a helmet

`build` takes a JSON spec. Paths are relative to the spec; anchor coordinates are 1024-space.

```json
{
  "guides": "guides", "size": 2048, "background": [10, 10, 10],
  "fill":   {"balaclava": [10,10,10], "belts": [220,55,20], "sunstrip": [10,10,10],
             "visor": "keep", "belt_labels": "keep"},
  "chips":  {"lotus_helmet": [10,10,10], "seat_belt": [220,55,20]},
  "fields": [{"image": "shatter.png", "mode": "dark-alpha", "color": [220,55,20], "regions": ["shell"]}],
  "marks":  [{"image": "wordmark.png", "anchor": "side_left",  "color": [238,238,238]},
             {"image": "wordmark.png", "anchor": "side_right", "color": [238,238,238]},
             {"text": "SPEEDSPORTS",   "anchor": "sunstrip", "island": "sunstrip", "color": [220,55,20]}]
}
```

- `background` paints the whole sheet first, small unnamed islands included; `fill` then sets
  named islands, and `keep` puts the template's pixels back.
- `fields` cover islands with one art image in one colour, fitted to the art's ink rather than its
  canvas. Modes: `luma` (light = ink; the backdrop colour is keyed out from the image border),
  `alpha`, `dark-alpha` (the livery pipeline's shatter rule, where dark and opaque = solid).
  Options: `scale`, `offset`, `flip`, `rot`, `opacity`.
- `marks` place art or text at an anchor, sized by `width` × the anchor's `max_w` (or `height`),
  clipped to the island under the anchor, with a warning when more than 1% of the ink is lost.

## Matching a set of liveries

When there are many cars in a few colourways, build **one helmet per colourway** and copy it into
each car folder at install time, rather than storing one per car. The DOOOOM liveries repo does
this: `design/helmets/build_helmets.py` builds `helmets/<set>/helmet_<id>.tga` and writes
`helmets/manifest.json`, mapping every `<car>/<variant>` to its set. It chooses the set by reading
the body and art colours off that variant's own `car_<id>.tga`. An installer reads the manifest and
copies the set's file to `paint/<car folder>/helmet_<id>.tga`; the default set goes to the paint
root.
