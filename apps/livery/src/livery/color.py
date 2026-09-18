"""Color parsing and the color math the paint rules need.

Everything in the pipeline speaks RGBA tuples of ints 0-255. Specs speak hex
strings, ``palette.<name>`` references, or ``{color: ..., alpha: ...}`` maps.
"""

from __future__ import annotations

import colorsys
import re
from typing import Iterable, Mapping, Sequence

from .errors import LiveryError

RGBA = tuple[int, int, int, int]

_HEX = re.compile(r"^#?([0-9a-fA-F]{3,8})$")

# Named colors worth having without pulling in a dependency: racing staples.
NAMED: dict[str, str] = {
    "black": "#000000",
    "white": "#ffffff",
    "red": "#e10600",
    "orange": "#ff6900",
    "yellow": "#ffd400",
    "green": "#00a651",
    "blue": "#0057b8",
    "navy": "#0b1a33",
    "purple": "#6b2fbb",
    "pink": "#ff3d7f",
    "gold": "#c8a200",
    "silver": "#c8ccd0",
    "gunmetal": "#3a4048",
    "carbon": "#1b1d20",
    "transparent": "#00000000",
}


def parse(value, palette: Mapping[str, str] | None = None) -> RGBA:
    """Parse any color the spec grammar allows into RGBA.

    Accepts ``"#rgb"``, ``"#rrggbb"``, ``"#rrggbbaa"``, a named color, a
    ``palette.key`` reference, a 3/4-tuple, or ``{color: x, alpha: 0-1}``.
    """
    if value is None:
        raise LiveryError("color is required but was null")
    if isinstance(value, Mapping):
        base = parse(value.get("color", "#000000"), palette)
        if "alpha" in value:
            return (base[0], base[1], base[2], _alpha_to_byte(value["alpha"]))
        return base
    if isinstance(value, (tuple, list)):
        vals = [int(v) for v in value]
        if len(vals) == 3:
            vals.append(255)
        if len(vals) != 4:
            raise LiveryError(f"color tuple must have 3 or 4 components, got {value!r}")
        return tuple(max(0, min(255, v)) for v in vals)  # type: ignore[return-value]
    if not isinstance(value, str):
        raise LiveryError(f"cannot read {value!r} as a color")

    text = value.strip()
    if text.startswith("palette."):
        key = text[len("palette."):]
        if not palette or key not in palette:
            known = ", ".join(sorted(palette or {})) or "(palette is empty)"
            raise LiveryError(f"palette.{key} is not defined. Defined: {known}")
        return parse(palette[key], None)
    low = text.lower()
    if low in NAMED:
        return parse(NAMED[low], None)
    m = _HEX.match(text)
    if not m:
        raise LiveryError(
            f"{value!r} is not a color. Use #rrggbb, #rrggbbaa, a palette.<key> "
            f"reference, or one of: {', '.join(sorted(NAMED))}"
        )
    h = m.group(1)
    if len(h) == 3:
        h = "".join(c * 2 for c in h) + "ff"
    elif len(h) == 4:
        h = "".join(c * 2 for c in h)
    elif len(h) == 6:
        h = h + "ff"
    elif len(h) != 8:
        raise LiveryError(f"{value!r} is not a 3/4/6/8 digit hex color")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), int(h[6:8], 16))


def _alpha_to_byte(alpha) -> int:
    a = float(alpha)
    if a <= 1.0:
        a *= 255.0
    return max(0, min(255, int(round(a))))


def to_hex(rgba: Sequence[int], with_alpha: bool = False) -> str:
    r, g, b = rgba[0], rgba[1], rgba[2]
    a = rgba[3] if len(rgba) > 3 else 255
    return f"#{r:02x}{g:02x}{b:02x}{a:02x}" if with_alpha else f"#{r:02x}{g:02x}{b:02x}"


def relative_luminance(rgba: Sequence[int]) -> float:
    """WCAG relative luminance, 0.0 (black) to 1.0 (white)."""

    def chan(c: int) -> float:
        s = c / 255.0
        return s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4

    r, g, b = (chan(rgba[i]) for i in range(3))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(a: Sequence[int], b: Sequence[int]) -> float:
    """WCAG contrast ratio between two colors, 1.0 to 21.0.

    Used to warn when a number or logo will not read at track distance.
    """
    la, lb = relative_luminance(a), relative_luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def mix(a: Sequence[int], b: Sequence[int], t: float) -> RGBA:
    """Linear blend, t=0 → a, t=1 → b. Straight RGB, no gamma — matches how a
    paint program blends two flats, which is what an author expects."""
    t = max(0.0, min(1.0, t))
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(4))  # type: ignore[return-value]


def lighten(rgba: Sequence[int], amount: float) -> RGBA:
    return mix(rgba, (255, 255, 255, rgba[3] if len(rgba) > 3 else 255), amount)


def darken(rgba: Sequence[int], amount: float) -> RGBA:
    return mix(rgba, (0, 0, 0, rgba[3] if len(rgba) > 3 else 255), amount)


def with_value(rgba: Sequence[int], value: float) -> RGBA:
    """Return the color with HSV value forced to ``value`` (0-1), hue and
    saturation kept. This is the metallic-albedo fix: metal keeps its hue but
    has to be painted far lighter than it looks on a flat."""
    r, g, b = (c / 255.0 for c in rgba[:3])
    h, s, _ = colorsys.rgb_to_hsv(r, g, b)
    nr, ng, nb = colorsys.hsv_to_rgb(h, s, max(0.0, min(1.0, value)))
    a = rgba[3] if len(rgba) > 3 else 255
    return (int(round(nr * 255)), int(round(ng * 255)), int(round(nb * 255)), a)


def value_of(rgba: Sequence[int]) -> float:
    """HSV value (0-1) — the brightness metric the metallic rule is stated in."""
    return max(rgba[0], rgba[1], rgba[2]) / 255.0


def readable_on(background: Sequence[int], candidates: Iterable[Sequence[int]]) -> RGBA:
    """Pick the candidate with the best contrast against ``background``."""
    best, best_ratio = None, -1.0
    for c in candidates:
        ratio = contrast_ratio(background, c)
        if ratio > best_ratio:
            best, best_ratio = c, ratio
    if best is None:
        raise LiveryError("readable_on() needs at least one candidate color")
    return tuple(best)  # type: ignore[return-value]
