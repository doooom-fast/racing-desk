"""The dual canvas: albedo and spec map painted by the same geometry.

Every stamp writes colour into the albedo texture and material channels into the
spec texture through the *same* alpha coverage. A logo with a matte material is
matte exactly where the logo is, down to its antialiased edge, with no second
pass and no chance of the two textures drifting apart.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import NamedTuple

import numpy as np
from PIL import Image

from .materials import Material

BLENDS = ("normal", "multiply", "screen", "overlay", "add")


class StampResult(NamedTuple):
    """What a stamp actually managed to paint.

    ``potential`` is the ink the mark carries; ``applied`` is how much of it
    survived the canvas edge and the zone mask. The ratio is the only honest way
    to say "this logo is hanging off the panel" — counting opaque pixels against
    the box area just flags every logo, since logos are mostly transparent.
    """

    applied: float
    potential: float

    @property
    def ratio(self) -> float:
        return self.applied / self.potential if self.potential > 0 else 0.0


def _to_array(img: Image.Image) -> np.ndarray:
    return np.asarray(img.convert("RGBA"), dtype=np.float32) / 255.0


def _blend_rgb(dst: np.ndarray, src: np.ndarray, mode: str) -> np.ndarray:
    if mode == "normal":
        return src
    if mode == "multiply":
        return dst * src
    if mode == "screen":
        return 1.0 - (1.0 - dst) * (1.0 - src)
    if mode == "add":
        return np.clip(dst + src, 0.0, 1.0)
    if mode == "overlay":
        return np.where(dst <= 0.5, 2 * dst * src, 1.0 - 2 * (1.0 - dst) * (1.0 - src))
    raise ValueError(f"unknown blend mode {mode!r}")


@dataclass
class PaintCanvas:
    """Albedo + spec map of one car texture, in float RGBA 0-1."""

    width: int
    height: int
    albedo: np.ndarray
    spec: np.ndarray
    glass_alpha: np.ndarray | None = None  # template alpha to carry through, if any

    @property
    def size(self) -> tuple[int, int]:
        return (self.width, self.height)

    @classmethod
    def new(
        cls,
        width: int,
        height: int,
        base_color: tuple[int, int, int, int] = (255, 255, 255, 255),
        base_material: Material | None = None,
    ) -> "PaintCanvas":
        albedo = np.zeros((height, width, 4), dtype=np.float32)
        albedo[..., :] = np.array(base_color, dtype=np.float32) / 255.0
        spec = np.zeros((height, width, 4), dtype=np.float32)
        channels = base_material.channels if base_material else (0, 25, 255, 255)
        spec[..., :] = np.array(channels, dtype=np.float32) / 255.0
        return cls(width=width, height=height, albedo=albedo, spec=spec)

    # ------------------------------------------------------------------ paint

    def stamp(
        self,
        art: Image.Image,
        box: tuple[int, int, int, int],
        material: Material | None = None,
        opacity: float = 1.0,
        blend: str = "normal",
        clip: np.ndarray | None = None,
    ) -> StampResult:
        """Composite ``art`` (RGBA, already oriented) at pixel ``box``.

        ``clip`` is a full-canvas float mask (1 = paint allowed). Returns how
        much ink was laid down against how much the mark carried, so the renderer
        can tell a logo that is hanging off its panel from one that simply has a
        lot of transparency.
        """
        x, y, w, h = box
        if w <= 0 or h <= 0:
            return StampResult(0.0, 0.0)
        if art.size != (w, h):
            art = art.resize((w, h), Image.Resampling.LANCZOS)

        opacity = float(np.clip(opacity, 0.0, 1.0))
        potential = float(_to_array(art)[..., 3].sum() * opacity)

        # Clip the paste rect to the canvas, trimming the art to match.
        cx0, cy0 = max(0, x), max(0, y)
        cx1, cy1 = min(self.width, x + w), min(self.height, y + h)
        if cx0 >= cx1 or cy0 >= cy1:
            return StampResult(0.0, potential)
        src = _to_array(art)[cy0 - y: cy1 - y, cx0 - x: cx1 - x]

        alpha = src[..., 3:4] * opacity
        if clip is not None:
            alpha = alpha * clip[cy0:cy1, cx0:cx1, None]
        if not alpha.any():
            return StampResult(0.0, potential)

        dst = self.albedo[cy0:cy1, cx0:cx1]
        blended = _blend_rgb(dst[..., :3], src[..., :3], blend)
        dst[..., :3] = dst[..., :3] * (1.0 - alpha) + blended * alpha
        dst[..., 3:4] = np.maximum(dst[..., 3:4], alpha)

        if material is not None:
            mat = np.array(material.channels, dtype=np.float32) / 255.0
            spec_dst = self.spec[cy0:cy1, cx0:cx1]
            spec_dst[...] = spec_dst * (1.0 - alpha) + mat * alpha

        return StampResult(float(alpha.sum()), potential)

    def fill_mask(
        self,
        mask: np.ndarray,
        color: tuple[int, int, int, int],
        material: Material | None = None,
        opacity: float = 1.0,
    ) -> float:
        """Flood every texel where ``mask`` > 0 — used for zone fills and for
        spec-only overrides such as glass or carbon trim."""
        alpha = (mask[..., None] * float(np.clip(opacity, 0.0, 1.0))).astype(np.float32)
        rgba = np.array(color, dtype=np.float32) / 255.0
        alpha = alpha * rgba[3]
        self.albedo[..., :3] = self.albedo[..., :3] * (1.0 - alpha) + rgba[:3] * alpha
        self.albedo[..., 3:4] = np.maximum(self.albedo[..., 3:4], alpha)
        if material is not None:
            mat = np.array(material.channels, dtype=np.float32) / 255.0
            self.spec[...] = self.spec * (1.0 - alpha) + mat * alpha
        return float(alpha.sum())

    def apply_spec_only(self, mask: np.ndarray, material: Material, opacity: float = 1.0) -> None:
        """Change material without touching colour (glass, trim, lenses)."""
        alpha = (mask[..., None] * float(np.clip(opacity, 0.0, 1.0))).astype(np.float32)
        mat = np.array(material.channels, dtype=np.float32) / 255.0
        self.spec[...] = self.spec * (1.0 - alpha) + mat * alpha

    # ----------------------------------------------------------------- export

    def albedo_image(self) -> Image.Image:
        arr = np.clip(self.albedo * 255.0 + 0.5, 0, 255).astype(np.uint8)
        if self.glass_alpha is not None:
            arr[..., 3] = np.clip(self.glass_alpha * 255.0 + 0.5, 0, 255).astype(np.uint8)
        else:
            arr[..., 3] = 255
        return Image.fromarray(arr, mode="RGBA")

    def spec_image(self) -> Image.Image:
        arr = np.clip(self.spec * 255.0 + 0.5, 0, 255).astype(np.uint8)
        return Image.fromarray(arr, mode="RGBA")

    def sample_albedo(self, x: int, y: int) -> tuple[int, int, int, int]:
        px = np.clip(self.albedo[y, x] * 255.0 + 0.5, 0, 255).astype(int)
        return (int(px[0]), int(px[1]), int(px[2]), int(px[3]))

    def region_mean_color(self, box: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
        """Mean albedo under a box — what a logo is about to sit on, which is
        how the renderer decides whether it will read."""
        x, y, w, h = box
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(self.width, x + w), min(self.height, y + h)
        if x0 >= x1 or y0 >= y1:
            return (0, 0, 0, 255)
        mean = self.albedo[y0:y1, x0:x1].mean(axis=(0, 1))
        px = np.clip(mean * 255.0 + 0.5, 0, 255).astype(int)
        return (int(px[0]), int(px[1]), int(px[2]), int(px[3]))
