---
name: iracing-paint-templates
description: |
  Find and download the official iRacing PSD paint template for a car, and look up the paint
  folder name the sim reads for that car (lotus79, ferrari296gt3, "astonmartin dbr9", ...). Use
  when starting a livery for any car, when the user names a car and you need its template or its
  folder, when asked "where do the files go for this car", or when a template PSD is missing.
  Templates are iRacing's own PSDs, indexed publicly with no login. Pairs with
  iracing-paint-install (naming and installing finished files) and iracing-livery-placement
  (designing the art itself).
---

# iRacing paint templates and car folders

Two things are needed before any livery work on a new car: **its template PSD**, and **the paint
folder name** the sim reads. Both come from one lookup.

```bash
S=<this skill>/scripts
python3 $S/get_template.py "Lotus 79"                  # download + unzip + report the PSD
python3 $S/get_template.py lotus79 --out ~/templates   # the folder name works too
python3 $S/get_template.py --search porsche            # list matches
python3 $S/get_template.py "Ferrari 296 GT3" --no-download   # just the folder and URL
```

Output for the Lotus 79:

```
Lotus 79
  paint folder : lotus79      <- the sim reads files from here
  template     : https://ir-core-sites.iracing.com/members/member_images/cars/car_templates/25_template_L79.zip
  PSD          : ~/templates/lotus79/Lotus 79.psd
```

## What the pieces mean

- **Paint folder** is the car's own directory under `Documents/iRacing/paint/`. It is the car's
  identity in the filesystem, not a number. Some have spaces (`astonmartin dbr9`,
  `mx5 mx52016`), so quote them.
- **Template zip** is hosted by iRacing and contains the PSD. No login needed. 21 MB for the
  Lotus 79, larger for modern cars.
- **The template PSD** is a UV sheet with guide layers, a `Turn Off Before Exporting TGA` group,
  a `Paintable Area` group and a `Custom Spec Map` group. `iracing-livery-placement` explains how
  to read it.

## The lookup table

`scripts/cars.tsv` maps 121 cars to folder, template code and download URL. It is scraped from the
public Trading Paints template index, which lists iRacing's own templates alongside each car's
folder path. Refresh it when iRacing adds cars:

```bash
python3 $S/refresh_cars.py
```

## Other routes to the same files

- **In the iRacing UI:** My Content, then Car Manager, then Download Template. Same PSD, one car
  at a time, and only for cars owned.
- **Already on disk:** a template downloaded earlier is usually in Downloads or beside previous
  work. Search for `*<car>*.psd` before downloading again; they are large.

Cars that are not in `cars.tsv` (brand new, or not listed) still have a template in the iRacing UI.
Add the row to the TSV by hand once you know the folder name.
