# The car list

`cars.json` says, for every car on the rig, what kind of car it is, whether it has ABS, traction control and a
brake bias the driver can change, and every control it gives the driver from the seat — with the label the car
itself uses, the control in words where what it does is known, its range or the names of its positions, and the
telemetry variable that carries it.

It is written by hand because the sim cannot be asked. Its class has no name in a test session and the car's own
name in others; a car publishes variables it does not use; and the same variable means different things in
different cars — the GTP and LMH prototypes have no ABS and carry brake migration on `dcABS` (the Porsche 963's
`dcABS` matched the garage's Brake Bias Migration in 43 of 47 of the driver's sessions), the Audi R18 its IBS, the
McLaren 570S its Track / Sport / Normal mode. The driver's words: "don't rely only on sim based data", "just build
a canonical list, because i don't think we can reliably do databased detection".

## Labels and words

He asked on 2026-10-02 for no text in capitals but an acronym, and for words instead of acronyms where they fit, with
his own for the common ones: "for ABS: anti-lock, for bb: bias. for tc: traction", "mig: migration. arb: rollbar". So a
control has two names:

- **`label`** is the car's own short form, as its dash or black box shows it, written in sentence case: its words in
  lower case ("Brake bias", "TC toggle", "Front ARB", "Launch rpm"), its own abbreviations as the car shows them (TCLO,
  BBAL, FARB, AR-F, MIG). The HUD shows it where the words do not fit, and the desk beside the words with the words as
  its title. `apps/overlay/modules/js/words.js` lists the abbreviations that may stay in capitals (`CAR_LABELS`).
- **`words`** (optional) is the control in words where what it does in that car is known — from the entry's own `note`
  and `sources` (iRacing's public manuals and release notes, and for a car he drives the garage's own names in his
  `.ibt` files): "Bias" for every brake bias, "Migration", "Front rollbar" and "Rear rollbar", "Anti-lock" where the
  label is ABS, "Traction" where it is TC or the car's one traction dial, "Traction slip" and "Traction gain" for a
  prototype's two (the 963's TCLO and TCLA, as its garage names them), "Assists" for a dial that is ABS, TC and
  stability at once, "Stability" for DSC and ESC, "Throttle map", "Engine map" and so on. They are what the car's own
  source calls the dial ("Engine power" for the FW31's MODE, as its setup guide has it; "Push to pass" for the IR18's OT,
  as the IL15 and the DW12 say it). Where the label is words that say what the dial is in the car's own terms (Weight
  jacker, Top wing, Start limit, Throttle shape) there are no `words`: the car's name stands, and nothing is renamed that a
  source does not rename. `words` are given for a label that does not say it (Map, Mix, Mode: "Engine map", "Fuel mix"),
  for his own words for the common ones (Bias for Brake bias), and for an abbreviation a source settles. Where what a
  control does is not settled, there are none and the label is all there is: the BMW LMDh's TCLON and TCLAT (its 2023
  manual and the 963 disagree on which is the slip and which the gain). DRS is an acronym, and stays one.
- **`positions`** are named in sentence case (Track, Sport, Normal, Off, Safety car); MDM, a name, stays in capitals.

The HUD's controls panel shows the longest form that is whole in a cell at its size: the words, then for a rollbar
"Rollbar" with a small F or R, then the label (`car-controls.js` `chooseForm`; the glance layout measures). The host
sends `words` with each reading; a SimHub plugin from before them sends none, and the HUD has its own words for the
dials whose meaning is the same in every car.

## What reads it

- **The HUD** (`RacingDesk.Core.Cars.CarList`, embedded in `RacingDesk.Core` at build time, so the app's host and
  the SimHub plugin both carry it): anti-lock, traction and bias as None, Off, a value, or the car's own mode, in words
  where they fit and else with the car's labels; brake migration, rollbars, DRS and push to pass for the cars that have
  them. The root `CLAUDE.md`, "The car's controls", says how.
- **The desk's Cars page**: what the list says of a car, each control by its words with the car's label beside them.
- **The pedal rule**: a car's kind and its ABS decide which of the driver's profiles it starts from.
- **The check** (`CarListCheck`): while he drives, what the car publishes is compared with its entry, and each
  disagreement is said once per car, so the list gets corrected. The telemetry checks the list; it never
  overrides it.

## How it was written (2026-09-29)

The 194 cars were split into eight groups. For each, one agent wrote the entries and a second tried to prove each
one wrong. For the 55 cars he has driven (`"checked": "telemetry"`), the entries were compared variable by variable
with what those cars publish in his own `.ibt` files, and with the garage's own words for each setting; for the
rest (`"checked": "written"`), from iRacing's public car manuals and release notes, cited per car in `sources`.
No login was used and nothing of iRacing's is copied here but names and labels. The labels were put in sentence case
and the words added on 2026-10-02, from the same notes and sources.

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
(numbers, like the MP4-30's `25%`, `50%`, `75%`); names of modes (`Track`, `MDM`, `Dry`) never do.

## Changing it

Edit `cars.json` (it is written with `JSON.stringify(list, null, 1)`: one space a level), then run the .NET tests:
`TheListThisBuildCarriesIsReadWithoutComplaint`, the list's self-agreement test and
`TheListThisBuildCarriesHasItsWordsWhereTheMeaningIsKnown` read the file this build embeds; and the overlay's
`tests/unit/words-not-caps.spec.mjs`, which holds its labels, words and positions to sentence case. The shape each entry
must have is in the root `CLAUDE.md`. The app picks a change up when it is built again, and the SimHub plugin when it
is installed again.
