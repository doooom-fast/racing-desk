# Per-car view and pedal profiles — plan

> **Status, 2026-09-29.** Built: the view is recorded per car when the sim closes (V1); SmartControl's profiles are
> read and a car can be tied to one on the desk (P1); the brake force is followed from SmartControl Live's keys
> and kept per car, and a car with no profile is given one by his rule (P2a). **Not built: putting anything
> back** — a view, a force or a profile — which is every slice that writes a file of iRacing's or SmartControl's,
> or presses a key. Nor the line on the HUD for each automatic action: what the app does is in `host.log` and on
> the desk, and nowhere he would see it from the car. Facts are in
> [`height-and-pedals-findings.md`](height-and-pedals-findings.md); this is what to do with them.
>
> **Decided by Kevin, 2026-09-28:** the view is *height, seat and horizon*; pedals are *per car*; the app *creates
> and restores the whole profile*; SmartControl Live *is kept running*; and the whole thing is *transparent* —
> SmartControl and iRacing are where a value is set, The Racing Desk remembers it per car and puts it back.

## Rules for both

- The sim, and SmartControl, are where values are set. The app has no editor for either.
- Nothing is written to iRacing's files while the sim runs. Nothing is ever written to the pedals directly.
- Every file the app changes is copied aside first, and every automatic action is logged and shown on the HUD
  once, in a line ("View: Lotus 79 — height −3"). Silent is not the same as invisible.
- A car with nothing saved is left exactly as it is.

## 1. The view: height, seat, horizon

### What each one is

| | Where iRacing keeps it | Per car today? | How it is set |
|---|---|---|---|
| Height | `driverHeightAdj`, `[View]`, `app.ini` | No — global | in-car keys |
| Horizon | `DrivingVanishY`, same section (to confirm: E3) | No — global | in-car keys |
| Seat, fore and aft | cockpit x in `cameras\cars\<car>\car.cam` | Yes, but only through the camera tool | camera tool |

The sim reads `app.ini` when it starts and rewrites it when it exits, and nothing in the SDK sets any of the three.
So saving is easy and restoring is the whole problem: by the time the app knows which car it is, the sim has
already read the file.

### Design

The store gets a **view per car**: height, horizon, seat. It is saved when the sim exits — only what changed
during the session, against the car that session was in, so a value left over from the previous car is never
recorded as this one's.

Restoring, in the order it will be built, each step gated by an experiment:

1. **Before launch.** While the sim is closed, `app.ini` holds the view of the car driven last. Right whenever
   the next session is in the same car, which is most of them.
2. **On a change of car.** When the SDK names a different car, the app presses the sim's own height and
   horizon keys the number of times it takes to get from what `app.ini` held to that car's view. It needs the
   step size (E2), the bindings, and the sim in focus — which, getting into a car, it is.
3. **Seat.** Written into the car's `car.cam` while the sim is closed, so iRacing applies it itself. The file is
   binary and undocumented (E4–E6). Until then the seat is saved and shown, and restoring it stays with iRacing's
   own `car.cam`.

If pressing keys proves unreliable, height goes the way of the seat: folded into `car.cam`'s z.

### Slices

| | Does | Writes |
|---|---|---|
| V1 | Records the three per car at sim exit; the desk shows them | nothing |
| V2 | Puts the last car's view into `app.ini` while the sim is closed | `app.ini`, sim closed |
| V3 | Nudges height and horizon on a change of car | key presses, in the car |
| V4 | Seat through `car.cam` | `car.cam`, sim closed |

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
**Right Ctrl + Up** +5 kg, **Right Ctrl + Down** −5 kg. No key switches profile. Live announces each change
itself, on screen and in a voice.

Nothing on the PC records which profile the pedals are using — not the database, not Live's settings file. The
controller holds it.

So a car's pedal settings are two things: **a profile** (curves, deadzones, a starting force), chosen in
SmartControl, and **a brake force**, adjusted from the seat with Live's keys. The second is in no file.

### Design

- **Brake force, through the keys already bound.** Any force in 5 kg steps can be reached with them: 65 kg is
  Page Up, then Right Ctrl + Up three times. When the SDK names the car, the app presses them. From then on it
  knows the force, and keeps knowing it by noticing those five keys — and no others — when they are pressed.
  At the end of the session the force it arrived at is the car's. Nothing is written to SmartControl's files,
  and Live says each change aloud, as it does now.
- **The profile.** The desk binds a car to one of the six by name (P1). Restoring it needs a Live key that
  applies a profile, which has to be bound once in SmartControl — one per profile (P3), or one in all if the app
  keeps a profile of its own in SmartControl's database and copies the car's saved one into it (P4). The copy is
  what SmartControl itself wrote, byte for byte, so its hash stands.
