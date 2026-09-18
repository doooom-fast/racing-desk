"""Car profiles — the flat model of one iRacing car's paint template.

A profile is what makes a livery spec portable between cars. It says how big the
template is, which rectangles of it are which panel, which way each panel faces,
and how many pixels make a metre there. Specs address panels by name
(``door``, ``hood``, ``rear_quarter``), never by pixel.

Profiles are data, not code: ``profiles/<car_dirpath>.yaml``. Confidence is
tracked honestly — a profile bootstrapped from a template PSD is ``draft`` until
someone has looked at the zone overlay and confirmed it in the sim.
"""

from __future__ import annotations

import fnmatch
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Sequence

import yaml

from .errors import ProfileError
from .geom import PanelFrame, Plane, Side, map_rect, panel_frame

CONFIDENCE = ("draft", "checked", "verified")


@dataclass
class Zone:
    """One named, oriented rectangle of the template."""

    name: str
    rect: tuple[float, float, float, float]  # normalized x, y, w, h of the canvas
    plane: Plane = "side"
    side: Side = "center"
    axes: dict[str, str] = field(default_factory=dict)
    tags: list[str] = field(default_factory=list)
    px_per_meter: float | None = None
    mask: str | None = None  # path to a PNG mask, white = paintable
    notes: str | None = None

    def __post_init__(self) -> None:
        if len(self.rect) != 4:
            raise ProfileError(f"zone {self.name}: rect must be [x, y, w, h] in 0-1")
        x, y, w, h = self.rect
        if w <= 0 or h <= 0:
            raise ProfileError(f"zone {self.name}: rect width/height must be > 0")
        if not (0 <= x <= 1 and 0 <= y <= 1 and x + w <= 1.0001 and y + h <= 1.0001):
            raise ProfileError(f"zone {self.name}: rect {self.rect} falls outside the canvas")

    @property
    def part(self) -> str:
        """``door.left`` → ``door``."""
        return self.name.split(".", 1)[0]

    @property
    def frame(self) -> PanelFrame:
        return panel_frame(self.plane, self.side, self.axes)

    def pixel_rect(self, canvas: tuple[int, int]) -> tuple[float, float, float, float]:
        cw, ch = canvas
        x, y, w, h = self.rect
        return (x * cw, y * ch, w * cw, h * ch)

    def map_rect(
        self, canvas: tuple[int, int], u: float, v: float, w: float, h: float
    ) -> tuple[int, int, int, int]:
        return map_rect(self.pixel_rect(canvas), self.frame, u, v, w, h)

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "rect": [round(float(v), 5) for v in self.rect],
            "plane": self.plane,
            "side": self.side,
            "axes": dict(self.axes),
        }
        if self.tags:
            out["tags"] = list(self.tags)
        if self.px_per_meter:
            out["px_per_meter"] = self.px_per_meter
        if self.mask:
            out["mask"] = self.mask
        if self.notes:
            out["notes"] = self.notes
        return out


