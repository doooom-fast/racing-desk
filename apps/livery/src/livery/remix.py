"""Remixing supplied art: palettes, recolouring, knockouts, backgrounds, tiles.

Source art arrives as whatever the sponsor sent — a JPEG off a website, a PNG
with a white box behind it, a wrap design in the wrong colours. These are the
operations that turn that into something that can be laid on a car.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import numpy as np
from PIL import Image

from . import color as colormod

RGBA = tuple[int, int, int, int]


@dataclass
class PaletteEntry:
    color: RGBA
    weight: float  # share of the image's opaque pixels

    @property
    def hex(self) -> str:
        return colormod.to_hex(self.color)


def extract_palette(img: Image.Image, count: int = 5, seed: int = 3) -> list[PaletteEntry]:
    """K-means over the opaque pixels — the colours a reference livery is made of.

    Returned heaviest first, so ``palette[0]`` is the body colour and the tail
    is the accent you actually want for a stripe.
    """
    rgba = np.asarray(img.convert("RGBA"), dtype=np.float32)
    flat = rgba.reshape(-1, 4)
    opaque = flat[flat[:, 3] > 32][:, :3]
    if len(opaque) == 0:
        return []
    if len(opaque) > 40000:
        rng = np.random.default_rng(seed)
        opaque = opaque[rng.choice(len(opaque), 40000, replace=False)]

    count = max(1, min(count, len(np.unique(opaque, axis=0))))
    rng = np.random.default_rng(seed)
    centers = _kmeanspp_init(opaque, count, rng)
    labels = np.zeros(len(opaque), dtype=np.int64)
    for _ in range(40):
        d = ((opaque[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
        labels = d.argmin(axis=1)
        moved = 0.0
        for k in range(count):
            members = opaque[labels == k]
            if len(members):
                new = members.mean(axis=0)
                moved = max(moved, float(np.abs(new - centers[k]).max()))
                centers[k] = new
            else:
                # Re-seed a starved cluster on the worst-fit pixel instead of
                # leaving a dead entry in the palette.
                worst = int(np.take_along_axis(d, labels[:, None], axis=1)[:, 0].argmax())
                centers[k] = opaque[worst]
                moved = 255.0
        if moved < 0.5:
            break

    entries = []
    total = len(opaque)
    for k in range(count):
        share = float((labels == k).sum()) / total
        c = centers[k].round().astype(int)
        entries.append(PaletteEntry((int(c[0]), int(c[1]), int(c[2]), 255), share))
    return sorted(entries, key=lambda e: -e.weight)


def _kmeanspp_init(points: np.ndarray, count: int, rng: np.random.Generator) -> np.ndarray:
    """k-means++ seeding. Plain random seeding merges a livery's red and blue
    into one purple cluster often enough to matter."""
    centers = [points[rng.integers(len(points))].astype(np.float32)]
    for _ in range(count - 1):
        d = np.min(
            ((points[:, None, :] - np.array(centers)[None, :, :]) ** 2).sum(axis=2), axis=1
        )
        total = float(d.sum())
        if total <= 0:
            centers.append(points[rng.integers(len(points))].astype(np.float32))
            continue
        centers.append(points[rng.choice(len(points), p=d / total)].astype(np.float32))
    return np.array(centers, dtype=np.float32)


def remove_background(
    img: Image.Image, tolerance: int = 24, key: RGBA | None = None
) -> Image.Image:
    """Knock out a flat background.

    With no ``key`` the corners vote — which is right for the usual "logo on
    white" download and safely wrong-free for art that already has alpha.
    """
    arr = np.asarray(img.convert("RGBA"), dtype=np.int16).copy()
    if key is None:
        h, w = arr.shape[:2]
        corners = np.array(
            [arr[0, 0, :3], arr[0, w - 1, :3], arr[h - 1, 0, :3], arr[h - 1, w - 1, :3]],
            dtype=np.int16,
        )
        # Only treat it as a background if the corners agree with each other.
        if int(np.ptp(corners, axis=0).max()) > tolerance * 2:
            return img.convert("RGBA")
        key_arr = corners.mean(axis=0)
    else:
        key_arr = np.array(key[:3], dtype=np.int16)

    distance = np.abs(arr[..., :3] - key_arr).max(axis=2)
    arr[..., 3] = np.where(distance <= tolerance, 0, arr[..., 3])
    # Feather the one-pixel fringe the key leaves behind.
    edge = (distance > tolerance) & (distance <= tolerance * 2)
    arr[..., 3] = np.where(edge, np.minimum(arr[..., 3], 160), arr[..., 3])
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), mode="RGBA")


def recolor(img: Image.Image, mapping: Sequence[tuple[RGBA, RGBA]], softness: int = 40) -> Image.Image:
    """Map source colours onto target colours, nearest-match with a falloff.

    This is how a sponsor's red-and-white becomes team-red-and-bone without
    re-drawing the logo: give it the pairs and it keeps the artwork's shading.
    """
    if not mapping:
        return img.convert("RGBA")
    arr = np.asarray(img.convert("RGBA"), dtype=np.float32)
    rgb = arr[..., :3]
    sources = np.array([m[0][:3] for m in mapping], dtype=np.float32)
    targets = np.array([m[1][:3] for m in mapping], dtype=np.float32)

    d = np.sqrt(((rgb[..., None, :] - sources[None, None, :, :]) ** 2).sum(axis=3))
    nearest = d.argmin(axis=2)
    nearest_d = np.take_along_axis(d, nearest[..., None], axis=2)[..., 0]

    src = sources[nearest]
    tgt = targets[nearest]
    # Preserve the shading: keep the pixel's offset from its source colour.
    shifted = np.clip(rgb - src + tgt, 0, 255)
    blend = np.clip(1.0 - (nearest_d / max(1.0, float(softness) * 4.0)), 0.0, 1.0)[..., None]
    out = arr.copy()
    out[..., :3] = rgb * (1 - blend) + shifted * blend
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), mode="RGBA")


def knockout(img: Image.Image, color: RGBA) -> Image.Image:
    """Flatten art to a single colour, keeping its alpha — a one-colour
    version of a logo for a busy panel, or for a shadow pass."""
    arr = np.asarray(img.convert("RGBA")).copy()
    arr[..., 0], arr[..., 1], arr[..., 2] = color[0], color[1], color[2]
    if len(color) > 3 and color[3] < 255:
        arr[..., 3] = (arr[..., 3].astype(np.float32) * (color[3] / 255.0)).astype(np.uint8)
    return Image.fromarray(arr, mode="RGBA")


def tint(img: Image.Image, color: RGBA, amount: float = 1.0) -> Image.Image:
    """Push art toward a colour while keeping its luminance detail."""
    arr = np.asarray(img.convert("RGBA"), dtype=np.float32)
    lum = (0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2])[..., None] / 255.0
    target = np.array(color[:3], dtype=np.float32) * lum
    arr[..., :3] = arr[..., :3] * (1 - amount) + target * amount
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), mode="RGBA")


def trim(img: Image.Image, threshold: int = 8) -> Image.Image:
    """Crop transparent margins so 'height' means the height of the ink."""
    rgba = img.convert("RGBA")
    alpha = np.asarray(rgba)[..., 3]
    rows = np.where(alpha.max(axis=1) > threshold)[0]
    cols = np.where(alpha.max(axis=0) > threshold)[0]
    if not len(rows) or not len(cols):
        return rgba
    return rgba.crop((int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1))


def tile(img: Image.Image, width: int, height: int, scale: float = 1.0, angle: float = 0.0) -> Image.Image:
    """Repeat art across a box — for a pattern supplied as a swatch."""
    src = img.convert("RGBA")
    if scale != 1.0:
        src = src.resize(
            (max(1, int(src.width * scale)), max(1, int(src.height * scale))),
            Image.Resampling.LANCZOS,
        )
    pad = int(max(width, height) * 0.5) if angle else 0
    out = Image.new("RGBA", (width + 2 * pad, height + 2 * pad), (0, 0, 0, 0))
    for y in range(0, out.height, src.height):
        for x in range(0, out.width, src.width):
            out.paste(src, (x, y), src)
    if angle:
        out = out.rotate(angle, resample=Image.Resampling.BICUBIC)
        out = out.crop((pad, pad, pad + width, pad + height))
    return out
