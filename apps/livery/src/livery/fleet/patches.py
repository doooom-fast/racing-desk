"""The parts of a sheet that are not paint.

Templates carry small patches the sim reads a colour from rather than mapping onto the car: the
pit-box swatch in a corner, a cockpit-colour patch on some cars. Art laid across the whole sheet
can land on them, which tints things that are nowhere near the art, so a build sets them to one
deliberate colour.

Number blocks are where the sim stamps the car's number over whatever is there. The shard field
runs under them; a logo must not.
"""

from __future__ import annotations

import glob
import os
from pathlib import Path

import numpy as np
from PIL import Image, PngImagePlugin

PngImagePlugin.MAX_TEXT_CHUNK = 1 << 30

PATCH_GUIDES = ("pitbox", "cockpit_color")

Rect = tuple[int, int, int, int]          # x0, x1, y0, y1


def _guides(work: str | Path, pattern: str) -> list[str]:
    return sorted(glob.glob(os.path.join(glob.escape(str(work)), pattern)))


def colour_patches(work: str | Path, min_area: int = 40) -> list[Rect]:
    """The colour-sampling patches this car's template declares."""
    from scipy import ndimage as ndi

    out: list[Rect] = []
    for f in _guides(work, "g_*.png"):
        name = os.path.basename(f).lower()
        if not any(k in name for k in PATCH_GUIDES):
            continue
        a = np.array(Image.open(f).convert("RGBA"))[..., 3] > 100
        if not a.any():
            continue
        lab, _ = ndi.label(a)
        for sl in ndi.find_objects(lab):
            if (sl[0].stop - sl[0].start) * (sl[1].stop - sl[1].start) < min_area:
                continue
            out.append((sl[1].start, sl[1].stop, sl[0].start, sl[0].stop))
    return out


def number_guide(work: str | Path) -> str | None:
    found = _guides(work, "g_*umber*.png")
    return found[0] if found else None


def number_blocks(work: str | Path, pad: int = 4) -> np.ndarray | None:
    """Where the sim draws the number, grown a little: numbers overflow their box."""
    from scipy import ndimage as ndi

    guide = number_guide(work)
    if guide is None:
        return None
    blocks = np.array(Image.open(guide).convert("RGBA"))[..., 3] > 10
    return ndi.binary_dilation(blocks, iterations=pad) if pad else blocks
