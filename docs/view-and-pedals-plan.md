# Per-car view and pedal profiles — plan

> **Status, 2026-10-02 (evening).** Recording is built: the view per car when the sim closes (V1); SmartControl's profiles
> read and a base given to each car by his rule (P1, P2a); the brake force followed from SmartControl Live's keys and kept
> per car. **Putting each car's seat height and brakes back is built, and acts by itself** on branch
> `feature/restore-height-brakes` (`RestoreDirector`): his words, "Dude I WANT them mid session", "No trial mode". There is
> no trial, no supervised first run and nothing on the HUD; Settings → Cars has two switches ("Brakes put back for each
> car", "Seat height put back for each car"), a sentence each for how it stands, and one "Undo what Racing Desk changed".
> - **Brakes**: once, with the SmartControl editor closed, Racing Desk adds its own switch profile "Racing Desk" (a copy of
>   Default) and binds F24 · Set profile to it in Live's Default preset (backed up first; the first copy kept for good as
>   `before-racing-desk.db`, the last ten others). Live reads its keys when it starts, so it works from Live's next start
>   (he restarts Live once, or the PC). **Each car gets a profile of its own** in SmartControl, "Porsche 963 GTP · Racing
>   Desk", made the first time the car loads (editor closed, backed up first): his rule's base at the car's saved force (or
>   the base's own, 45 or 80). It is the one he tunes there: a force he sets in it is the car's force, anything else he
>   changes is kept as it is, and the force his keys leave in the car is written into it when he leaves the car or the sim
>   (the hash by the rule; waiting for the editor). When he is parked in a car (garage screen or pit stall, still a second,
>   brake released, fresh frames, not a replay), and its brakes are not on the pedals already, the car's own profile is
>   copied as it stands into the switch profile — renamed "Racing Desk: Porsche 963 GTP", so that Live's voice says which
>   car; the editor closed, the binding checked first and made again if it is gone — and F24 is pressed once, only with Live
>   started after the binding and iRacing in front and not elevated. After it, the key watcher counts his +5 / −5 from the
>   profile's force. Undo takes the cars' profiles out too.
> - **Seat height**: when the sim has gone, what he left app.ini at above S goes into the car's camera file's cockpit Z and
>   app.ini goes back to S (both backed up, read back, the pair's intent kept); a car beyond ±5 cm keeps nothing, one
>   without a camera file keeps its height in the store and the Cars page says how to save one. Once, the heights he chose
>   before go into their camera files the same way. When the sim next starts, app.ini must hold what Racing Desk left there;
>   if not, the height part turns itself off and puts each camera file back once iRacing closes — unless a telemetry file
>   (.ibt) is newer than Racing Desk's last write of app.ini: a session ran without Racing Desk and iRacing wrote the height
>   itself, which is no override (a line in the log; the next fold keeps what he ends with). The horizon is left out.
>
> The rest of this page is the design as it was settled before the build; where it speaks of a trial or a first run, that
> is what was dropped. Facts are in [`height-and-pedals-findings.md`](height-and-pedals-findings.md).
>
> **Decided by Kevin, 2026-09-28:** the view is *height, seat and horizon*; pedals are *per car*; the app *creates and
> restores the whole profile*; SmartControl Live *is kept running*; and the whole thing is *transparent* — SmartControl and
> iRacing are where a value is set, The Racing Desk remembers it per car and puts it back.
>
> **Decided by Kevin, 2026-10-02:** "when I get in a car, its saved driver height and brake force should be set
> automatically, and they aren't"; "I thought you'd be making new Heusinkveld profiles for each car as needed". Every car
> starts at **S = −0.020** (his height then); a car whose force he never set starts at its base's own force (LightBrake
> 45 kg, Default 80 kg); after a switch his +5 / −5 keys count from the profile's force, **once the first run proves the
> switch**; the forces stored are right (720S GT3 30 kg, Dallara F3 90, F4 85, 963 70, 570S 55, MX-5 35). Racing Desk makes
> its switch profile and binds F24 itself, in the first run's step A2, with him there; the horizon per car only if the
> first run proves it; no log configuration in Live's program folder.

