"""Building the fleet: a car's template in, its livery into the library.

The library is where the desk's Paints page looks (``<library>/<car>/<version>/``). A build
writes both directions of the livery there, each with a ``meta.json`` that says the build made it,
and never touches a version that is anyone else's.

This machine is the rig. The work is heavy for a minute per car, so the build does nothing while
the sim is running: it asks before each car and between the steps of one, and waits.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import time
from collections import Counter
from dataclasses import dataclass, field as dataclass_field
from pathlib import Path
from typing import Any, Callable

import numpy as np
from PIL import Image

from ..errors import LiveryError
from ..tga import save_tga
from . import cars as cars_mod
from . import patches, shatter, template

# The sim, under both of its names: the desk looks for the same two (modules/js/paints/process.js).
SIM_PROCESSES = ("iracingsim64dx11.exe", "iracingsim64.exe")
PAINT_NAME = re.compile(r"^car_(\d+)\.tga$", re.IGNORECASE)
CUSTOMER_ID = re.compile(r"^\d{1,10}$")
PANELS = Path(__file__).resolve().parent.parent / "data" / "panels"
SOURCE = "Racing Desk fleet build"
PARTS = ".part"                 # where a version's files are written before they are put in place


def sim_running(run: Callable[..., Any] = subprocess.run) -> bool | None:
    """Whether the sim is running: yes, no, or None when the question could not be asked.

    Asked without a window. The whole list is asked for rather than the one name, because an empty
    answer then means the question failed and not that the sim is absent.
    """
    if sys.platform != "win32":
        return False
    try:
        done = run(
            ["tasklist", "/FO", "CSV", "/NH"],
            capture_output=True, text=True, timeout=30,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if done.returncode != 0:
        return None
    names = {row[0].strip().lower() for row in csv.reader(io.StringIO(done.stdout or "")) if row}
    if not names:
        return None
    return any(name in names for name in SIM_PROCESSES)


def below_normal() -> None:
    """Run behind everything else on the machine."""
    if sys.platform != "win32":
        return
    try:
        import ctypes

        kernel32 = ctypes.windll.kernel32
        kernel32.GetCurrentProcess.restype = ctypes.c_void_p
        kernel32.SetPriorityClass.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
        kernel32.SetPriorityClass(kernel32.GetCurrentProcess(), 0x00004000)   # BELOW_NORMAL_PRIORITY_CLASS
    except Exception:  # noqa: BLE001 - a courtesy, never a reason to stop
        pass


def customer_id(library: str | Path) -> str | None:
    """The id the library's paints are named for: the one most of its files carry."""
    seen: Counter[str] = Counter()
    root = Path(library)
    if root.is_dir():
        for f in root.glob("*/*/car_*.tga"):
            m = PAINT_NAME.match(f.name)
            if m:
                seen[m.group(1)] += 1
    return seen.most_common(1)[0][0] if seen else None


def require_customer_id(ident: Any) -> str:
    """A customer id is digits. It becomes part of a file name, so nothing else is taken."""
    text = str(ident).strip() if ident is not None else ""
    if not CUSTOMER_ID.match(text):
        raise LiveryError("the customer id is a number, and this is not one")
    return text


def panel_prefix(folder: str) -> str | None:
    """The prefix a car's logo layers are written under, when it has a panel map."""
    key = cars_mod.fold(folder)
    if not PANELS.is_dir():
        return None
    for f in PANELS.glob("*.json"):
        if cars_mod.fold(f.stem) == key:
            return json.loads(f.read_text(encoding="utf-8")).get("prefix", shatter.DEFAULT_PREFIX)
    return None


@dataclass
class CarResult:
    car: str
    outcome: str                      # built | there | no-template | no-psd | failed
    detail: str = ""
    size: list[int] = dataclass_field(default_factory=list)
    patches: int = 0
    numbers: bool = False
    spec: bool = False
    logos: bool = False
    versions: list[str] = dataclass_field(default_factory=list)
    kept: list[str] = dataclass_field(default_factory=list)      # versions that are someone else's
    skipped_layers: int = 0
    seconds: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


# ---------------------------------------------------------------- whose a version is


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _paint_in(folder: Path) -> Path | None:
    if not folder.is_dir():
        return None
    return next((f for f in sorted(folder.iterdir())
                 if f.is_file() and (PAINT_NAME.match(f.name) or f.name.lower() == "car.tga")), None)


def version_there(library: Path, folder: str, mode: str) -> bool:
    return _paint_in(Path(library) / folder / mode) is not None


def state_of(library: Path, folder: str, mode: str) -> str:
    """What is at a version's place in the library:

        absent      nothing, or an empty folder
        ours        this build's, whole, and as it was written
        unfinished  this build's, stopped before its paint was written
        theirs      anything else: made by hand, made elsewhere, or changed since - never touched
    """
    d = Path(library) / folder / mode
    if not d.exists():
        return "absent"
    if not d.is_dir():
        return "theirs"
    if not any(e.name != PARTS for e in d.iterdir()):
        return "absent"
    try:
        meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return "theirs"
    if not isinstance(meta, dict) or meta.get("source") != SOURCE:
        return "theirs"
    paint = _paint_in(d)
    if paint is None:
        return "unfinished"
    written = meta.get("built") if isinstance(meta.get("built"), dict) else {}
    # The note alone does not make a paint the build's: it has to be the paint the note was written for.
    return "ours" if written.get("paint") == _sha256(paint) else "theirs"


