"""The car registry — which cars exist, what their paint folder is called, and
how far along their profile is.

It is learned from the rig (``livery cars scan``): the iRacing install's
``cars/`` folder, one folder per car owned, plus the paint folder. Pro Drive uses
no authenticated iRacing endpoint, so cars you do not own are not listed — and
you cannot race them anyway.

The registry is also the production tracker: ``livery cars coverage`` joins it
against ``profiles/`` so "all cars in iRacing" is a number you can watch go up
rather than a vague ambition.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .profile import CONFIDENCE, CarProfile


@dataclass
class CarEntry:
    car_dirpath: str
    car_name: str = ""
    car_id: int | None = None
    abbrev: str = ""
    categories: list[str] = field(default_factory=list)
    package_id: int | None = None
    owned: bool | None = None
    source: str = "disk"

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in self.__dict__.items() if v not in (None, [], "")}


class CarRegistry:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.cars: dict[str, CarEntry] = {}
        if self.path.exists():
            self.load()

    def load(self) -> None:
        data = json.loads(self.path.read_text(encoding="utf-8"))
        self.cars = {
            entry["car_dirpath"]: CarEntry(**entry) for entry in data.get("cars", [])
        }

    def save(self) -> Path:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "cars": [c.to_dict() for c in sorted(self.cars.values(), key=lambda c: c.car_dirpath)]
        }
        self.path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return self.path

    # ---------------------------------------------------------------- sources

    def scan_disk(self, *directories: Path | None, owned: bool | None = None) -> int:
        """Pick up car folders from the paint directory or an iRacing install's ``cars/``.

        ``owned=True`` for the install: a car folder there means the car is installed,
        which on this rig means owned.
        """
        found = 0
        for directory in directories:
            if not directory:
                continue
            root = Path(directory)
            if not root.exists():
                continue
            for entry in sorted(root.iterdir()):
                if not entry.is_dir() or entry.name.startswith("."):
                    continue
                if entry.name in self.cars:
                    if owned:
                        self.cars[entry.name].owned = True
                    continue
                self.cars[entry.name] = CarEntry(
                    car_dirpath=entry.name,
                    car_name=entry.name,
                    owned=owned,
                    source=f"disk:{root.name}",
                )
                found += 1
        return found

    # ----------------------------------------------------------------- access

    def find(self, term: str) -> list[CarEntry]:
        """Match on dirpath, name or abbreviation — case and punctuation blind."""
        needle = _normalize(term)
        exact = [c for c in self.cars.values() if _normalize(c.car_dirpath) == needle]
        if exact:
            return exact
        return [
            c
            for c in sorted(self.cars.values(), key=lambda c: c.car_dirpath)
            if needle in _normalize(c.car_dirpath)
            or needle in _normalize(c.car_name)
            or needle in _normalize(c.abbrev)
        ]

    def coverage(self, profiles_dir: Path) -> dict[str, Any]:
        """How much of the roster can actually be painted today."""
        rows = []
        counts = {level: 0 for level in CONFIDENCE}
        counts["missing"] = 0
        for car in sorted(self.cars.values(), key=lambda c: c.car_dirpath):
            profile_path = Path(profiles_dir) / f"{car.car_dirpath}.yaml"
            if profile_path.exists():
                try:
                    confidence = CarProfile.load(profile_path).confidence
                except Exception as exc:  # a broken profile is worse than none
                    confidence = f"broken: {exc}"
            else:
                confidence = "missing"
            counts[confidence] = counts.get(confidence, 0) + 1
            rows.append(
                {"car": car.car_dirpath, "name": car.car_name, "confidence": confidence}
            )
        return {"total": len(rows), "counts": counts, "cars": rows}


def _normalize(text: str) -> str:
    return "".join(ch for ch in text.lower() if ch.isalnum())
