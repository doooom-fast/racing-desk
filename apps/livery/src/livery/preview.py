"""Previews — the flat checks you can do before the sim.

Three views earn their keep:

* **albedo** — the paint itself, on a mid grey so white artwork is visible.
* **zones** — the profile drawn over the paint, with a nose arrow per panel and
  a mark on any island whose UVs are mirrored. This is how a profile gets from
  ``draft`` to ``verified``, and how a misplaced logo is spotted in one look.
* **materials** — the spec map as false colour: red metallic, green roughness,
  blue clear coat, plus the specular mask. Material mistakes are invisible in
  the albedo and obvious here.

The sim's own 3D viewer is still the arbiter of how a paint looks. These exist so
that only *finished* paints ever get loaded into it.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from .canvas import PaintCanvas
from .marks import resolve_font
from .profile import CarProfile

CHECKER = 32
LABEL_PX = 22


def checkerboard(size: tuple[int, int], light: int = 150, dark: int = 120) -> Image.Image:
    w, h = size
    img = Image.new("RGB", (w, h), (light, light, light))
    draw = ImageDraw.Draw(img)
    for y in range(0, h, CHECKER):
        for x in range(0, w, CHECKER):
            if (x // CHECKER + y // CHECKER) % 2:
                draw.rectangle([x, y, x + CHECKER - 1, y + CHECKER - 1], fill=(dark, dark, dark))
    return img


def albedo_view(canvas: PaintCanvas) -> Image.Image:
    """The paint over a checkerboard, so transparent and white areas both read."""
    base = checkerboard((canvas.width, canvas.height)).convert("RGBA")
    art = canvas.albedo_image()
    base.alpha_composite(art)
    return base.convert("RGB")


def zone_view(canvas: PaintCanvas, profile: CarProfile) -> Image.Image:
    """Paint with the profile's zones, orientation arrows and mirror flags drawn on."""
    img = albedo_view(canvas).convert("RGBA")
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = resolve_font(None, LABEL_PX)
    size = (canvas.width, canvas.height)

    for name, zone in sorted(profile.zones.items()):
        x, y, w, h = zone.pixel_rect(size)
        frame = zone.frame
        color = (255, 220, 60, 230) if zone.side == "center" else (
            (90, 200, 255, 230) if zone.side == "left" else (255, 130, 90, 230)
        )
        draw.rectangle([x, y, x + w - 1, y + h - 1], outline=color, width=3)
        label = f"{name}{' ⇋' if frame.mirrored else ''}"
        draw.rectangle([x + 4, y + 4, x + 12 + len(label) * LABEL_PX * 0.55, y + 8 + LABEL_PX],
                       fill=(0, 0, 0, 170))
        draw.text((x + 8, y + 6), label, font=font, fill=color)

        # Direction arrow. On a flank or a horizontal panel it points at the
        # car's nose; a front/rear panel has no nose in its plane, so there it
        # points at the car's right instead.
        cx, cy = x + w / 2, y + h / 2
        if zone.plane in ("side", "top", "bottom"):
            nose = (-frame.u[0], -frame.u[1])
        else:
            nose = frame.u
        length = min(w, h) * 0.3
        tip = (cx + nose[0] * length, cy + nose[1] * length)
        draw.line([(cx, cy), tip], fill=color, width=4)
        head = 12
        perp = (-nose[1], nose[0])
        draw.polygon(
            [
                tip,
                (tip[0] - nose[0] * head + perp[0] * head * 0.6, tip[1] - nose[1] * head + perp[1] * head * 0.6),
                (tip[0] - nose[0] * head - perp[0] * head * 0.6, tip[1] - nose[1] * head - perp[1] * head * 0.6),
            ],
            fill=color,
        )
    img.alpha_composite(overlay)
    return img.convert("RGB")


def material_view(canvas: PaintCanvas) -> Image.Image:
    """Spec map as false colour, with the specular mask shown as darkening."""
    spec = np.clip(canvas.spec * 255.0, 0, 255).astype(np.uint8)
    rgb = spec[..., :3].copy()
    mask = spec[..., 3:4].astype(np.float32) / 255.0
    shown = (rgb.astype(np.float32) * (0.25 + 0.75 * mask)).astype(np.uint8)
    return Image.fromarray(shown, mode="RGB")


def contact_sheet(
    canvas: PaintCanvas, profile: CarProfile, path: str | Path, cell: int = 900
) -> Path:
    """One PNG with every flat check on it, ready to look at or attach."""
    views = [
        ("albedo", albedo_view(canvas)),
        ("zones + orientation", zone_view(canvas, profile)),
        ("materials (R metallic · G rough · B clearcoat)", material_view(canvas)),
        ("alpha / glass", _alpha_view(canvas)),
    ]
    scale = cell / max(canvas.width, canvas.height)
    tw, th = int(canvas.width * scale), int(canvas.height * scale)
    pad, header = 16, 34
    sheet = Image.new("RGB", (tw * 2 + pad * 3, (th + header) * 2 + pad * 3), (24, 26, 30))
    draw = ImageDraw.Draw(sheet)
    font = resolve_font(None, 20)
    for i, (title, view) in enumerate(views):
        col, row = i % 2, i // 2
        x = pad + col * (tw + pad)
        y = pad + row * (th + header + pad)
        draw.text((x, y), title, font=font, fill=(220, 224, 230))
        sheet.paste(view.resize((tw, th), Image.Resampling.LANCZOS), (x, y + header))
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    return out


def _alpha_view(canvas: PaintCanvas) -> Image.Image:
    if canvas.glass_alpha is None:
        img = Image.new("RGB", (canvas.width, canvas.height), (40, 42, 48))
        draw = ImageDraw.Draw(img)
        font = resolve_font(None, max(18, canvas.width // 40))
        draw.text(
            (canvas.width * 0.06, canvas.height * 0.45),
            "no glass alpha — 24-bit TGA",
            font=font,
            fill=(150, 155, 165),
        )
        return img
    arr = np.clip(canvas.glass_alpha * 255.0, 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([arr] * 3), mode="RGB")


def swatch_sheet(materials, path: str | Path, cell: int = 220) -> Path:
    """A labelled grid of every material, to calibrate the spec-map numbers.

    Build it onto a car, look at it in the sim's 3D viewer, then edit
    ``data/materials.yaml`` until the names match what your eyes report.
    """
    names = materials.names()
    cols = 4
    rows = (len(names) + cols - 1) // cols
    img = Image.new("RGB", (cols * cell, rows * cell), (30, 30, 34))
    draw = ImageDraw.Draw(img)
    font = resolve_font(None, 18)
    for i, name in enumerate(names):
        mat = materials.resolve(name)
        x, y = (i % cols) * cell, (i // cols) * cell
        draw.rectangle([x + 6, y + 6, x + cell - 6, y + cell - 40], fill=tuple(mat.channels[:3]))
        draw.text((x + 12, y + cell - 32), f"{name}", font=font, fill=(235, 235, 240))
        draw.text(
            (x + 12, y + cell - 14),
            f"m{mat.metallic} r{mat.roughness} c{mat.clearcoat} a{mat.spec_mask}",
            font=font,
            fill=(160, 165, 175),
        )
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    return out