def ours(library: Path, folder: str, mode: str) -> bool:
    return state_of(library, folder, mode) == "ours"


# ---------------------------------------------------------------- the work


def prepare(row: cars_mod.TemplateRow, cache: Path, opener=None, keep_psd: bool = False,
            patterns: bool = False, hold: Callable[[], None] = lambda: None) -> tuple[Path, dict[str, Any]]:
    """A car's work folder: its template fetched, and what a build needs read out of it. Done once."""
    home = template.folder_for(cache, row.paint_folder)
    work = home / "work"
    note = work / "extract.json"
    info = _vouched(work, note)
    if info is not None and (not patterns or info.get("schemes")):
        return work, info
    # What is there is about to be written over, so nothing vouches for it until that is done.
    note.unlink(missing_ok=True)
    archive = template.fetch(row, cache, opener=opener)
    hold()
    psd = template.unpack(archive, home)
    if psd is None:
        raise LiveryError(f"{row.paint_folder}: no PSD in the template iRacing publishes")
    try:
        info = template.extract(psd, work, patterns=patterns)
    finally:
        if not keep_psd:
            psd.unlink(missing_ok=True)       # the archive stays; the PSD is three times its size
    info["template"] = row.template_zip
    _write_whole(note, json.dumps(info, indent=1))
    return work, info


