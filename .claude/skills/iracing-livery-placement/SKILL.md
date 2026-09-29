---
name: iracing-livery-placement
description: |
  Design an iRacing car livery from a paint-template PSD and flat artwork (logo .ai/.pdf/.png),
  placing the art so it reads correctly ON THE 3D CAR rather than on the flat UV sheet: identify
  which UV islands are the top (or side) surfaces, work out their orientation, close the UV padding
  between neighbouring panels so strokes carry across seams, then export paint + custom spec map
  TGAs via Photoshop. Covers matte-on-gloss effects through the spec map (roughness), the iRacing
  paint folder / file naming, and a no-spec gray fallback. Use when the user asks to "make a
  livery", "paint a car", "put this logo across the top/side of the car", "cut and place the
  artwork", "spec map", "matte black", "car_####.tga", mentions an iRacing template PSD, or asks to
  repeat a livery for another car. Built on macOS + Photoshop (scripted via osascript) + ImageMagick
  + a small numpy/scipy tool; no 3D preview is available here, so the user checks in iRacing.
---

# iRacing livery placement

A template PSD is a **UV sheet**: the car's skin cut into islands packed onto a 2048² square.
Artwork dropped straight on the sheet lands on the car as unrelated fragments. The job is to map
art from *car space* (how it should look on the car) into *UV space* island by island.

The worked reference is the Lotus 79 DOOOOM livery (Sept 2026): black body, logo at 45° across the
top in matte black. Island ids and numbers below come from that car; every car differs.
## What gets delivered

| File | Where it goes | Notes |
|---|---|---|
| `car_<custID>.tga` | `Documents/iRacing/paint/<carfolder>/` | 24-bit, 2048², no RLE. Paint colour. |
| `car_spec_<custID>.tga` | same folder, **alongside** the paint | Custom spec map. R metallic, G roughness, B clearcoat. |
| `car_<custID>_grayfallback.tga` | *alternative* to the paint file | Art visible as a colour; used alone, with no spec file. |
| `Livery_<name>.psd` | keep | Layered source: base, art, clipped colour fills, spec copy. |

**Pairing, for users coming from LMU:** iRacing loads `car_<id>.tga` for colour and, if present,
`car_spec_<id>.tga` from the same folder automatically. They are a **pair used together**. The
fallback is an **either/or replacement** for the paint file, because only one file can be named
`car_<id>.tga`. `<id>` is the iRacing customer ID. The car folder is the sim's internal name, for
example `lotus79`; open an existing paint folder to confirm it. Trading Paints users upload
through that app instead.

**Matte-on-gloss** is done entirely in the spec map. The art has the same paint colour as the
body, and roughness 255 in the green channel makes it matte. Template default body roughness is
about 30–45, which is glossy. If the user can't or won't use a spec map, ship the fallback. The
art is then painted a slightly lighter colour, for example 85% black #262626 on #0A0A0A.

**Same-colour matte alone is too subtle in the sim.** On the Lotus, black matte art on gloss black
barely read. Default to both effects together: matte roughness plus a lighter tone. Use
`artcolor=38,38,38`, which is 85% black. Also build a stronger `artcolor=64,64,64`, which is 75%
black, so the user can compare both in one pass. Only use `artcolor` equal to `base` if the user
explicitly asks for sheen-only.

## Pipeline

Scripts are in `scripts/`. Photoshop can't read the sandbox `/private/tmp` scratchpad, so put
the working files somewhere the user owns, for example `~/Downloads/<car>-livery/work/`.

```bash
S=<this skill>/scripts
python3 -m venv ~/.venvs/livery && ~/.venvs/livery/bin/pip install numpy scipy pillow
V=~/.venvs/livery/bin/python
```

### 1. Export the template guides and rasterize the art

```bash
$S/ps_run.sh $S/ps_export_guides.jsx template="/path/Car.psd" out="$W/"
$S/ps_run.sh $S/ps_rasterize_art.jsx art="/path/logo.ai" out="$W/art_600.png"
```

You get `g_Wire.png`, `g_Mask.png`, `g_Sponsor_Block_Locations.png`, `g_Number_Block_Locations.png`,
`g_Car_Mandatory.png`, the 24 `grp_Car_Patterns__*` iRacing paint patterns, the spec groups, and
`layers.txt` with the layer tree. **Always rasterize art with Photoshop.** Quick Look and qlmanage
silently dropped the whole SPEEDSPORTS line from the DOOOOM .ai. The art should be light on dark.
The tool thresholds luminance, so invert dark-on-light art first.

### 2. Number the islands

```bash
cd $W && $V $S/livery_uv.py islands g_Wire.png
```

