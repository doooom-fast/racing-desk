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
[doooom-iRacing-liveries](https://github.com/k10-motorsports/doooom-iRacing-liveries) already
writes `car_1159839.tga`, so that repo's `cars/` folder works as a library with no changes.

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

`simFolder` is the escape hatch for when the library folder and the sim's folder disagree.
Usually they do not need it: `mx5-mx52016` is matched to the sim's `mx5 mx52016` automatically,
and the UI says when a match was made loosely rather than exactly.

## What an apply does

1. **Backs up** every file belonging to your customer id in the car's sim folder, `.tga` and
   `.mip`, into `<library>/.backups/<car>/<timestamp>/` with a manifest.
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
appeared three times and ranked eighteenth. So detection is a cascade:

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

Each one is named in the UI with its current value, and an apply that would land into a risky
setup asks before going ahead rather than after.

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

The suite is 51 unit tests over the parts that touch disk — role parsing, path detection, the
id cascade, library scanning, applied-version hashing, and apply/revert including rollback.

There is also a set of smoke tests that read the real install on the machine you are on, which
is where every path, lock and process question is actually settled:

```bash
cd src-tauri && cargo test --test real_machine -- --ignored --nocapture
```

## Layout

```
src/            React + TypeScript front end; renders, never builds a path
src-tauri/src/
  roles.rs         iRacing's <role>_<id>.<ext> naming
  paths.rs         finding the paint folder, OneDrive and all
  customer.rs      the customer id cascade
  tradingpaints.rs the downloader's config and what it means
  process.rs       is the sim running
  library.rs       scanning the library, matching car folders to the sim's
  digest.rs        hashing, for "which version is applied"
  installed.rs     what is in the sim's folder now
  apply.rs         backup, install, cooked-file cleanup, revert
  settings.rs      the two folders and the id, remembered
```

Every decision that touches the disk is in Rust. The front end asks for things to happen and
renders what comes back, so the rules about backups, renaming and cooked files live in exactly
one place.

## Still to come

Drag and drop import, a watch on the design output folder, per-version "what changed", export a
version as a zip.
