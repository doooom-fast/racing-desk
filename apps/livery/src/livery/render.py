"""The renderer: spec + profile + art → albedo and spec-map canvases.

Order of business, once per build:

1. flood the base colour and base material
2. lay every layer down, zone by zone, in spec order
3. bake the numbers (unless the sim is stamping them)
4. apply spec-only material overrides (glass, carbon trim)
5. colour the wheels, or report that the sim's paint shop has to do it
6. check what was built: legibility, clear space, marks that missed their panel

Step 6 is the point of doing this in code. A generated livery that nobody checks
is a livery with a 40mm sponsor logo on the splitter and a number you cannot
read at 200 metres.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence

import numpy as np
from PIL import Image

from . import art as artmod
from . import color as colormod
from . import marks, place, remix
from .canvas import PaintCanvas
from .errors import LiveryError
from .materials import Material, MaterialLibrary, default_library
from .profile import CarProfile, Zone
from .spec import Element, LiverySpec, NumberSpec

NOMINAL_TEXT_PX = 240
MIN_NUMBER_CONTRAST = 3.0
MIN_LOGO_CONTRAST = 1.8


@dataclass
class BuildReport:
    car: str
    livery: str
    canvas: tuple[int, int]
    number_mode: str
    warnings: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    manual_steps: list[str] = field(default_factory=list)
    placements: list[dict[str, Any]] = field(default_factory=list)
    outputs: dict[str, str] = field(default_factory=dict)
    spec_digest: str = ""

    def warn(self, message: str) -> None:
        if message not in self.warnings:
            self.warnings.append(message)

    def note(self, message: str) -> None:
        if message and message not in self.notes:
            self.notes.append(message)

    def manual(self, message: str) -> None:
        if message not in self.manual_steps:
            self.manual_steps.append(message)

    def to_dict(self) -> dict[str, Any]:
        return {
            "car": self.car,
            "livery": self.livery,
            "canvas": list(self.canvas),
            "number_mode": self.number_mode,
            "spec_digest": self.spec_digest,
            "outputs": dict(self.outputs),
            "warnings": list(self.warnings),
            "notes": list(self.notes),
            "manual_steps": list(self.manual_steps),
            "placements": list(self.placements),
        }


@dataclass
class RenderResult:
    canvas: PaintCanvas
    report: BuildReport


class Renderer:
    def __init__(
        self,
        spec: LiverySpec,
        profile: CarProfile,
        art_library: artmod.ArtLibrary,
        materials: MaterialLibrary | None = None,
        base_dir: str | Path | None = None,
    ):
        self.spec = spec
        self.profile = profile
        self.art = art_library
        self.materials = materials or default_library()
        self.base_dir = Path(base_dir) if base_dir else Path.cwd()
        if spec.car != profile.car:
            raise LiveryError(
                f"spec is for car {spec.car!r} but the profile is for {profile.car!r}"
            )
        self.size = self._canvas_size()
        self._occupied: dict[str, list[tuple[tuple[int, int, int, int], str]]] = {}

    def _canvas_size(self) -> tuple[int, int]:
        w, h = self.profile.canvas
        if self.spec.resolution:
            target = int(self.spec.resolution)
            if target not in (512, 1024, 2048, 4096):
                raise LiveryError(
                    f"resolution must be 512/1024/2048/4096, got {target}"
                )
            aspect = h / w
            return (target, int(round(target * aspect)))
        return (w, h)

    # ---------------------------------------------------------------- helpers

    def color(self, value: Any, default: str = "#ffffff") -> tuple[int, int, int, int]:
        return colormod.parse(value if value is not None else default, self.spec.palette)

    def material(self, value: Any, fallback: Material | None = None) -> Material:
        if value is None:
            return fallback or self.materials.resolve(self.spec.base.get("material"))
        return self.materials.resolve(value)

    def zone_clip(self, zone: Zone) -> np.ndarray:
        base = Path(self.profile.source).parent if self.profile.source else self.base_dir
        return place.zone_mask(zone, self.size, base)

    # ----------------------------------------------------------------- render

    def render(self) -> RenderResult:
        report = BuildReport(
            car=self.spec.car,
            livery=self.spec.name,
            canvas=self.size,
            number_mode=self.spec.number_mode,
            spec_digest=self.digest(),
        )
        if self.profile.confidence == "draft":
            report.warn(
                f"profile {self.profile.car} is still 'draft' — check the zone overlay "
                f"(livery preview --zones) before trusting placements"
            )

        base_material = self.materials.resolve(self.spec.base.get("material"))
        base_color = self.color(self.spec.base.get("color"), "#ffffff")
        base_color, note = base_material.apply_albedo_rule(base_color)
        report.note(note or "")
        canvas = PaintCanvas.new(self.size[0], self.size[1], base_color, base_material)
        self._load_template_alpha(canvas, report)

        for element in self.spec.layers:
            self._render_element(canvas, element, report)

        if self.spec.number_mode == "custom":
            self._render_numbers(canvas, report)
        else:
            report.note(
                "number_mode: sim_stamped — the sim stamps the number, so the paint "
                "ships without one. Set your number design in the iRacing UI."
            )

        self._apply_spec_overrides(canvas, report)
        self._render_wheels(canvas, report)
        return RenderResult(canvas=canvas, report=report)

    def _load_template_alpha(self, canvas: PaintCanvas, report: BuildReport) -> None:
        """Some cars want a 32-bit TGA whose alpha came from the template."""
        if self.profile.alpha != "glass":
            return
        ref = self.profile.template.get("alpha")
        if not ref:
            report.warn(
                f"{self.profile.car}: profile says alpha: glass but template.alpha names no file. "
                f"The paint will ship with a solid alpha, which can make glass opaque in the sim."
            )
            return
        path = Path(ref)
        if not path.is_absolute():
            base = Path(self.profile.source).parent if self.profile.source else self.base_dir
            path = base / path
        if not path.exists():
            raise LiveryError(f"template alpha not found at {path}")
        alpha = Image.open(path).convert("L").resize(self.size, Image.Resampling.LANCZOS)
        canvas.glass_alpha = np.asarray(alpha, dtype=np.float32) / 255.0
        report.note(f"carried the template's glass alpha through from {path.name}")

    # --------------------------------------------------------------- elements

    def _render_element(self, canvas: PaintCanvas, element: Element, report: BuildReport) -> None:
        zones = self.profile.select(element.zones, element.sides)
        for zone in zones:
            self._render_on_zone(canvas, element, zone, report)

    def _render_on_zone(
        self, canvas: PaintCanvas, element: Element, zone: Zone, report: BuildReport
    ) -> None:
        aspect = self._art_aspect(element)
        placement = place.resolve(element, zone, self.profile, self.size, aspect)
        art, material, extra_notes = self._build_art(element, placement, canvas, report)
        for note in extra_notes:
            report.note(note)

        box = placement.box
        if element.rotate:
            art, new_size = place.rotate_in_frame(art, element.rotate)
            box = place.recenter(box, new_size)
        art = place.orient(art, placement, element.flip)

        clip = self.zone_clip(zone) if element.clip else None
        stamped = canvas.stamp(
            art, box, material=material, opacity=element.opacity, blend=element.blend, clip=clip
        )
        if stamped.potential <= 0:
            report.warn(f"layer {element.id} on {zone.name} has no ink in it — is the art empty?")
        elif stamped.applied <= 0:
            report.warn(
                f"layer {element.id} on {zone.name} painted nothing — the placement falls "
                f"outside the zone (box {box}, zone rect {zone.rect})"
            )
        elif stamped.ratio < 0.97:
            report.warn(
                f"layer {element.id} on {zone.name}: {1 - stamped.ratio:.0%} of it is being clipped "
                f"off the panel — shrink it, move it (at:), or give it a rect that fits"
            )

        if element.kind in ("logo", "text"):
            self._claim_space(element, placement, box, report)

        report.placements.append(
            {
                "layer": element.id,
                "kind": element.kind,
                "zone": zone.name,
                "box": list(box),
                "mirrored": placement.mirrored,
                "orient": element.effective_orient,
                "material": material.name if material else None,
                "height_mm": round(place.px_to_mm(box[3], placement.ppm), 1),
            }
        )

    def _claim_space(
        self,
        element: Element,
        placement: place.Placement,
        box: tuple[int, int, int, int],
        report: BuildReport,
    ) -> None:
        """Reserve a mark's clear space and complain if it lands on another's.

        A number over a sponsor is the single most common failure in a generated
        livery: both are legible alone and neither is legible together.
        """
        if element.kind == "logo":
            logo = self.art.get(element.params["logo"])
            clear = float(element.params.get("clear_space", logo.clear_space))
            label = logo.id
        else:
            clear = 0.12
            label = element.id
        keep_out = artmod.clear_space_box(box, clear)
        for other_box, other_id in self._occupied.get(placement.zone.name, []):
            if artmod.boxes_overlap(keep_out, other_box):
                report.warn(
                    f"{label} and {other_id} overlap on {placement.zone.name} (clear space "
                    f"{clear:.0%}) — they will read as one blurred mark at racing distance"
                )
        self._occupied.setdefault(placement.zone.name, []).append((keep_out, label))

    def _art_aspect(self, element: Element) -> float | None:
        if element.kind == "logo":
            logo = self.art.get(element.params["logo"])
            variant = element.params.get("variant") or "default"
            try:
                return logo.aspect(variant)
            except artmod.ArtError:
                return logo.aspect()
        if element.kind == "image":
            path = self.art.resolve_source(element.params["source"])
            with Image.open(path) as img:
                return img.width / max(1, img.height)
        if element.kind == "text":
            art = self._text_art(element, NOMINAL_TEXT_PX)
            return art.width / max(1, art.height)
        return None

    def _build_art(
        self,
        element: Element,
        placement: place.Placement,
        canvas: PaintCanvas,
        report: BuildReport,
    ) -> tuple[Image.Image, Material | None, list[str]]:
        w, h = placement.art_size
        params = element.params
        notes: list[str] = []
        material = self.material(element.material)

        def col(key: str = "color", default: str = "#ffffff") -> tuple[int, int, int, int]:
            c = self.color(params.get(key), default)
            adjusted, note = material.apply_albedo_rule(c)
            if note:
                notes.append(f"layer {element.id}: {note}")
            return adjusted

        kind = element.kind
        if kind == "fill":
            art = marks.solid(w, h, col())
        elif kind == "band":
            art = marks.band(
                w, h, col(),
                angle=float(params.get("angle", 0.0)),
                taper=float(params.get("taper", 0.0)),
                feather=float(params.get("feather", 0.0)),
            )
        elif kind == "stripes":
            colors = [self.color(c) for c in (params.get("colors") or [params.get("color", "#ffffff")])]
            art = marks.stripes(
                w, h, colors,
                count=int(params.get("count", len(colors))),
                weight=float(params.get("weight", 0.6)),
                gap=float(params.get("gap", 0.0)),
                angle=float(params.get("angle", 0.0)),
                feather=float(params.get("feather", 0.0)),
            )
        elif kind == "gradient":
            art = marks.gradient(
                w, h, self._gradient_stops(params),
                angle=float(params.get("angle", 0.0)),
                shape=params.get("shape", "linear"),
            )
        elif kind == "pattern":
            art = self._pattern_art(element, w, h)
        elif kind == "image":
            art = self._image_art(element, w, h)
        elif kind == "logo":
            art, logo_notes = self._logo_art(element, placement, canvas, report)
            notes.extend(logo_notes)
            art = marks.fit_image(art, w, h, params.get("fit", "contain"))
        elif kind == "text":
            art = self._text_art(element, h)
        else:  # pragma: no cover - spec parsing rejects anything else
            raise LiveryError(f"layer {element.id}: cannot render kind {kind!r}")

        if element.kind in ("logo", "text") and material.name in self.materials.legibility_warn:
            report.warn(
                f"layer {element.id} uses material {material.name} over lettering — "
                f"mirror finishes destroy legibility at distance"
            )
        return art, material, notes

    def _gradient_stops(self, params: dict[str, Any]) -> list[tuple[float, tuple[int, int, int, int]]]:
        if params.get("stops"):
            return [
                (float(s["at"]), self.color(s["color"]))
                for s in params["stops"]
            ]
        colors = params.get("colors")
        if colors:
            n = len(colors)
            return [(i / max(1, n - 1), self.color(c)) for i, c in enumerate(colors)]
        start = self.color(params.get("color"), "#000000")
        end = self.color(params.get("to"), "#ffffff")
        return [(0.0, start), (1.0, end)]

    def _pattern_art(self, element: Element, w: int, h: int) -> Image.Image:
        params = element.params
        if params.get("source"):
            path = self.art.resolve_source(params["source"])
            swatch = Image.open(path).convert("RGBA")
            return remix.tile(
                swatch, w, h,
                scale=float(params.get("scale", 1.0)),
                angle=float(params.get("angle", 0.0)),
            )
        colors = [self.color(c) for c in (params.get("colors") or [params.get("color", "#222222")])]
        return marks.pattern(
            params.get("pattern", "carbon"), w, h, colors,
            scale=float(params.get("scale", 0.08)),
            angle=float(params.get("angle", 0.0)),
            density=float(params.get("density", 0.5)),
        )

    def _image_art(self, element: Element, w: int, h: int) -> Image.Image:
        params = element.params
        path = self.art.resolve_source(params["source"])
        img = Image.open(path).convert("RGBA")
        if params.get("knockout"):
            img = remix.remove_background(img)
        img = remix.trim(img)
        if params.get("recolor"):
            img = remix.recolor(img, self._recolor_pairs(params["recolor"]))
        if params.get("tint"):
            img = remix.tint(img, self.color(params["tint"]))
        return marks.fit_image(img, w, h, params.get("fit", "contain"))

    def _recolor_pairs(self, spec_pairs: Sequence[Any]) -> list[tuple[tuple[int, int, int, int], tuple[int, int, int, int]]]:
        pairs = []
        for entry in spec_pairs:
            if isinstance(entry, dict):
                pairs.append((self.color(entry["from"]), self.color(entry["to"])))
            else:
                pairs.append((self.color(entry[0]), self.color(entry[1])))
        return pairs

    def _logo_art(
        self,
        element: Element,
        placement: place.Placement,
        canvas: PaintCanvas,
        report: BuildReport,
    ) -> tuple[Image.Image, list[str]]:
        params = element.params
        logo = self.art.get(params["logo"])
        notes: list[str] = []
        background = canvas.region_mean_color(placement.box)
        variant = params.get("variant") or logo.pick_variant(background)
        img = logo.load(variant)
        if params.get("recolor"):
            if logo.lock_color:
                report.warn(
                    f"{logo.id} is marked lock_color: its brand does not allow recolouring — "
                    f"the recolor on layer {element.id} was ignored"
                )
            else:
                img = remix.recolor(img, self._recolor_pairs(params["recolor"]))
        if params.get("tint"):
            if logo.lock_color:
                report.warn(f"{logo.id} is lock_color; the tint on layer {element.id} was ignored")
            else:
                img = remix.tint(img, self.color(params["tint"]))

        min_mm = float(params.get("min_height_mm", logo.min_height_mm))
        for warning in artmod.legibility_check(
            artmod.Logo(**{**logo.__dict__, "min_height_mm": min_mm}),
            placement.box[3],
            placement.ppm,
            background,
        ):
            report.warn(warning)

        ink = remix.extract_palette(img, 1)
        if ink:
            ratio = colormod.contrast_ratio(background, ink[0].color)
            if ratio < MIN_LOGO_CONTRAST:
                report.warn(
                    f"{logo.id} on {placement.zone.name}: {ratio:.1f}:1 against the panel behind it "
                    f"— pick the {'light' if colormod.relative_luminance(background) < 0.4 else 'dark'} "
                    f"variant or move it"
                )

        notes.append(f"{logo.id}: variant '{variant}' on {placement.zone.name}")
        return img, notes

    def _text_art(self, element: Element, height_px: int) -> Image.Image:
        params = element.params
        content = str(params.get("text", ""))
        case = params.get("case")
        if case == "upper":
            content = content.upper()
        elif case == "lower":
            content = content.lower()
        outline = params.get("outline")
        outline_arg = None
        if outline:
            outline_arg = (self.color(outline.get("color", "#000000")), float(outline.get("width", 0.05)))
        return marks.text(
            content,
            params.get("font"),
            max(8, int(height_px)),
            self.color(params.get("color"), "#ffffff"),
            outline=outline_arg,
            tracking=float(params.get("tracking", 0.0)),
            slant=float(params.get("slant", 0.0)),
        )

    # ---------------------------------------------------------------- numbers

    def _render_numbers(self, canvas: PaintCanvas, report: BuildReport) -> None:
        numbers = self.spec.numbers
        if numbers is None:
            report.warn(
                "number_mode is custom but the spec has no numbers: block — the car will "
                "race without a number. Add numbers: or switch to number_mode: sim_stamped."
            )
            return
        zone_names = numbers.zones or self.profile.number_zones
        if not zone_names:
            report.warn(
                f"no number zones: the spec names none and profile {self.profile.car} has no "
                f"number_zones. Numbers were not painted."
            )
            return
        for zone in self.profile.select(zone_names, "both"):
            self._render_number_on(canvas, numbers, zone, report)

    def _render_number_on(
        self, canvas: PaintCanvas, numbers: NumberSpec, zone: Zone, report: BuildReport
    ) -> None:
        overrides = numbers.per_zone.get(zone.name) or numbers.per_zone.get(zone.part) or {}
        merged: dict[str, Any] = {
            "kind": "text",
            "id": f"number-{zone.name}",
            "zones": [zone.name],
            "text": numbers.value,
            "font": overrides.get("font", numbers.font),
            "color": overrides.get("color", numbers.color),
            "slant": overrides.get("slant", numbers.slant),
            "tracking": overrides.get("tracking", numbers.tracking),
            "material": overrides.get("material", numbers.material),
            "size": overrides.get("size") or {"h": numbers.size.h or 0.55},
            "at": overrides.get("at", numbers.at),
            "anchor": overrides.get("anchor", numbers.anchor),
            "rotate": overrides.get("rotate", 0.0),
        }
        outline = dict(overrides.get("outline") or numbers.outline or {})
        background_probe = zone.map_rect(self.size, 0.25, 0.25, 0.5, 0.5)
        background = canvas.region_mean_color(background_probe)
        fill = self.color(merged["color"], "#ffffff")

        if outline.get("color") in (None, "auto") and outline:
            pick = colormod.readable_on(fill, [(0, 0, 0, 255), (255, 255, 255, 255)])
            outline["color"] = colormod.to_hex(pick)
        if outline:
            merged["outline"] = outline

        ratio = colormod.contrast_ratio(background, fill)
        if ratio < MIN_NUMBER_CONTRAST and not outline:
            suggestion = colormod.to_hex(
                colormod.readable_on(background, [(255, 255, 255, 255), (17, 17, 19, 255)])
            )
            report.warn(
                f"number on {zone.name} is {ratio:.1f}:1 against the panel — a spotter will lose it. "
                f"Use fill {suggestion}, or add numbers.outline: {{width: 0.06}}"
            )

        element = Element.parse({k: v for k, v in merged.items() if v is not None}, 0)
        self._render_on_zone(canvas, element, zone, report)

    # ----------------------------------------------------- overrides / wheels

    def _apply_spec_overrides(self, canvas: PaintCanvas, report: BuildReport) -> None:
        for override in self.spec.spec_overrides:
            material = self.materials.resolve(override.material)
            for zone in self.profile.select(override.zones, override.sides):
                canvas.apply_spec_only(self.zone_clip(zone), material, override.opacity)
                report.note(f"spec override: {zone.name} → {material.name}")

    def _render_wheels(self, canvas: PaintCanvas, report: BuildReport) -> None:
        wheels = self.spec.wheels
        if wheels is None:
            return
        color = self.color(wheels.color) if wheels.color is not None else None
        material = self.materials.resolve(wheels.material) if wheels.material else None
        paintable = [z for z in wheels.zones if z in self.profile.zones]
        if not paintable:
            hint = colormod.to_hex(color) if color else "the colour you want"
            report.manual(
                f"Wheels: this car's template has no wheel zone, so rim colour is a paint-shop "
                f"setting, not pixels. In the iRacing UI set the rim colour to {hint}"
                + (f" and the finish to {material.name}." if material else ".")
            )
            if wheels.note:
                report.manual(f"Wheels: {wheels.note}")
            return
        for zone in self.profile.select(paintable, "both"):
            mask = self.zone_clip(zone)
            if color is not None:
                adjusted, note = (material or self.materials.resolve("gloss")).apply_albedo_rule(color)
                report.note(note or "")
                canvas.fill_mask(mask, adjusted, material)
            elif material is not None:
                canvas.apply_spec_only(mask, material)
            report.note(f"wheels painted on zone {zone.name}")

    # ----------------------------------------------------------------- digest

    def digest(self) -> str:
        """A hash over the spec and the art it references, so a rebuild can tell
        whether the paint on disk is still the paint the spec describes."""
        h = hashlib.sha256()
        source = Path(self.spec.source) if self.spec.source else None
        if source and source.exists():
            h.update(source.read_bytes())
        else:
            h.update(repr(self.spec).encode("utf-8"))
        if self.profile.source and Path(self.profile.source).exists():
            h.update(Path(self.profile.source).read_bytes())
        for element in self.spec.layers:
            ref = element.params.get("logo") or element.params.get("source")
            if not ref:
                continue
            try:
                path = (
                    self.art.get(ref).file(element.params.get("variant") or "default")
                    if element.kind == "logo"
                    else self.art.resolve_source(ref)
                )
                h.update(path.read_bytes())
            except (artmod.ArtError, OSError):
                continue
        return h.hexdigest()[:16]