This segments on the wireframe's green island outlines. Don't segment on `g_Mask.png`, because
the mask pads islands until they merge into about 12 blobs. Output is `islands_map.png`, with
numbered islands over the wire, plus `islands.tsv` with bounds and centroids. Read the map.

### 3. Read the layout like a painter

Work out three things. None of them can be skipped.

1. **Which way is forward, and where is the centreline.** Look for a pattern in
   `grp_Car_Patterns__*` that is a smooth front-to-rear gradient; the Lotus had one at pattern
   010. If it runs continuously across all body islands, U maps linearly to car length and the
   centre band is a flattened top view. The nose number block sits near the nose tip. Get the
   centreline from mirrored features, such as the midpoint of the two side number blocks, and
   check it against the nose number block's centre. On the Lotus, nose was left and centreline
   y=1258.
2. **Which islands face the way you're painting.** For the top view, the single islands that
   straddle the centreline (nose, cockpit surround, engine cover) are the spine. Next come the
   mirrored pairs flanking them, working outward: sidepod tops, then outer decks with louvres.
   Stop at islands carrying side number or sponsor blocks, because those are vertical side
   panels. Leave out mirrors, seat, suspension, wings and anything off the band unless wanted.
   Lotus top set: `51,63,61,56,62,66,46,50,78,70,30,31,34,94,96,87,41,91`.
3. **Chirality, meaning is the island mirrored?** An island that straddles the centreline is a
   single welded surface. UV unwraps keep face winding, so it shows the surface as seen from
   outside, not mirrored. With nose left, the car's right side is then at the top of the sheet.
   Side panels can mislead. On ground-effect cars the cut bottom-front corner is the venturi
   inlet, not a top chamfer. If the evidence conflicts, trust the welded centre islands. Tell
   the user which way you assumed and how to check it: text reads backwards if it's wrong. The
   fix is to flip the art vertically in car space.

### 4. Close the seam gaps

```bash
$V $S/livery_uv.py gapclose --top $TOP --center 1258 [--axis y] [--gap-max 60]
```

Neighbouring islands sit about 20–40px apart in UV but touch on the car. This builds a
per-column map from UV to car coordinates. Short non-top runs between two top panels collapse to
zero width. Long runs, like the cockpit opening, keep their size. Without this step every seam
chops or doubles strokes. Use `--axis x` when the template's centreline is vertical.

### 5. Choose size, angle and position in car space

```bash
$V $S/livery_uv.py search  --art art_600.png --top $TOP                      # ranks % of ink landing on top panels
$V $S/livery_uv.py preview --art art_600.png --top $TOP --crop 0 640 2048 1880 --rotate 90 \
    1450,45,1200,1300 1550,45,1150,1258 --out cand.png                        # reconstructed top view
```

Specs are `L,angle,cx,cy`: art width in px, rotation in degrees counter-clockwise, and centre in
car space. Read `cand.png`. Bright art is what lands on the car, and faint purple is what falls
off it. Coverage around 65–70% is normal because of the cockpit hole and edge bleed. Judge the
result by eye, not by the score:

- A diagonal on a long, narrow car crosses the body once. Its visible length is about
  body width × √2. Size the art so the whole word survives, or oversize it on purpose for a
  bleed. The Lotus used L=1450: the D stays on the left front sidepod, the M breaks over the
  right rear, and the tagline runs along the tub.
- Check the text reads correctly from the chase cam, with the nose up in the preview. It will
  be upside down from the front, which is normal.
- Nudge the art so key letters avoid the cockpit opening.

### 6. Render and build (Python path, preferred)

```bash
$V $S/template_extract.py "/path/Car.psd" --out $W/      # once per car: guides + spec_default.png
$V $S/livery_uv.py render --art art_600.png --top $TOP 1450,45,1200,1300
$V $S/build_livery.py livery.json                        # paint + spec TGAs
```

No Photoshop, so it runs headless, in seconds, on any machine including Windows, and it cannot
hang on a modal dialog. Layers composite with their own alpha, so soft edges and partial opacity
survive - the Photoshop path could only stamp flat colour.

Two things to know about `template_extract.py`. The spec map cannot be composited in one pass,
because the template restricts each channel group to one channel through Advanced Blending, which
psd-tools does not implement; each channel group is composited alone and assembled into R/G/B,
matching Photoshop's export to a rounding step. And a group whose own children are hidden
composites empty, and an empty document composites to **white**, so only ancestors are hidden when
soloing a layer.

Templates also carry their own art inside Paintable Area (stock decals, banners, manufacturer
logos). Photoshop kept those visible by default; in Python, list what you want to keep under
`"underlay"`. On the MX-5 that one list accounts for most of the difference between the two paths.

