"""Reading iRacing's own paint templates, and bootstrapping a profile from one.

iRacing ships a layered PSD per car (iRacing UI → My Content → Car → Download
Template). The layer names in it are the closest thing to a panel map anybody
hands out, so that is where a profile starts: names and bounding boxes in, draft
zones out. The result is never trusted blind — it lands as ``confidence: draft``
and has to be checked against the zone overlay before it is worth anything.

``psd-tools`` is an optional dependency; without it, a template can still be
bootstrapped from a flattened PNG (canvas size only) or from a 3D bake, which is
the better route anyway when a mesh is available (see bake.py).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable

from .errors import LiveryError
from .profile import CarProfile, Zone

# Layer-name fragment → (zone part, plane). Ordered: first match wins, so the
# more specific fragments come first.
PART_KEYWORDS: list[tuple[tuple[str, ...], str, str]] = [
    (("front bumper", "front fascia", "nose", "front end"), "front", "front"),
    (("rear bumper", "rear fascia", "tail", "rear end"), "rear", "rear"),
    (("rear quarter", "quarter panel", "quarter"), "rear_quarter", "side"),
    (("front fender", "fender", "wing panel", "guard"), "front_fender", "side"),
    (("rocker", "sill", "side skirt", "skirt"), "rocker", "side"),
    (("door",), "door", "side"),
    (("hood", "bonnet"), "hood", "top"),
    (("roof",), "roof", "top"),
    (("decklid", "deck lid", "trunk", "boot", "engine cover"), "decklid", "top"),
    (("rear wing", "spoiler", "wing"), "rear_wing", "rear"),
    (("splitter", "air dam"), "splitter", "top"),
    (("diffuser", "undertray", "floor"), "diffuser", "bottom"),
    (("mirror",), "mirror", "side"),
    (("glass", "window", "windshield", "windscreen"), "glass", "top"),
    (("wheel", "rim"), "wheel", "side"),
    (("side",), "side", "side"),
]

SIDE_KEYWORDS: list[tuple[tuple[str, ...], str]] = [
    (("left", " lh", "lh ", "_l", "driver side", "driver's side"), "left"),
    (("right", " rh", "rh ", "_r", "passenger side", "passenger's side"), "right"),
]

DEFAULT_AXES = {
    "side": {"tail": "+x", "down": "+y"},
    "top": {"tail": "+y", "car_right": "+x"},
    "bottom": {"tail": "+y", "car_right": "+x"},
    "front": {"car_right": "+x", "down": "+y"},
    "rear": {"car_right": "+x", "down": "+y"},
}


def classify_layer(name: str) -> tuple[str, str, str] | None:
    """``"Door RH"`` → ``("door", "side", "right")``. None if it is not a panel."""
    low = f" {name.lower().strip()} "
    part = plane = None
    for fragments, candidate_part, candidate_plane in PART_KEYWORDS:
        if any(f in low for f in fragments):
            part, plane = candidate_part, candidate_plane
            break
    if part is None:
        return None
    side = "center"
    for fragments, candidate_side in SIDE_KEYWORDS:
        if any(f in low for f in fragments):
            side = candidate_side
            break
    if plane in ("top", "bottom", "front", "rear"):
        side = "center"
    return (part, plane, side)


def zones_from_layers(
    layers: Iterable[tuple[str, tuple[int, int, int, int]]],
    canvas: tuple[int, int],
) -> dict[str, Zone]:
    """Turn (layer name, pixel bbox) pairs into draft zones.

    Layers that classify to the same panel are merged into one bounding box —
    templates routinely split a door across "Door", "Door Shadow" and
    "Door Guide" layers.
    """
    cw, ch = canvas
    boxes: dict[str, tuple[str, str, list[int]]] = {}
    for name, (x0, y0, x1, y1) in layers:
        classified = classify_layer(name)
        if not classified or x1 <= x0 or y1 <= y0:
            continue
        part, plane, side = classified
        key = part if side == "center" else f"{part}.{side}"
        if key in boxes:
            _, _, box = boxes[key]
            box[0], box[1] = min(box[0], x0), min(box[1], y0)
            box[2], box[3] = max(box[2], x1), max(box[3], y1)
        else:
            boxes[key] = (plane, side, [x0, y0, x1, y1])

    zones: dict[str, Zone] = {}
    for key, (plane, side, box) in sorted(boxes.items()):
        x0, y0, x1, y1 = box
        rect = (
            max(0.0, x0 / cw),
            max(0.0, y0 / ch),
            min(1.0, (x1 - x0) / cw),
            min(1.0, (y1 - y0) / ch),
        )
        zones[key] = Zone(
            name=key,
            rect=rect,
            plane=plane,  # type: ignore[arg-type]
            side=side,  # type: ignore[arg-type]
            axes=dict(DEFAULT_AXES[plane]),
            tags=["draft"],
            notes="axes are a guess from the template layout — verify with the zone overlay",
        )
    return zones


def bootstrap_from_psd(psd_path: str | Path, car: str) -> CarProfile:
    """Read a template PSD and produce a draft profile."""
    try:
        from psd_tools import PSDImage  # type: ignore
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise LiveryError(
            "reading PSD templates needs psd-tools: pip install 'prodrive-livery[templates]'"
        ) from exc

    path = Path(psd_path)
    if not path.exists():
        raise LiveryError(f"no template at {path}")
    psd = PSDImage.open(path)
    canvas = (psd.width, psd.height)

    layers: list[tuple[str, tuple[int, int, int, int]]] = []
    alpha_layer = False

    def walk(group) -> None:
        nonlocal alpha_layer
        for layer in group:
            name = str(layer.name)
            if "alpha" in name.lower() and "glass" in name.lower():
                alpha_layer = True
            if layer.is_group():
                walk(layer)
                continue
            bbox = getattr(layer, "bbox", None)
            if bbox and bbox != (0, 0, 0, 0):
                layers.append((name, tuple(bbox)))  # type: ignore[arg-type]

    walk(psd)
    zones = zones_from_layers(layers, canvas)
    profile = CarProfile(
        car=car,
        display_name=car,
        canvas=canvas,
        alpha="glass" if alpha_layer else "none",
        confidence="draft",
        zones=zones,
        number_zones=[z for z in ("door.left", "door.right", "hood", "roof") if z in zones],
        template={"psd": str(path), "layers": len(layers)},
        notes=(
            "Bootstrapped from the template PSD. Every rect and every axis is a guess: "
            "run `livery preview --zones` and fix them, then set confidence: checked."
        ),
    )
    profile.validate()
    return profile


def bootstrap_blank(car: str, width: int = 2048, height: int = 2048) -> CarProfile:
    """A starting profile for a car whose template has not been read yet.

    One zone covering the sheet, so a spec can at least flood a base colour and
    a build can be put in front of the sim's 3D viewer to see where things land.
    """
    zones = {
        "body": Zone(
            name="body",
            rect=(0.0, 0.0, 1.0, 1.0),
            plane="top",
            side="center",
            axes={"tail": "+y", "car_right": "+x"},
            tags=["placeholder"],
            notes=(
                "placeholder covering the whole sheet. Its orientation is arbitrary — it is "
                "here so a base colour can be flooded and looked at in the sim. Split it into "
                "real panels before placing anything that has to land somewhere specific."
            ),
        )
    }
    return CarProfile(
        car=car,
        display_name=car,
        canvas=(width, height),
        confidence="draft",
        zones=zones,
        notes="blank profile: no template has been read for this car yet",
    )


def template_hints(psd_path: str | Path) -> dict[str, Any]:
    """Layer names and sizes, for when a bootstrap gets a panel wrong and you
    want to see what the template actually called things."""
    try:
        from psd_tools import PSDImage  # type: ignore
    except ImportError as exc:  # pragma: no cover
        raise LiveryError("needs psd-tools: pip install 'prodrive-livery[templates]'") from exc
    psd = PSDImage.open(Path(psd_path))
    out: list[dict[str, Any]] = []

    def walk(group, depth=0) -> None:
        for layer in group:
            out.append(
                {
                    "name": str(layer.name),
                    "depth": depth,
                    "bbox": list(getattr(layer, "bbox", ()) or []),
                    "classified": classify_layer(str(layer.name)),
                }
            )
            if layer.is_group():
                walk(layer, depth + 1)

    walk(psd)
    return {"canvas": [psd.width, psd.height], "layers": out}
