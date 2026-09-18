"""Placement: author-space rectangles → pixels, art → the right way round.

Two frames matter and they are not the same:

* **author frame** — u runs nose→tail, v runs top→bottom (or left→right on
  horizontal panels). A spec is written here, once, for both flanks.
* **viewer frame** — what someone standing outside the car sees. Lettering must
  be upright and unmirrored here or the paint is wrong.

An element picks which frame its *content* follows with ``orient``: shapes and
patterns follow the car (so the two flanks come out mirror-symmetric, the way a
real livery is laid out), while logos, text and photographic art follow the
viewer (so they read on both sides). Both are positioned identically.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import numpy as np
from PIL import Image

from .errors import LiveryError
from .geom import Vec, quarter_turns_cw
from .profile import CarProfile, Zone
from .spec import Element, Size


@dataclass
class Placement:
    """Where a mark goes and what shape to draw it at."""

    zone: Zone
    box: tuple[int, int, int, int]      # pixel x, y, w, h on the template
    art_size: tuple[int, int]           # size to generate the mark at, in its own frame
    x_axis: Vec                         # pixel direction of the art's +x
    y_axis: Vec                         # pixel direction of the art's +y
    mirrored: bool                      # art gets flipped when stamped
    ppm: float                          # pixels per metre here — for mm-sized art

    @property
    def center(self) -> tuple[int, int]:
        x, y, w, h = self.box
        return (x + w // 2, y + h // 2)


def _axis_extent_px(direction: Vec, zone_px: tuple[float, float, float, float]) -> float:
    _, _, zw, zh = zone_px
    return zw if direction[0] != 0 else zh


def _art_axes(element: Element, zone: Zone) -> tuple[Vec, Vec]:
    """Which pixel directions the art's own +x/+y run along."""
    frame = zone.frame
    if element.effective_orient == "reading":
        return frame.camera_right, frame.camera_down
    return frame.u, frame.v


def _det(x_axis: Vec, y_axis: Vec) -> int:
    return x_axis[0] * y_axis[1] - x_axis[1] * y_axis[0]


def resolve(
    element: Element,
    zone: Zone,
    profile: CarProfile,
    canvas: tuple[int, int],
    art_aspect: float | None = None,
) -> Placement:
    """Work out the pixel box for one element on one zone.

    ``art_aspect`` (width/height in the art's own frame) lets a logo keep its
    proportions when the spec only pins one dimension — the usual case.
    """
    zone_px = zone.pixel_rect(canvas)
    frame = zone.frame
    ppm = profile.px_per_meter_for(zone)
    eu = _axis_extent_px(frame.u, zone_px)
    ev = _axis_extent_px(frame.v, zone_px)

    x_axis, y_axis = _art_axes(element, zone)
    # Does the art's +x run along the author u axis, or across it?
    swapped = (x_axis[0] != 0) != (frame.u[0] != 0)

    if element.rect is not None:
        u, v, w, h = element.rect
    else:
        w, h = _resolve_size(element.size, eu, ev, ppm, art_aspect, swapped, element.id)
        margin = element.margin
        u0, v0 = margin, margin
        span_u, span_v = 1.0 - 2 * margin, 1.0 - 2 * margin
        if span_u <= 0 or span_v <= 0:
            raise LiveryError(f"layer {element.id}: margin {margin} leaves no room in the zone")
        au, av = element.at if element.at is not None else (u0 + span_u / 2, v0 + span_v / 2)
        u, v = _anchor_offset(element.anchor, au, av, w, h)

    box = zone.map_rect(canvas, u, v, w, h)
    aw, ah = (box[3], box[2]) if _turns(x_axis) % 2 else (box[2], box[3])
    return Placement(
        zone=zone,
        box=box,
        art_size=(max(1, aw), max(1, ah)),
        x_axis=x_axis,
        y_axis=y_axis,
        mirrored=_det(x_axis, y_axis) < 0,
        ppm=ppm,
    )


def _turns(x_axis: Vec) -> int:
    return quarter_turns_cw(x_axis)