## Rules for both

- The sim, and SmartControl, are where values are set. The app has no editor for either.
- Nothing is written to iRacing's files while the sim runs — both of its process names are checked before each write.
  Nothing is ever written to the pedals directly: no HID, no serial port, nothing to the pedals' memory.
- **One key, ever: F24**, sent by `KeySender` alone (a test fails if `SendInput` appears anywhere else). No key is pressed
  for the height. SmartControl's Apply, Save and Restore are never automated.
- **His own six profiles, his Live presets and his brake-force keys are never changed** (six by 2026-10-08: F1–F4, Up and
  Down, each stored as `ZOOM` + the key, Live's form for a key on its own), but for the move of F1–F4 to Right Ctrl he
  asked for on 2026-10-09 (CLAUDE.md, His brake-force keys on Right Ctrl). The writer refuses any row it did not
  make (it is given the ids Racing Desk made, and nothing else).
- Every file the app changes is copied aside first (the first original of each kept for good) and read back after;
  SmartControl's database is backed up whole before the first write ever (0b, kept for good) and again before the first
  write of each step of the first run (a timestamped copy in Racing Desk's own backup folder, checked to open and to hold
  what the database holds; the write is refused if it does not; the last ten are kept). Every automatic action is logged, said on the desk,
  and shown on the rig's HUD once in a line ("Trial: brakes Porsche 963 GTP · 70 kg"). Silent is not the same as invisible.
- A car with nothing saved starts at S (`app.ini`'s starting height, plus the Z of its own camera file, if it has one); a
  car with no saved force goes to its base's own force (LightBrake 45 kg, Default 80 kg). Neither is left as it is: both
  were his decisions of 2026-10-02.

## The settled design (2026-10-02)

### Height: kept in each car's camera file

iRacing reads `driverHeightAdj` (`app.ini`, `[View]`) when it starts and writes it back when it exits: one height for every
car. What it does read per car is the car's camera file, `Documents\iRacing\cameras\cars\<car>\car.cam` (or the set
`camera.ini`'s `LastCarSet` names), applied when the car loads. Its cockpit camera's Z is a height of its own, and the two
add. So:

- **`app.ini` holds S for every car, and each car's own height lives in its camera file**: what he sees in a car is S plus
  the cockpit Z its file holds. iRacing puts it back when he gets in; Racing Desk presses nothing.
- **After the sim closes**, a run that started at S and in which he changed the height by d (the height `app.ini` holds
  at exit, less S) adds d to the car's cockpit Z, and `app.ini` goes back to S. The first time a car is put back, its
  stored height is moved over: new Z = his chosen height + the Z it was driven with − S, so S + Z is what he had.
- **A run that did not start at S** (something else wrote `app.ini`, critique H2): if he changed the height, what he last
  saw is kept (new Z = height at exit + Z − S); a leftover he did not touch is kept nowhere. Either way `app.ini` goes back
  to S, at every exit.
- **Limits:** |Z| ≤ 0.05 m until a test shows the camera takes more (a change past it is not kept, and said); a change
  under half a millimetre is no change. His own Z is kept apart from what Racing Desk added (`own_z`, `added_z`), so undo
  can take back exactly its own. The field of view is never touched.
- **The order of a write**, so that a stop halfway leaves nothing wrong: the intent is kept in the store first, then
  `app.ini` is set to S, then the camera file is written; a host start puts a cut-short write back (app.ini's value, never finishing the step), with the
  sim closed. A change waiting for the sim to close expires when the car is next driven.
- **The camera file**: MACC version 14 or 15, 1,668 bytes, nine 184-byte records; the cockpit record is found by its name
  and its Z is at +60. A file that is not that shape is refused and said.
- **A car without a camera file** (the Dallara F3, the Lotus 79, the Caterham 420R today) has its height recorded only;
  the desk asks him once to save one: out of the car, in replay, Ctrl+F12, Save Car, name `car.cam` (B8's words, said the
  same everywhere).
- **The horizon** (the cockpit's vertical shift, +84) the same way, behind its own switch, off until the first run shows
  that the shift adds to `DrivingVanishY` (B6).

### Brakes: a SmartControl profile per car, switched by F24

- **Each car gets a profile of its own in SmartControl**, made by Racing Desk when needed: a new row copied from his base —
  LightBrake or Default, by his rule or his choice on the desk — at the car's force (the one his keys last left in it, or
  the base's own if he never set one), named for the car ("Porsche 963 GTP"), with SmartControl's SHA-512 section hash
  made by the rule (`rule_check.py`), and tracked by its id, not its name or description.
- **One "Racing Desk" profile does the switching**: a copy of Default that Racing Desk owns, bound to **F24 · Set profile**
  (Live action 1) in his "Default" Live preset. At car load the car's profile is copied into that row (as soon as the car
  is known); F24 is sent once, **when he is parked** — still for a second (under 0.3 m/s), brake released (under 2 %), at
  the garage screen or in the pit stall, never on track, in the pit lane or in a replay. Not sent if Live is not running,
  the pedals are not connected, he has already set the force with his own keys in this car (his key wins), or the window in
  front may be elevated (Windows would drop the key).
- **The force his keys leave becomes the car's profile's force at exit**, written only with the SmartControl editor closed
  (it would save its own copy over it); it waits for the editor to close, and an edit of his made meanwhile wins.
- **Writing SmartControl's database**: the vendor's own SQL shapes (`profile_sim_device`, `keyboard_binding`,
  `profile_smartcontrol_live_keyboard_binding`), database version 1 only, a short transaction with a busy timeout, the
  journal mode never changed, every row read back after.

### Trial, the gate and the first run

- **Trial** is the only mode this build has. The two switches in Settings → Cars — "Put back each car's driver height" and
  "A brake profile for each car" — are on, and say "Trial — saying what it would do; nothing is written or pressed until
  the first run with you at the rig." "The horizon per car too" is off. The switches live in `overlay-settings.json`
  (`restoreHeight`, `restoreBrakes`, `restoreHorizon`); main.js tells the host, which keeps them in `restore.json`.
- **The first run** is the critique's corrected run, as buttons in Settings → Cars: 0a and 0b before he sits down; Part A
  with the sim closed (A1 both SmartControl apps closed, A2 the Racing Desk profile and F24, A3 Live has F24, A4 F24 from a
  program, A5 and A6 a LightBrake then a Default profile through the same row, A7 writing with the editor open); Part B in
  the sim, a test drive in the Porsche 963 (B1 `app.ini` at S survives a launch, B2 the garage flags and F24 with iRacing
  in front, B3 the pit box, B4 the camera file 2 cm lower, B5 `app.ini` 2 cm lower instead, B6 the horizon pair, B7 the
  field of view and the state he keeps, B8 camera files for the cars without one); and **C1, his own profile and force
  again**. Each button runs only its step, on his click; one that writes or presses asks first. Beside each step is what he
  should see, and his mark.
- **C1 closes the run, and is owed after any F24 that went** — also when he stops the pedals part early, after a failed A5.
  The pedals may still be on a Racing Desk profile: nothing on the PC records which profile they hold, and the firmware may
  keep the profile id or the values it was sent. So C1 is his, with his own hands; Racing Desk says what is owed and checks
  what it can, and presses and writes nothing in it. First the look at the pedals' memory, before he picks anything: he
  quits Live from its tray icon, unplugs the pedals for 5 seconds, plugs them back in, opens SmartControl and only looks (no
  Apply, Save or Restore), and says which of three it shows: his own profile and force from before the run (nothing was
  saved), Racing Desk's profile with his old values (the firmware keeps the id), or Racing Desk's values (settings were
  saved). The second and third fail the brakes part, said plainly (the switch design cannot be used); the first is also
  what the brakes need, besides A4–A6 and B2, to be proven. Then he picks his own profile in SmartControl as he normally
  does, closes it, starts Live, sets his usual force with his own keys, and confirms on the panel. Racing Desk checks that
  the look was made after the last F24, that SmartControl is closed, Live is running and the pedals are listed. The panel
  shows C1 as owed until it is done, and "Remove the brake profiles Racing Desk made" refuses, with its reason, while it
  is owed: the pedals may be on one of those rows.
- **0b copies two things, each on its own**: SmartControl's database (A2 needs it) and iRacing's `app.ini`, `camera.ini` and
  every camera file (B1 and B4–B7 need them, and refuse until they are copied and read back). One failing does not stop the
  other, and each says how it went. **A step that sends F24 or writes SmartControl's database refuses while the sim runs** (A2
  and A4–A7), and B2 asks the parked rule once more on a fresh frame right before its key.
- **One command at a time** on the host: a first-run button or an undo while another runs is told Racing Desk is busy, at
  once, and is not queued. "Remove the RD test 65 row" takes A7's test row away on its own.
- **The gate**: the brakes may leave trial once A4, A5, A6 and B2 are marked passed; the height once B1, B4 and B5; the
  horizon once B6 — and only in a build that acts. His +5 / −5 count from a switched profile's force under the same gate.
- **Undo**, each on his click, asking first: "Remove the brake profiles Racing Desk made" (its car profiles, its switch
  profile and F24, with the editor closed; his own rows are never touched) and "Undo everything Racing Desk changed" for the
  height (with iRacing closed), and per car from the car's View panel. **Undo puts values back, never whole files**: a camera
  file's cockpit Z (and vertical shift) is set to what it held before Racing Desk wrote it — the same four bytes, nothing else
  of the file — and `app.ini`'s driver height and horizon likewise, one value at a time, from what each held before Racing
  Desk's first write of it, whichever step made that write. Each is put back only while it still holds what Racing Desk
  wrote; one he saved or changed since is his, left as it is, and said with the path of the copy Racing Desk took first. The
  whole-file copies are for recovering by hand and are never put back by Racing Desk itself.

### What is stored (schema v9, tables only)

`car_view_keep` (each car's camera file, his own Z and what was added, what was last written, a waiting change, a write's
intent), `view_baseline` (S, `app.ini`'s original), `car_smartcontrol` (each car's profile: id, name, base, force written
and waiting), `smartcontrol_switch` (the Racing Desk profile and its binding), `restore_events` (every line said; the last
500 kept) and `restore_checks` (each first-run step: when it ran, what it saw, his mark). An earlier build still records
into a store this one has opened. `GET /racing-desk/data/restore` (this machine only, like every data route) answers the
switches, the gate, the lines, the dry run and the first run's steps; `POST` takes a switch, a step, a mark or an undo.
`RacingDesk.Host.exe restore --dry-run` prints the dry run and writes nothing (the store opened read-only, not migrated);
`--db`, `--documents` and `--smartcontrol` name copies to read instead of the rig's own.

### Phase 0 (read-only, 2026-10-02)

- **R1** `host.log`: 39 sim runs since 2026-09-27, a view recorded after 20. None is recorded when the host stops before
  the sim goes (3 runs) or the sim outlives the SDK ("the sim is still running", 1); the rest ended at a session change, not
  a sim exit, or came before views were recorded. Forces his keys set are kept at exit (F4 85 kg, F3 90 kg); a step from an
  unknown force is not ("+65 kg from one that is not known", the 963).
- **R2** UAC is on (consent prompt); SmartControl Live, Pit House and Explorer run unelevated; the sim, its launcher and
  `start_protected_game` ask `asInvoker`, with no run-as-administrator flag for the C: install. The key reaches Live unless the window in front is
  elevated, which B2 checks with iRacing in front.
- **R3** His account has full control of `Documents\iRacing`, `app.ini`, `camera.ini` and `cameras\cars` (19 camera files,
  all 1,668 bytes, none read-only), and of SmartControl's database folder and file; Controlled Folder Access is off.
- **R4** SmartControl's database: version 1, journal mode delete; `profile_sim_device` (id TEXT, name TEXT, data BLOB of
  UTF-8 bytes whose XML says utf-16), `keyboard_binding` (action_type INTEGER, action_value TEXT, first_key, second_key) and
  its link table to `profile_smartcontrol_live`; his five keys are actions 8, 9 and 10 in preset 1 (six by 2026-10-08: `ZOOM` + F1–F4, UP, DOWN); the vendor seeds
  SetProfile bindings itself (NUMPAD1–4), which is the shape the writer copies.
- **R5** The SimHub plugin's old `PedalProfileManager` has one profile and no car bound in either `PedalProfiles` folder, and
  no Pit House folder has the `DeviceConfig` or `profiles` it imports from: it cannot act as a second applier.
- **R6** F13–F24 are bound nowhere: not in OBS's hotkeys (both profiles, three scene collections), not in Stream Deck's 16
  profiles, not in SimHub's settings; and, from the critique's read, nothing in his 35 iRacing control profiles or the root
  `controls.cfg` is bound above F12.
- **R7** Live's `Settings.xml` has its last preset as 1 ("Default"), notifications on (visual and voice); Live starts with
  Windows (HKCU Run); the SmartControl editor does not.

## 1. The view: height, seat, horizon

### What each one is

| | Where iRacing keeps it | Per car today? | How it is set |
|---|---|---|---|
| Height | `driverHeightAdj`, `[View]`, `app.ini` | No — global | in-car keys |
| Horizon | `DrivingVanishY`, same section | No — global | in-car keys |
| Seat, fore and aft | cockpit x in `cameras\cars\<car>\car.cam` | Yes, but only through the camera tool | camera tool |

The sim reads `app.ini` when it starts and rewrites it when it exits, and nothing in the SDK sets any of the three.
So saving is easy and restoring is the whole problem: by the time the app knows which car it is, the sim has
already read the file. The settled design above answers it with the one per-car file iRacing does read at car load.

### Design as first written (superseded)

The first plan restored in three steps — the last car's view into `app.ini` before launch (V2), the sim's own height and
horizon keys pressed on a change of car (V3), and the seat through `car.cam` (V4) — with "if pressing keys proves
unreliable, height goes the way of the seat: folded into `car.cam`'s z". The settled design takes that fold from the
start, presses no key for the height, and leaves the seat as iRacing keeps it.

### Slices

| | Does | Writes |
|---|---|---|
| V1 | **Done.** Records the three per car at sim exit; the desk shows them | nothing |
| V2 | **Built, in trial.** The height folded into each car's camera file, `app.ini` at S | `car.cam` and `app.ini`, sim closed — first-run buttons only |
| V3 | Dropped: no keys are pressed for the height | — |
| V4 | The horizon in the cockpit's vertical shift, behind its own switch, if B6 passes | `car.cam`, sim closed |

## 2. The pedals

### What is on the rig (read 2026-09-28, from a copy of the database)

Six profiles. For the Ultimate pedals they differ in the brake and, in two, the throttle; the clutch is
untouched in all but one.

| Profile | Brake force | Brake curve | Brake deadzone | Throttle |
|---|---|---|---|---|
| Default | 80 kg | linear | 5 % | linear, 5/5 % |
| Rain | 75 kg | 0/10/30/70/90/100 | 5 % | 0/25/50/75/92/100, 6/10 % |
| F1 | 75 kg | 0/10/30/70/90/100 | 5 % | 0/25/50/75/92/100, 6/10 % |
| HeavyBrake | 83 kg | 0/8/25/50/75/100 | 8 % | linear, 7/7 % |
| LightBrake | 45 kg | linear | 4 % | linear, 5/5 % |
| super light | 30 kg | linear | 1 % | linear, 5/5 % |

SmartControl Live has one set of keys, all brake force: **Page Up** 50 kg, **Page Down** 30 kg, **Pause** 80 kg,
**Right Ctrl + Up** +5 kg, **Right Ctrl + Down** −5 kg. No key switches profile — until the first run's A2 binds F24 to the
Racing Desk profile. Live announces each change itself, on screen and in a voice.

Nothing on the PC records which profile the pedals are using — not the database, not Live's settings file. The
controller holds it.

So a car's pedal settings are two things: **a profile** (curves, deadzones, a starting force), chosen in
SmartControl, and **a brake force**, adjusted from the seat with Live's keys. The second is in no file.

### Design as first written (superseded)

The first plan put the force back with the five keys already bound (65 kg is Page Up then Right Ctrl + Up three times),
and the profile with a Live key per profile (P3) or one profile of the app's behind one key (P4). The settled design is
P4 with a profile per car: the car's force is written into the car's own profile, so no force key is ever pressed, and
the one key is F24.

### A profile of its own for every car (decided 2026-09-28)

> "app should create new profiles based on them: light for touring and sports cars with abs, default for
> formula and cars without abs"

So the desk no longer asks which of the six a car uses. Every car gets a profile of its own, made by the app
from one of two of his:

| The car | Its profile starts as a copy of |
|---|---|
| Touring or sports car **with ABS** | `LightBrake` — 45 kg, linear, 4 % deadzone |
| Formula car, prototype, or any car **without ABS** | `Default` — 80 kg, linear, 5 % deadzone |

- **Whether a car has ABS** is in his own telemetry. A car with ABS he can adjust publishes `dcABS`; one whose
  ABS cannot be adjusted shows it only when it works (`BrakeABSactive`). A car is taken to have none after three
  laps of neither, counted across runs — and is put right, profile and all, if its ABS is seen later. A car
  never driven has no answer, and until it has one has no profile.
- **Whether a car is a formula car** is whether any session in it ran in the category `Formula`. A test session
  is `Road` whatever the car, so a formula car only ever tested is not known to be one — which changes nothing
  while no formula car has ABS.
- **"A proto with abs gets default"** (his answer, 2026-09-29). The sim cannot say which car is a prototype:
  it races as `SportsCar`, its class has no name in a test session and the car's own in others. Of the 24 cars
  he has driven that publish `dcABS`, the five prototypes (Porsche 963, Cadillac V-Series.R, Ferrari 499P, Aston
  Martin Valkyrie, Audi R18) are the only ones that publish a hybrid system (`EnergyERSBattery`), brake
  migration (`dcBrakeMisc`) or a front anti-roll bar set from the seat (`dcAntiRollFront`), so as built that is
  how a prototype is known. A car given `LightBrake` for its ABS and later seen to be a prototype is put right.
- **That is a stand-in, by his word**: "don't rely only on sim based data" and "just build a canonical list,
  because i don't think we can reliably do databased detection". The list is `packages/car-list/cars.json` —
  every car's kind, its ABS, and every control it gives the driver — written by hand and checked against his
  telemetry for the cars he has driven. **The rule reads it** (`CarPedalsKeeper.Keep`, given a `CarList`, by
  default the one the build carries): a car is a formula car when the list says its kind is `formula`, a prototype
  when it says `prototype`, and has ABS when it says `abs` is `fixed` or `adjustable`. That answers at the end of
  the car's first run — no laps to wait for, nothing the car published — when what the list says is enough for
  the profile: both the kind and the ABS, or a formula car, or no ABS (each starts from `Default` whatever else is
  so). What the car publishes is the check on the list, and the answer for a car the list has not met and for
  whatever an entry leaves out: an entry that says the kind and not the ABS waits for the laps to say the ABS, and
  one that says the ABS and not the kind has what the car showed for its kind. Everything above stands as it was
  for those. The log line says which ("from the list", or "from the list and what the car showed").
- **A profile the rule gave, and the list contradicts, is given again once.** The list may be put right in a later
  build, or the data may have given the profile before the list had the car. The rule's reason kept is compared
  with the one the list gives now; if they differ the profile is made again from the base the list sends it to
  and the log line says why ("the list says it has no ABS, so its profile is from Default now, not LightBrake").
  If that base is the profile it already has, only the reason kept is put right and the profile is left as it was.
  A profile he gave, or his choice that a car has none, is not touched. A car the list says has no ABS that
  published an ABS setting, or whose ABS was seen working, is given `Default` all the same, and the line where the
  rule acts says the two disagree ("the car published an ABS setting or its ABS was seen working, though the list
  says it has none, and the rule goes by the list"). It says what was seen and not that the car has ABS: the
  prototypes of the list have none, and publish `dcABS` for the brake migration it carries.
- **What the rule writes is written only if he has not chosen since it looked.** The rule reads the car's pedals,
  then SmartControl's database, then writes, and on the desk he may pick a profile, or that the car has none, in
  between (the desk has its own connection to the store). The store makes the write conditional in the write
  itself: a first profile only where the car has none and he has not chosen (`GiveCarPedalsByRule`); a profile
  given again only while it is still the one the rule read, by when it was bound, and the rule is still down as
  having given it (`RegiveCarPedalsByRule`); the reason put right likewise (`NoteRuleReason`). If he has chosen, the
  rule writes nothing and says nothing.
- **Where the answer came from is in the log line only** ("from Default (no ABS, from the list)").
- **The Cars page's "No profile yet" sentences read the list** as the rule does (`CarPedals.tsx`, from the list
  the page has for its Controls panel): a listed car is not said to wait on laps, and a GTP — whose `dcABS` is its
  brake migration — is not said to have ABS.
- **Who gave a car its profile is kept** (`car_pedal_facts`: the rule and what it went by, or he himself), and
  the data API says it (`given_by`, `given_why`). A profile he gave on the desk, or chose not to have, is never
  the rule's to change.
- **What the rule gives is the car's base**, under the base's own name. The car's own profile in SmartControl — a copy
  of that base under the car's name, at the car's force — is what the settled design makes from it (`car_smartcontrol`).

### What the first night taught (2026-09-28)

He drove the Honda Civic Type R TCR, set the brakes and found nothing saved. The view had been (height 0.02,
horizon 0.05, seat −0.04). The pedals had not: nothing followed them yet, and what he changed went through
Live's keys into the controller — SmartControl's database was untouched, and Live writes nothing when a key is
pressed. He then said **yes to noticing the keys** ("Yes watch the hot keys") and gave the force ("It was 45"),
which is his `LightBrake`, and what his rule gives a touring car with ABS.

Built that night, the half of P2 that writes nothing of anyone else's: the host follows the force from Live's
keys while the sim sends, and when the sim goes keeps it for the car, giving a car with no pedals of its own a
profile by his rule. Restoring is the half that is left.

A force set by key is kept whatever else is not known — the car's ABS, SmartControl's profiles — because it is
the car's with or without a profile. That was the first night's complaint, and the first version of this
repeated it for any car it could not yet give a profile.

What is followed is not trusted further than it can be:
- **A step key held until Windows repeats it leaves the force not known**, until a key sets one. Whether Live
  steps again on a repeat is not known, and a number that may be wrong is not kept.
- **A key pressed while SmartControl Live is not running is not counted.** It did nothing to the pedals.
- **What is pressed while the sim is not sending is not seen**, and after a minute of that the force is not
  known either: the pedals may have been set meanwhile.
- **Where Live stops is not known** (E8). Past Live's limit a step is counted here that Live did not take.
- **Not known: whether Live acts on Page Up with Ctrl, Shift or Alt held.** Here it counts.

### Slices

| | Does | Writes |
|---|---|---|
| P1 | **Done.** Reads SmartControl's profiles; binds car to profile; the desk shows each car's | nothing |
| P2a | **Done.** Brake force per car, followed by noticing Live's keys, saved when the sim goes; a base by his rule for a car that has none | the app's own store |
| P2 | Dropped: no force key is pressed; the force is in the car's profile | — |
| P3 | Dropped: one key, not one per profile | — |
| P4 | **Built, in trial.** A profile per car, copied into the Racing Desk profile at car load and switched with F24 when parked | rows of SmartControl's database it made; F24 — first-run buttons only |

### Where it runs

In the host: it has the SDK's car and the session's start and end, and the store (`RestoreDirector`, with the writers in
`RacingDesk.Data/Restore` and `Pedals`, and `KeySender` in the host). Key presses and file writes are not "hardware" in the
sense of `--no-hardware`, which stays what it is — the Moza serial port and friends. The pedal code in `RacingDesk.Core`
(`PedalProfileManager`) is the SimHub plugin's, keyed on display names and a Pit House folder this rig doesn't have; R5
found it with nothing bound, and it plays no part in this.

## Experiments

Each needs Kevin at the rig for a few minutes; the app only reads files before and after. Each is now a step of the first
run, with a button that does Racing Desk's half.

| | Question | Settled by |
|---|---|---|
| E1 | Does an `app.ini` edit made with the iRacing UI open survive a sim launch? | B1; on the rig `app.ini` already holds S, so B1 changes no value and B5 (two centimetres lower) is the test |
| E2 | How much is one press of height up, and of horizon up? | not needed: no key is pressed (steps are 0.005 m in his files) |
| E3 | Is the horizon key `DrivingVanishY`? | B6 (and his `app.ini` comment says so) |
| E4 | Is `car.cam` applied when `camera.ini` has `LastCarSet=` empty? | B4 |
| E5 | Does cockpit z add to `driverHeightAdj` one for one? | B5 |
| E6 | Will iRacing take a `car.cam` for a car that never had one? | B8 (he saves it in the sim; Racing Desk writes into it after) |
| E7 | Does Live act on a key press sent by another program? | A4, and B2 with iRacing in front |
| E8 | Do +5 and −5 stop at a limit, and at which? | open; the profile editor keeps forces within the vendor's range |
| E9 | Does Live read the database when a profile is activated, or once at start? | A5, A6 |
| E10 | Can the database be written while SmartControl and Live are open? | A7 (the editor); Live is open from A3 on |

## Open

- ~~After a car is given another profile on the desk, which force is the car's?~~ **The last one a key set**
  (2026-09-29): "I will only adjust with keys, you save last adjustment automatically".
- ~~Monitor or VR?~~ **Monitor** (2026-09-28). The horizon applies, and height is the one in `app.ini`.
- ~~A car with ABS that is neither a touring nor a sports car: which base does it start from?~~ **`Default`**
  (2026-09-29): "A proto with abs gets default".
- ~~What height up and down and horizon up and down are bound to?~~ Not needed: no key is pressed for the view.
- ~~A HUD line for every automatic change, or only when something could not be done?~~ **Every one, once**, on the rig's
  HUD only and never while OBS records.
- Page Up, Page Down and Pause reach iRacing as well as Live when pressed. They do already, from the keyboard;
  worth a look at what, if anything, they are bound to in the sim. F24 is bound to nothing in the sim, OBS, Stream Deck
  or SimHub (R6); B3 looks for anything it does in the sim.
- ~~Noticing five keys means the host listens to the keyboard while the sim runs.~~ **Yes** (2026-09-28): those
  keys, only while the sim runs, keeping only the force.
- **When to do the first run** (about 40 minutes, the editor and Live closed for a few of them): his call.