### 6. Build through Photoshop (only when a layered PSD is wanted)

```bash
$V $S/livery_uv.py render --art art_600.png --top $TOP 1450,45,1200,1300    # -> art_uv_rgba.png
$S/ps_run.sh $S/ps_build.jsx template="/path/Car.psd" art="$W/art_uv_rgba.png" out="$OUT/" \
    name=DOOOOM base=10,10,10 artcolor=10,10,10 fallback=38,38,38 rough=255
```

`ps_build.jsx` adds a base colour layer above Main Car Body, the placed art, and clipped
solid-colour fills for the art colour and fallback colour. It copies the art into the Green
Channel Roughness group, saves the PSD, and exports the three TGAs with the guides group hidden.
It never touches the template, which is always saved as a new file.

### 6b. Optional offset shadow or half-outline

A shiny accent-colour drop shadow makes a subtle tone-on-tone logo pop. The Lotus v4 used
matte #0C0C0C art with a gloss orange shadow 2 inches rearward.

```bash
$V $S/livery_uv.py render --art art_600.png --top $TOP --out $W/art.png --shadow 24,0 1450,45,1200,1300
$S/ps_run.sh $S/ps_build.jsx template=... art="$W/art.png" shadow="$W/art_shadow.png" out=... name=... \
    artcolor=12,12,12 rough=255 shadowcolor=197,80,45 shadowrough=15
```

- The shadow is cast by the art's **filled silhouette**, the default `--shadow-mode silhouette`.
  Gaps are sealed, the letter counters are filled, and the shape is shifted in car space, so
  orange only shows past the far edge of the letterforms. Don't use `--shadow-mode strokes` on
  line art like DOOOOM. Each thin stroke then casts its own copy, and it reads as an outline on
  every edge; the user rejected that. Shifting happens before the UV remap, so the shadow stays
  continuous across seams.
- In the PSD, stack it the way a designer would, with black on top: the full offset shadow, then
  a knockout of the art's footprint in the body colour, then the art. Pass
  `shadowfull=..._shadowfull.png knockout=..._knockout.png` along with `shadow=..._shadow.png`.
  The trimmed file is only used for the spec map, so the body keeps template roughness under the
  art. The user can nudge the shadow layer in the PSD.
- Resizing and rotating follow user requests literally. "135%" means L × 1.35, even if the art
  crops at the body edges. "Tilt 15% toward the centre" became 45° to about 38°, measured from
  the car's length axis. Say which interpretation you used.
- Scale is about 12px per inch on the Lotus, from roughly 1,900px of UV across roughly 4 m of
  body length. Recompute it for each car. "Vertical" in the user's nose-up top view means
  rearward, which is `+dx` on a nose-left template.
- To match a colour from a sim screenshot, calibrate for lighting. Divide the sampled colour by
  how bright known-white decals render in the same shot. Goodyear lettering came out around 0.89,
  which turned the rendered #AF4628 into roughly #C5502D. Tell the user it's an estimate and ask
  for the exact hex.

### 6c. Islands outside the band: rear wing top and underside

Wings live elsewhere on the sheet. Map them into car space with a small JSON of rectangle maps,
passed as `--extra maps.json --car-size 2400 --center <C>`. The car canvas grows so the wing can
sit behind the body.

```json
[{"name":"rear wing top","island":1,"uv":[295,5,506,475],"car":[1950,1023,2160,1493],"mirror":false},
 {"name":"rear wing underside","island":1,"uv":[9,5,271,475],"car":[2160,1023,1950,1493],"mirror":true}]
```

- **Read the wing island first.** The Lotus rear wing is a single island, the profile unwrapped
  around its leading edge. You can spot the leading edge where spanwise grid lines bunch up. The
  top surface is the flatter side of an inverted wing and usually carries the sponsor block.
  Here it runs front to rear left to right, like the body. The underside is longer and more
  curved, unfolded the other way, so reverse its car x range.
- **`mirror: true` on undersides.** The art is sampled mirrored across the centreline so it reads
  correctly from below. The template had no paintable floor, so the wing underside was the only
  "bottom of the car".
- **Placement.** Put the wing's car-space x just behind the last body island, and its lateral span
  centred on the centreline. For the Lotus spine layout, at 0° and 125% (L=1812), cx=1384 put the
  D at the front of the cockpit, the O's down the spine and the M on the wing.

### 6d. Several art layers, decals and ad spots

`ps_build_multi.jsx` takes a JSON config and builds any number of art layers in one pass, plus
hidden guide rectangles. Use it once a livery is more than one logo.