def _resolve_size(
    size: Size,
    eu: float,
    ev: float,
    ppm: float,
    art_aspect: float | None,
    swapped: bool,
    element_id: str,
) -> tuple[float, float]:
    """Return (w, h) as fractions of the zone's u and v extents."""
    w = size.w
    h = size.h
    if size.width_mm is not None:
        w = (size.width_mm / 1000.0 * ppm) / max(1e-6, eu)
    if size.height_mm is not None:
        h = (size.height_mm / 1000.0 * ppm) / max(1e-6, ev)

    if w is None and h is None:
        return (1.0, 1.0)
    if w is not None and h is not None:
        return (w, h)
    if art_aspect is None or art_aspect <= 0:
        # No intrinsic shape (a band, a fill) — the unpinned axis fills the zone.
        return (w if w is not None else 1.0, h if h is not None else 1.0)

    # Keep the art's proportions. art_aspect is width/height in the art's frame;
    # on a rotated island the art's width may run along the author v axis.
    if swapped:
        # art width ↔ author v, art height ↔ author u
        if h is not None:
            px_along_v = h * ev
            px_along_u = px_along_v / art_aspect
            return (px_along_u / max(1e-6, eu), h)
        px_along_u = w * eu  # type: ignore[operator]
        px_along_v = px_along_u * art_aspect
        return (w, px_along_v / max(1e-6, ev))  # type: ignore[return-value]
    if h is not None:
        px_along_v = h * ev
        px_along_u = px_along_v * art_aspect
        return (px_along_u / max(1e-6, eu), h)
    px_along_u = w * eu  # type: ignore[operator]
    px_along_v = px_along_u / art_aspect
    return (w, px_along_v / max(1e-6, ev))  # type: ignore[return-value]


def _anchor_offset(anchor: str, au: float, av: float, w: float, h: float) -> tuple[float, float]:
    """Turn an anchor point + size into the near corner in author space."""
    u_map = {
        "center": au - w / 2, "top": au - w / 2, "bottom": au - w / 2,
        "nose": au, "tail": au - w,
        "nose_top": au, "nose_bottom": au, "tail_top": au - w, "tail_bottom": au - w,
    }
    v_map = {
        "center": av - h / 2, "nose": av - h / 2, "tail": av - h / 2,
        "top": av, "bottom": av - h,
        "nose_top": av, "tail_top": av, "nose_bottom": av - h, "tail_bottom": av - h,
    }
    return (u_map[anchor], v_map[anchor])


def orient(art: Image.Image, placement: Placement, flip: str = "auto") -> Image.Image:
    """Rotate/mirror art from its own frame into template pixel space."""
    x_axis, y_axis = placement.x_axis, placement.y_axis
    mirror = _det(x_axis, y_axis) < 0
    if flip == "never":
        mirror = False
    elif flip == "always":
        mirror = not mirror

    out = art
    if mirror:
        out = out.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        x_axis = (-x_axis[0], -x_axis[1])
    turns = quarter_turns_cw(x_axis)
    if turns == 1:
        out = out.transpose(Image.Transpose.ROTATE_270)
    elif turns == 2:
        out = out.transpose(Image.Transpose.ROTATE_180)
    elif turns == 3:
        out = out.transpose(Image.Transpose.ROTATE_90)
    return out


def rotate_in_frame(art: Image.Image, degrees: float) -> tuple[Image.Image, tuple[int, int]]:
    """Free rotation inside the art's own frame, growing the canvas to fit."""
    if not degrees:
        return art, art.size
    rotated = art.rotate(-degrees, resample=Image.Resampling.BICUBIC, expand=True)
    return rotated, rotated.size


def recenter(box: tuple[int, int, int, int], new_size: tuple[int, int]) -> tuple[int, int, int, int]:
    """Keep a grown/shrunk mark centred on the box it was placed at."""
    x, y, w, h = box
    nw, nh = new_size
    return (x + (w - nw) // 2, y + (h - nh) // 2, nw, nh)


@lru_cache(maxsize=256)
def _rect_mask(canvas: tuple[int, int], rect: tuple[float, float, float, float]) -> np.ndarray:
    cw, ch = canvas
    mask = np.zeros((ch, cw), dtype=np.float32)
    x, y, w, h = rect
    x0, y0 = int(round(x * cw)), int(round(y * ch))
    x1, y1 = int(round((x + w) * cw)), int(round((y + h) * ch))
    mask[max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = 1.0
    return mask


def zone_mask(zone: Zone, canvas: tuple[int, int], base_dir: Any = None) -> np.ndarray:
    """A clip mask for a zone: its rect, narrowed by a PNG mask if one exists.

    A rect is enough for most panels. Where a panel is a real shape on the
    template — a door with a mirror cut out of it — drop a white-on-black PNG
    next to the profile and reference it as ``mask:``.
    """
    mask = _rect_mask(canvas, tuple(zone.rect)).copy()
    if zone.mask:
        from pathlib import Path

        path = Path(zone.mask)
        if base_dir and not path.is_absolute():
            path = Path(base_dir) / path
        if not path.exists():
            raise LiveryError(f"zone {zone.name}: mask file not found at {path}")
        img = Image.open(path).convert("L").resize(canvas, Image.Resampling.LANCZOS)
        mask *= np.asarray(img, dtype=np.float32) / 255.0
    return mask


def px_to_mm(px: float, ppm: float) -> float:
    """Pixels on the template → millimetres on the car. Legibility floors and
    build-report sizes are stated in millimetres because that is the unit a
    livery is actually judged in."""
    return px / max(1e-6, ppm) * 1000.0
