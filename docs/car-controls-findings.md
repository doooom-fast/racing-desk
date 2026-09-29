# In-car controls, car by car — findings

> **Status, 2026-09-29.** Read: every `.ibt` on the rig. Decided by Kevin the same day, after the first results:
> *"don't rely only on sim based data … just build a canonical list, because i don't think we can reliably do
> databased detection."* So what a car has is written down by hand, in one list kept in source
> (`packages/car-list/cars.json`), and the telemetry is asked two things only: the value a control has now, and
> whether what the car publishes agrees with the list. §9 is why that is the right call; §11 is what was built.
>
> No customer id, driver name or setup name is in this document, in the evidence file or in anything the survey
> printed. The session YAML was read for the driver's own car, the weekend's options and `CarSetup`, and nothing else.

## 1. What was read

3,205 files in `Documents\iRacing\telemetry`, October 2025 to September 2026: 3,202 read, 3 cut short by a crash.
**55 cars**, 1,760 of the files from fixed-setup sessions. From each file: the header, the table of variables (name,
unit, the sim's one-line description), the session YAML, and one frame in every three seconds (557,000 frames). Then
a closer look, frame by frame, at a few files each of the cars that raised a question.

The whole pass takes a minute and was run with the sim closed. What came out of it, per car, is kept outside the
repository as evidence for whoever writes the list (`evidence.json`, 1 MB; the scripts beside it). Nothing of it is
bundled: the list is written by hand.

## 2. What the sim says about a car's controls

Three places, and none of them is whole.

**The telemetry variables.** A car publishes `dc…` variables for its in-car adjustments ("driver controls"), `dp…` for
pit requests, and status variables such as `DRS_Status`. Each carries the sim's description: `dcABS` is "In car abs
adjustment" in every car that has it. A variable a car does not publish is absent from the file's header and from
the live SDK, so *published* can be asked of any car. It is the best single sign, and §3 is the list of ways it misleads.

**`CarSetup` in the session YAML.** The garage's values, under the garage's own headings, as text:

```
CarSetup:
 UpdateCount: 2
 Chassis:
  InCarAdjustments:
   BrakePressureBias: 54.0%
   AbsSetting: 4 (ABS)
   TcSetting: 4 (TC1 & TC2)
```

This is the only place the sim writes a label down. A value like `4 (ABS)` carries the dash's tag for the dial in
brackets; a mode is a word (`AbsTcEscSetting: Track`). It is the setup as the garage has it: a dial turned in the
car does not change it, and it names only the position the setup holds, never the others. Headings differ from car
to car (`InCarDials`, `InCarAdjustments`, `BrakesInCarMisc`, `BrakesDriveUnit > BrakeSpec`, `PuSpecInCar`…) and so do
the names of the entries.

**Whether the setup is fixed.** `WeekendInfo: WeekendOptions: IsFixedSetup: 1`, and with it
`DriverInfo: DriverSetupLoadTypeName: fixed` (the others seen: `user`, `baseline`, `iracing`, `invalid`). The two
agree in every file but 11, where the setup had not loaded (`invalid`).

**Nowhere:** the range of a dial, the names of its positions, which value is off, or which dials a fixed setup locks.

## 3. ABS, traction control, brake bias: NONE, OFF or a value

### ABS

| What the car does | Cars | What is true |
|---|---|---|
| Publishes `dcABS`, the garage has an `Abs…` entry, the ABS is seen working (`BrakeABSactive`) | 17 | Adjustable ABS. The number is the garage's number (`AbsSetting: 4 (ABS)` ↔ 4) |
| Publishes no `dcABS`, the ABS is seen working | `mx5 mx52016` (525 of 667 files), `bmwm2csr` (55 of 64) | It has ABS and no dial for it |
| Publishes no `dcABS`, the ABS never works | 29 | No ABS |
| Publishes `dcABS`, **the ABS never works**, the garage has no `Abs…` entry | `porsche963gtp`, `cadillacvseriesrgtp`, `ferrari499p`, `amvalkyriegtp`, `audir18` | **No ABS.** The variable is something else (below) |
| Publishes `dcABS`, one dial for ABS, TC and stability together | `mclaren570sgt4`, `porsche718gt4` | A mode (§4) |

- **`dcABS` is not always ABS.** In the Porsche 963, the Cadillac and the Valkyrie it is the **brake-migration** dial:
  on getting in it reads what `BrakeBiasMigration` says in the garage (−2 ↔ `-2`, −3 ↔ `-3`, −5 ↔ `-5`; 43 of 47 files
  for the 963, 30 of 33 for the Cadillac), it goes negative, and `BrakeABSactive` was false in every one of 15,000
  samples looked at closely. In the Audi R18 it reads what `IntelBrakeSys_IbsMode: 10 (IBS)` says. In the Ferrari 499P
  it is a dial from 1 to 6 that agrees with nothing in the garage that can be told apart from chance. The
  description in the header is "In car abs adjustment" all the same.
- **OFF.** A value of 0 was seen in `audirs3lms` (garage: `0 (ABS)`), `bmwm2g87`, `porsche9922cup` and
  `porsche992rgt3`. Nothing the sim publishes says that 0 is off; in the 570S 0 is `Track`. That 0 means off is
  Kevin's rule, and the list may say otherwise per car (`off`, `positions`).
- **Working** is `BrakeABSactive`, true while the ABS is cutting brake pressure. It is published by every car, with
  or without ABS.

### Traction control

`dcTractionControl` is published by 29 cars, `dcTractionControl2` by 11, a third and fourth by the Audi R18 alone.
There is **no variable that says the traction control is working** (iRacing has no counterpart to `BrakeABSactive`),
so a car with traction control and no dial cannot be told from a car with none.

- The tag says what the dial is, and it is rarely plain "TC": `TCS` (Acura), `TC-LAT` (992 GT3 R), `TC1 & TC2`
  (720S, since a 2026 build; `TC` before), `TC1+TC2` (296 GT3), `MAP` (both Ford GTs), `TC1` / `TC2` (296 Challenge,
  P217, 499P), `TC-CON` / `TCR` (911 RSR), `TC` / `SLIP` (M8 GTE), `TCLO` / `TCLA` (963, Valkyrie), `TC A` / `TC B`
  (Cadillac).
- **Which of two dials is which differs by car.** In the 963, Cadillac, Valkyrie and 499P `dcTractionControl` is
  **slip** and `dcTractionControl2` **gain**; in the Dallara P217 it is the other way round.
- **`dcTractionControlToggle` says nothing.** It reads 0 in 21 of the 22 cars that publish it, through sessions in
  which the traction control was set to 4 and working, and 1 in the Ford GT (GT2) throughout. He has never been
  seen to use it, so what it would read with the system switched off is not on this disk.
- **OFF.** 0 was seen in `porsche9922cup` (garage: `0 (TC)`), `porsche992rgt3`, `ligierjsp320`, `bmwm2csr`,
  `bmwm2g87`. As with ABS, the sim does not say that 0 is off.
- `superformulasf23 honda` publishes `dcTractionControl` (2 to 6) and its garage has no traction-control entry at
  all. What that dial is cannot be told from the telemetry.

### Brake bias

`dcBrakeBias` is published by 53 of the 55 (not the MX-5 Cup, not the Caterham Academy). **Published does not mean
adjustable.**

| What the car does | Cars | What is true |
|---|---|---|
| Garage has `BrakePressureBias` (or `BrakeBias`, `FrontBrakeBias`), the dial moves, the number is the garage's | 40 | Adjustable, a percentage to the front |
| Published, one value in every file, no garage entry | `mclaren570sgt4` (49), `bmwm2csr`, `bmwm2g87`, `caterham caterham420r`, `ferrari296challenge`, `dirtmicrosprint winged outlaw` (50) | Not adjustable from the seat. The number is a placeholder |
| Published, reads 0 | `hpdarx01c`, `protrucks pro2lite`, `stockcars2 arcaford25` | The garage has a bias; the variable does not carry it. One file to three each |
| Published, not a percentage | `mclarenmp430` (−3 to 2.5) | An offset from `BaseBrakeBias`; the garage's total is `TotalPeakBrakeBalance` |
| Not published | `mx5 mx52016`, `caterham caterhamacademy` | None |

The number is the garage's to the precision the garage prints: `dcBrakeBias` 53.095 is `53.1%`.

## 4. Cars whose dial is a mode

| Car | Variable | Garage entry | What was seen |
|---|---|---|---|
| `mclaren570sgt4` | `dcABS` | `InCarDials > AbsTcEscSetting` | 0 `Track` (362 files), 1 `Sport` (11), 2 `Normal` (2). One dial for ABS, traction and stability control; no `dcTractionControl` |
| `bmwm2csr` | `dcTractionControl` | `InCarDials > DscSetting` | 1 `MDM` (16), 2 `On` (44), 0 seen once in the car and never in a setup, so never named. ABS has no dial |
| `bmwm2g87` | `dcTractionControl`, `dcABS` | `TcSetting: 3 (TC)`, `DscSetting: MDM`, `ThrottleSetting: Sport+` | TC 0 to 3; `dcABS` 0 or 1. Every one of his 19 files has the same setup, so which variable the DSC mode rides on cannot be told |
| `bmwm4evogt4` | `dcTractionControl` | `TcSetting: 4 (TC)` and `DscSetting: TC / MDM / On` | The dial follows `TcSetting`. `DscSetting` has no variable of its own that could be found |
| `porsche718gt4` | `dcABS`, `dcTractionControl`, `dcTractionControl2` | `AbsTcEscSetting: 5`, `TractionControl: On`, `StabilityControl: Off` | `dcABS` 1 to 11 is the combined dial; the other two read 0 or 1 and are the two switches, but which is which, and which way round, did not come out the same in two files |
| `porsche9922cup` | none | `InCarDials > TcMode: Dry / Wet` | A mode with no variable: the garage's word is all there is |
| `mercedesw13` | `dcMGUKDeployMode` | `PowerUnitConfig > MguKDeployMode` | 2 `Balanced`, 0 `Qual`; 3 seen, never named |
| `mclarenmp430` | `dcMGUKDeployMode` | `MguKDeployMode: Race` | Reads 25, 50, 75: a target charge, not a position |
| `audir18` | `dcMGUKDeployMode` | `HysDeployMode: Automatic` | One file |

**Where a mode's name can be read:** in `CarSetup`, and only for the position the setup was saved in. The 570S's
three names are known because he has saved setups in all three. A position he has only ever reached from the
seat has no name anywhere on this machine.

## 5. GTP and LMH: brake migration, TC slip and the rest

Four cars driven: `porsche963gtp` (49 files), `cadillacvseriesrgtp` (33), `ferrari499p` (8), `amvalkyriegtp` (3).
None has ABS.

| Control | 963 | Cadillac | Valkyrie | 499P |
|---|---|---|---|---|
| Brake bias | `dcBrakeBias` = `BrakePressureBias: 48.00%` | the same | the same | the same |
| Brake migration | `dcABS` = `BrakeBiasMigration` (−4…5) | `dcABS` = `BrakeBiasMigration` (−5…5) | `dcABS` = `BrakeBiasMigration` (−4…0) | garage: `BiasMigration: 3`; variable not settled |
| Brake target | `dcBrakeMisc` = `BrakeBiasTarget` (−4…5) | `dcBrakeMisc` = `BrakeBiasTarget` (−5…5) | `dcBrakeMisc` (0…1), garage entry not seen | `dcBrakeMisc` = `BiasMigrationGain` (−1.75…−0.75) |
| TC slip | `dcTractionControl` = `TractionControlSlip: 5 (TCLO)` | … `(TC A)` | … `(TCLO)` | … `(TC1)` |
| TC gain | `dcTractionControl2` = `TractionControlGain: 4 (TCLA)` | … `(TC B)` | … `(TCLA)` | … `(TC2)` |
| Front bar | `dcAntiRollFront` = `Front > ArbAdj` (1…2) | `Front > ArbBlades` (1…4) | `Front > ArbSetting` (2…11) | `Front > ArbBlades` (1…3) |
| Rear bar | `dcAntiRollRear` = `Rear > ArbAdj` (11…16) | `Rear > ArbBlades` (2…5) | `Rear > ArbSetting` (5…11) | `Rear > ArbBlades` (1…3) |
| Deploy | — | — | — | `dcMGUKDeployMode` (3 in every file) |
| Also in the garage, no variable | — | `PowerSteeringAssist: 8 (EPAS)`, `ThrottleShape: 12` | — | `HybridRearDriveEnabled` |

Hybrid state is published by all four and by the two F1 cars and the R18: `EnergyERSBatteryPct`,
`EnergyMGU_KLapDeployPct`, `PowerMGU_K`, `TorqueMGU_K`.

In the 499P the dial `dcABS` and the dial `dcMGUKDeployMode` both read 3 in nearly every file and the garage's
`BiasMigration` is 3 in all eight, so the numbers cannot say which is the migration dial. Eight files are too few.

## 6. Anti-roll bars

| Car | Front | Rear |
|---|---|---|
| `porsche963gtp`, `cadillacvseriesrgtp`, `ferrari499p`, `amvalkyriegtp` | §5 | §5 |
| `dallarail15` | `dcAntiRollFront` 0…4 | `dcAntiRollRear` 0…1 |
| `dallarair01` | `dcAntiRollFront` 0…2 | `dcAntiRollRear` 1…3 |
| `lotus79` | `dcAntiRollFront` 0…3 | `dcAntiRollRear` 0…1 |
| `audi90gto` | — | `dcAntiRollRear` 6…10 = `Rear > ArbBlades` |
| `porschemissionr` | — | `dcAntiRollRear` = `Controls > RarbBlade` |

In the Indy NXT, the IR01 and the Lotus 79 the dial's number is **not** the garage's: the garage says
`ArbBlades: 3-5`, `ArbSize: Stiff`, `ArbArms: 3`, and the dial reads 2. The dial is a position; what the position is
called is not written anywhere. Both of the Indy NXT's bars were moved in 25 fixed-setup files.

The HUD already reads `dcAntiRollFront` and `dcAntiRollRear` for the pit box, and takes a bar to exist once its value
has been anything but 0 — which hides a bar that is at position 0, as the Indy NXT's rear is in 17 files.

## 7. DRS and push-to-pass

### DRS

`DRS_Status` is published by the two cars that have it, `mercedesw13` and `mclarenmp430`, and by no other. Its
description is "Drag Reduction System Status"; what the four values mean is from watching them:

| Value | Seen | Meaning |
|---|---|---|
| 0 | most of the lap | Nothing |
| 1 | from a fixed point on the lap (87.1% at The Bend) to the start of the zone | Detected: DRS will be there in the zone ahead |
| 2 | from the start of the zone (96.4%) | In the zone, and it may be opened |
| 3 | from the moment `dcDRSToggle` goes to 1 | Open. Back to 2 or 0 when he brakes or the zone ends |

`dcDRSToggle` is the button: 1 for the tenth of a second it is held. These were test sessions, where the detection
always succeeds; in a race 1 appears only when he is within a second of the car ahead, so **1 is the spotter's
signal** ("DRS next zone") and **2 the second** ("DRS — open"). Neither car has been raced on this rig.

### Push-to-pass

`P2P_Status`, `P2P_Count` and `PushToPass` are published by **all 55 cars**, so that they are there says nothing.
Two cars have the system:

| Car | Button | What was seen |
|---|---|---|
| `dallarail15` | `dcPushToPass` and `PushToPass`, together | `P2P_Count` 65 at the start of a race, down by one a second while `P2P_Status` is 1. Pressing in the first laps of the race did nothing: status stayed 0 |
| `superformulasf23 honda` | `PushToPass` only (no `dc…`) | `P2P_Count` 199 at the start of a race, 999 in practice (no limit). A press switches it on, another off |

So `P2P_Count` is **seconds left**, `P2P_Status` is **on**, and a car has the system when its count is above nought
— which in a car never raced may not have been seen. Two MX-5 files hold a few frames of garbage in these
variables (a count of two thousand million); any reader has to turn away a value no car could have.

## 8. Everything else a car may publish

Dials the HUD does not show, with the cars of his that publish them:

| Variable | The sim's description | Cars |
|---|---|---|
| `dcThrottleShape` | throttle shape | 17: most GT3s, both M2s, the 992.2 Cup, P217, P320, SF23, SR10, IR01, Indy NXT. Tags `MAP`, `PED`, `PEDAL`, `THR`, `TPS`, `ATH`; in the BMWs a word (`Dry`, `Sport+`, `Linear`) |
| `dcBrakeMisc` | brake misc | the four of §5; `mercedesw13` |
| `dcBrakeBiasFine` | brake bias fine | `mercedesw13` (`FineBrakeBias: 0.0 (BB+/BB-)`) |
| `dcPeakBrakeBias` | peak brake bias | `mercedesw13`, `mclarenmp430` (`PeakBrakeBiasOffset: 5 (BAL)`), `hondacivictyper` and `audirs3lms` (where it reads what `RearBrakeValve` says) |
| `dcDiffEntry`, `dcDiffMiddle`, `dcDiffExit`, `dcDiffPreload` | differential | `mercedesw13` (entry, middle, exit), `mclarenmp430` (entry, preload), `audirs3lms` (preload) |
| `dcEngineBraking` | engine braking | `mercedesw13` (`EB`) |
| `dcMGUKDeployMode`, `dcMGUKDeployFixed`, `dcMGUKRegenGain` | hybrid deployment | `mercedesw13`, `mclarenmp430`, `ferrari499p`, `audir18` |
| `dcFuelMixture` | fuel mixture | `bmwm8gte`, `porsche991rsr` (both `EngineMapSetting … (MAP)`) |
| `dcEnginePower` | engine power | `audir18`, `hpdarx01c`, `porschemissionr` (where it reads what `DriveBias` says) |
| `dcBoostLevel` | boost | `bmwm8gte` (`BOOST`), `radicalsr10` |
| `dcPowerSteering` | power steering | `dallarap217`, `acuransxevo22gt3` |
| `dcLaunchRPM` | launch rpm | `hondacivictyper`, `audirs3lms`, `fordfiestarswrc`, `subaruwrxsti` |
| `dcFuelCutPosition`, `dcTractionControl3`, `dcTractionControl4` | | `audir18` only |

Switches and buttons, which hold no setting: `dcPitSpeedLimiterToggle` (42 cars; the HUD reads it),
`dcStarter`, `dcHeadlightFlash`, `dcToggleWindshieldWipers`, `dcTriggerWindshieldWipers`, `dcTearOffVisor`,
`dcLowFuelAccept`, `dcDashPage`, `dcDashPage2`, and in the R18 `dcFCYToggle`, `dcHysBoostHold`, `dcInLapToggle`,
`dcFuelNoCutToggle`.

Not published by any car he has driven, though the HUD reads them: `dcWeightJackerLeft`, `dcWeightJackerRight`,
`dcWingFront`, `dcWingRear`. They belong to ovals and IndyCar.

In the garage and in no variable: the dash page, the pad compound, night LED colours, `TcMode` (992.2 Cup),
`DscSetting` (M4 GT4), `PowerSteeringAssist` and `ThrottleShape` (Cadillac), `RechargeMode` (W13),
`HybridRearDriveEnabled` (499P).

## 9. Why what a car has is written down, not detected

Each of these was met in his own files:

1. **A variable under another's name.** `dcABS` is brake migration in three GTP cars, the IBS mode in the R18.
   `dcEnginePower` is the fuel mixture in the R18 and the drive bias in the Mission R. `dcPeakBrakeBias` is the rear
   brake valve in the two TCR cars.
2. **Published, and not there.** `dcBrakeBias` in six cars whose bias cannot be changed. The push-to-pass
   variables in all 55.
3. **There, and not published.** The ABS of the MX-5 and the M2 CS. Any traction control without a dial. Modes that
   are only in the garage.
4. **A label for one position only.** The garage names the position the setup holds. 0 in the M2 CS has no name.
5. **Pairing by number fails where nothing varies.** Matching a dial to the garage entry with the same number
   works for a car driven with many setups (the 720S: `dcABS` = `AbsSetting` in 340 of 348 files) and gives
   nonsense for a car driven with one: the M2 G87's `dcABS` "is" its front bar, the Lotus 79's rear bar "is" its
   rear toe, the Acura's power steering "is" its rear bar blades. In §12's table these are marked †.
6. **A dial keeps what he did to it.** Turned in one stint, it starts the next where he left it while the garage
   entry still says what the setup says. One file in six disagrees for that reason alone.
7. **Names change with the sim's builds.** The 720S's tag went from `TC` to `TC1 & TC2`; the 992.2 Cup gained
   `dcTractionControlToggle`.
8. **Nothing says what is off, what the range is, or what a fixed setup locks.**
9. **A car he has not driven has no file.** He has driven 55; the sim has several times that.

What the telemetry is still good for, and is used for:

- **The live value**, and `BrakeABSactive` for the flash.
- **Whether the setup is fixed** (`IsFixedSetup`).
- **A check on the list.** A listed variable the car does not publish; an ABS dial published by a car listed as
  having none; ABS seen working in a car listed as having none. Said once per car in the host's log, so the list
  gets corrected. It is a check and not a detector: it never changes what the HUD shows.

## 10. Fixed setups

In 1,760 fixed-setup files he moved, from the seat:

| Dial | Files | Cars |
|---|---|---|
| `dcBrakeBias` | 630 | 25 |
| `dcABS` where it is brake migration | 31 | 963, Cadillac, 499P |
| `dcBrakeMisc` | 26 | 963, Cadillac |
| `dcAntiRollFront`, `dcAntiRollRear` | 25 each | Indy NXT |
| `dcPowerSteering` | 11 | P217 |

and **never** an ABS dial or a traction-control dial, in any car, though in open-setup sessions he moved the
720S's traction control in 50 files and the 992.2 Cup's ABS in 65. That is what a fixed setup locking ABS and
traction control looks like, and it is as far as the evidence goes: the sim does not publish which dials a fixed
setup locks. The reader takes ABS and traction control as fixed by a fixed setup and everything else as free,
unless the list says otherwise for a control (`lockedWhenFixed`).

So "ABS is off in a fixed setup" is: the session says `IsFixedSetup: 1`, the list says the car has ABS, and the
dial reads the value that is off. It shows OFF, and he cannot change it.

## 11. What was built

Branch `feature/car-controls`, 2026-09-29. The root `CLAUDE.md` (The car's controls) and `apps/overlay/CLAUDE.md`
(The controls panel) say how it works for whoever changes it; this is what came of each finding above.

**The list.** `packages/car-list/cars.json`, written by hand and carried inside `RacingDesk.Core`
(`RacingDesk.Core.Cars.cars.json`), read by `CarList` (`Find(path)` case-blind, unknown fields left, a wrong entry put
in `Problems` and the rest read). A car has `abs` and `tc` as `none`, `fixed` or `adjustable`, `brakeBias` as `none`
or `adjustable`, a `kind`, and `controls`: each an `id`, the telemetry `var` that carries it, the car's own `label`,
and where it has them an `off` value (or `"off": false`), a `range`, named `positions`, a `note`; optionally
`lockedWhenFixed`, `covers` and `decimals`. This branch does not contain the file: it is written apart from the
code, and until it is in the tree the build carries no list and every car is not known.

**What each finding became.**

| Finding | In the code |
|---|---|
| §3: `dcABS` is not always ABS; published does not mean adjustable | The list's `abs: none` reads NONE whatever `dcABS` says; `dcABS` is given to the control that is really on it (`brakeMigration`, `mode`). A control with no readable dial is not read at all |
| §3: ABS without a dial (MX-5, M2 CS) | `abs: fixed` → **ON** |
| §3: 0 as off | 0 is OFF for ABS and traction control, and for nothing else, unless the control says `off`, names a `positions` entry `off`, or says `"off": false` |
| §4: modes | A `mode` control with `positions` (`TRACK`, `SPORT`, `NORMAL`); it stands for the cells it `covers` (default: the ones the car lists no control of its own for). A dial that is a word without being a mode (the M2's `DSC`: OFF, MDM, ON) is an ordinary control with `positions` |
| §5: GTP brake migration, TC slip and gain | `brakeMigration`, `tc` and `tc2` controls with the car's labels (`MIG`, `TCLO`, `TCLA`); the second dial and the migration are in the row beneath the three |
| §6: anti-roll bars | `arbFront`, `arbRear` controls, in the same row, for the cars that have them |
| §7: DRS, push-to-pass | `drs` (`DRS_Status` 0 to 3) and `p2p` (`P2P_Status`, `P2P_Count`, 999 no limit, garbage refused) controls; they exist only where the list gives them, since every car publishes the variables |
| §9: why not detect | Nothing detects. The list is the answer; what the car publishes is the **check** |
| §10: fixed setups | `IsFixedSetup` decides `locked` for ABS and traction control (the rule), or as the control's `lockedWhenFixed` says |

**The host** (`RacingDesk.Core/Cars`). `CarControls.Read(car, variable, fixedSetup)` reads one car's controls;
`CarControlsFollower` follows the car the driver is in and never throws (a frame that goes wrong goes out without
the key). Where the car and its setup come from: the host's own reader (`IRacingTelemetrySource.CarPath` and
`FixedSetup`, from the session YAML) or, under SimHub, the SDK bridge (`PlayerCarPath`, `IsFixedSetup`).
`TelemetryCapture` puts the result in the snapshot and `TelemetryFrame` and the `:8889` writer put it on the wire as
`RacingDesk.Plugin.CarControls`, **only** for a car the list has and never in the demo. `GET
/racing-desk/data/controls[?car=]` serves the list with what the check has said.

**The check** (`CarListCheck`). Once per car for each thing, after his first second in the car: the car is not in
the list; the list disagrees with itself (no ABS but a control called `abs`; adjustable with nothing to read it
from); a listed variable the car does not publish; a dial the car publishes that no control has; `dcABS` published
or ABS seen working in a car listed without ABS; a bias that moves in a car listed without one; a value outside the
`range`, or a position with no name. It only says. What the HUD shows is the list's until somebody corrects it.

**The HUD** (`car-controls.js`, `leaderboard.css`, `spotter.js`, `poll-engine.js`). The three cells read NONE, ON,
OFF, a number or a name, under the car's label; NONE is a cell no wider than the word; a mode is a cell of its
own; a small lock says the fixed setup holds a control; the row beneath carries the rest, DRS lit when it can be
opened and while it is open, push-to-pass with its seconds. The spotter says the car's word (`TCLO ▲ 6`, `ESC ▼
SPORT`), `DRS next zone`, `DRS — open it`, `DRS open`, and when push-to-pass goes on, off or runs out. A name fills no
bar. The old computing is still in place for a car the host sends nothing for, which shows as it did; the old table
in `config.js` is what it goes by, so the table stays.

**Tests.** The HUD: 38 in `tests/unit/car-controls.spec.mjs`, the module's functions in Node and the real
`dashboard.html` fed a payload for each case, with the cars read from `tests/unit/fixtures/car-controls-wire.json`.
The host: `Cars/CarListTests.cs` (the loader, NONE, ON, OFF, values, modes, DRS, push-to-pass, the follower, the
check once per car, the served list), `Cars/CarControlsWireTests.cs` (the HUD's fixture is what the host writes; the
list this build carries agrees with itself), and `Cars/CarControlsOnTheRigTests.cs` (the same read from the rig's
own recordings of the 570S, the MX-5 and the 963, skipped where there is none). The one hop no test covers is
`:8889` itself: the runtime writes the snapshot's JSON into the payload as an object, and the only way to run it is
to start a runtime, which binds wildcard ports.

**Not built.** The desk does not show the list or the check. The pedals' rule (`CarPedalsKeeper`) still works out a
car's kind and ABS from what it publishes, not from the list. Nothing is remembered per car. What a fixed setup locks
is the rule of §10 and no more. No car outside the list gets anything: a car the list has not met is shown as it was.

## 12. The cars, one by one

How to read it: **Files** is files read, with those under a fixed setup in brackets. A dial is given by its variable
without the `dc`, the range of values seen, and the garage entry whose number it had on getting in, with the dash's
tag in quotes. **†** marks a pairing made by number alone, which may be chance (§9.5) and in several rows certainly
is. **= ?** is two entries that could not be told apart. "Working in *n*" is files in which the ABS was seen cutting
brake pressure. Ranges are what he has used, not what the car allows.

| Car | Files (fixed) | ABS | Traction control | Brake bias | Other dials | Status |
|---|---|---|---|---|---|---|
| `acuransxevo22gt3` | 2 (0) | `ABS` 3…5 = `AbsSetting` “ABS”; working in 2 | `TractionControl` 3…6 = `TcSetting` “TCS” | `BrakeBias` 48.797…50.006 = `BrakePressureBias` | `PowerSteering` 3 = `ArbBlades` †<br>`ThrottleShape` 1 |  |
| `amvalkyriegtp` | 3 (0) | `ABS` -4…0 = `BrakeBiasMigration` †; **never working** — not ABS | `TractionControl` 6…8 = `TractionControlSlip` “TCLO”<br>`TractionControl2` 1…7 = `TractionControlGain` “TCLA” | `BrakeBias` 47…50.5 = `BrakePressureBias` | `AntiRollFront` 2…11 = `ArbSetting`<br>`AntiRollRear` 5…11 = `ArbSetting`<br>`BrakeMisc` 0…1 |  |
| `audi90gto` | 17 (5) | — | — | `BrakeBias` 47.506…55.272 = `BrakePressureBias` | `AntiRollRear` 6…10 = `ArbBlades` |  |
| `audir18` | 1 (0) | `ABS` 10 = `IntelBrakeSys_IbsMode` “IBS” †; **never working** — not ABS | `TractionControl` 6 = ?<br>`TractionControl2` 6 = `RearTractionControl` “TC1”<br>`TractionControl3` 1.6 = `RearTcLateralSlip`<br>`TractionControl4` 1.7 = `FrontTcLateralSlip` | `BrakeBias` 52.6 = `BrakePressureBias`; not moved yet | `EnginePower` 1 = `FuelMixture` “MIX” †<br>`FuelCutPosition` 0 = ?<br>`MGUKDeployFixed` 12 = `HysManualDeployTrim` “Mode”<br>`MGUKDeployMode` 1 = `HysDeployMode` (1 Automatic)<br>`MGUKRegenGain` 9 = `HysReGenGain` | hybrid |
| `audir8lmsevo2gt3` | 11 (9) | `ABS` 3…9 = `AbsSetting` “ABS”; working in 8 | `TractionControl` 2…9 = `TcSetting` “TC” | `BrakeBias` 58.998…62.112 = `BrakePressureBias` | `ThrottleShape` 3 = `ThrottleShapeSetting` “MAP” |  |
| `audirs3lms` | 7 (2) | `ABS` 0…1 = `AbsSetting` “ABS”; working in 6 | — | `BrakeBias` 66.853…70.343 = `BrakePressureBias` | `DiffPreload` 1 = `RearBrakeValve` †<br>`LaunchRPM` 3000 = `LaunchRpmLimit`<br>`PeakBrakeBias` 1…2 |  |
| `bmwm2csr` | 64 (24) | no dial; working in 55 | `TractionControl` 0…2 = `DscSetting` (2 On, 1 MDM) | published, always 50, no garage entry | `ThrottleShape` 0…1 = `ThrottleSetting` (0 Dry) |  |
| `bmwm2g87` | 19 (0) | `ABS` 0…1 = `ArbSetting` †; working in 9 | `TractionControl` 0…3 = `TcSetting` “TC” | published, always 50, no garage entry | `ThrottleShape` 0…2 = `ThrottleSetting` (2 Sport+) |  |
| `bmwm4evogt4` | 46 (15) | `ABS` 1…3; working in 37 | `TractionControl` 1…8 = `TcSetting` “TC” | `BrakeBias` 50…62 = `BrakePressureBias` |  |  |
| `bmwm4gt3` | 17 (4) | `ABS` 1…9 = `AbsSetting` “ABS”; working in 15 | `TractionControl` 2…9 = `TcSetting` “TC” | `BrakeBias` 48.25…53 = `BrakePressureBias` |  |  |
| `bmwm8gte` | 30 (0) | — | `TractionControl` 1…9 = `TractionControlSetting` “TC”<br>`TractionControl2` 3…10 = `TracControlSlipSetting` “SLIP” | `BrakeBias` 49.2…54.4 = `BrakePressureBias` | `BoostLevel` 1…5 = `BoostMapSetting` “BOOST”<br>`FuelMixture` 1…12 = `EngineMapSetting` “MAP”<br>`ThrottleShape` 1…12 = `ThrottleShapeSetting` “PEDAL” |  |
| `cadillacvseriesrgtp` | 33 (9) | `ABS` -5…5 = `BrakeBiasMigration` †; **never working** — not ABS | `TractionControl` 4…12 = `TractionControlSlip` “TC A”<br>`TractionControl2` 1…12 = `TractionControlGain` “TC B” | `BrakeBias` 48.5…60.75 = `BrakePressureBias` | `AntiRollFront` 1…4 = `ArbBlades`<br>`AntiRollRear` 2…5 = `ArbBlades`<br>`BrakeMisc` -5…5 = `BrakeBiasTarget` † | hybrid |
| `caterham caterham420r` | 57 (51) | — | — | published, always 50, no garage entry |  |  |
| `caterham caterhamacademy` | 2 (0) | — | — | — |  |  |
| `crosscartn11` | 5 (0) | — | — | `BrakeBias` 45 = `BrakePressureBias`; not moved yet |  |  |
| `dallaraf3` | 116 (70) | — | — | `BrakeBias` 45.721…60.142 = `BrakePressureBias` |  |  |
| `dallarail15` | 120 (105) | — | — | `BrakeBias` 48.258…57.235 = `BrakePressureBias` | `AntiRollFront` 0…4<br>`AntiRollRear` 0…1<br>`ThrottleShape` 3 = `ThrottleSetting` (3 Linear) | push-to-pass |
| `dallarair01` | 3 (0) | — | — | `BrakeBias` 47.5…53 = `BrakePressureBias` | `AntiRollFront` 0…2<br>`AntiRollRear` 1…3<br>`ThrottleShape` 3 = `ThrottleShaping` “PEDAL” |  |
| `dallarap217` | 119 (88) | — | `TractionControl` 1…8 = `TractionControlGain` “TC1”<br>`TractionControl2` 1…12 = `TractionControlSlip` “TC2” | `BrakeBias` 49.75…60 = `BrakePressureBias` | `PowerSteering` 2…5 = `PowerSteeringAssist`<br>`ThrottleShape` 1…11 = `ThrottleShape` |  |
| `dirtmicrosprint winged outlaw` | 1 (0) | — | — | published, always 50, no garage entry |  |  |
| `ferrari296challenge` | 6 (5) | `ABS` 2 = `AbsSetting` “ABS”; working in 4 | `TractionControl` 2 = ?<br>`TractionControl2` 2 = `Tc2Setting` “TC2” | published, always 50, no garage entry |  |  |
| `ferrari296gt3` | 2 (1) | `ABS` 4 = `AbsSetting` “ABS”; working in 2 | `TractionControl` 4 = `TcSetting` “TC1+TC2” | `BrakeBias` 49.113…51.122 = `BrakePressureBias`; not moved yet | `ThrottleShape` 1 = `ThrottleShapeSetting` “PED” |  |
| `ferrari499p` | 8 (5) | `ABS` 1…6; **never working** — not ABS | `TractionControl` 4…11 = `TractionControlSlip` “TC1”<br>`TractionControl2` 3…9 = `TractionControlGain` “TC2” | `BrakeBias` 55.75…63 = `BrakePressureBias` | `AntiRollFront` 1…3 = `ArbBlades`<br>`AntiRollRear` 1…3 = `ArbBlades`<br>`BrakeMisc` -1.75…-0.75 = `BiasMigrationGain` †<br>`MGUKDeployMode` 3 = `BiasMigration` † | hybrid |
| `fordfiestarswrc` | 6 (0) | — | — | `BrakeBias` 53.059 = `BrakePressureBias`; not moved yet | `LaunchRPM` 5500…6500 = `LaunchRpmLimit` |  |
| `fordgt` | 23 (0) | — | `TractionControl` 1…3 = `TractionControlSetting` “MAP” | `BrakeBias` 49.579…54.296 = `BrakePressureBias` |  |  |
| `fordgt gt3` | 2 (0) | `ABS` 3 = `AbsSetting`; working in 2 | `TractionControl` 2 = `TractionControlSetting` “MAP” | `BrakeBias` 57.958 = `BrakePressureBias`; not moved yet |  |  |
| `formulair04` | 220 (198) | — | — | `BrakeBias` 50.521…61.877 = `BrakePressureBias` |  |  |
| `hondacivictyper` | 44 (6) | `ABS` 1…9 = `AbsSetting` “ABS”; working in 38 | — | `BrakeBias` 48.5…65.75 = `BrakePressureBias` | `LaunchRPM` 7000 = `LaunchRpmLimit`<br>`PeakBrakeBias` 1…5 = `RearBrakeValve` † |  |
| `hpdarx01c` | 1 (0) | — | `TractionControl` 8 = `AccelControl_Tc1` “TC1”<br>`TractionControl2` 1 | published, always 0, no garage entry | `EnginePower` 8 |  |
| `lamborghinievogt3` | 7 (5) | `ABS` 2…4 = `AbsSetting` “ABS”; working in 4 | `TractionControl` 2…6 = `TcSetting` “TC” | `BrakeBias` 46.481…75.486; no garage entry found | `ThrottleShape` 1…3 = `ThrottleShapeSetting` “THR” |  |
| `ligierjsp320` | 85 (73) | — | `TractionControl` 0…7 = `TractionControl` “TC” | `BrakeBias` 47…60.911 = `BrakePressureBias` | `ThrottleShape` 1…5 = `ThrottleShape` |  |
| `lotus79` | 109 (84) | — | — | `BrakeBias` 39.5…50.5 = `BrakeBias` | `AntiRollFront` 0…3 = `ArbArms` †<br>`AntiRollRear` 0…1 = `ToeIn` † |  |
| `mclaren570sgt4` | 382 (270) | `ABS` 0…2 = `AbsTcEscSetting` (0 Track, 1 Sport, 2 Normal); working in 307 | — | published, always 49, no garage entry |  |  |
| `mclaren720sgt3` | 351 (274) | `ABS` 1…12 = `AbsSetting` “ABS”; working in 263 | `TractionControl` 1…12 = `TcSetting` “TC” | `BrakeBias` 46.4…60 = `BrakePressureBias` | `ThrottleShape` 1…3 = `ThrottleShapeSetting` “MAP” |  |
| `mclarenmp4` | 34 (0) | `ABS` 1…8 = `AbsSetting`; working in 26 | `TractionControl` 1…6 = `TractionControlSetting` “TC” | `BrakeBias` 43.191…53.064 = `BrakePressureBias` | `ThrottleShape` 9…10 = `ThrottleShapeSetting` “TPS” |  |
| `mclarenmp430` | 8 (0) | — | — | `BrakeBias` -3…2.5; no garage entry found | `DiffEntry` 2…5 = `Entry` “ENT”<br>`DiffPreload` 2…4 = `EntryPreload` “PL”<br>`MGUKDeployMode` 25…75 = `MguKDeployMode` (75 Race)<br>`PeakBrakeBias` 1…8 = `PeakBrakeBiasOffset` “BAL” | DRS, hybrid |
| `mercedesw13` | 7 (1) | — | — | `BrakeBias` 52…55.5; no garage entry found | `BrakeBiasFine` -1…0.4 = `Preload` †<br>`BrakeMisc` 0 = `FineBrakeBias` “BB+/BB-” †<br>`DiffEntry` 1…4 = `Entry` “ENTRY”<br>`DiffExit` 1…12<br>`DiffMiddle` 4…10<br>`EngineBraking` 2…8 = `EngineBraking` “EB”<br>`MGUKDeployMode` 0…3 = `MguKDeployMode` (2 Balanced, 0 Qual)<br>`MGUKRegenGain` 0…1<br>`PeakBrakeBias` 3…10 | DRS, hybrid |
| `mx5 mx52016` | 667 (211) | no dial; working in 525 | — | — |  |  |
| `nissangtpzxt` | 28 (0) | — | — | `BrakeBias` 54.25…57.5 = `BrakePressureBias` |  |  |
| `porsche718gt4` | 26 (8) | `ABS` 1…11 = `AbsTcEscSetting`; working in 25 | `TractionControl` 0…1 = ?<br>`TractionControl2` 0…1 | `BrakeBias` 47.5…60 = `BrakePressureBias` |  |  |
| `porsche963gtp` | 49 (36) | `ABS` -4…5 = `BrakeBiasMigration` †; **never working** — not ABS | `TractionControl` 3…10 = `TractionControlSlip` “TCLO”<br>`TractionControl2` 2…12 = `TractionControlGain` “TCLA” | `BrakeBias` 46…55 = `BrakePressureBias` | `AntiRollFront` 1…2 = `ArbAdj`<br>`AntiRollRear` 11…16 = `ArbAdj`<br>`BrakeMisc` -4…5 = `BrakeBiasTarget` † | hybrid |
| `porsche991rsr` | 35 (0) | — | `TractionControl` 1…9 = `TractionControlSetting1` “TC-CON”<br>`TractionControl2` 1…11 = `TractionControlSetting2` “TCR” | `BrakeBias` 50…60.25 = `BrakePressureBias` | `FuelMixture` 0…10 = `EngineMapSetting` “MAP” |  |
| `porsche9922cup` | 176 (72) | `ABS` 0…8 = `AbsSetting` “ABS”; working in 155 | `TractionControl` 0…10 = `TcSetting` “TC” | `BrakeBias` 42.769…53.262 = `BrakePressureBias` | `ThrottleShape` 1…2 = `ThrottleSetting` “ATH” |  |
| `porsche992cup` | 2 (0) | — | — | `BrakeBias` 42.079 = `BrakePressureBias`; not moved yet |  |  |
| `porsche992rgt3` | 36 (10) | `ABS` 0…11 = `AbsSetting` “ABS”; working in 32 | `TractionControl` 0…11 = `TcSetting` “TC-LAT” | `BrakeBias` 47…54.638 = `BrakePressureBias` | `ThrottleShape` 1…3 = `ThrottleShapeSetting` |  |
| `porschemissionr` | 1 (1) | `ABS` 4 = `AbsSetting`; working in 1 | `TractionControl` 4 = `TractionControl` | published, always 48.795, no garage entry | `AntiRollRear` 1 = `RarbBlade` †<br>`EnginePower` -4 = `DriveBias` † |  |
| `protrucks pro2lite` | 3 (2) | — | — | published, always 0, no garage entry |  |  |
| `radical sr8` | 14 (10) | — | — | `BrakeBias` 54…54.5 = `BrakeBias` |  |  |
| `radicalsr10` | 77 (53) | — | — | `BrakeBias` 53.5…65 = `BrakePressureBias` | `BoostLevel` 8 = `BoostLevel_Cal`<br>`ThrottleShape` 1 = `ThrottleShape_Tps` |  |
| `raygr22` | 35 (30) | — | — | `BrakeBias` 54.5…60 = `BrakePressureBias` |  |  |
| `stockcars2 arcaford25` | 1 (0) | — | — | published, always 0, no garage entry |  |  |
| `subaruwrxsti` | 12 (0) | — | — | `BrakeBias` 62.11 = `BrakePressureBias`; not moved yet | `LaunchRPM` 5600…6600 = `LaunchRpmLimit` |  |
| `superformulalights324` | 17 (5) | — | — | `BrakeBias` 49.5…58.5 = `BrakePressureBias` |  |  |
| `superformulasf23 honda` | 43 (6) | — | `TractionControl` 2…6 = `LaunchControlRpm` “Start Limit” † | `BrakeBias` 50.869…60.018 = `BrakePressureBias` | `ThrottleShape` 1…9 = `ThrottleShaping` “TPS” | push-to-pass |
| `toyotagr86` | 12 (12) | `ABS` 2 = `AbsSetting` “ABS”; working in 9 | `TractionControl` 1 = `TcSetting` “TC” | `BrakeBias` 50 = `BrakePressureBias`; not moved yet |  |  |

## 13. What cannot be known on this machine

- Anything about a car he has not driven.
- The name of a position he has never saved a setup in.
- The range of a dial beyond what he has used.
- Whether traction control exists in a car that has no dial for it, and whether it is working in any car.
- What `dcTractionControlToggle` reads with the system switched off.
- Which dials a fixed setup locks, other than by his never having moved them.
- In a race, how DRS and push-to-pass behave for the two F1 cars: they have only been tested.
