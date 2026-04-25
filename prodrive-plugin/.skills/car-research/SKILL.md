---
name: car-research
description: >
  Research, document, and maintain car data for the RaceCor overlay.
  Use this skill whenever someone asks about car facts, manufacturer history,
  engine specs, driving characteristics, or commentary material for any racing
  car — especially iRacing cars. Also use when adding a new car to the system,
  finding car photos for commentary, or enriching the commentary database with
  car-specific talking points. Trigger on mentions of specific car names,
  "car data", "car research", "manufacturer facts", "car photos", "car images",
  or "add a car".
---

# Car Research Skill

This skill manages the authoritative car and manufacturer database for the RaceCor
project. The database powers two things:

1. **The commentary engine** — rich facts, driving character descriptions,
   engine specs, and broadcast-ready talking points that make the AI commentator
   sound knowledgeable and engaging about every car on the grid.
2. **Commentary images** — Wikimedia Commons photos of cars displayed alongside
   car-related commentary topics (car spotlight, manufacturer heritage, etc.).

## Data sources

Car data comes from several places, in priority order:

1. **The existing `commentary_cars.json`** — contains curated info for
   GT3, GTP, LMP2, TCR, and historic cars. Already referenced by the plugin.
2. **Web research** — for history, notable drivers, design philosophy, and
   commentary-grade facts. Wikipedia, manufacturer press kits, official
   series sites, Wikimedia Commons for images.
3. **iRacing session data** — CarModel string from the sim identifies which
   car the player is driving. The plugin fuzzy-matches this against our database.

## Database location

`racecor-plugin/simhub-plugin/racecorprodrive-data/commentary_cars.json` — the master
reference file. Contains both `cars` (individual car entries) and
`manufacturers` (brand-level commentary data).

## Car entry schema

Each car entry follows this structure:

```json
{
  "displayName": "BMW M4 GT3 EVO",
  "manufacturer": "BMW",
  "class": "GT3",
  "engineLayout": "front-engine",
  "engineSpec": "3.0L twin-turbo straight-six",
  "talkingPoints": [
    "Evolved from the dominant M6 GT3",
    "Most forgiving GT3 on the grid"
  ],
  "drivingCharacter": [
    "accessible to master but fast in the right hands",
    "forgiving mid-corner stability"
  ],
  "nickname": "The Bavarian Workhorse",
  "designer": "BMW M GmbH",
  "notableDrivers": ["Augusto Farfus", "Sheldon van der Linde"],
  "images": [
    "https://upload.wikimedia.org/wikipedia/commons/..."
  ]
}
```

## Manufacturer entry schema

```json
{
  "displayName": "BMW M Motorsport",
  "countryCode": "DE",
  "founder": "Karl Rapp",
  "racingPhilosophy": "engineering precision meets touring car heritage",
  "talkingPoints": [
    "BMW's motorsport DNA goes back to the 1972 formation of BMW Motorsport GmbH",
    "The M division was born from racing and that ethos flows into every M car"
  ]
}
```

## Finding car images

Images should come from **Wikimedia Commons** (Creative Commons licensed):

1. Search `https://commons.wikimedia.org/` for the car name
2. Look for **action/racing shots** over static/showroom photos
3. Use the **direct file URL** (starts with `https://upload.wikimedia.org/`)
4. For thumbnails, use the `/thumb/` path with a width suffix like `/1280px-...`
5. Aim for 1-3 images per car
6. Add to the car's `"images"` array

The dashboard displays these in the commentary panel when car/manufacturer
topics fire, with a "Wikimedia Commons · CC" attribution overlay.

## When researching a car

1. **Check the database first** — read `commentary_cars.json`
2. **If the car exists**, present what we have and note any gaps
3. **If the car is missing**, research it:
   - Search for the car's official spec sheet
   - Check Wikipedia for history, engine, designer
   - Look for notable real-world racing results
   - Find 1-3 Wikimedia Commons images
   - Identify the driving character (what makes it unique to drive)
4. **Always gather commentary-grade facts** — the kind of thing a broadcast
   commentator would say: "The flat-six in this Porsche is naturally aspirated
   in a field of turbos" type nuggets.
5. **Update the database** with findings

## Commentary integration

When adding facts, think about what makes good broadcast material:

- **Talking points** should be surprising, specific, and conversational — not
  generic spec sheets. "Turbos sit inside the V-angle" beats "Has turbocharging."
- **Driving character** descriptions should evoke what the car feels like to
  drive: "explosive turbo delivery demanding smooth inputs"
- **Engine specs** as a single punchy string: "4.2L naturally aspirated flat-six"
- **Nicknames** add broadcast color: "The Purist's Choice", "The Turbo Revolution"
- **Notable drivers** give context for "a car that carried [driver] to victory"

## Car classes in iRacing

- `"GT3"` — GT World Challenge spec (most popular)
- `"GTP"` — IMSA/WEC Hypercar class
- `"LMP2"` — Le Mans Prototype 2
- `"GT4"` — entry-level GT
- `"TCR"` — touring car
- `"F1"` — open-wheel (historic or modern)
- `"NASCAR"` — stock car
- `"Prototype"` — older LMP categories
