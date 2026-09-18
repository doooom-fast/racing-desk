"""Deriving a car profile from 3D instead of guessing it.

If a mesh whose UVs match the paint template is available, the guesswork
disappears. Bake three maps in UV space — object-space position, normal, and a
panel id — and every field a profile needs falls out of the geometry:

* **which way is forward on this island** — from how position changes across the
  texture, so ``axes`` is measured, not declared;
* **which way the panel faces** — from its mean normal, giving ``plane`` and
  ``side``;
* **how big things are** — from metres per pixel, so ``height_mm: 150`` means
  150mm on the car, on every car;
* **mirrored islands** — they fall out of the axes, so a UV island shared
  between both flanks is detected rather than discovered in the sim.

The mesh has to carry the sim's UV layout for this to mean anything. Check first
with ``livery bake --check``; a mesh with its own UVs gives a beautiful map of
the wrong thing.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
import numpy as np
from PIL import Image

from .errors import LiveryError
from .geom import DIR_NAMES, Vec
from .profile import CarProfile, Zone

AXIS_INDEX = {"x": 0, "y": 1, "z": 2}


@dataclass
class AxisConvention:
    """How the mesh sits in its own space.

    Blender's default for a car exported nose-forward is ``forward: +y``,
    ``up: +z``. A model that faces down -X just needs the two strings changed.
    """

    forward: str = "+y"
    up: str = "+z"

    def _vec(self, spec: str) -> np.ndarray:
        sign = -1.0 if spec.strip().startswith("-") else 1.0
        axis = spec.strip().lstrip("+-").lower()
        if axis not in AXIS_INDEX:
            raise LiveryError(f"axis must be x, y or z (optionally signed), got {spec!r}")
        v = np.zeros(3, dtype=np.float32)
        v[AXIS_INDEX[axis]] = sign
        return v

    @property
    def basis(self) -> np.ndarray:
        """Rows: forward, left, up — the car's own frame."""
        fwd = self._vec(self.forward)
        up = self._vec(self.up)
        left = np.cross(up, fwd)
        return np.stack([fwd, left, up])

    def to_car(self, world: np.ndarray) -> np.ndarray:
        """Rotate world-space vectors into (forward, left, up)."""
        return world @ self.basis.T


@dataclass
class BakeMaps:
    """UV-space maps baked from a mesh."""

    position: np.ndarray            # H×W×3, metres, car frame (forward, left, up)
    normal: np.ndarray              # H×W×3, unit, car frame
    valid: np.ndarray               # H×W bool — texels the mesh actually covers
    panels: np.ndarray | None = None  # H×W int labels
    panel_names: dict[int, str] = field(default_factory=dict)

    @property
    def size(self) -> tuple[int, int]:
        return (self.position.shape[1], self.position.shape[0])


def load_bake(directory: str | Path, convention: AxisConvention | None = None) -> BakeMaps:
    """Read the maps written by the Blender script."""
    root = Path(directory)
    meta_path = root / "bake.json"
    if not meta_path.exists():
        raise LiveryError(
            f"no bake.json in {root}. Run `livery bake <car> --mesh <file>` first."
        )
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    convention = convention or AxisConvention(
        forward=meta.get("forward", "+y"), up=meta.get("up", "+z")
    )

    position_img = _read_map(root / meta.get("position", "position.png"))
    bounds_min = np.array(meta["bounds_min"], dtype=np.float32)
    bounds_max = np.array(meta["bounds_max"], dtype=np.float32)
    world_pos = bounds_min + position_img[..., :3] * (bounds_max - bounds_min)
    valid = position_img[..., 3] > 0.5 if position_img.shape[2] > 3 else np.ones(position_img.shape[:2], bool)

    normal_path = root / meta.get("normal", "normal.png")
    world_normal = _read_map(normal_path)[..., :3] * 2.0 - 1.0 if normal_path.exists() else np.zeros_like(world_pos)

    panels = panel_names = None
    panel_path = root / meta.get("panels", "panels.png")
    if panel_path.exists() and meta.get("panel_names"):
        panel_rgb = (_read_map(panel_path)[..., :3] * 255).round().astype(int)
        panel_names = {}
        panels = np.full(panel_rgb.shape[:2], -1, dtype=int)
        for label, (name, rgb) in enumerate(meta["panel_names"].items()):
            match = np.all(np.abs(panel_rgb - np.array(rgb)) <= 4, axis=2)
            panels[match] = label
            panel_names[label] = name

    return BakeMaps(
        position=convention.to_car(world_pos),
        normal=convention.to_car(world_normal),
        valid=valid,
        panels=panels,
        panel_names=panel_names or {},
    )


