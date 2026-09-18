"""The car registry — which cars exist, what their paint folder is called, and
how far along their profile is.

Two sources, both useful:

* the iRacing Data API (``livery cars sync``), which is authoritative and knows
  every car on the service including ones you do not own;
* the local disk (``livery cars scan``), which knows exactly what this machine
  has installed and needs no login.

The registry is also the production tracker: ``livery cars coverage`` joins it
against ``profiles/`` so "all cars in iRacing" is a number you can watch go up
rather than a vague ambition.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

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
    source: str = "api"

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

    def sync_from_api(self, cars: Iterable[dict[str, Any]]) -> int:
        added = 0
        for car in cars:
            dirpath = car.get("car_dirpath")
            if not dirpath:
                continue
            if dirpath not in self.cars:
                added += 1
            self.cars[dirpath] = CarEntry(
                car_dirpath=dirpath,
                car_name=car.get("car_name", ""),
                car_id=car.get("car_id"),
                abbrev=car.get("car_name_abbreviated", ""),
                categories=list(car.get("categories") or car.get("car_types") or []),
                package_id=car.get("package_id"),
                owned=car.get("free_with_subscription") or None,
                source="api",
            )
        return added

    def scan_disk(self, *directories: Path | None) -> int:
        """Pick up car folders from the paint directory or an iRacing install."""
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
                    continue
                self.cars[entry.name] = CarEntry(
                    car_dirpath=entry.name,
                    car_name=entry.name,
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