```bash
$S/ps_run.sh $S/ps_build_multi.jsx config="$W/livery.json"
```

```json
{"template":"/path/Car.psd","out":"/out/","name":"DOOOOM","base":[10,10,10],
 "layers":[{"png":"wm.png","color":[10,10,10],"rough":59,"name":"Watermark"},
           {"png":"logo.png","color":[197,80,45],"rough":null,"name":"Logo orange (gloss)"}],
 "guides":[{"rect":[1150,560,1420,690],"name":"AD SPOT - rear flank"}]}
```

Layers list bottom to top. `rough: null` leaves template roughness, which is gloss; 255 is matte.
A percentage-visible wash is roughness only, blended from the body value: 10% of the way from 37
to 255 is 59. Guides sit in a hidden group and never reach the TGA.

**Decal orientation, from the Lotus:**

- **Vertical flank panels** are laid out upright on the sheet on one side and upside down on the
  other. The upper half was the car's right and needed 180°, the lower half the car's left at 0°.
- **Text on a top surface meant to be read from one side** has its letter tops pointing at the
  centreline. Same rotations as above: upper 180°, lower 0°.
- **Letter tops point away from the reader.** Tops toward the nose reads from behind, which is
  the chase cam. Tops toward the tail reads from in front of the car. Say which you chose.
- **A wash that must cover the whole car** needs two mirrored diagonal passes. One pass along the
  car is too narrow and leaves the flanks bare; one diagonal misses the corners. Two passes at
  +45 and -45 covered 71 of 108 islands, leaving only small parts.
- Use `--fallback g_Mask.png` so art reaches flanks, wings and small parts through an identity
  mapping, rather than being confined to the gap-closed band.

### 6e. Composing an original livery from the artwork

When the brief is "remix this", build motifs out of the supplied art and place them with racing
conventions. What worked on the Lotus (v10 "Ring Dissolve"):

- **Mine the artwork for shapes.** The DOOOOM logo gave a double O ring, a torn fringe edge and
  the M's lightning. The ring became a front-to-rear dissolve down each sidepod, the fringe an
  edging for the spine stripe and a border along the flanks, the lightning small hash marks.
- **Racing language carries the rest:** nose chevrons in graded tones, a centreline spine stripe,
  a sponsor row along the sill, the wordmark big across the rear deck.
- **Keep the body colour dominant.** A black car wants roughly 8-10% ink coverage. The first pass
  was near 40% and read as an orange car; cut it back hard.
- **Grade the accent colour on abstract shapes only, and keep every brand logo one colour.**
  Deep / core / hot / pale oranges on chevrons, rings and hashes; all logos at core.
- **Motifs cropped from a rasterised logo carry its background.** A ~14% grey background paints a
  faint rectangle behind every stamp. Stretch each crop's alpha before use.
- **Sponsors read as a list, not a spread.** Normalise every logo to one cap height, use one fixed
  gap, anchor the row at one end and let it run. Keep it clear of the number block.
- **Mirror a mark, never a row's order.** On the far side of the car each logo is turned 180 where
  it already stands - same station along the car, same running order. Reflecting the group about
  its centre so the row "reads left to right" from both sides reverses the sequence, and that is
  not how a car is signwritten: a sponsor sits at the same place on both flanks. Mirrored panels
  pair by a vertical flip, so "same station" means the same sheet x with y mirrored.
- **One DOOOOM per surface.** The lockup carries the wordmark too, so putting it on the panel that
  already wears DOOOOM reads as the logo stamped twice - it did on the MX-5's flank and across the
  M2's quarter panel and door. Where a car has no second surface, that panel gets SPEEDSPORTS on
  its own instead: a second mark, not a second DOOOOM.
- **A row is a group, and a group that does not fit is not a row.** Stamping the logos and letting
  the island mask cut whatever hangs over the edge produces a half a logo on the car, which reads
  as a mistake rather than as a sponsor. Fit the whole group instead: keep every logo's relative
  size and spacing, slide the group back along the panel to find a place it lands whole, and only
  when no position works shrink the group a step and try again. Both sides of the car take the
  same scale, or the strip is visibly bigger on one flank. See `### 6g`.
- **Give each surface its own map when it needs different art.** Splitting the rear wing into
  `wing_top.json` and `wing_bottom.json` put one logo on top and another underneath.
- **Logo files vary; detect the ink.** Real transparency wins; otherwise decide between dark ink
  on light and light ink on dark from the border pixels, and measure distance from white rather
  than darkness. Cisco's light-blue mark scores as "not dark" and vanishes under a darkness test,
  while an opaque white-background thumbnail becomes a solid rectangle under an alpha test.

