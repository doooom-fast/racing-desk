# The car list

`cars.json` says, for every car on the rig, what kind of car it is, whether it has ABS, traction control and a
brake bias the driver can change, and every control it gives the driver from the seat — with the label the car
itself uses, its range or the names of its positions, and the telemetry variable that carries it.

It is written by hand because the sim cannot be asked. Its class has no name in a test session and the car's own
name in others; a car publishes variables it does not use; and the same variable means different things in
different cars — the GTP and LMH prototypes have no ABS and carry brake migration on `dcABS` (the Porsche 963's
`dcABS` matched the garage's Brake Bias Migration in 43 of 47 of the driver's sessions), the Audi R18 its IBS, the
McLaren 570S its TRACK / SPORT / NORMAL mode. The driver's words: "don't rely only on sim based data", "just build
a canonical list, because i don't think we can reliably do databased detection".

## What reads it

- **The HUD** (`RacingDesk.Core.Cars.CarList`, embedded in `RacingDesk.Core` at build time, so the app's host and
  the SimHub plugin both carry it): ABS, TC and brake bias as NONE, OFF, a value, or the car's own mode, with its
  labels; brake migration, anti-roll bars, DRS and push to pass for the cars that have them. The root `CLAUDE.md`,
  "The car's controls", says how.
- **The pedal rule**: a car's kind and its ABS decide which of the driver's profiles it starts from.
- **The check** (`CarListCheck`): while he drives, what the car publishes is compared with its entry, and each
  disagreement is said once per car, so the list gets corrected. The telemetry checks the list; it never
  overrides it.

## How it was written (2026-09-29)

The 194 cars were split into eight groups. For each, one agent wrote the entries and a second tried to prove each
one wrong. For the 55 cars he has driven (`"checked": "telemetry"`), the entries were compared variable by variable
with what those cars publish in his own `.ibt` files, and with the garage's own words for each setting; for the
rest (`"checked": "written"`), from iRacing's public car manuals and release notes, cited per car in `sources`.
No login was used and nothing of iRacing's is copied here but names and labels.

What the checkers could not settle is in `DOUBTS.md`. A car he drives settles its own entry: where it disagrees,
the host says so.

## Ranges (2026-10-02)

The HUD draws every control's value as a bar: where it stands between the control's `range` for that car (he asked
for "background scaling for all of these adjustments"). A range is added only where its source can be named, and the
control's `note` names it: an iRacing manual or setup guide, release notes (all public pages, no login), or, for a car
he drives, the lowest and highest value his own `.ibt` files show for that variable while he was in the car, held for
half a second or more, written `Range from his files: seen 46 to 55 in 55 files to 2026-10-02`. A control with no
source has no range and no bar:
nothing is made up. A range from his files is what he has used, not what the car allows, so when he goes past it the
check says so (`value:<var>`) and the range wants widening. Named positions fill a bar only where they are a scale
(numbers, like the MP4-30's `25%`, `50%`, `75%`); names of modes (`TRACK`, `MDM`, `DRY`) never do.

## Changing it

Edit `cars.json`, then run the .NET tests: `TheListThisBuildCarriesIsReadWithoutComplaint` and the list's
self-agreement test read the file this build embeds. The shape each entry must have is in the root `CLAUDE.md`.
The app picks a change up when it is built again, and the SimHub plugin when it is installed again.
