"""The shatter livery: the shard field over the whole sheet, plus whatever logo layers a car has.

The field is laid across the UV sheet itself, not through car space. Cars whose templates are
packed panels have no car-space band to map through, and for an abstract shard field that reads
fine: seam continuity only matters for lettering.

A shard is art colour at the field's strength over the body colour, and gloss over matte: the
body is fully rough and the shards are not, so the art catches light and the car does not. That
is the spec map's green channel; the car's own metallic and clearcoat are kept.

``art/doooom/shatter-field.png`` is the field every fleet car wears, so a car painted here matches
the ones painted before it. ``field_from_raster`` makes a field out of any shattered artwork
(``packages/shatter`` renders them), which is how a new one comes to be.
"""

from __future__ import annotations

import glob
import os
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image, PngImagePlugin

from .patches import Rect

PngImagePlugin.MAX_TEXT_CHUNK = 1 << 30

ORANGE = (220.0, 55.0, 20.0)
BLACK = (10.0, 10.0, 10.0)
WHITE = (238.0, 238.0, 238.0)

# The two directions of the livery: folder name → (body, art).
MODES: dict[str, tuple[tuple[float, float, float], tuple[float, float, float]]] = {
    "shatter": (BLACK, ORANGE),
    "shatter-inverted": (ORANGE, BLACK),
}

BODY_ROUGH, ART_ROUGH, LOGO_ROUGH = 255.0, 22.0, 22.0

FIELD_NAME = Path("doooom") / "shatter-field.png"
DEFAULT_PREFIX = "lg"   # what a car's logo layers are written under when its panel map names nothing else
OVERRUN = 1.12          # a raster covers the sheet and then some, so no edge is bare


def load_field(path: str | Path, size: tuple[int, int]) -> np.ndarray:
    """The field as strengths 0..1, at a sheet's size (width, height).

    The field is square. A sheet of another size takes it scaled to cover, centred.
    """
    with Image.open(path) as im:
        deep = im.mode.startswith("I;16") or im.mode == "I"
        a = np.asarray(im).astype(np.float64) / (65535.0 if deep else 255.0)
    if a.ndim == 3:
        a = a[..., 0]
    w, h = size
    if a.shape == (h, w):
        return np.clip(a, 0.0, 1.0)
    side = max(w, h)
    # Pillow resamples floats as they are, which keeps what sixteen bits knew.
    im = Image.fromarray(a.astype(np.float32)).resize((side, side), Image.LANCZOS)
    a = np.asarray(im).astype(np.float64)
    ox, oy = (side - w) // 2, (side - h) // 2
    return np.clip(a[oy:oy + h, ox:ox + w], 0.0, 1.0)


def field_from_raster(path: str | Path, size: int, flip: bool = False) -> np.ndarray:
    """A field from shattered artwork: the darker a shard, the stronger the art."""
    src = np.array(Image.open(path).convert("RGBA")).astype(np.float64) / 255
    alpha = np.clip(src[..., 3] * (1.0 - src[..., :3].mean(2)) * 1.15, 0, 1)   # dark shard = opaque
    im = Image.fromarray((alpha * 255).astype(np.uint8))
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    scale = max(size * OVERRUN / im.size[0], size * OVERRUN / im.size[1])
    im = im.resize((int(im.size[0] * scale), int(im.size[1] * scale)), Image.LANCZOS)
    ox, oy = (im.size[0] - size) // 2, (im.size[1] - size) // 2
    return np.asarray(im).astype(np.float64)[oy:oy + size, ox:ox + size] / 255


def logo_layers(work: str | Path, pattern: str, size: tuple[int, int], exclude: Iterable[str] = ()) -> np.ndarray:
    """A car's logo layers as one coverage map. Layers of another size are previews, and skipped."""
    w, h = size
    logos = np.zeros((h, w))
    for f in sorted(glob.glob(os.path.join(glob.escape(str(work)), pattern))):
        if any(e and e in os.path.basename(f) for e in exclude):
            continue
        m = np.array(Image.open(f).convert("RGBA"))[..., 3]
        if m.shape != (h, w):
            continue
        logos = np.maximum(logos, m.astype(np.float64) / 255)
    return logos


def paint(
    field: np.ndarray,
    body: tuple[float, float, float],
    art: tuple[float, float, float],
    spec_template: np.ndarray | None = None,
    logos: np.ndarray | None = None,
    patches: Iterable[Rect] = (),
) -> tuple[np.ndarray, np.ndarray | None]:
    """The paint and the spec map for one direction of the livery, as 8-bit RGB.

    No spec map comes back for a car whose template has none. The sim then uses the car's own -
    or one left in the car's paint folder by an earlier paint, which is the desk's to warn of.
    """
    body_c, art_c, white = (np.array(c, dtype=np.float64) for c in (body, art, WHITE))
    a = field
    sheet = body_c * (1 - a[..., None]) + art_c * a[..., None]
    rough = BODY_ROUGH * (1 - a) + ART_ROUGH * a

    if logos is not None:
        lm = logos[..., None]
        sheet = sheet * (1 - lm) + white * lm
        rough = rough * (1 - logos) + LOGO_ROUGH * logos

    # colour-sampling patches (pit box, cockpit): give them the art colour, not the paint
    for (x0, x1, y0, y1) in patches:
        sheet[y0:y1, x0:x1] = art_c

    spec = None
    if spec_template is not None:
        spec = spec_template.astype(np.float64).copy()
        spec[..., 1] = rough
        spec = spec.round().astype(np.uint8)
    return sheet.round().astype(np.uint8), spec