def _read_map(path: Path) -> np.ndarray:
    if not path.exists():
        raise LiveryError(f"bake map missing: {path}")
    return np.asarray(Image.open(path).convert("RGBA"), dtype=np.float32) / 255.0


# --------------------------------------------------------------------- analysis


@dataclass
class ZoneAnalysis:
    plane: str
    side: str
    axes: dict[str, str]
    px_per_meter: float
    coverage: float          # share of the rect the mesh actually covers
    mean_normal: tuple[float, float, float]

    def as_zone(self, name: str, rect: tuple[float, float, float, float]) -> Zone:
        return Zone(
            name=name,
            rect=rect,
            plane=self.plane,  # type: ignore[arg-type]
            side=self.side,  # type: ignore[arg-type]
            axes=dict(self.axes),
            px_per_meter=round(self.px_per_meter, 1),
            tags=["baked"],
            notes=f"derived from a 3D bake (coverage {self.coverage:.0%})",
        )


def analyze_region(maps: BakeMaps, rect: tuple[float, float, float, float]) -> ZoneAnalysis:
    """Work out a panel's orientation and scale from the baked maps."""
    h, w = maps.position.shape[:2]
    x0, y0 = int(rect[0] * w), int(rect[1] * h)
    x1, y1 = int((rect[0] + rect[2]) * w), int((rect[1] + rect[3]) * h)
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(w, max(x0 + 2, x1)), min(h, max(y0 + 2, y1))

    valid = maps.valid[y0:y1, x0:x1]
    if valid.sum() < 16:
        raise LiveryError(
            f"the bake covers only {int(valid.sum())} texels of rect {rect} — "
            f"either the rect is off the mesh or the mesh does not use this template's UVs"
        )
    pos = maps.position[y0:y1, x0:x1]
    nrm = maps.normal[y0:y1, x0:x1]

    ys, xs = np.mgrid[y0:y1, x0:x1]
    A = np.stack([xs[valid], ys[valid], np.ones(int(valid.sum()))], axis=1).astype(np.float64)
    jac = np.zeros((3, 2), dtype=np.float64)
    for axis in range(3):
        coeffs, *_ = np.linalg.lstsq(A, pos[..., axis][valid].astype(np.float64), rcond=None)
        jac[axis] = coeffs[:2]  # d(car axis)/d(pixel x), d/d(pixel y)

    normal = nrm[valid].mean(axis=0)
    norm_len = float(np.linalg.norm(normal))
    normal = normal / norm_len if norm_len > 1e-6 else np.array([0.0, 1.0, 0.0])

    dominant = int(np.argmax(np.abs(normal)))
    if dominant == 2:
        plane, side = ("top", "center") if normal[2] >= 0 else ("bottom", "center")
    elif dominant == 1:
        plane, side = "side", ("left" if normal[1] >= 0 else "right")
    else:
        plane, side = ("front", "center") if normal[0] >= 0 else ("rear", "center")

    nose = _pixel_dir(jac[0])      # +forward
    car_left = _pixel_dir(jac[1])  # +left
    up = _pixel_dir(jac[2])        # +up

    axes: dict[str, str] = {}
    if plane in ("side",):
        axes = {"tail": DIR_NAMES[_negate(nose[0])], "down": DIR_NAMES[_negate(up[0])]}
        scale = (nose[1], up[1])
    elif plane in ("top", "bottom"):
        axes = {"tail": DIR_NAMES[_negate(nose[0])], "car_right": DIR_NAMES[_negate(car_left[0])]}
        scale = (nose[1], car_left[1])
    else:
        axes = {"car_right": DIR_NAMES[_negate(car_left[0])], "down": DIR_NAMES[_negate(up[0])]}
        scale = (car_left[1], up[1])

    metres_per_px = [s for s in scale if s > 1e-9]
    ppm = float(np.mean([1.0 / m for m in metres_per_px])) if metres_per_px else 0.0
    return ZoneAnalysis(
        plane=plane,
        side=side,
        axes=axes,
        px_per_meter=ppm,
        coverage=float(valid.mean()),
        mean_normal=(float(normal[0]), float(normal[1]), float(normal[2])),
    )


