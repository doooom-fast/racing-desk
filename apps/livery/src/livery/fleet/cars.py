"""Which car is which: the folder the sim reads a paint from, and where its template is published.

``data/paint_templates.tsv`` is the table from the ``iracing-paint-templates`` skill: a car's name,
its paint folder and the address of iRacing's own template for it. The addresses are public and
need no login. A car missing from the table has a template too; the table just has not met it.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

TABLE = Path(__file__).resolve().parent.parent / "data" / "paint_templates.tsv"

# Walking the install: how deep to look, and the folder in it that holds no cars. Cars sit up to three
# folders deep; one more is slack, as in the desk's own walk (modules/js/paints/catalogue.js), so both
# name the same cars.
MAX_DEPTH = 4
INSTALL_NOT_CARS = ("safety",)


@dataclass(frozen=True)
class TemplateRow:
    car_name: str
    paint_folder: str
    template_code: str
    template_id: str
    template_zip: str


def fold(name: str) -> str:
    """A folder name, comparable: the library writes ``mx5-mx52016``, the sim ``mx5 mx52016``.

    The same folding the desk's Paints page does, so both agree on which car a folder is.
    """
    out: list[str] = []
    for ch in str(name).strip():
        c = " " if ch in "-_" else ch
        if c.isspace():
            if out and out[-1] != " ":
                out.append(" ")
        else:
            out.append(c.lower())
    return "".join(out).rstrip(" ")


def load(path: str | Path = TABLE) -> list[TemplateRow]:
    with open(path, encoding="utf-8", newline="") as fh:
        return [
            TemplateRow(**{k: (row.get(k) or "").strip() for k in TemplateRow.__dataclass_fields__})
            for row in csv.DictReader(fh, delimiter="\t")
        ]


def for_folder(rows: list[TemplateRow], folder: str) -> TemplateRow | None:
    key = fold(folder)
    return next((r for r in rows if fold(r.paint_folder) == key), None)


def find(rows: list[TemplateRow], term: str) -> list[TemplateRow]:
    """By folder or by name, blind to case and punctuation. An exact match wins over a partial one."""
    def squash(text: str) -> str:
        return "".join(ch for ch in text.lower() if ch.isalnum())

    needle = squash(term)
    exact = [r for r in rows if needle in (squash(r.paint_folder), squash(r.car_name))]
    return exact or [r for r in rows if needle in squash(r.car_name) or needle in squash(r.paint_folder)]


def walk(install_dir: str | Path | None) -> tuple[list[str], list[str]]:
    """The folders under an install's ``cars`` that hold a ``.dat`` of their own, in two lists:

        cars      nothing beneath it is a car - lotus79, mx5 mx52016
        families  folders beneath it are cars too - mx5, fordgt

    A name is the folder's path with spaces for separators (``cars\\mx5\\mx52016`` is
    ``mx5 mx52016``), which is what the sim calls its paint folder. A family's ``.dat`` is what the
    cars beneath it are built on, and the disk does not say whether the folder is a car in its own
    right as well: fordgt is (beside ``fordgt gt3``), mx5 is not. Something else has to know.
    """
    if not install_dir:
        return [], []
    found: list[str] = []
    families: list[str] = []

    def visit(directory: Path, parts: tuple[str, ...]) -> bool:
        try:
            entries = list(directory.iterdir())
        except OSError:
            return False
        own = bool(parts) and any(e.is_file() and e.suffix.lower() == ".dat" for e in entries)
        beneath = False
        if len(parts) < MAX_DEPTH:
            for e in entries:
                if not e.is_dir():
                    continue
                if not parts and e.name.lower() in INSTALL_NOT_CARS:
                    continue
                if visit(e, (*parts, e.name)):
                    beneath = True
        if own:
            (families if beneath else found).append(" ".join(parts))
        return own or beneath

    visit(Path(install_dir) / "cars", ())
    return sorted(found), sorted(families)


def installed(install_dir: str | Path | None) -> list[str]:
    """The folders in an install that are certainly cars."""
    return walk(install_dir)[0]


def on_the_rig(install_dir: str | Path | None, rows: list[TemplateRow], library: str | Path | None = None) -> list[str]:
    """Every car in the install: the certain ones, and a family when something knows it as a car -
    the template table has a row for it, or the library a paint."""
    certain, families = walk(install_dir)
    has_paint = painted(library) if library else {}
    known = [f for f in families if for_folder(rows, f) is not None or fold(f) in has_paint]
    return sorted(certain + known)


def painted(library: str | Path) -> dict[str, str]:
    """The cars the library has a paint for: folded name → the library's folder for it."""
    out: dict[str, str] = {}
    root = Path(library)
    if not root.is_dir():
        return out
    for car in sorted(root.iterdir()):
        if not car.is_dir() or car.name.startswith("."):
            continue
        for version in car.iterdir():
            if version.is_dir() and any(_is_paint(f.name) for f in version.iterdir() if f.is_file()):
                out.setdefault(fold(car.name), car.name)
                break
    return out


def _is_paint(name: str) -> bool:
    low = name.lower()
    if not low.endswith(".tga") or not low.startswith("car"):
        return False
    rest = low[3:-4]
    return rest == "" or (rest.startswith("_") and rest[1:].isdigit())
