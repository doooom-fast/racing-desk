"""Materials → iRacing spec-map channels.

Every mark the compositor lays down carries a material as well as a colour, so
the albedo TGA and the spec TGA are painted by the same geometry in one pass.
That is the difference between a livery that has materials and one where someone
hand-painted a spec map afterwards and got it 90% aligned.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping, Sequence

import yaml

from . import color as colormod
from .errors import LiveryError

DATA_DIR = Path(__file__).resolve().parent / "data"
DEFAULT_MATERIAL = "gloss"


@dataclass(frozen=True)
class Material:
    name: str
    metallic: int = 0
    roughness: int = 25
    clearcoat: int = 255
    spec_mask: int = 255
    albedo_value: float | None = None
    description: str = ""

    @property
    def channels(self) -> tuple[int, int, int, int]:
        """(R, G, B, A) as written into the spec map."""
        return (self.metallic, self.roughness, self.clearcoat, self.spec_mask)

    def apply_albedo_rule(self, rgba: Sequence[int]) -> tuple[tuple[int, int, int, int], str | None]:
        """Lift the albedo if this material needs a lighter base.

        Returns the (possibly adjusted) colour and a note explaining any change,
        so the build report can tell the author their black chrome became silver
        on purpose.
        """
        if self.albedo_value is None:
            return tuple(rgba), None  # type: ignore[return-value]
        current = colormod.value_of(rgba)
        if current >= self.albedo_value - 0.02:
            return tuple(rgba), None  # type: ignore[return-value]
        lifted = colormod.with_value(rgba, self.albedo_value)
        note = (
            f"{self.name}: albedo lifted {colormod.to_hex(rgba)} → {colormod.to_hex(lifted)} "
            f"(metal needs a base value of ~{self.albedo_value:.2f}; it was {current:.2f})"
        )
        return lifted, note


class MaterialLibrary:
    def __init__(self, presets: Mapping[str, Material], legibility_warn: Sequence[str] = ()):
        self._presets = dict(presets)
        self.legibility_warn = set(legibility_warn)

    @classmethod
    def load(cls, path: str | Path | None = None) -> "MaterialLibrary":
        p = Path(path) if path else DATA_DIR / "materials.yaml"
        if not p.exists():
            raise LiveryError(f"material library not found at {p}")
        data = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
        presets = {
            name: Material(
                name=name,
                metallic=int(v.get("metallic", 0)),
                roughness=int(v.get("roughness", 25)),
                clearcoat=int(v.get("clearcoat", 255)),
                spec_mask=int(v.get("spec_mask", 255)),
                albedo_value=v.get("albedo_value"),
                description=v.get("description", ""),
            )
            for name, v in (data.get("presets") or {}).items()
        }
        return cls(presets, data.get("legibility_warn") or [])

    def names(self) -> list[str]:
        return sorted(self._presets)

    def resolve(self, value: Any) -> Material:
        """Accept a preset name, or a mapping that names a preset and overrides
        individual channels (``{base: gloss, roughness: 60}``)."""
        if value is None:
            return self._presets[DEFAULT_MATERIAL]
        if isinstance(value, Material):
            return value
        if isinstance(value, str):
            if value not in self._presets:
                raise LiveryError(
                    f"unknown material {value!r}. Known: {', '.join(self.names())}"
                )
            return self._presets[value]
        if isinstance(value, Mapping):
            base = self.resolve(value.get("base", DEFAULT_MATERIAL))
            return Material(
                name=value.get("name", f"{base.name}*"),
                metallic=_chan(value, "metallic", base.metallic),
                roughness=_chan(value, "roughness", base.roughness),
                clearcoat=_chan(value, "clearcoat", base.clearcoat),
                spec_mask=_chan(value, "spec_mask", base.spec_mask),
                albedo_value=value.get("albedo_value", base.albedo_value),
                description=value.get("description", base.description),
            )
        raise LiveryError(f"cannot read {value!r} as a material")


def _chan(mapping: Mapping[str, Any], key: str, default: int) -> int:
    if key not in mapping:
        return default
    raw = mapping[key]
    if isinstance(raw, float) and 0.0 <= raw <= 1.0:
        raw = raw * 255
    return max(0, min(255, int(round(float(raw)))))


@lru_cache(maxsize=1)
def default_library() -> MaterialLibrary:
    return MaterialLibrary.load()
