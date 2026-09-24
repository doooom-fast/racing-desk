# doooom-paints — build plan

A small Windows app for swapping iRacing liveries. A mini Trading Paints with no service behind
it: it copies files into the sim's paint folders and gets out of the way. Preview happens in
iRacing, so the app never renders a car.

## The job it does

Today a swap means: find the car's folder, rename two files to the customer ID, copy them in,
delete the stale `.mip` files so the sim re-cooks, and make sure Trading Paints isn't about to
overwrite the lot. The app does exactly that, in one click, and can put back what it replaced.

## Model

A **library** of versions, separate from the sim's folders:

```
<library>/<car folder>/<version>/
    car.tga           paint
    car_spec.tga      spec map, optional
    car_num.tga       optional, and the rest of the iRacing roles
    preview.png       optional
    meta.json         { name, created, notes, source, seed }
```

`<car folder>` uses the sim's own name (`lotus79`, `nissangtpzxt`, `mx5 mx52016`), which is what
the existing pipeline already produces, so the design output drops straight in.

**Apply** = back up what's there, copy the version's files in renamed to `car_<id>.tga` and
friends, delete that car's `.mip` files, report.

## MVP

1. **Find the sim.** `Documents\iRacing\paint`, and the OneDrive-redirected twin, which is a real
   trap: deleting files in one while the sim reads the other looks like the app doing nothing.
   Show the resolved path in the UI, always, and let the user override it.
2. **Find the customer ID** from existing filenames (`car_<digits>.tga`), most frequent wins,
   editable. Same logic as `install_paint.py --find-id`.
3. **Library browser.** Cars down the side, versions as cards with previews. Mark which version is
   currently applied by hashing the installed files against each version.
4. **Apply**, with backup to `<library>/.backups/<car>/<timestamp>/`.
5. **Revert** to the last backup for that car.
6. **Delete `.mip` files** for the car on every apply. Without this the sim can keep serving the
   old cooked texture.
7. **Trading Paints guard.** If `TradingPaintsDownloader.exe` is running, say so before applying
   and offer to keep going. Its "Update My Own Paints" setting silently overwrites your own car,
   which cost us an afternoon.

## Later

- Drag and drop a folder or zip to import a version.
- Watch the design output folder and import new builds automatically.
- Per-car notes and a "what changed" line per version.
- Export a version as a zip to share.
- Spec map on/off toggle, since a paint can be installed with or without it.
- Optional: write the iRacing `.mip` by launching the sim once, for Trading Paints uploads.

## Stack

**Tauri v2 with a React + TypeScript front end.** It matches the TypeScript the rest of the org
runs on, ships a small single binary, and file operations live in Rust where they belong. The
whole app is a file browser plus a copy routine, so there is no need for a heavier runtime.

Fallback if the Rust toolchain is a nuisance on the gaming PC: **.NET 8 with WinUI 3**, which is
native and has first-class file APIs, at the cost of a stack nobody here is using yet. A third
option, a PowerShell script with a WinForms window, would work for a personal tool but ages badly.

## Risks worth designing around

- **Never destructive.** Always back up before overwriting, and never delete a file the app didn't
  install. A paint can represent hours of work.
- **Two Documents folders.** Detect and display, never assume.
- **File locks.** The sim holds textures open while running. Detect iRacing and warn rather than
  failing halfway through a copy.
- **Read-only files.** Setting the installed files read-only defeats Trading Paints, so the app
  should be able to clear that flag when it applies, and optionally set it afterwards.

## Milestones

| # | Ships | Proves |
|---|---|---|
| 1 | Library browser, path and ID detection, read-only | The layout and detection are right |
| 2 | Apply + backup + revert | The swap works on a real install |
| 3 | `.mip` cleanup, Trading Paints guard, active-version detection | The failure modes we actually hit |
| 4 | Import, watch folder, export | Day-to-day use |

Build it on the Windows machine, since every path, lock and process check is Windows behaviour and
testing it anywhere else is guesswork.