def _pixel_dir(gradient: np.ndarray) -> tuple[Vec, float]:
    """Which pixel direction this car axis increases along, and metres per pixel."""
    dx, dy = float(gradient[0]), float(gradient[1])
    if abs(dx) >= abs(dy):
        return ((1, 0) if dx >= 0 else (-1, 0), abs(dx))
    return ((0, 1) if dy >= 0 else (0, -1), abs(dy))


def _negate(v: Vec) -> Vec:
    return (-v[0], -v[1])


def zones_from_panels(maps: BakeMaps, min_texels: int = 256) -> dict[str, Zone]:
    """One zone per baked panel id, each analysed for orientation and scale."""
    if maps.panels is None:
        raise LiveryError(
            "this bake has no panel map. Name the mesh's materials after panels "
            "(door_left, hood, ...) and re-bake so panels.png is written."
        )
    h, w = maps.panels.shape
    zones: dict[str, Zone] = {}
    for label, name in sorted(maps.panel_names.items(), key=lambda kv: kv[1]):
        mask = maps.panels == label
        if mask.sum() < min_texels:
            continue
        ys, xs = np.where(mask)
        rect = (
            float(xs.min()) / w,
            float(ys.min()) / h,
            float(xs.max() - xs.min() + 1) / w,
            float(ys.max() - ys.min() + 1) / h,
        )
        try:
            analysis = analyze_region(maps, rect)
        except LiveryError:
            continue
        zones[name] = analysis.as_zone(name, rect)
    return zones


def profile_from_bake(car: str, maps: BakeMaps, canvas: tuple[int, int] | None = None) -> CarProfile:
    zones = zones_from_panels(maps)
    if not zones:
        raise LiveryError("the bake produced no usable panels — check the panel map and its names")
    ppms = [z.px_per_meter for z in zones.values() if z.px_per_meter]
    profile = CarProfile(
        car=car,
        display_name=car,
        canvas=canvas or maps.size,
        px_per_meter=round(float(np.mean(ppms)), 1) if ppms else 700.0,
        confidence="checked",
        zones=zones,
        number_zones=[n for n in ("door.left", "door.right", "hood", "roof") if n in zones],
        notes="Derived from a 3D bake: axes and scale are measured, not guessed.",
    )
    profile.validate()
    return profile


# ---------------------------------------------------------------------- driver


def run_blender(
    mesh: str | Path,
    out_dir: str | Path,
    resolution: int = 2048,
    blender: str = "blender",
    uv_map: str | None = None,
    forward: str = "+y",
    up: str = "+z",
    timeout: int = 1800,
) -> Path:
    """Drive Blender headlessly to bake the maps for one car."""
    script = Path(__file__).resolve().parent / "blender" / "bake_uv_maps.py"
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    cmd = [
        blender, "--background", "--factory-startup", "--python", str(script), "--",
        "--mesh", str(mesh),
        "--out", str(out),
        "--resolution", str(resolution),
        "--forward", forward,
        "--up", up,
    ]
    if uv_map:
        cmd += ["--uv-map", uv_map]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError as exc:
        raise LiveryError(
            f"Blender not found at {blender!r}. Set `blender:` in livery.yaml to the full path."
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise LiveryError(f"Blender bake timed out after {timeout}s") from exc
    if result.returncode != 0:
        tail = (result.stderr or result.stdout or "").strip().splitlines()[-20:]
        raise LiveryError("Blender bake failed:\n" + "\n".join(tail))
    return out


def uv_match_score(maps: BakeMaps, template: str | Path) -> float:
    """How well a mesh's UV coverage lines up with a template's ink.

    A mesh made for another purpose scores near zero; one that carries the sim's
    layout scores high. Cheap sanity check before trusting a bake.
    """
    img = Image.open(Path(template)).convert("RGBA").resize(maps.size, Image.Resampling.NEAREST)
    arr = np.asarray(img, dtype=np.float32)
    ink = (arr[..., 3] > 8) & (arr[..., :3].std(axis=2) + arr[..., :3].mean(axis=2) > 6)
    covered = maps.valid
    union = float((ink | covered).sum())
    if union <= 0:
        return 0.0
    return float((ink & covered).sum()) / union
