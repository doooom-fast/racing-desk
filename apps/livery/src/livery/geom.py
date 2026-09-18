"""Panel geometry: how author-space coordinates land on a flat UV template.

The whole mirroring problem lives here. A race car's two flanks are seen from
opposite directions, so a graphic that runs nose-to-tail on the left runs
tail-to-nose on the right *as the viewer sees it* — while the lettering on both
sides still reads left-to-right. Authors should never have to think about that.

So every zone declares two of its three world axes as pixel directions on the
template:

    tail       the pixel direction pointing toward the back of the car
    down       the pixel direction pointing toward the ground
    car_right  the pixel direction pointing toward the car's right-hand side

From those two, plus which way the panel faces (``plane``/``side``), we derive:

  * the **author frame** (u, v) a spec writes placements in, identical on both
    flanks, so ``sides: both`` gives a true mirror;
  * the **viewer frame** (camera right / camera down) art is rendered in, so
    lettering always reads correctly;
  * whether this UV island is **mirrored**, in which case art is flipped before
    it is stamped down — the one case where a naive pipeline puts backwards
    text on a car.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .errors import ProfileError

Vec = tuple[int, int]

# Pixel space: +x is right across the template, +y is *down* it.
DIRS: dict[str, Vec] = {"+x": (1, 0), "-x": (-1, 0), "+y": (0, 1), "-y": (0, -1)}
DIR_NAMES = {v: k for k, v in DIRS.items()}

Plane = Literal["side", "top", "bottom", "front", "rear"]
Side = Literal["left", "right", "center"]

# Which world direction is "to the viewer's right" when you stand outside the
# car and look at this panel, and which is "down" in that same view.
VIEWER_BASIS: dict[tuple[str, str], tuple[str, str]] = {
    # (plane, side): (camera_right_world, camera_down_world)
    ("side", "left"): ("tail", "down"),
    ("side", "right"): ("nose", "down"),
    ("top", "center"): ("car_right", "tail"),
    ("bottom", "center"): ("car_left", "tail"),
    ("front", "center"): ("car_left", "down"),
    ("rear", "center"): ("car_right", "down"),
}

# Author frame per plane: which world direction u and v run along.
AUTHOR_AXES: dict[str, tuple[str, str]] = {
    "side": ("tail", "down"),
    "top": ("tail", "car_right"),
    "bottom": ("tail", "car_right"),
    "front": ("car_right", "down"),
    "rear": ("car_right", "down"),
}

OPPOSITE = {
    "tail": "nose",
    "nose": "tail",
    "down": "up",
    "up": "down",
    "car_right": "car_left",
    "car_left": "car_right",
}


def negate(v: Vec) -> Vec:
    return (-v[0], -v[1])


def rot_cw(v: Vec) -> Vec:
    """Rotate a pixel-space vector 90° clockwise on screen (+y is down)."""
    return (-v[1], v[0])


def rot_ccw(v: Vec) -> Vec:
    return (v[1], -v[0])


def quarter_turns_cw(target: Vec) -> int:
    """How many 90° clockwise turns take +x onto ``target``."""
    order = [(1, 0), (0, 1), (-1, 0), (0, -1)]
    if target not in order:
        raise ProfileError(f"{target!r} is not an axis-aligned unit direction")
    return order.index(target)


@dataclass(frozen=True)
class PanelFrame:
    """A zone's resolved orientation: everything the compositor needs."""

    u: Vec  # pixel direction of increasing author u
    v: Vec  # pixel direction of increasing author v
    camera_right: Vec
    camera_down: Vec
    mirrored: bool  # art must be flipped before it is stamped into this island

    @property
    def turns_cw(self) -> int:
        """Quarter turns applied to viewer-frame art to land it in pixel space."""
        return quarter_turns_cw(self.camera_right)


