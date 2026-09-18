"""Mark generators — every mark is drawn in the *viewer frame*.

"Viewer frame" means: as a person standing outside the car sees that panel,
+x to their right, +y down. Nothing here knows about UV islands or which flank
it is going on. `place.py` turns a viewer-frame image into pixels on the
template, flipping and rotating as that island requires.

Everything is drawn at SUPERSAMPLE and scaled down, because a livery edge that
crawls under motion is the giveaway of a generated paint.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Sequence

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from .errors import ArtError, LiveryError

SUPERSAMPLE = 3
RGBA = tuple[int, int, int, int]

FONT_DIRS = [
    Path.home() / ".fonts",
    Path("/usr/share/fonts/truetype/liberation"),
    Path("/usr/share/fonts/truetype/dejavu"),
    Path("C:/Windows/Fonts"),
]
FALLBACK_FONTS = ["LiberationSans-Bold.ttf", "DejaVuSans-Bold.ttf", "arialbd.ttf"]


def _hi(size: int) -> int:
    return max(1, size * SUPERSAMPLE)


def _down(img: Image.Image, w: int, h: int) -> Image.Image:
    return img.resize((max(1, w), max(1, h)), Image.Resampling.LANCZOS)


def solid(w: int, h: int, color: RGBA) -> Image.Image:
    return Image.new("RGBA", (max(1, w), max(1, h)), tuple(color))


def band(
    w: int,
    h: int,
    color: RGBA,
    angle: float = 0.0,
    taper: float = 0.0,
    feather: float = 0.0,
) -> Image.Image:
    """A band filling the box, optionally sheared and tapered.

    ``angle`` shears the band's long edges (a rake, as on a real side stripe);
    ``taper`` narrows it toward the tail end; ``feather`` softens both edges.
    """
    W, H = _hi(w), _hi(h)
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    rise = math.tan(math.radians(angle)) * W
    t = max(0.0, min(0.95, taper)) * H
    poly = [
        (0.0, 0.0),
        (float(W), -rise + t / 2),
        (float(W), H - rise - t / 2),
        (0.0, float(H)),
    ]
    draw.polygon(poly, fill=tuple(color))
    if feather > 0:
        img = img.filter(ImageFilter.GaussianBlur(radius=max(1.0, feather * H * 0.5)))
    return _down(img, w, h)


def stripes(
    w: int,
    h: int,
    colors: Sequence[RGBA],
    count: int = 3,
    weight: float = 0.5,
    gap: float = 0.0,
    angle: float = 0.0,
    feather: float = 0.0,
) -> Image.Image:
    """``count`` parallel stripes down the box — the Gulf/Martini arrangement.

    ``weight`` is the share of each slot the stripe fills; ``gap`` adds dead
    space between slots so the base colour shows through.
    """
    if count < 1:
        raise LiveryError("stripes.count must be at least 1")
    if not colors:
        raise LiveryError("stripes needs at least one colour")
    W, H = _hi(w), _hi(h)
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    total_gap = gap * H * (count - 1)
    slot = (H - total_gap) / count
    rise = math.tan(math.radians(angle)) * W
    y = 0.0
    for i in range(count):
        color = tuple(colors[i % len(colors)])
        thickness = slot * max(0.02, min(1.0, weight))
        y0 = y + (slot - thickness) / 2
        y1 = y0 + thickness
        draw.polygon(
            [(0.0, y0), (float(W), y0 - rise), (float(W), y1 - rise), (0.0, y1)],
            fill=color,
        )
        y += slot + gap * H
    if feather > 0:
        img = img.filter(ImageFilter.GaussianBlur(radius=max(1.0, feather * H * 0.5)))
    return _down(img, w, h)


def gradient(
    w: int,
    h: int,
    stops: Sequence[tuple[float, RGBA]],
    angle: float = 0.0,
    shape: str = "linear",
) -> Image.Image:
    """Linear or radial gradient. Stops are (position 0-1, colour)."""
    if len(stops) < 2:
        raise LiveryError("a gradient needs at least two colour stops")
    w, h = max(1, w), max(1, h)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    xs /= max(1, w - 1)
    ys /= max(1, h - 1)
    if shape == "radial":
        t = np.sqrt((xs - 0.5) ** 2 + (ys - 0.5) ** 2) / 0.7071
    elif shape == "linear":
        rad = math.radians(angle)
        dx, dy = math.cos(rad), math.sin(rad)
        t = xs * dx + ys * dy
        span = abs(dx) + abs(dy)
        offset = min(0.0, dx) + min(0.0, dy)
        t = (t - offset) / max(1e-6, span)
    else:
        raise LiveryError(f"gradient.shape must be linear or radial, got {shape!r}")
    t = np.clip(t, 0.0, 1.0)

    ordered = sorted(stops, key=lambda s: s[0])
    out = np.zeros((h, w, 4), dtype=np.float32)
    positions = [p for p, _ in ordered]
    colors = [np.array(c, dtype=np.float32) for _, c in ordered]
    out[:] = colors[0]
    for i in range(len(ordered) - 1):
        p0, p1 = positions[i], positions[i + 1]
        c0, c1 = colors[i], colors[i + 1]
        if p1 <= p0:
            continue
        local = np.clip((t - p0) / (p1 - p0), 0.0, 1.0)[..., None]
        seg = c0 + (c1 - c0) * local
        inside = ((t >= p0) & (t <= p1))[..., None]
        out = np.where(inside, seg, out)
    out = np.where((t >= positions[-1])[..., None], colors[-1], out)
    return Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8), mode="RGBA")


# ------------------------------------------------------------------ patterns


def pattern(
    kind: str,
    w: int,
    h: int,
    colors: Sequence[RGBA],
    scale: float = 0.08,
    angle: float = 0.0,
    density: float = 0.5,
    seed: int = 7,
) -> Image.Image:
    """Procedural fills that read as a texture rather than a flat panel."""
    w, h = max(1, w), max(1, h)
    if not colors:
        raise LiveryError("a pattern needs at least one colour")
    fg = tuple(colors[0])
    bg = tuple(colors[1]) if len(colors) > 1 else (0, 0, 0, 0)
    cell = max(4, int(min(w, h) * max(0.005, scale)))

    if kind == "carbon":
        img = _carbon(w, h, fg, bg, cell)
    elif kind == "halftone":
        img = _halftone(w, h, fg, bg, cell, density)
    elif kind == "hex":
        img = _hexgrid(w, h, fg, bg, cell)
    elif kind == "chevron":
        img = _chevron(w, h, fg, bg, cell)
    elif kind == "camo":
        img = _camo(w, h, colors, cell, seed)
    elif kind == "noise":
        rng = np.random.default_rng(seed)
        n = rng.random((h, w, 1)).astype(np.float32)
        arr = np.array(bg, dtype=np.float32) + (np.array(fg, dtype=np.float32) - np.array(bg, dtype=np.float32)) * n
        img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), mode="RGBA")
    else:
        raise LiveryError(
            f"unknown pattern {kind!r}; try carbon, halftone, hex, chevron, camo, noise"
        )
    if angle:
        img = img.rotate(angle, resample=Image.Resampling.BICUBIC, expand=False)
    return img


def _carbon(w: int, h: int, fg: RGBA, bg: RGBA, cell: int) -> Image.Image:
    img = Image.new("RGBA", (w, h), bg)
    draw = ImageDraw.Draw(img)
    half = max(2, cell // 2)
    for y in range(0, h + cell, half):
        for x in range(0, w + cell, half):
            weave = ((x // half) + (y // half)) % 2 == 0
            shade = tuple(int(c * (1.12 if weave else 0.88)) if i < 3 else c for i, c in enumerate(fg))
            shade = tuple(min(255, max(0, v)) for v in shade)
            draw.rectangle([x, y, x + half - 1, y + half - 1], fill=shade)  # type: ignore[arg-type]
    return img.filter(ImageFilter.GaussianBlur(radius=0.6))


def _halftone(w: int, h: int, fg: RGBA, bg: RGBA, cell: int, density: float) -> Image.Image:
    img = Image.new("RGBA", (w, h), bg)
    draw = ImageDraw.Draw(img)
    r = cell * max(0.05, min(0.5, density))
    for row, y in enumerate(range(0, h + cell, cell)):
        offset = cell // 2 if row % 2 else 0
        for x in range(-cell, w + cell, cell):
            cx, cy = x + offset, y
            draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=tuple(fg))
    return img


def _hexgrid(w: int, h: int, fg: RGBA, bg: RGBA, cell: int) -> Image.Image:
    img = Image.new("RGBA", (w, h), bg)
    draw = ImageDraw.Draw(img)
    r = cell
    dx, dy = r * 1.5, r * math.sqrt(3)
    for col, x in enumerate(np.arange(-r, w + r, dx)):
        for y in np.arange(-r, h + r, dy):
            cy = y + (dy / 2 if col % 2 else 0)
            pts = [
                (x + r * math.cos(math.radians(60 * k)), cy + r * math.sin(math.radians(60 * k)))
                for k in range(6)
            ]
            draw.polygon(pts, outline=tuple(fg), width=max(1, cell // 8))
    return img


def _chevron(w: int, h: int, fg: RGBA, bg: RGBA, cell: int) -> Image.Image:
    img = Image.new("RGBA", (w, h), bg)
    draw = ImageDraw.Draw(img)
    step = cell * 2
    for x in range(-h, w + h, step):
        draw.line([(x, h), (x + h // 2, 0)], fill=tuple(fg), width=max(1, cell // 2))
        draw.line([(x + h // 2, 0), (x + h, h)], fill=tuple(fg), width=max(1, cell // 2))
    return img


def _camo(w: int, h: int, colors: Sequence[RGBA], cell: int, seed: int) -> Image.Image:
    rng = np.random.default_rng(seed)
    small = (max(2, w // max(4, cell)), max(2, h // max(4, cell)))
    field = rng.random((small[1], small[0])).astype(np.float32)
    blurred = Image.fromarray((field * 255).astype(np.uint8)).resize((w, h), Image.Resampling.BICUBIC)
    values = np.asarray(blurred, dtype=np.float32) / 255.0
    bands = np.linspace(0.0, 1.0, len(colors) + 1)[1:-1]
    index = np.digitize(values, bands)
    palette = np.array([list(c) for c in colors], dtype=np.uint8)
    return Image.fromarray(palette[index], mode="RGBA")


# ---------------------------------------------------------------------- text


def resolve_font(name: str | None, size: int) -> ImageFont.FreeTypeFont:
    """Find a font by path or by name, with a legible fallback.

    Race numbers deserve a proper condensed face — drop the TTF next to the
    spec or in ~/.fonts and name it; this only falls back so a build never dies
    for want of a font file.
    """
    size = max(4, int(size))
    candidates: list[Path] = []
    if name:
        p = Path(name).expanduser()
        candidates.append(p)
        for d in FONT_DIRS:
            candidates.append(d / name)
            if not name.lower().endswith((".ttf", ".otf")):
                candidates.extend([d / f"{name}.ttf", d / f"{name}.otf"])
    for d in FONT_DIRS:
        candidates.extend(d / f for f in FALLBACK_FONTS)
    for c in candidates:
        try:
            if c.exists():
                return ImageFont.truetype(str(c), size)
        except OSError:
            continue
    if name:
        raise ArtError(
            f"font {name!r} not found. Put the .ttf beside the spec, in ~/.fonts, "
            f"or give an absolute path."
        )
    return ImageFont.load_default(size=size)


def text(
    content: str,
    font_name: str | None,
    height_px: int,
    color: RGBA,
    outline: tuple[RGBA, float] | None = None,
    shadow: tuple[RGBA, float, float] | None = None,
    tracking: float = 0.0,
    slant: float = 0.0,
) -> Image.Image:
    """Render a word/number tight to its ink, with optional outline and shadow.

    ``tracking`` is letter spacing as a fraction of cap height, ``slant`` is a
    forward lean in degrees (the italic race number look) applied as a shear so
    the strokes keep their weight.
    """
    if not content:
        raise LiveryError("text element has no content")
    px = max(8, int(height_px * SUPERSAMPLE))
    font = resolve_font(font_name, px)
    stroke = int(round(outline[1] * px)) if outline else 0

    spacing = int(round(tracking * px))
    widths = []
    for ch in content:
        box = font.getbbox(ch, stroke_width=stroke)
        widths.append(box[2] - box[0] if box else px // 2)
    total_w = sum(widths) + spacing * max(0, len(content) - 1)
    ascent, descent = font.getmetrics()
    total_h = ascent + descent + 2 * stroke

    pad = int(px * 0.4) + stroke
    img = Image.new("RGBA", (total_w + 2 * pad, total_h + 2 * pad), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    x = pad
    for ch, cw in zip(content, widths):
        box = font.getbbox(ch, stroke_width=stroke)
        if shadow:
            sc, sdx, sdy = shadow
            draw.text(
                (x - box[0] + sdx * px, pad - box[1] + sdy * px), ch, font=font, fill=tuple(sc),
                stroke_width=stroke, stroke_fill=tuple(sc),
            )
        draw.text(
            (x - box[0], pad - box[1]),
            ch,
            font=font,
            fill=tuple(color),
            stroke_width=stroke,
            stroke_fill=tuple(outline[0]) if outline else None,
        )
        x += cw + spacing

    if slant:
        shear = math.tan(math.radians(slant))
        w, h = img.size
        extra = int(abs(shear) * h) + 1
        canvas = Image.new("RGBA", (w + extra, h), (0, 0, 0, 0))
        canvas.paste(img, (extra if shear < 0 else 0, 0))
        img = canvas.transform(
            canvas.size,
            Image.Transform.AFFINE,
            (1, shear, -shear * h if shear > 0 else 0, 0, 1, 0),
            resample=Image.Resampling.BICUBIC,
        )

    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    scale = height_px / max(1, img.height)
    return _down(img, max(1, int(round(img.width * scale))), height_px)


# --------------------------------------------------------------------- image


def fit_image(img: Image.Image, w: int, h: int, mode: str = "contain") -> Image.Image:
    """Resize into a w×h box. ``contain`` letterboxes, ``cover`` crops,
    ``stretch`` distorts (and is almost always a mistake on a logo)."""
    w, h = max(1, w), max(1, h)
    img = img.convert("RGBA")
    if mode == "stretch":
        return img.resize((w, h), Image.Resampling.LANCZOS)
    scale = min(w / img.width, h / img.height) if mode == "contain" else max(w / img.width, h / img.height)
    nw, nh = max(1, int(round(img.width * scale))), max(1, int(round(img.height * scale)))
    resized = img.resize((nw, nh), Image.Resampling.LANCZOS)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(resized, ((w - nw) // 2, (h - nh) // 2), resized)
    return out
