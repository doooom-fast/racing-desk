# doooom paints

A small Windows app for swapping iRacing liveries. A mini Trading Paints with no service
behind it: it copies files into the sim's paint folders and gets out of the way. Preview
happens in iRacing, so the app never renders a car.

One click does what a swap actually takes — back up what is there, copy the version's files in
renamed to `car_<id>.tga` and friends, delete that customer's stale `.mip` files so the sim
re-cooks, and check that Trading Paints is not about to undo the lot.

## The library

Versions live outside the sim's folders, one folder per version:

```
<library>/<car folder>/<version>/
    car.tga           paint          (or car_<id>.tga)
    car_spec.tga      spec map       (or car_spec_<id>.tga, optional)
    preview*.png      optional
    meta.json         optional
```

Both filename shapes are read. The plan called for role-only names; the design pipeline in
[doooom-iRacing-liveries](https://github.com/alternatekev/doooom-iRacing-liveries) already
writes `car_424242.tga`, so that repo's `cars/` folder works as a library with no changes.

`meta.json` is all optional:

```json
{
  "name": "v13 Shatter",
  "created": "2026-09-23",
  "notes": "matte black against gloss shards",
  "source": "design/lotus79/v13_design.py",
  "simFolder": "mx5 mx52016"
}
```

### Keeping it current

If the library is a git checkout, the app treats the repo as the source of truth and says when
new liveries are waiting. It finds the checkout itself — any folder in or beside the paint
directory, or under `Documents\GitHub`, whose nesting looks like a library — so the usual case
needs no browsing at all. The sim's own paint folder can never be mistaken for one, because a
car folder there holds textures directly rather than a layer of version folders.

**Library source** in the UI shows the remote, the branch, the commit you are on, and whether
you are behind. **Check** fetches; **Update** fast-forwards. There is a checkbox to update
automatically on launch.

Updating cannot lose work:

- The only write is `git pull --ff-only`. If the branch has diverged, git stops rather than
  inventing a merge.
- A dirty working tree is refused before git is asked, with a message about your changes rather
  than about git.
- `git` is driven as a command, not linked in, so it already knows your credentials through
  your credential helper and never has to ask again.

`simFolder` is the escape hatch for when the library folder and the sim's folder disagree.
Usually they do not need it: `mx5-mx52016` is matched to the sim's `mx5 mx52016` automatically,
and the UI says when a match was made loosely rather than exactly.

## Seeing the paint

A card shows the pipeline's rendered previews when a version has them, and the textures
themselves either way. The tabs under each card switch between them — `topview nose up`,
`paint`, `spec` — so you can look at the actual file that is about to be installed rather
than a render of an earlier one.

The `.tga` decoding is built in: uncompressed and run-length encoded, 16-, 24- and 32-bit
colour and greyscale, either vertical origin. Colour-mapped files are refused by name rather
than drawn as noise. A 2048x2048 paint decodes and scales down in well under a tenth of a
second, and the result is cached against the file's size and modification time.

It is a flat UV sheet, not a car. iRacing packs each car as a single encrypted archive and
only downloads the ones you drive, so there are no local models to render onto — previewing on
the car still means loading the sim.

## What an apply does

1. **Backs up** every file belonging to your customer id in the car's sim folder, `.tga` and
   `.mip`, into `%LOCALAPPDATA%\doooom-paints\backups\<car>\<timestamp>\` with a manifest.
   Not into the library: the library is usually a git checkout, and backups written there make
   the repo permanently dirty, which in turn stops the app updating it.
2. **Copies** the version's textures in, renamed for your customer id. Each one is written to a
   temporary name and renamed into place, so a failed copy leaves the old file intact rather
   than half of a new one.
3. **Deletes the cooked `.mip` files** for your customer id, because the sim will otherwise keep
   serving the texture it cooked last time. Other drivers' cooked files are left alone — they
   are not stale, and clearing them costs everyone a re-cook. There is a checkbox if you want
   them gone anyway.
4. **Rolls back** from the backup if any step fails, and says so.

Nothing the app did not install is ever deleted. Revert restores a backup, and takes a backup
of the current state first, so a revert is itself undoable.

## Two things the app works out for you

**Which paint folder the sim actually reads.** When OneDrive backs up Documents there are two
plausible `Documents\iRacing\paint` folders, and deleting files in one while the sim reads the
other looks exactly like the app doing nothing. Every candidate is found — registry shell
folders, `%USERPROFILE%`, each OneDrive variant — ranked by what is really in it, and the
resolved path is on screen at all times with the alternatives one click away.

**Which customer id is yours.** Not by frequency. Trading Paints fills the paint folder with
every driver you have shared a session with; on the machine this was built against that is 3,204
car textures across 85 cars, and the most frequent id belongs to a stranger. The owner's own id
appeared three times and ranked seventh of 2,977. So detection is a cascade:

| | Signal | Confidence |
|---|---|---|
| 1 | `User ID` in the Trading Paints downloader's own `config.xml` | certain |
| 2 | A `car_spec_<id>.tga` on disk — the downloader ships other drivers' spec maps pre-cooked as `.mip`, so a `.tga` one was installed by hand | likely |
| 3 | Most frequent `car_<id>.tga` | guess |

The confidence is shown next to the field, and the field is always editable.

## The Trading Paints guard

"Is `TradingPaintsDownloader.exe` running" is the weaker half of the question. The downloader
keeps its settings in `%APPDATA%\TradingPaints Downloader\config.xml`, and the app reads the
ones that decide whether your work survives:

- **Download my schemes** — the "Update My Own Paints" switch. On, and the downloader pulls your
  paints from the website over the top of what you just applied.
- **Keep my paints synced from website** — the same failure on a timer.
- **Delete schemes before downloading** and **Delete schemes once session ends** — both can take
  your applied files with them.

Each one is named in the UI with its current value. An apply that would land into a risky setup —
the downloader running, the sim holding the files — is refused with the reason, where the click
was, and going ahead regardless is a second click offered only then.

## Building

Needs Node 20+, Rust (stable, MSVC toolchain) and the Visual Studio C++ build tools.

```bash
npm install
npm run app          # dev, with hot reload
npm run app:build    # release build and NSIS installer
```

Tests:

```bash
cd src-tauri && cargo test
```

The suite is 69 unit tests over the parts that touch disk — role parsing, path detection, the
id cascade, library scanning, applied-version hashing, apply/revert including rollback, and a
real clone-push-fetch-pull cycle against a local git remote.

There is also a set of smoke tests that read the real install on the machine you are on, which
is where every path, lock and process question is actually settled:

```bash
cd src-tauri && cargo test --test real_machine -- --ignored --nocapture
```

For the interface there is `dev-preview.html`, a harness that stands in for the Rust side with
canned data so the UI can be worked on without iRacing, a library or the sim being present.
`npm run dev` and open `/dev-preview.html`. It is not part of the build — only `index.html` is.

## Layout

```
src/            React + TypeScript front end; renders, never builds a path
src-tauri/src/
  roles.rs         iRacing's <role>_<id>.<ext> naming
  paths.rs         finding the paint folder, OneDrive and all
  customer.rs      the customer id cascade
  tradingpaints.rs the downloader's config and what it means
  process.rs       is the sim running
  repo.rs          the library as a git checkout, and finding one
  tga.rs           decoding paints so the cards can show them
  library.rs       scanning the library, matching car folders to the sim's
  digest.rs        hashing, for "which version is applied"
  installed.rs     what is in the sim's folder now
  apply.rs         backup, install, cooked-file cleanup, revert
  settings.rs      the two folders and the id, remembered
```

Every decision that touches the disk is in Rust. The front end asks for things to happen and
renders what comes back, so the rules about backups, renaming and cooked files live in exactly
one place.

## Inside The Racing Desk

The same UI now runs as the **Cars** page of The Racing Desk's desk window: the one list of cars, and the one place
to look at a car — its liveries, the view it is driven with, its pedals. (It was the Paints page, beside a Cars page
of views and pedals, until the two became one.) `build-island.mjs` bundles `src/` for
it; `src/bridge.ts` sends every call to the app when it is there (`window.racingDesk.paints`) and to the Rust
commands when it isn't, so the components never know which host they are in. In the app the file operations are a
Node port of `src-tauri/src`, module for module, in `apps/overlay/modules/js/paints/`. Backups move to
`%LOCALAPPDATA%\Racing Desk\paints\backups`, and the two folders and the id are remembered in the app's settings.

There the page has no name of its own on it — the desk's masthead says where you are — and the status chips and
Refresh sit at the end of the setup row.

A car's page reads from the top: its name; its **View** and its **Pedals**, side by side; its versions and "When a
livery is applied"; what is on disk for it (installed in the sim, backups); Trading Paints; and last the library's
own housekeeping, **Library source**, which used to be first. The view and the pedals are what the page is opened
for after a drive, and under the versions' cards they were out of sight: where they are now they are in sight
without scrolling in the desk's smallest window, for every car, with the first row of cards beginning under them.
Choosing another car, or a group, puts the pane back at its top.

### The car just driven

The page opens on the car driven last, and goes on following it — the desk hands over when each car was last
driven (`setLastDriven`, exported beside `mount`), at its start and again whenever the store has something new —
until a car is chosen in the list. A car that was chosen stays until you drive again: a drive begun after you chose
it puts the page on the car you drove. It is not moved under a group, or while something is being done.

**Driven**, beside the filter, narrows the list to the cars you have driven, the last driven first, each saying
when; the cars the store counts sessions for and the desk has no date for come after, by name. It is one click, a
button that says whether it is pressed, and it stays as it was set while the page is open. While it is on the list
is one group, "Driven", and not "Liveries" and "No livery yet": newest first is an order across every car driven,
and the car just driven would otherwise be under every driven car with a livery whenever it has none. Off, the list
is as it always was, every car in it, and the filter's words work over whichever is showing.

### A car's view and pedals

Two panels that are the desk's alone. **View** is the view the car was last driven with —
driver height, horizon, head horizon, FOV, the seat's three offsets — with when it was last driven and whether the
view is the car's own or carried over from the car driven before it. **Pedals** is which of Heusinkveld
SmartControl's profiles the car is driven with, chosen from a select, with that profile's brake beside it and
SmartControl Live's keys under it. A car with either kept is marked in the list (`view`, `pedals`). Nothing here
changes iRacing or the pedals; choosing a profile is the one thing written, and it is written to the app's host.

The host also knows who gave a car its profile, whether the car has ABS, and the brake force it was last driven
with, and the Pedals panel says so in a sentence under the profile:

| The host has | The page says |
|---|---|
| a profile, `given_by: "rule"`, `given_why: "ABS"` | From LightBrake — given by the rule: it has ABS. (or "it has no ABS", "it is a formula car", "it is a prototype") |
| a profile, `given_by: "driver"` | You chose this. |
| no profile, `given_by: "none"` | You chose that this car has none. |
| no profile, `has_abs: null` | No profile yet: not driven enough yet to say whether it has ABS. |
| no profile, `has_abs` known | No profile yet: it has ABS, and the rule gives it one when it is next driven. (or that SmartControl has no `LightBrake` or `Default` to give from) |
| `brake_force_kg`, `force_at` | brake force 62 kg in this car, set Tue, Sep 15, 5:40 PM — beside the profile's brake, and there with no profile at all |

The rule is the driver's — his `LightBrake` for a car with ABS that is neither a formula car nor a prototype, his
`Default` for the rest — and it is the host that applies it, at the end of a run, going by the canonical car list for
a car the list says the kind and ABS of, and by what the car showed for any other. The page does not say which yet. A host from before it kept any of this sends none of
those fields, and the panel is then as it was: the sentence is left out, and the force has no date. Taking a car's
profile away leaves its force on the page, and the host has that down as the driver's choice.

Both come from the app's host by way of its main process (`window.racingDesk.rig`: `read()` and
`bindPedals(carPath, profileId)`); the page builds no address and fetches nothing. `src/rig.ts` shapes what comes
back, `src/useRig.ts` reads it — when the page is mounted, when the desk shows it again, on either Refresh, and when
the desk says there is something new. The Rust never had any of
this, so nothing falls back to it: in the Tauri shell and in `dev-preview.html` the two panels say that the app is
not there, and everything else works as it did.

In the desk the list of cars does not wait on a library either. Once one has been looked for and not found, the
cars are the install's and the paint folder's, so a car's view and pedals can be looked at with no livery anywhere.

### What is read, and when

The page stays mounted while another page of the desk is up and while the desk is minimised behind a race, and
everything it asks for is done in the process the HUD answers to. So:

- **The guards** — is the sim running, is the downloader — each start a process. They are looked at every eight
  seconds only while the desk's window is the one in front and this page is the one showing, and at once when that
  becomes so. An apply does not go by them: the app checks for itself before it writes, and a refused apply asks
  afresh.
- **The library's remote** is asked once per library, and only once a livery is within reach — a car with a version,
  or a group, has been on the page for a second, with the window in front. Looking at a car's view, or passing a
  car on the way to another, asks nothing. **Check** asks whenever it is pressed.
- **Refresh** is two buttons that do the same to this page: the page's own, and the desk's in the masthead, both
  read the list of cars again and what the host keeps for them. So does the desk finding its host after finding
  none — which is how cars listed by folder while the host was starting get their names — and the store having
  something new, which a drive is. The desk says so with `racingdesk:refresh`; said while another page is up, it
  is kept and said when this one is next shown. Coming back to the page without any of that reads what the host
  keeps, and not the list.

### Every car, by name

In the app the list is not only the library. It is every car the rig knows, called what the sim calls it
("Mazda MX-5 Cup", not `mx5-mx52016`), in two groups — **Liveries**, the cars with at least one version, then
**No livery yet** — with a filter over both that matches the name or the folder, its words in any order and accents
optional ("huracan evo" finds the Huracán). Picking a car with no livery shows
where a version would go (`<library>\<car folder>\<version name>\`), what is installed for it in the sim, and its
backups; there is nothing to apply, so nothing offers to.

One command does it, `carCatalogue` (`apps/overlay/modules/js/paints/catalogue.js`), which the Rust does not have:
`src/api.ts` falls back to the library's cars under their folder names when the host is the Tauri shell, so this app
shows what it always did. The command merges three lists on the sim's car path:

| From | What counts as a car |
|---|---|
| the library | every car folder with a version in it, exactly as the library scan describes it |
| the iRacing install | a folder under `cars\` holding a `.dat`, named by its folders joined with spaces: `cars\mx5\mx52016` is `mx5 mx52016` — but nothing under `cars\safety`, the pace cars |
| the paint folder | a folder the install also has, or one holding `car_*.tga` / `car_*.mip` itself — never `helmets`, `suits` or `cars`, nor the folder the library is in |

`-`, `_` and case fold away when two are compared, which is how the library's `mx5-mx52016` and the sim's
`mx5 mx52016` come out as one car. A folder in the install that holds a `.dat` *and* has cars beneath it (`mx5`,
`fordgt`) may be a car or may only be what its cars are built on; it is listed when something else knows it as a
car — a name, a paint folder, a livery.

A fourth list is the store's: a car you have driven (`driven` > 0) that is in none of the three — uninstalled
since, or the install could not be found — is listed too, under the store's own path for it, as **not installed**.
Its view and pedals are kept and shown, and its pedals can still be given a profile, since that is the store's.
Nothing is offered that needs the car on disk: no place for a livery, nothing installed, no backups, nothing to
apply, and nothing is read from the paint folder for it. A car that was only ever seen in a session is not listed:
nothing is kept for it.

Names come from The Racing Desk's local store, which keeps the name the sim gave every car that has been in one of
your sessions; the app asks its host for them (`GET /racing-desk/data/cars`) and shows folder names when there is no
answer. The install is the one the iRacing UI registered for `iracing://` links
(`HKCU\Software\Classes\iracing\shell\open\command`), then the usual Steam and default paths;
`paints.installDir` in the app's `overlay-settings.json` names another by hand.

The Tauri shell here still builds from the same source. It stays until the page has done a few real swaps, then goes.

### One click, and groups

In the app an apply is one click: there is no dialog. How a livery is applied — the spec map too, read-only
afterwards, other drivers' cooked files — is set once, under **When a livery is applied**, remembered, and used by
every apply after it. What stands in the way is said where the click was.

A **group** is one name for a livery across cars, listed above the cars. The library makes its own: a version more
than one car has (`shatter` under seventeen cars) is a group, and a car joins it the moment a folder of that name
appears under it. **New** makes one of your own — a name and, for each car with a livery, the version it wears;
"every car in" fills them from a version the cars share — kept under `paints.liveryGroups` in the app's settings.
**Set** applies each car's version, car by car, so each is backed up exactly as a single apply backs it up. A car
already wearing its version is left alone, one car failing does not stop the rest, and what became of each is said
beside it (`apps/overlay/modules/js/paints/groups.js`).

A car that has never been driven has no paint folder. An apply makes it, under the install's name for the car —
which is what the sim would call it — so the paint is there the first time the car is driven. Whether a folder may
be made is decided in the app's main process, whatever the page sent.

## Still to come

Drag and drop import, a watch on the design output folder, per-version "what changed", export a
version as a zip.
