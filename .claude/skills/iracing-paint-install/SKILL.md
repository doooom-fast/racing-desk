---
name: iracing-paint-install
description: |
  Put finished livery files where iRacing will load them, with the names it expects: work out the
  customer ID that goes in the filename, resolve the car's paint folder, and copy/rename
  car_<id>.tga, car_spec_<id>.tga, car_num_<id>.tga, helmet_<id>.tga and friends in one step
  instead of editing filenames by hand. Also covers the spec-map .mip step and uploading to
  Trading Paints so other drivers see the paint. Use when a livery is finished and needs to show
  up in the sim, when asked "what ID goes in the filename", "why isn't my paint showing",
  "car_spec .mip", or "should I use Trading Paints". Pairs with iracing-paint-templates and
  iracing-livery-placement.
---

# Installing a paint into iRacing

The sim loads `Documents/iRacing/paint/<car folder>/car_<customer ID>.tga`. Getting a paint to
show up is entirely about those two values.

```bash
S=<this skill>/scripts
python3 $S/install_paint.py --find-id                                   # what ID goes in the name
python3 $S/install_paint.py --src v10_remix --car "Lotus 79" --id 424242
python3 $S/install_paint.py --src v10_remix --car lotus79 --id auto     # infer the ID
python3 $S/install_paint.py --src v10_remix --car "Lotus 79" --id 424242 --stage ~/to_pc
```

It resolves the car folder from a name, renames every file to its role, warns on wrong bit depth
or size, backs up anything it replaces, and prints what it did. `--stage` writes a ready-to-copy
folder for when the sim's machine isn't mounted, which is the normal case when designing on a Mac
and racing on a PC.

## The ID in the filename

It is the **iRacing customer ID of the account that owns the paint**, 6 or 7 digits. It is *not*
per-car and *not* a livery ID. The same number is used for every car, and for helmet and suit.

Three ways to get it, in order of convenience:

1. `--find-id` reads existing paint files and takes the number that recurs. Run it on the machine
   with iRacing installed; downloaded paints from other drivers are named with *their* IDs, so it
   reports the most frequent and lists runners-up.
2. iRacing UI: helmet icon, top right, then Profile.
3. A Trading Paints profile URL ends in the same number.

Leading zeros to six digits are accepted and sort better. Seven-digit IDs are normal for newer
accounts.

## The names iRacing looks for

| File | Holds |
|---|---|
| `car_<id>.tga` | the paint |
| `car_spec_<id>.tga` | spec map: R metallic, G roughness, B clearcoat |
| `car_num_<id>.tga` | custom number layer |
| `car_decal_<id>.tga` | decals |
| `helmet_<id>.tga`, `suit_<id>.tga` | helmet and suit |

24-bit TGA, 1024² or 2048². RLE compression is allowed but not required; uncompressed files from
the livery-placement pipeline load fine. 32-bit is only for cars with paintable windows. The car
folder is the sim's own directory name (`lotus79`); resolve it with `iracing-paint-templates`.

In the sim, the paint has to be selected: the car's paint must be set to the custom scheme, and
custom spec maps must be enabled in graphics options or the spec file is ignored.

## Spec maps and the .mip step

Locally, `car_spec_<id>.tga` works directly. For anyone else to see it, iRacing needs a `.mip`,
which only the sim can produce:

1. Put `car_spec_<id>.tga` in the car folder and drive the car onto track.
2. iRacing writes `car_spec_<id>.mip` beside it. Ctrl+R re-cooks it after edits.
3. Upload that `.mip` to Trading Paints alongside the paint.
4. Remove the spec `.tga` afterwards, or the sim keeps regenerating the `.mip` and can overwrite
   what Trading Paints selected.

## Local files versus Trading Paints

They answer different questions, and a paint that relies on a spec map needs both.

- **Local files** are the only way to iterate. They show the paint to *you*, immediately, and they
  are what produces the `.mip`. No upload, no approval, no waiting.
- **Trading Paints** is how *other drivers* see it. Upload per car through the site; the filename
  and customer ID stop mattering because the upload is already tied to the account and car. Their
  Downloader must be running while racing, and it only shows the paint to others who also run it.

So: keep designing against local files, and upload to Trading Paints when a version is worth
showing other people. Uploading does not remove the need for the local install, because the spec
map's `.mip` can only be cooked by driving with the local `.tga`.
