---
name: track-research
description: >
  Research, document, and maintain track data for the RaceCor overlay.
  Use this skill whenever someone asks about track facts, sector counts, track
  history, corner names, or commentary material for any racing circuit —
  especially iRacing tracks. Also use when adding a new track to the system,
  updating sector boundary data, or enriching the commentary database with
  track-specific talking points. Trigger on mentions of specific circuit names,
  "track data", "sector count", "track research", "commentary facts",
  "corner names", or "add a track".
---

# Track Research Skill

This skill manages the authoritative track database for the RaceCor overlay
project. The database powers two things:

1. **The HUD** — sector counts, boundary percentages, track lengths, and
   configuration metadata that the sector indicator and track map consume.
2. **The commentary engine** — rich facts, historical context, corner-by-corner
   notes, and broadcast-ready talking points that make the AI commentator
   sound knowledgeable and engaging.

## Data sources

Track data comes from several places, in priority order:

1. **iRacing session YAML** (`SplitTimeInfo`) — the only source for sector
   boundary percentages and native sector counts. These are only available
   at runtime when connected to the sim. If the user provides observed values,
   treat them as authoritative and update the database.
2. **The existing `racecor-overlay/data/tracks.json`** — contains curated
   info for ~10 key tracks. Already referenced by the overlay.
3. **Web research** — for history, notable races, corner names, and
   commentary-grade facts. Wikipedia, official circuit sites, F1/WEC/IMSA
   results pages.
4. **The bundled track map CSVs** in
   `racecor-plugin/simhub-plugin/racecorprodrive-data/trackmaps/` — waypoint data for the
   map visualization. If a CSV exists for a track, it's a "bundled" track
   with first-class support.

## Database location

`references/iracing-tracks.json` in this skill folder. This is the master
reference — read it when you need track data, update it when you learn
something new.

## Track entry schema

Each track entry follows this structure:

```json
{
  "id": "spa-francorchamps",
  "name": "Circuit de Spa-Francorchamps",
  "country": "Belgium",
  "region": "Wallonia",
  "trackType": "road",
  "lengthKm": 7.004,
  "lengthMi": 4.352,
  "turns": 19,
  "sectors": {
    "count": 3,
    "source": "confirmed",
    "boundaryPcts": [0.326, 0.687],
    "notes": "Standard 3-sector F1 layout"
  },
  "elevation": {
    "changeM": 104,
    "changeFt": 341,
    "description": "Significant through Ardennes hills"
  },
  "configurations": 7,
  "bundledMap": true,
  "iRacingPrice": "paid",
  "difficulty": "advanced",
  "commentary": {
    "nickname": "The Ardennes Rollercoaster",
    "builtYear": 1920,
    "famousCorners": ["Eau Rouge/Raidillon", "La Source", "Blanchimont", "Bus Stop"],
    "notableRaces": ["Belgian GP (F1)", "Spa 24 Hours", "WEC 6 Hours of Spa"],
    "talkingPoints": [
      "Originally 15km using public roads through the Ardennes",
      "Eau Rouge is actually the name of the stream — the uphill is Raidillon",
      "Weather can differ between sectors due to the circuit's 7km length",
      "Pouhon is a blind double-left taken at over 250 km/h in an F1 car"
    ],
    "lapRecord": {
      "time": "1:46.286",
      "driver": "Valtteri Bottas",
      "year": 2018,
      "series": "F1"
    }
  }
}
```

### Sector source values

- `"confirmed"` — observed from iRacing SplitTimeInfo or confirmed by user
- `"f1-standard"` — F1/FIA circuits use 3 sectors by default
- `"estimated"` — assumed 3 based on track type (most road courses)
- `"unknown"` — no data yet

Always prefer `"confirmed"` data. When the user provides sector counts they've
observed in iRacing, immediately update the entry and set source to `"confirmed"`.

## When researching a track

1. **Check the database first** — read `references/iracing-tracks.json`
2. **If the track exists**, present what we have and note any gaps
3. **If the track is missing**, research it:
   - Search for the official circuit website
   - Check Wikipedia for history, length, turns, elevation
   - Look for notable races and famous corners
   - Check if we have a bundled track map CSV
4. **Always gather commentary-grade facts** — the kind of thing a broadcast
   commentator would drop: "Did you know this corner was named after..."
   type nuggets. These make the AI commentator feel human.
5. **Update the database** with findings

## When the user provides sector data

This is gold — iRacing sector counts are only available from the sim at runtime.
When the user says something like "Nordschleife has 7 sectors" or provides
boundary percentages:

1. Update the track entry immediately
2. Set `sectors.source` to `"confirmed"`
3. If boundary percentages are provided, store them in `boundaryPcts`
4. Note: the compact HUD indicator caps display at 3 sectors, but the drive
   HUD and track map use the full native count

## Commentary integration

The `commentary` field is designed to feed the AI Strategist / commentary engine.
When adding facts, think about what makes good broadcast material:

- **Talking points** should be surprising, specific, and conversational — not
  generic Wikipedia summaries. "Eau Rouge is actually the stream name" beats
  "Spa is a famous Belgian circuit."
- **Famous corners** with their actual names help the commentator reference
  track position naturally
- **Lap records** give context for "that's X seconds off the lap record" type
  commentary
- **Nicknames** ("Green Hell", "The Brickyard") add broadcast color

## Track types

Use these values for `trackType`:
- `"road"` — permanent road course
- `"oval"` — banked oval (superspeedway, short track, dirt oval)
- `"street"` — temporary street circuit
- `"rallycross"` — rallycross layout
- `"dirt-road"` — dirt road course
- `"hillclimb"` — point-to-point hillclimb
