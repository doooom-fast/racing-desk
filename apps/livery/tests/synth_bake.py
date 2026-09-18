"""Build a synthetic 3D bake, so the bake analyser can be tested without Blender.

Lays out three panels the way a real template does — left flank nose-left, right
flank nose-right, hood nose-up — and writes the same files the Blender script
writes. If the analyser recovers the axes these were built with, it will recover
a real car's too.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

# (name, pixel rect, car-frame position at pixel (0,0), d/dx, d/dy, normal, colour)
# Position and its gradients are in metres, car frame: (forward, left, up).
PANELS = [
    (
        "door.left", (0, 0, 256, 128),
        (2.0, 0.90, 1.20), (-0.005, 0.0, 0.0), (0.0, 0.0, -0.005),
        (0.0, 1.0, 0.0), (220, 40, 40),
    ),
    (
        "door.right", (0, 256, 256, 128),
        (0.5, -0.90, 1.20), (0.005, 0.0, 0.0), (0.0, 0.0, -0.005),
        (0.0, -1.0, 0.0), (40, 220, 40),
    ),
    (
        "hood", (300, 0, 160, 160),
        (3.2, 0.60, 1.05), (0.0, -0.005, 0.0), (-0.005, 0.0, 0.0),
        (0.0, 0.0, 1.0), (40, 40, 220),
    ),
]

FORWARD = "+y"
UP = "+z"


def _to_world(car: np.ndarray) -> np.ndarray:
    """Car frame (forward, left, up) → Blender world for forward=+y, up=+z."""
    basis = np.array([[0.0, 1.0, 0.0], [-1.0, 0.0, 0.0], [0.0, 0.0, 1.0]], dtype=np.float32)
    return car @ basis  # inverse of the orthonormal basis used by AxisConvention


def write(directory: str | Path, size: int = 512) -> Path:
    out = Path(directory)
    out.mkdir(parents=True, exist_ok=True)
    pos = np.zeros((size, size, 3), dtype=np.float32)
    nrm = np.zeros((size, size, 3), dtype=np.float32)
    valid = np.zeros((size, size), dtype=bool)
    panels = np.zeros((size, size, 3), dtype=np.uint8)
    names: dict[str, list[int]] = {}

    for name, (x, y, w, h), origin, ddx, ddy, normal, colour in PANELS:
        xs, ys = np.meshgrid(np.arange(w), np.arange(h))
        block = (
            np.array(origin, dtype=np.float32)[None, None, :]
            + xs[..., None] * np.array(ddx, dtype=np.float32)
            + ys[..., None] * np.array(ddy, dtype=np.float32)
        )
        pos[y:y + h, x:x + w] = block
        nrm[y:y + h, x:x + w] = np.array(normal, dtype=np.float32)
        valid[y:y + h, x:x + w] = True
        panels[y:y + h, x:x + w] = colour
        names[name] = list(colour)

    world_pos = _to_world(pos.reshape(-1, 3)).reshape(pos.shape)
    world_nrm = _to_world(nrm.reshape(-1, 3)).reshape(nrm.shape)
    lo = world_pos[valid].min(axis=0) - 0.01
    hi = world_pos[valid].max(axis=0) + 0.01

    encoded = np.zeros((size, size, 4), dtype=np.uint8)
    encoded[..., :3] = np.clip((world_pos - lo) / (hi - lo) * 255.0, 0, 255).astype(np.uint8)
    encoded[..., 3] = np.where(valid, 255, 0)
    Image.fromarray(encoded, "RGBA").save(out / "position.png")

    normal_img = np.clip((world_nrm * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    Image.fromarray(normal_img, "RGB").save(out / "normal.png")
    Image.fromarray(panels, "RGB").save(out / "panels.png")

    (out / "bake.json").write_text(
        json.dumps(
            {
                "position": "position.png",
                "normal": "normal.png",
                "panels": "panels.png",
                "bounds_min": [float(v) for v in lo],
                "bounds_max": [float(v) for v in hi],
                "forward": FORWARD,
                "up": UP,
                "panel_names": names,
                "resolution": size,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return out
