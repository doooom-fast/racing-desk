# Per-car view and pedal profiles — plan

> **Status:** plan, 2026-09-28. Nothing built. Facts are in
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
| Formula car, or any car **without ABS** | `Default` — 80 kg, linear, 5 % deadzone |

- **Whether a car has ABS** is in his own telemetry: a car that has it publishes `dcABS`, and one that does not
  has no such variable. The per-car record of controls (`docs/car-controls-findings.md`) holds it; a car never
  driven has no answer until the first session in it, and until then has no profile.
- **Whether a car is a formula car** is the category its sessions ran in, which the store has per session. A car
  with ABS that is neither touring nor sports (a prototype with ABS, say) is not covered by the rule as he gave
  it: it takes `Default` until he says otherwise, and the Cars page shows which base a car was given and why.
- **The copy is the car's from then on.** What he changes in SmartControl while in that car — curve, deadzone,
  force — is saved to the car's profile, not to the base. The base is only where a car starts.
- **What this changes in the slices.** P1's binding by name becomes the base a car was given. P3 (a Live key per
  profile) no longer fits — there would be a key per car — so the way to restore is P4: one profile in
  SmartControl that is the app's, holding the current car's, behind one key. That is a write to SmartControl's
  database, and it waits on E9, E10 and his go-ahead like every other write.
- **A profile made by the app is not byte for byte SmartControl's**: it is a copy of one that was, under another
  name. Whether SmartControl takes a row whose name changed and whose hash did not is part of E10.

### Slices

| | Does | Writes |
|---|---|---|
| P1 | Reads SmartControl's profiles; binds car to profile; the desk shows each car's | nothing |
| P2 | Brake force per car: restored with Live's keys, followed by noticing them, saved at session end | key presses |
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

- ~~Monitor or VR?~~ **Monitor** (2026-09-28). The horizon applies, and height is the one in `app.ini`.
- A car with ABS that is neither a touring nor a sports car: which base does it start from? (`Default`, until
  he says.)
- What height up and down and horizon up and down are bound to — or whether the app should read that from the
  control profile.
- A HUD line for every automatic change, or only when something could not be done?
- Page Up, Page Down and Pause reach iRacing as well as Live when pressed. They do already, from the keyboard;
  worth a look at what, if anything, they are bound to in the sim.
- Noticing five keys means the host listens to the keyboard while the sim runs. It keeps nothing but the
  resulting force. Say if that is not wanted: the alternative is the force being restored but never learnt.
