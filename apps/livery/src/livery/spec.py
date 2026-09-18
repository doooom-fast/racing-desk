"""The livery spec — the thing an agent actually authors.

A spec is YAML that says what the car looks like in car-space terms: which
panels, what colours, which sponsor where, what material. It never mentions
pixels, never mentions which flank a UV island lives on, and never says "flip
this one". Those are the car profile's job, so the same spec can be rebuilt on
a different car and still look like itself.

Everything here is parsing and validation. Unknown keys are errors, and the
error names the keys that *would* have worked — an agent fixes its own spec on
the next pass instead of silently dropping a sponsor.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

import yaml

from .errors import LiveryError

SPEC_VERSION = 1

NUMBER_MODES = ("custom", "sim_stamped")
ORIENTS = ("auto", "car", "reading")
ANCHORS = (
    "center", "nose", "tail", "top", "bottom",
    "nose_top", "nose_bottom", "tail_top", "tail_bottom",
)
BLENDS = ("normal", "multiply", "screen", "overlay", "add")

COMMON_KEYS = {
    "id", "kind", "zones", "sides", "rect", "at", "anchor", "size", "rotate",
    "opacity", "material", "clip", "orient", "flip", "blend", "margin", "note",
}

KIND_KEYS: dict[str, set[str]] = {
    "fill": {"color"},
    "band": {"color", "angle", "taper", "feather"},
    "stripes": {"colors", "color", "count", "gap", "angle", "weight", "feather"},
    "gradient": {"colors", "color", "to", "angle", "shape", "stops"},
    "image": {"source", "fit", "tint", "recolor", "knockout"},
    "logo": {"logo", "variant", "fit", "tint", "clear_space", "min_height_mm", "recolor"},
    "text": {"text", "font", "color", "outline", "tracking", "slant", "case", "fit"},
    "pattern": {"pattern", "source", "colors", "color", "scale", "angle", "density", "fit"},
}


def _check_keys(data: Mapping[str, Any], allowed: set[str], context: str) -> None:
    unknown = sorted(set(data) - allowed)
    if unknown:
        raise LiveryError(
            f"{context}: unknown key(s) {', '.join(unknown)}. Allowed here: "
            f"{', '.join(sorted(allowed))}"
        )


def _as_float(value: Any, context: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise LiveryError(f"{context}: expected a number, got {value!r}") from exc


@dataclass
class Size:
    """How big a mark is, in whatever unit the author found natural."""

    w: float | None = None       # fraction of the zone's nose→tail extent
    h: float | None = None       # fraction of the zone's other extent
    width_mm: float | None = None
    height_mm: float | None = None
    fit: str = "contain"         # contain | cover | stretch

    @classmethod
    def parse(cls, data: Any, context: str) -> "Size":
        if data is None:
            return cls()
        if isinstance(data, (int, float)):
            return cls(h=float(data))
        if not isinstance(data, Mapping):
            raise LiveryError(f"{context}: size must be a number or a mapping")
        _check_keys(data, {"w", "h", "width_mm", "height_mm", "fit"}, f"{context}.size")
        fit = data.get("fit", "contain")
        if fit not in ("contain", "cover", "stretch"):
            raise LiveryError(f"{context}.size.fit must be contain/cover/stretch, got {fit!r}")
        size = cls(
            w=_opt_float(data.get("w"), f"{context}.size.w"),
            h=_opt_float(data.get("h"), f"{context}.size.h"),
            width_mm=_opt_float(data.get("width_mm"), f"{context}.size.width_mm"),
            height_mm=_opt_float(data.get("height_mm"), f"{context}.size.height_mm"),
            fit=fit,
        )
        if size.w is not None and size.width_mm is not None:
            raise LiveryError(f"{context}.size: give w or width_mm, not both")
        if size.h is not None and size.height_mm is not None:
            raise LiveryError(f"{context}.size: give h or height_mm, not both")
        return size

    @property
    def is_empty(self) -> bool:
        return all(v is None for v in (self.w, self.h, self.width_mm, self.height_mm))


def _opt_float(value: Any, context: str) -> float | None:
    return None if value is None else _as_float(value, context)


@dataclass
class Element:
    """One mark: a fill, a band, a logo, a line of text.

    Placement is author space: ``u`` runs nose→tail, ``v`` runs top→bottom (or
    left→right on horizontal panels). Identical on both flanks — the profile
    turns it into pixels.
    """

    kind: str
    id: str = ""
    zones: list[str] = field(default_factory=list)
    sides: str = "both"
    rect: tuple[float, float, float, float] | None = None
    at: tuple[float, float] | None = None
    anchor: str = "center"
    size: Size = field(default_factory=Size)
    rotate: float = 0.0
    opacity: float = 1.0
    material: Any = None
    clip: bool = True
    orient: str = "auto"
    flip: str = "auto"  # auto (respect the island) | never | always
    blend: str = "normal"
    margin: float = 0.0
    note: str = ""
    params: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def parse(cls, data: Mapping[str, Any], index: int) -> "Element":
        if not isinstance(data, Mapping):
            raise LiveryError(f"layers[{index}]: expected a mapping, got {type(data).__name__}")
        kind = data.get("kind")
        if kind not in KIND_KEYS:
            raise LiveryError(
                f"layers[{index}]: kind must be one of {', '.join(sorted(KIND_KEYS))}, got {kind!r}"
            )
        ident = str(data.get("id") or f"{kind}-{index}")
        context = f"layer {ident}"
        _check_keys(data, COMMON_KEYS | KIND_KEYS[kind], context)

        zones = data.get("zones")
        if isinstance(zones, str):
            zones = [zones]
        if not zones:
            raise LiveryError(f"{context}: zones is required (e.g. zones: [door] or zones: [@flank])")

        rect = data.get("rect")
        if rect is not None:
            if len(rect) != 4:
                raise LiveryError(f"{context}.rect must be [u, v, w, h] in 0-1")
            rect = tuple(_as_float(v, f"{context}.rect") for v in rect)
        at = data.get("at")
        if at is not None:
            if isinstance(at, Mapping):
                _check_keys(at, {"u", "v"}, f"{context}.at")
                at = (_as_float(at.get("u", 0.5), f"{context}.at.u"),
                      _as_float(at.get("v", 0.5), f"{context}.at.v"))
            elif len(at) == 2:
                at = (_as_float(at[0], f"{context}.at"), _as_float(at[1], f"{context}.at"))
            else:
                raise LiveryError(f"{context}.at must be {{u: .., v: ..}} or [u, v]")
        if rect is not None and at is not None:
            raise LiveryError(f"{context}: give rect or at, not both")

        anchor = data.get("anchor", "center")
        if anchor not in ANCHORS:
            raise LiveryError(f"{context}.anchor must be one of {', '.join(ANCHORS)}, got {anchor!r}")
        orient = data.get("orient", "auto")
        if orient not in ORIENTS:
            raise LiveryError(f"{context}.orient must be one of {', '.join(ORIENTS)}")
        flip = data.get("flip", "auto")
        if flip not in ("auto", "never", "always"):
            raise LiveryError(f"{context}.flip must be auto/never/always")
        blend = data.get("blend", "normal")
        if blend not in BLENDS:
            raise LiveryError(f"{context}.blend must be one of {', '.join(BLENDS)}")
        sides = data.get("sides", "both")
        if sides not in ("both", "left", "right", "center", "all"):
            raise LiveryError(f"{context}.sides must be both/left/right/center")

        params = {k: v for k, v in data.items() if k in KIND_KEYS[kind]}
        return cls(
            kind=kind,
            id=ident,
            zones=list(zones),
            sides=sides,
            rect=rect,  # type: ignore[arg-type]
            at=at,  # type: ignore[arg-type]
            anchor=anchor,
            size=Size.parse(data.get("size"), context),
            rotate=_as_float(data.get("rotate", 0.0), f"{context}.rotate"),
            opacity=_as_float(data.get("opacity", 1.0), f"{context}.opacity"),
            material=data.get("material"),
            clip=bool(data.get("clip", True)),
            orient=orient,
            flip=flip,
            blend=blend,
            margin=_as_float(data.get("margin", 0.0), f"{context}.margin"),
            note=str(data.get("note", "")),
            params=params,
        )

    @property
    def effective_orient(self) -> str:
        """Shapes mirror across the car; anything with reading direction does not."""
        if self.orient != "auto":
            return self.orient
        return "reading" if self.kind in ("logo", "text", "image") else "car"


@dataclass
class NumberSpec:
    """Race numbers. Their own type because they are their own discipline:
    sized for a spotter's glance, outlined for contrast, and either baked in or
    left for the sim to stamp."""

    value: str = ""
    zones: list[str] = field(default_factory=list)
    font: str | None = None
    color: Any = "#ffffff"
    outline: dict[str, Any] = field(default_factory=dict)
    shadow: dict[str, Any] = field(default_factory=dict)
    size: Size = field(default_factory=lambda: Size(h=0.55))
    at: tuple[float, float] | None = None
    anchor: str = "center"
    slant: float = 0.0
    tracking: float = 0.0
    material: Any = None
    per_zone: dict[str, dict[str, Any]] = field(default_factory=dict)

    @classmethod
    def parse(cls, data: Mapping[str, Any] | None) -> "NumberSpec | None":
        if not data:
            return None
        _check_keys(
            data,
            {"value", "zones", "font", "color", "outline", "shadow", "size", "at",
             "anchor", "slant", "tracking", "material", "per_zone"},
            "numbers",
        )
        value = str(data.get("value", "")).strip()
        if not value:
            raise LiveryError("numbers.value is required (the race number, as a string)")
        zones = data.get("zones")
        if isinstance(zones, str):
            zones = [zones]
        at = data.get("at")
        if isinstance(at, Mapping):
            _check_keys(at, {"u", "v"}, "numbers.at")
            at = (_as_float(at.get("u", 0.5), "numbers.at.u"), _as_float(at.get("v", 0.5), "numbers.at.v"))
        elif at is not None:
            at = (_as_float(at[0], "numbers.at"), _as_float(at[1], "numbers.at"))
        anchor = data.get("anchor", "center")
        if anchor not in ANCHORS:
            raise LiveryError(f"numbers.anchor must be one of {', '.join(ANCHORS)}")
        return cls(
            value=value,
            at=at,
            anchor=anchor,
            zones=list(zones or []),
            font=data.get("font"),
            color=data.get("color", "#ffffff"),
            outline=dict(data.get("outline") or {}),
            shadow=dict(data.get("shadow") or {}),
            size=Size.parse(data.get("size"), "numbers") if data.get("size") is not None else Size(h=0.55),
            slant=_as_float(data.get("slant", 0.0), "numbers.slant"),
            tracking=_as_float(data.get("tracking", 0.0), "numbers.tracking"),
            material=data.get("material"),
            per_zone={k: dict(v) for k, v in (data.get("per_zone") or {}).items()},
        )


@dataclass
class WheelSpec:
    """Wheels. Most iRacing cars take rim colour from the paint shop UI rather
    than the paint TGA, so this may resolve to an instruction in the build
    report rather than pixels — see docs/DESIGN.md."""

    color: Any = None
    material: Any = None
    zones: list[str] = field(default_factory=lambda: ["wheel"])
    note: str = ""

    @classmethod
    def parse(cls, data: Mapping[str, Any] | None) -> "WheelSpec | None":
        if not data:
            return None
        _check_keys(data, {"color", "material", "zones", "note"}, "wheels")
        zones = data.get("zones") or ["wheel"]
        if isinstance(zones, str):
            zones = [zones]
        return cls(
            color=data.get("color"),
            material=data.get("material"),
            zones=list(zones),
            note=str(data.get("note", "")),
        )


@dataclass
class LiverySpec:
    car: str
    name: str = "untitled"
    version: int = SPEC_VERSION
    number_mode: str = "custom"
    customer_id: str | None = None
    resolution: int | None = None
    palette: dict[str, str] = field(default_factory=dict)
    base: dict[str, Any] = field(default_factory=lambda: {"color": "#ffffff"})
    layers: list[Element] = field(default_factory=list)
    numbers: NumberSpec | None = None
    wheels: WheelSpec | None = None
    spec_overrides: list[Element] = field(default_factory=list)
    art_direction: str = ""
    source: str | None = None

    @classmethod
    def parse(cls, data: Mapping[str, Any], source: str | None = None) -> "LiverySpec":
        if not isinstance(data, Mapping):
            raise LiveryError("a livery spec must be a YAML mapping")
        _check_keys(
            data,
            {"version", "car", "name", "number_mode", "customer_id", "resolution",
             "palette", "base", "layers", "sponsors", "numbers", "wheels",
             "spec_overrides", "art_direction"},
            "spec",
        )
        if "car" not in data:
            raise LiveryError("spec.car is required — the iRacing car_dirpath, e.g. ferrari296gt3")
        version = int(data.get("version", SPEC_VERSION))
        if version != SPEC_VERSION:
            raise LiveryError(f"spec version {version} is not supported (this build speaks {SPEC_VERSION})")
        number_mode = data.get("number_mode", "custom")
        if number_mode not in NUMBER_MODES:
            raise LiveryError(f"number_mode must be one of {NUMBER_MODES}, got {number_mode!r}")

        base = data.get("base") or {"color": "#ffffff"}
        if isinstance(base, str):
            base = {"color": base}
        _check_keys(base, {"color", "material"}, "base")

        layers: list[Element] = []
        for i, raw in enumerate(data.get("layers") or []):
            layers.append(Element.parse(raw, i))
        # `sponsors:` is sugar for logo layers — it reads better in a spec and
        # keeps brand placements visibly separate from the paint design.
        for i, raw in enumerate(data.get("sponsors") or []):
            if not isinstance(raw, Mapping):
                raise LiveryError(f"sponsors[{i}]: expected a mapping")
            merged = {"kind": "logo", **raw}
            merged.setdefault("id", f"sponsor-{raw.get('logo', i)}-{i}")
            layers.append(Element.parse(merged, i))

        overrides = [Element.parse({"kind": "fill", **raw}, i)
                     for i, raw in enumerate(data.get("spec_overrides") or [])]

        spec = cls(
            car=str(data["car"]),
            name=str(data.get("name", "untitled")),
            version=version,
            number_mode=number_mode,
            customer_id=_opt_str(data.get("customer_id")),
            resolution=int(data["resolution"]) if data.get("resolution") else None,
            palette={str(k): str(v) for k, v in (data.get("palette") or {}).items()},
            base=dict(base),
            layers=layers,
            numbers=NumberSpec.parse(data.get("numbers")),
            wheels=WheelSpec.parse(data.get("wheels")),
            spec_overrides=overrides,
            art_direction=str(data.get("art_direction", "")),
            source=source,
        )
        spec.validate()
        return spec

    @classmethod
    def load(cls, path: str | Path) -> "LiverySpec":
        p = Path(path)
        if not p.exists():
            raise LiveryError(f"no livery spec at {p}")
        return cls.parse(yaml.safe_load(p.read_text(encoding="utf-8")) or {}, source=str(p))

    def validate(self) -> None:
        ids = [layer.id for layer in self.layers]
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        if dupes:
            raise LiveryError(f"duplicate layer ids: {', '.join(dupes)} — ids must be unique")
        if self.number_mode == "sim_stamped" and self.numbers and self.numbers.zones:
            raise LiveryError(
                "number_mode is sim_stamped but numbers.zones asks to paint numbers. "
                "Use number_mode: custom to bake numbers into the paint, or drop numbers.zones."
            )

    @property
    def slug(self) -> str:
        cleaned = [c.lower() if c.isalnum() else "-" for c in self.name]
        slug = "".join(cleaned).strip("-")
        while "--" in slug:
            slug = slug.replace("--", "-")
        return slug or "untitled"


def _opt_str(value: Any) -> str | None:
    return None if value is None else str(value)
