# Per-car driver height, and Heusinkveld brake settings — findings

> **Status:** researched 2026-09-28 on the rig, read-only. Nothing was launched, no device was written to.
> For planning two tools Kevin asked for: a per-car saver for iRacing's height setting, and per-car brake
> settings on the Heusinkveld pedals. His constraint for both: transparent — SmartControl (or iRacing) is
> where a value is set; The Racing Desk saves it per car and puts it back, without being asked.

## 1. Per-car height

### Established

| Finding | Evidence |
|---|---|
| The setting is `driverHeightAdj` in `[View]` of `Documents\iRacing\app.ini`, in metres. The file's own comment gives the range as ±0.050 m; the value on the rig is outside it, so the limit is not enforced there. | `app.ini` |
| It is **global**. iRacing's support article: driver height (Ctrl+[ / Ctrl+]) and horizon (Shift+[ / ]) are global; per-car adjustment exists only through the camera tool's X/Y/Z offsets, saved as `car.cam`. | iRacing support |
| Sibling globals in the same section: `drivingCamFOV`, `DrivingVanishY`. `app.ini` has no per-car view section. | `app.ini` |
| The per-car workaround is `Documents\iRacing\cameras\cars\<carpath>\car.cam`. 19 of the 55 driven cars have one. | folder listing |
| `car.cam` is binary: magic `MACC`, version 14, 9 records of 184 bytes, `CamCockpit` last; the cockpit x, y, z offsets are three floats at record offset +52. | hex parse |
| The edits in those files are mostly fore/aft (x), not height: z is non-zero on only 8 cars. | same |
| For 6 cars with a `car.cam`, `camera.ini` has `LastCarSet=` empty. Whether those files are being applied is unknown. | `camera.ini` |
| The sim rewrites its ini files on exit (`app.ini`, `camera.ini`, `core.ini`, the renderer file, the HUD profile) within seconds of the `.ibt` closing. An external edit made while the sim runs is overwritten. | file timestamps |
| Nothing in the SDK reports or sets it. `DriverHeadPosX/Y/Z` in the session YAML is a per-car constant (3,201 headers, 55 cars, one value per car). | `.ibt` headers |
| The controls are `DCamDrvHeightInc` / `DCamDrvHeightDec` in the control profile; on this rig they look rebound from the defaults. | `controls.cfg`, not fully decoded |
| He changes car often: 25 cars and at least 72 car changes in 30 days. | `.ibt` file names |

That `app.ini` is read only at sim start is inferred, not tested.

### Approaches

| # | Approach | Effort | Risk | Failure modes |
|---|---|---|---|---|
| A | **Write `app.ini` before launch.** At sim exit store `driverHeightAdj` against the car just driven; while the sim is closed, write the value for the expected next car. | 1–2 days | Low | The next car isn't known before launch; "last car driven" is wrong on every car change. On a mismatch the app can only say so. |
| B | **Fold the adjustment into `car.cam`.** At exit, move the change in `driverHeightAdj` into that car's cockpit z-offset and restore the global baseline; iRacing then applies it per car itself. | 3–5 days plus experiments | Medium | Undocumented binary format; needs a `car.cam` to exist (36 cars have none); two files to update; the `LastCarSet` question; VR behaviour unknown. |
| C | **Nudge in-car with injected key presses.** | 2–3 days | Medium-high | No readback, step size unknown, needs sim focus, bindings are per control profile. |

B is the only one that is transparent on a car change.

### First slice

1. **Record only.** At each sim exit, store `driverHeightAdj`, `drivingCamFOV` and `DrivingVanishY` against the session's `CarPath`; show them per car in the desk. No writes.
2. Then A, with a HUD notice on mismatch. Save a new value only if it changed during the session, so a stale value from the previous car is never recorded.
3. Run the `car.cam` experiments before committing to B.

### Unknowns

- **For Kevin:** only the Driver Height control, or also FOV, horizon and fore/aft seat position? (His camera edits are mostly fore/aft, which has no iRacing setting outside the camera tool.) What are height up/down bound to? Monitor or VR?
- **Supervised experiments:** does an `app.ini` edit made with the iRacing UI open survive a sim launch; is `car.cam` applied when `LastCarSet` is empty; does cockpit z add to `driverHeightAdj` one-for-one; will iRacing accept a `car.cam` for a car that never had one saved.

## 2. Heusinkveld pedals

### Established