def resolve_axes(
    plane: Plane,
    side: Side,
    axes: dict[str, str],
) -> dict[str, Vec]:
    """Expand the two declared axes into all six world directions in pixel space.

    ``axes`` maps world direction names (``tail``/``nose``/``down``/``up``/
    ``car_right``/``car_left``) to pixel directions (``+x``/``-x``/``+y``/``-y``).
    Exactly two perpendicular axes must be given, and they must be the two that
    lie in this panel's plane.
    """
    if not axes:
        raise ProfileError(f"a {plane} zone must declare its axes, e.g. {{tail: +x, down: +y}}")

    resolved: dict[str, Vec] = {}
    for name, pixel in axes.items():
        if name not in OPPOSITE:
            raise ProfileError(
                f"unknown axis {name!r}; use one of {', '.join(sorted(OPPOSITE))}"
            )
        if pixel not in DIRS:
            raise ProfileError(f"axis {name} must be one of +x/-x/+y/-y, got {pixel!r}")
        vec = DIRS[pixel]
        resolved[name] = vec
        resolved[OPPOSITE[name]] = negate(vec)

    needed = set(AUTHOR_AXES[plane])
    # The viewer basis may reference the opposite of an author axis (e.g. "nose").
    cam_right_world, cam_down_world = VIEWER_BASIS[(plane, side)]
    needed |= {cam_right_world, cam_down_world}
    missing = [n for n in needed if n not in resolved]
    if missing:
        raise ProfileError(
            f"{plane}/{side} zone is missing axis information for: {', '.join(sorted(set(missing)))}. "
            f"Declare two perpendicular axes, e.g. axes: {{{AUTHOR_AXES[plane][0]}: +x, {AUTHOR_AXES[plane][1]}: +y}}"
        )

    a, b = (resolved[n] for n in AUTHOR_AXES[plane])
    if a[0] * b[0] + a[1] * b[1] != 0:
        raise ProfileError(
            f"declared axes are not perpendicular: {AUTHOR_AXES[plane][0]}={DIR_NAMES[a]} "
            f"and {AUTHOR_AXES[plane][1]}={DIR_NAMES[b]}"
        )
    return resolved


def panel_frame(plane: Plane, side: Side, axes: dict[str, str]) -> PanelFrame:
    if (plane, side) not in VIEWER_BASIS:
        valid = ", ".join(f"{p}/{s}" for p, s in VIEWER_BASIS)
        raise ProfileError(
            f"plane {plane!r} with side {side!r} is not a panel orientation I know. Valid: {valid}"
        )
    resolved = resolve_axes(plane, side, axes)
    u_world, v_world = AUTHOR_AXES[plane]
    cam_right_world, cam_down_world = VIEWER_BASIS[(plane, side)]
    cam_right, cam_down = resolved[cam_right_world], resolved[cam_down_world]
    # On an unmirrored island the viewer basis is right-handed on screen:
    # turning camera-right 90° clockwise gives camera-down.
    mirrored = rot_cw(cam_right) != cam_down
    return PanelFrame(
        u=resolved[u_world],
        v=resolved[v_world],
        camera_right=cam_right,
        camera_down=cam_down,
        mirrored=mirrored,
    )


def map_rect(
    zone_px: tuple[float, float, float, float],
    frame: PanelFrame,
    u: float,
    v: float,
    w: float,
    h: float,
) -> tuple[int, int, int, int]:
    """Map an author-space rect inside a zone to a pixel rect (x, y, w, h).

    ``u``/``v`` are the near corner in author space (0-1 within the zone), and
    ``w``/``h`` its extents. The zone's axes decide which way each runs.
    """
    zx, zy, zw, zh = zone_px
    x0 = x1 = float(zx)
    y0 = y1 = float(zy)
    span = {"x": (zx, zw), "y": (zy, zh)}

    def axis_span(direction: Vec, start: float, extent: float) -> tuple[str, float, float]:
        which = "x" if direction[0] != 0 else "y"
        base, size = span[which]
        if direction[0] + direction[1] > 0:  # +x or +y
            lo = base + start * size
        else:  # runs backwards along that pixel axis
            lo = base + (1.0 - start - extent) * size
        return which, lo, extent * size

    for direction, start, extent in ((frame.u, u, w), (frame.v, v, h)):
        which, lo, size = axis_span(direction, start, extent)
        if which == "x":
            x0, x1 = lo, lo + size
        else:
            y0, y1 = lo, lo + size

    left, top = int(round(x0)), int(round(y0))
    return (left, top, max(1, int(round(x1 - x0))), max(1, int(round(y1 - y0))))


def viewer_size(frame: PanelFrame, pixel_w: int, pixel_h: int) -> tuple[int, int]:
    """Size art should be rendered at in the viewer frame to fill a pixel rect."""
    return (pixel_h, pixel_w) if frame.turns_cw % 2 else (pixel_w, pixel_h)