- **Create.** A car driven with nothing saved gets, at the end of that session, the force the app arrived at
  and the profile the desk was told. The desk asks which profile once per car, by name, and not in the car.
- **A car with nothing saved** keeps whatever the pedals have, and the HUD says so.

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
  telemetry for the cars he has driven. Once it is in, the rule reads a car's kind and ABS from it; what the
  car publishes is the check on the list, and the answer only for a car the list has not met.
- **Who gave a car its profile is kept** (`car_pedal_facts`: the rule and what it went by, or he himself), and
  the data API says it (`given_by`, `given_why`). A profile he gave on the desk, or chose not to have, is never
  the rule's to change.
- **As built, the car's profile is the base's, kept as it was** — under the base's own name, not yet a copy with
  the car's. What he changes in SmartControl afterwards changes the base for every car that starts from it; the
  desk shows that the profile has changed since the car was given it. A profile per car *in SmartControl* is a
  write to its database, and waits with the rest.
- **What this changes in the slices.** P1's binding by name becomes the base a car was given. P3 (a Live key per
  profile) no longer fits — there would be a key per car — so the way to restore is P4: one profile in
  SmartControl that is the app's, holding the current car's, behind one key. That is a write to SmartControl's
  database, and it waits on E9, E10 and his go-ahead like every other write.
- **A profile made in SmartControl by the app would not be byte for byte SmartControl's**: it is a copy of one
  that was, under another name. Whether SmartControl takes a row whose name changed and whose hash did not is
  part of E10.

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

One look at the rig settles most of it: press each of the five keys once with Live speaking, and compare what it
says with `host.log`.

### Slices

| | Does | Writes |
|---|---|---|
| P1 | Reads SmartControl's profiles; binds car to profile; the desk shows each car's | nothing |
| P2a | **Done.** Brake force per car, followed by noticing Live's keys, saved when the sim goes; a profile by his rule for a car that has none | the app's own store |
| P2 | Brake force per car: restored with Live's keys | key presses |
| P3 | The profile per car, with a Live key per profile | key presses |
| P4 | The managed profile: a snapshot per car, one key | one row in SmartControl's database |

### Where it runs

In the host: it has the SDK's car and the session's start and end, and the store. Key presses and file writes are
not "hardware" in the sense of `--no-hardware`, which stays what it is — the Moza serial port and friends.
The pedal code already in `RacingDesk.Core` (`PedalProfileManager`) keys on the car's display name, pushes nothing
when it falls back to the global profile, and imports from a Pit House folder this rig doesn't have; it is
reworked to key on `CarPath` and to carry a vendor's profile verbatim.

## Experiments

Each needs Kevin at the rig for a few minutes; the app only reads files before and after.

| | Question | How |
|---|---|---|
| E1 | Does an `app.ini` edit made with the iRacing UI open survive a sim launch? | edit, launch, exit, read |
| E2 | How much is one press of height up, and of horizon up? | press five times, exit, read |
| E3 | Is the horizon key `DrivingVanishY`? | same run as E2 |
| E4 | Is `car.cam` applied when `camera.ini` has `LastCarSet=` empty? | a car that has one, look |
| E5 | Does cockpit z add to `driverHeightAdj` one for one? | one car, both set |
| E6 | Will iRacing take a `car.cam` for a car that never had one? | copy one across, look |
| E7 | Does Live act on a key press sent by another program? | send Page Up; Live says "50" or doesn't |
| E8 | Do +5 and −5 stop at a limit, and at which? | press past 80 and below 30, listen |
| E9 | Does Live read the database when a profile is activated, or once at start? | change a row, activate |
| E10 | Can the database be written while SmartControl and Live are open? | try on a copy of a profile |

E7 decides the most: if Live ignores keys it didn't get from the keyboard, P2 to P4 fall back to asking the
pedals directly, which is a later and more careful piece of work.

## Open

- ~~After a car is given another profile on the desk, which force is the car's?~~ **The last one a key set**
  (2026-09-29): "I will only adjust with keys, you save last adjustment automatically". No editor, nothing to
  confirm; the force it was last driven with stays the car's whatever profile it is given.
- ~~Monitor or VR?~~ **Monitor** (2026-09-28). The horizon applies, and height is the one in `app.ini`.
- ~~A car with ABS that is neither a touring nor a sports car: which base does it start from?~~ **`Default`**
  (2026-09-29): "A proto with abs gets default".
- What height up and down and horizon up and down are bound to — or whether the app should read that from the
  control profile.
- A HUD line for every automatic change, or only when something could not be done?
- Page Up, Page Down and Pause reach iRacing as well as Live when pressed. They do already, from the keyboard;
  worth a look at what, if anything, they are bound to in the sim.
- ~~Noticing five keys means the host listens to the keyboard while the sim runs.~~ **Yes** (2026-09-28): those
  keys, only while the sim runs, keeping only the force.