| Finding | Evidence |
|---|---|
| Pedals: USB `30B7:1003`, "Heusinkveld Sim Pedals Ultimate"; SmartControl's product enum maps 0x1003 to `UltimatePlus`. USB can't tell an Ultimate+ from a classic Ultimate with the upgrade kit. | device enumeration |
| Other devices: MOZA R21 base and HBP handbrake, DS-8X shifter, GTPRO2 wheel. **No Moza pedals on this rig.** | same |
| SmartControl 26.02.5 at `C:\Program Files\Heusinkveld\` (SmartControl and SmartControl Live). Live has an autostart entry. | uninstall registry, Run key |
| Profiles live in SQLite: `C:\ProgramData\Heusinkveld\Database\Heusinkveld.db`, table `profile_sim_device` (id, name, an XML blob). Six profiles on the rig. | read-only open |
| Per pedal the XML holds: bottom deadzone %, six curve points (0/20/40/60/80/100 %), top deadzone % (throttle, clutch), and `MaximumCalibratedForceInKilogram` (brake). Each device section carries a SHA-512 `Hash`. | XML parse |
| His SmartControl Live bindings are all brake force (set to a value, ±5 kg). No profile-switch key is bound. | `keyboard_binding` rows |
| Settings are stored in both places: the database on the PC and EEPROM on the controller, which also stores the active profile's id. | method names in the vendor library |
| SmartControl Live applies profiles and brake force to working memory only — nothing in it calls the EEPROM save. Live brake tweaks exist in no file and are lost on power cycle. | static call lookup, not a runtime test |
| SmartControl imports and exports profiles as XML through file dialogs. No command-line switching, pipe or API found. Live listens by raw input and a low-level keyboard hook. | string and manifest inspection |
| The HID protocol is not publicly documented and no third-party implementation was found. Calibration, EEPROM-save and bootloader commands share the command space with deadzone and curve commands. | web search; vendor metadata |
| The only existing tool, Simulator Controller's pedal plugin, drives the SmartControl application and supports only SmartControl 1.0. | its wiki |

### Options, least to most invasive

| # | Option | Needs | What can go wrong | Hardware risk |
|---|---|---|---|---|
| 0 | **Know and show.** Read the database read-only, bind car to profile in the desk, note it on the HUD at car load. | Nothing running | Not automatic | None |
| 1 | **Fire SmartControl Live's own hotkeys** on car change. | Live running; a binding per profile | Live not running; injected keys may be ignored; the chord leaks into iRacing | None beyond what Live does; no EEPROM write |
| 2 | **One managed profile.** Rewrite one profile row with the car's saved snapshot, then fire one hotkey. | Live running, and re-reading the database on activation (unverified) | Writing a vendor database; locks; a stale `Hash` unless blobs are copied verbatim | None direct |
| 3 | **Direct HID.** | Value scaling, firmware gating, a strict command whitelist | A wrong command could decalibrate or write EEPROM; firmware updates can change the protocol | Real, though calibration is recoverable in SmartControl's wizard |

Rough effort: 0 is 1–2 days, 1 is 2–3 days, 2 is 3–4 days, 3 is 1–2 weeks. Option 3 is the only one that can read back live brake tweaks.

### What the existing pedal code gives

- `PedalProfile.cs` — reusable as the curve and display model; lacks a top deadzone and brake max force, and should carry the verbatim SmartControl XML for restore.
- `PedalProfileManager.cs` — reusable: JSON storage, car bindings, global fallback, the HTTP actions, the HUD curve JSON. To change: it keys on the display name where `CarPath` is the stable key; `OnCarChanged` pushes nothing when it falls back to the global profile, so the pedals would keep the previous car's settings; the Pit House import is hard-coded and finds nothing on this rig.
- `Moza/*` — a template for direct hardware talk, not reusable code.
- Hosting — hardware code runs only without `--no-hardware`; beside SimHub the app's host runs with that flag, so today the active pedal manager is the SimHub plugin's. Only one process should apply profiles.

### First slice

Option 0 first: it settles the data model and car bindings with no writes anywhere. Then option 1 as the first automatic apply, because it goes through the vendor's own code path and doesn't write EEPROM. Option 3 later, starting with read-only queries.

### Unknowns

- **For Kevin:** Ultimate+ or classic Ultimate with the upgrade kit? Per car or per class? Brake force only, or curves and deadzones too? Should live brake tweaks be captured, or only what is saved in SmartControl? Is SmartControl Live kept running?
- **Supervised experiments:** does Live accept an injected key chord; does Live read the database at activation or cache it at start; does SmartControl accept a profile whose values changed but whose `Hash` didn't; can the pedals be queried over HID while Live has them open.

## Sources

- https://support.iracing.com/support/solutions/articles/31000169161-how-to-configure-your-seating-position
- https://support.iracing.com/support/solutions/articles/31000157467-iracing-camera-tool
- https://gist.github.com/samkatakouzinosracing/5d07a71750b78c445a8b387b6ec31a5c
- https://heusinkveld.com/smartcontrol/
- https://heusinkveld.com/highlights/smartcontrol-live/
- https://heusinkveld.com/faq/
- https://traxion.gg/heusinkvelds-smartcontrol-live-allows-pedal-mapping-changes-mid-race/
- https://github.com/SeriousOldMan/Simulator-Controller/wiki/Plugins-&-Modes