@dataclass
class CarProfile:
    car: str  # iRacing car_dirpath, e.g. "ferrari296gt3" — the paint folder name
    display_name: str = ""
    canvas: tuple[int, int] = (2048, 2048)
    alpha: str = "none"  # none | glass  (glass → 32-bit TGA carrying the template alpha)
    px_per_meter: float = 700.0
    confidence: str = "draft"
    number_zones: list[str] = field(default_factory=list)
    wheels: dict[str, Any] = field(default_factory=dict)
    template: dict[str, Any] = field(default_factory=dict)
    zones: dict[str, Zone] = field(default_factory=dict)
    notes: str | None = None
    source: str | None = None

    # ---------------------------------------------------------------- loading

    @classmethod
    def from_dict(cls, data: dict[str, Any], source: str | None = None) -> "CarProfile":
        if "car" not in data:
            raise ProfileError("profile is missing the required 'car' key (the iRacing car_dirpath)")
        canvas = data.get("canvas", {"width": 2048, "height": 2048})
        if isinstance(canvas, dict):
            canvas_t = (int(canvas.get("width", 2048)), int(canvas.get("height", 2048)))
        else:
            canvas_t = (int(canvas[0]), int(canvas[1]))
        confidence = data.get("confidence", "draft")
        if confidence not in CONFIDENCE:
            raise ProfileError(f"confidence must be one of {CONFIDENCE}, got {confidence!r}")

        zones: dict[str, Zone] = {}
        for name, z in (data.get("zones") or {}).items():
            if not isinstance(z, dict):
                raise ProfileError(f"zone {name}: expected a mapping, got {type(z).__name__}")
            zones[name] = Zone(
                name=name,
                rect=tuple(float(v) for v in z["rect"]),  # type: ignore[arg-type]
                plane=z.get("plane", "side"),
                side=z.get("side", _side_from_name(name)),
                axes=dict(z.get("axes") or {}),
                tags=list(z.get("tags") or []),
                px_per_meter=z.get("px_per_meter"),
                mask=z.get("mask"),
                notes=z.get("notes"),
            )
        profile = cls(
            car=data["car"],
            display_name=data.get("display_name", ""),
            canvas=canvas_t,
            alpha=data.get("alpha", "none"),
            px_per_meter=float(data.get("px_per_meter", 700.0)),
            confidence=confidence,
            number_zones=list(data.get("number_zones") or []),
            wheels=dict(data.get("wheels") or {}),
            template=dict(data.get("template") or {}),
            zones=zones,
            notes=data.get("notes"),
            source=source,
        )
        profile.validate()
        return profile

    @classmethod
    def load(cls, path: str | Path) -> "CarProfile":
        p = Path(path)
        if not p.exists():
            raise ProfileError(f"no profile at {p}")
        with p.open("r", encoding="utf-8") as fh:
            return cls.from_dict(yaml.safe_load(fh) or {}, source=str(p))

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "car": self.car,
            "display_name": self.display_name,
            "canvas": {"width": self.canvas[0], "height": self.canvas[1]},
            "alpha": self.alpha,
            "px_per_meter": self.px_per_meter,
            "confidence": self.confidence,
        }
        if self.number_zones:
            out["number_zones"] = list(self.number_zones)
        if self.wheels:
            out["wheels"] = dict(self.wheels)
        if self.template:
            out["template"] = dict(self.template)
        if self.notes:
            out["notes"] = self.notes
        out["zones"] = {name: z.to_dict() for name, z in self.zones.items()}
        return out

    def save(self, path: str | Path) -> Path:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("w", encoding="utf-8") as fh:
            yaml.safe_dump(self.to_dict(), fh, sort_keys=False, allow_unicode=True)
        return p

    # ------------------------------------------------------------- validation

    def validate(self) -> None:
        for zone in self.zones.values():
            zone.frame  # raises ProfileError if the axes don't describe a real panel
        for name in self.number_zones:
            if name not in self.zones:
                raise ProfileError(f"number_zones references unknown zone {name!r}")
        for pair in self.mirror_pairs():
            left, right = pair
            lz, rz = self.zones[left], self.zones[right]
            if abs(lz.rect[2] * lz.rect[3] - rz.rect[2] * rz.rect[3]) > 0.5 * lz.rect[2] * lz.rect[3]:
                raise ProfileError(
                    f"mirror pair {left}/{right} differ wildly in area — one of the rects is wrong"
                )

    def mirror_pairs(self) -> list[tuple[str, str]]:
        """Zones that are the same part on opposite flanks."""
        pairs = []
        for name, zone in self.zones.items():
            if zone.side != "left":
                continue
            partner = f"{zone.part}.right"
            if partner in self.zones:
                pairs.append((name, partner))
        return sorted(pairs)

    # -------------------------------------------------------------- selection

    def select(self, selectors: Sequence[str], sides: str = "both") -> list[Zone]:
        """Resolve spec zone selectors to concrete zones.

        A selector is an exact zone name (``door.left``), a part name
        (``door`` → both flanks, filtered by ``sides``), a tag (``@flank``), or
        a glob (``rear_*``). Unknown selectors raise, with the zone list in the
        message — an agent gets told what it *could* have said.
        """
        wanted: list[Zone] = []
        seen: set[str] = set()
        for sel in selectors:
            matched = self._match(sel, sides)
            if not matched:
                raise ProfileError(
                    f"{self.car}: no zone matches {sel!r}. Known zones: "
                    f"{', '.join(sorted(self.zones))}"
                )
            for zone in matched:
                if zone.name not in seen:
                    seen.add(zone.name)
                    wanted.append(zone)
        return wanted

    def _match(self, sel: str, sides: str) -> list[Zone]:
        if sel.startswith("@"):
            tag = sel[1:]
            pool = [z for z in self.zones.values() if tag in z.tags]
        elif sel in self.zones:
            return [self.zones[sel]]
        elif any(ch in sel for ch in "*?["):
            pool = [z for z in self.zones.values() if fnmatch.fnmatch(z.name, sel)]
        else:
            pool = [z for z in self.zones.values() if z.part == sel]
        return [z for z in pool if _side_allowed(z.side, sides)]

    def zone(self, name: str) -> Zone:
        if name not in self.zones:
            raise ProfileError(
                f"{self.car} has no zone {name!r}. Known: {', '.join(sorted(self.zones))}"
            )
        return self.zones[name]

    def px_per_meter_for(self, zone: Zone) -> float:
        return zone.px_per_meter or self.px_per_meter


def _side_from_name(name: str) -> Side:
    suffix = name.rsplit(".", 1)[-1]
    return suffix if suffix in ("left", "right") else "center"  # type: ignore[return-value]


def _side_allowed(side: str, sides: str) -> bool:
    if sides in ("both", "all"):
        return True
    if sides == "left":
        return side in ("left", "center")
    if sides == "right":
        return side in ("right", "center")
    if sides == "center":
        return side == "center"
    raise ProfileError(f"sides must be both/left/right/center, got {sides!r}")


def find_profile(car: str, search: Iterable[str | Path]) -> Path:
    """Locate ``<car>.yaml`` in the profile search path."""
    tried = []
    for root in search:
        candidate = Path(root) / f"{car}.yaml"
        tried.append(str(candidate))
        if candidate.exists():
            return candidate
    raise ProfileError(
        f"no profile for car {car!r}. Looked in: {', '.join(tried)}. "
        f"Bootstrap one with: livery profile bootstrap {car}"
    )