def _vouched(work: Path, note: Path) -> dict[str, Any] | None:
    """The note a finished extraction left, if the files it stands for are there."""
    try:
        info = json.loads(note.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    size = info.get("size") if isinstance(info, dict) else None
    if not (isinstance(size, list) and len(size) == 2 and all(isinstance(v, int) and v > 0 for v in size)):
        return None
    names = list(info.get("guides") or []) + list(info.get("schemes") or [])
    if info.get("spec"):
        names.append("spec_default.png")
    if not all((work / str(name)).is_file() for name in names):
        return None
    return info


def _write_whole(path: Path, text: str) -> None:
    partial = path.with_name(path.name + ".part")
    try:
        partial.write_text(text, encoding="utf-8")
        os.replace(partial, path)
    finally:
        partial.unlink(missing_ok=True)


def write_version(out: Path, ident: str, sheet: np.ndarray, spec: np.ndarray | None,
                  meta: dict[str, Any], rle: bool = True) -> None:
    """The files of one version: the note that it is the build's first, the paint last.

    Each file is written elsewhere and put in its place when it is whole, and the paint is the last
    to appear: a paint in a version's folder means the version is finished, and a folder with the
    note and no paint is one the build was stopped in, which the next run finishes. RLE is what
    iRacing asks for in a paint, and a shard field packs to a seventh of its size; half the paints
    in the sim's own folders are written that way.
    """
    out.mkdir(parents=True, exist_ok=True)
    paint, spec_map, note = out / f"car_{ident}.tga", out / f"car_spec_{ident}.tga", out / "meta.json"
    parts = out / PARTS             # a folder, which the desk does not read as one of the version's files
    parts.mkdir(exist_ok=True)
    try:
        # A rebuild takes the old paint away first, so that a stop part way is never a finished version.
        paint.unlink(missing_ok=True)
        _write_whole(note, json.dumps(meta, indent=2) + "\n")
        built: dict[str, str] = {}
        if spec is not None:
            save_tga(Image.fromarray(spec), parts / spec_map.name, bits=24, rle=rle)
            built["spec"] = _sha256(parts / spec_map.name)
            os.replace(parts / spec_map.name, spec_map)
        else:
            spec_map.unlink(missing_ok=True)
        save_tga(Image.fromarray(sheet), parts / paint.name, bits=24, rle=rle)
        built["paint"] = _sha256(parts / paint.name)
        _write_whole(note, json.dumps({**meta, "built": built}, indent=2) + "\n")
        os.replace(parts / paint.name, paint)
    finally:
        for leftover in parts.glob("*"):
            leftover.unlink(missing_ok=True)
        try:
            parts.rmdir()
        except OSError:
            pass


def _say(exc: BaseException, ident: str) -> str:
    """An error as one line, with the customer id taken out: a path in it names the paint file."""
    text = f"{type(exc).__name__}: {exc}" if not isinstance(exc, LiveryError) else str(exc)
    text = " ".join(text.split())
    return text.replace(ident, "<id>") if ident else text


def build_car(
    folder: str,
    row: cars_mod.TemplateRow | None,
    library: str | Path,
    cache: str | Path,
    ident: str,
    field_path: str | Path,
    force: bool = False,
    rle: bool = True,
    opener=None,
    today: str | None = None,
    hold: Callable[[], None] = lambda: None,
) -> CarResult:
    """Both directions of the livery for one car, written into the library."""
    library, cache = Path(library), Path(cache)
    ident = require_customer_id(ident)
    started = time.monotonic()
    target = cars_mod.painted(library).get(cars_mod.fold(folder), folder)
    states = {m: state_of(library, target, m) for m in shatter.MODES}
    kept = [m for m, s in states.items() if s == "theirs"]
    missing = [m for m, s in states.items() if s in ("absent", "unfinished") or (force and s == "ours")]
    if not missing:
        return CarResult(folder, "there", "both directions are in the library", kept=kept)
    if row is None:
        return CarResult(folder, "no-template", "no template address is known for this car", kept=kept)

    try:
        work, info = prepare(row, cache, opener=opener, hold=hold)
    except LiveryError as exc:
        outcome = "no-psd" if "no PSD" in str(exc) else "failed"
        return CarResult(folder, outcome, _say(exc, ident), kept=kept)
    except Exception as exc:  # noqa: BLE001 - one car's trouble is not the fleet's
        return CarResult(folder, "failed", _say(exc, ident), kept=kept)

    hold()
    try:
        w, h = info["size"]
        spec_template = None
        if (work / "spec_default.png").exists():
            spec_template = np.array(Image.open(work / "spec_default.png").convert("RGB"))
        field = shatter.load_field(field_path, (w, h))
        rects = patches.colour_patches(work)
        prefix = panel_prefix(folder)
        logos = shatter.logo_layers(work, f"{prefix}_*.png", (w, h)) if prefix else None
        has_logos = logos is not None and bool((logos > 0.5).any())

        notes = "The shard field over the whole sheet; colour patches set to the art colour."
        notes += " Logos placed." if has_logos else " No logos yet."
        if spec_template is None:
            notes += (" This car's template has no spec map, so none is written: the sim uses the car's own,"
                      " unless a spec map is already in the car's paint folder, which then stays in use.")
        for mode in missing:
            body, art = shatter.MODES[mode]
            sheet, spec = shatter.paint(field, body, art, spec_template, logos if has_logos else None, rects)
            # No folder is named for the sim: the library's folder is the car's own name, which the
            # desk matches for itself - and a folder it is told of, it takes to be there.
            write_version(library / target / mode, ident, sheet, spec, {
                "name": mode,
                "created": today or time.strftime("%Y-%m-%d"),
                "source": SOURCE,
                "notes": notes,
            }, rle=rle)
    except Exception as exc:  # noqa: BLE001
        return CarResult(folder, "failed", _say(exc, ident), kept=kept)

    return CarResult(
        folder, "built", size=[w, h], patches=len(rects), numbers=patches.number_guide(work) is not None,
        spec=spec_template is not None, logos=has_logos, versions=list(missing), kept=kept,
        skipped_layers=len(info.get("skipped") or []),
        seconds=round(time.monotonic() - started, 1),
    )


def build_fleet(
    folders: list[str],
    library: str | Path,
    cache: str | Path,
    ident: str,
    field_path: str | Path,
    rows: list[cars_mod.TemplateRow] | None = None,
    force: bool = False,
    rle: bool = True,
    limit: int | None = None,
    busy: Callable[[], bool | None] | None = None,
    wait_seconds: float = 120.0,
    sleep: Callable[[float], None] = time.sleep,
    log: Callable[[str], None] = print,
    report: str | Path | None = None,
    opener=None,
) -> list[CarResult]:
    """Every car in turn, until ``limit`` have been built. Waits while the sim runs - or while it
    cannot be told whether it does - and writes the report after each car."""
    ident = require_customer_id(ident)
    rows = cars_mod.load() if rows is None else rows
    busy = busy or sim_running
    results: list[CarResult] = []

    def hold() -> None:
        said = None
        while (state := busy()) is not False:
            saying = "the sim is running: waiting" if state else "cannot tell whether the sim is running: waiting"
            if saying != said:
                log(saying)
                said = saying
            sleep(wait_seconds)

    built = 0
    for n, folder in enumerate(folders, 1):
        if limit is not None and built >= limit:
            break
        hold()
        result = build_car(folder, cars_mod.for_folder(rows, folder), library, cache, ident, field_path,
                           force=force, rle=rle, opener=opener, hold=hold)
        results.append(result)
        built += result.outcome == "built"
        log("%3d/%d  %-34s %-12s %s" % (n, len(folders), folder, result.outcome, _line(result)))
        if report:
            _write_report(Path(report), results)
    return results


def _line(r: CarResult) -> str:
    kept = "; left alone: %s" % ", ".join(r.kept) if r.kept else ""
    if r.outcome != "built":
        return r.detail + kept
    return "%dx%d, %d colour patch(es), number blocks %s, %s, %s%s, %.0f s%s" % (
        r.size[0], r.size[1], r.patches, "found" if r.numbers else "none",
        "spec map" if r.spec else "no spec map", "logos" if r.logos else "no logos",
        ", %d layer(s) could not be read" % r.skipped_layers if r.skipped_layers else "",
        r.seconds, kept)


def _write_report(path: Path, results: list[CarResult]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    counts = Counter(r.outcome for r in results)
    _write_whole(path, json.dumps({"counts": dict(counts), "cars": [r.to_dict() for r in results]}, indent=1))