### 6f. Three checks that only the car reveals

All three look fine on the sheet and wrong in the sim, so they are scripted rather than eyeballed.

**Numbers are stamped over the paint.** Anything under a Number Block location is invisible on the
car. The official paint document calls those blocks "informational", which is misleading: art there
is hidden. Run before shipping, and treat a clash as a build failure:

```bash
$V $S/check_numbers.py --blocks 'g_Number_Blocks*.png' --layers 'art_*.png'   # exit 1 on a clash
```

It dilates each block by a few px, because numbers overflow their box. This caught a Liquid Death
lockup on the Lotus nose and SPEEDSPORTS on both of the Nissan's number panels.

**Some patches are colour samples, not surfaces.** The sim reads a colour from them and applies it
elsewhere: the pit-box swatch in a corner, a cockpit-colour patch on some cars, and on others
single-pixel blocks in the top-left that set mirrors and wing undersides. Art laid across the whole
sheet lands on them and tints things nowhere near the art; leaving them at the template default
gives you the template's pit box.

```bash
$V $S/color_chips.py --find <template guide dir>          # what this car has
$V $S/color_chips.py car.tga --rects 'x0,x1,y0,y1;...' --fix
```

Default to the body colour unless the user asks otherwise.

**A mark that overruns its panel is cut, not shrunk.** The island mask is applied after stamping,
so anything past the edge simply disappears - the death logo came off the Lotus with its side
sliced off, and the same happened on eight fleet cars where a row fitted on one flank caught the
edge on the other. Mirrored panels are near-perfect twins, not perfect ones, so fitting one side
proves nothing about the other. Measure the ink a mark would lose *before* committing it:

```python
lost = sheet.loss(logo, cx, cy, island_ids, h=cap)     # 0 means it lands whole
```

`loss` counts ink over a number block as lost too, so one search keeps marks inside the panel and
off the numbers at the same time - which matters most on the mirrored side, where the position is
derived rather than fitted.

Then search, smallest change first: slide the mark or the whole row along the panel, and only
shrink when no position fits. `fleet_logos.py` walks scale down in 4% steps with shifts of up to
180px at each step, and refuses a row that would end up below 55% of its natural size - better no
row than a row nobody can read. Check both sides of every mirrored placement.

### 7. Verify before handing off

- Paint TGA values: body and art should match the requested colours. The 22px Pitbox Color
  swatch in the bottom-right corner is expected.
- The fallback's lighter pixels should line up with the art mask. A mismatch of about 190k
  pixels means the TGA is flipped. Antialiased edges alone account for about 5k.
- In the spec green channel, art should be about 250 and body should keep the template default.
- Save `preview_uv_on_wireframe.png` and `preview_topview_reconstructed.png` for the user.
- No mark loses ink to a panel edge. Sponsor rows are fitted as a group, both sides at one scale.
- State plainly that orientation was inferred without a 3D view. The user checks it in the
  iRacing paint viewer or a session.

## Photoshop scripting gotchas (all hit for real)

- **Photoshop can't read the sandbox temp dir.** Pass script text inline; `ps_run.sh` does this
  and injects `key=value` args as a `P` object.
- **`do javascript` with a dynamic app name won't compile.** Interpolate the name into the
  AppleScript text. Override it with `PS_APP="Adobe Photoshop 2027"`.
- **Any modal dialog hangs everything.** One `selection.fill()` opened the Fill dialog and every
  later AppleEvent timed out. Set `app.displayDialogs = DialogModes.NO` and fill through
  `executeAction("Fl  ")` with an explicit colour, as in `fillSel()` in `ps_build.jsx`. If
  Photoshop is already stuck, ask for computer-use access, look at the dialog with
  `app_screenshot`, and press Cancel.
- **Clipped Solid Color fills don't always clip.** The shadow's fill came out unclipped and
  turned the whole body orange. Setting `grouped = true` afterwards didn't help. The fix is to
  recolour the layer's own pixels with Fill and Preserve Transparency (`PrsT`). Always check the
  body colour in the exported TGA.
- **`layer.duplicate(otherDoc)` needs the source doc frontmost.** Set
  `app.activeDocument = source` first.
- Raise the AppleEvent timeout with `with timeout of 1800 seconds`, or long exports report a
  false failure while Photoshop keeps working.
- PIL refuses Photoshop PNGs with big XMP chunks. Set `PngImagePlugin.MAX_TEXT_CHUNK` high; the
  tool already does.
- There's no Ghostscript, so ImageMagick can't read .ai files. Rasterize with Photoshop.
