#!/usr/bin/env python3
"""Generate the placeholder sponsor art the demo livery uses.

These are stand-ins so `livery build liveries/demo-night-runner.yaml` works on a
fresh clone. Real sponsor logos go in art/logos/<id>/ with a logo.yaml beside
them — see `livery art import`.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import yaml
from PIL import Image, ImageDraw

from livery import marks, remix

ROOT = Path(__file__).resolve().parents[1]
LOGOS = ROOT / "art" / "logos"

SAMPLES = [
    {
        "id": "sample-primary",
        "word": "PLACEHOLDER",
        "color": (255, 255, 255, 255),
        "meta": {
            "brand": "Sample Primary Sponsor",
            "tier": "primary",
            "clear_space": 0.3,
            "min_height_mm": 110,
            "affinity": ["door", "rear_quarter", "hood"],
            "notes": "Placeholder artwork — replace with the real logo.",
        },
    },
    {
        "id": "sample-associate",
        "word": "ASSOCIATE",
        "color": (240, 240, 235, 255),
        "meta": {
            "brand": "Sample Associate",
            "tier": "associate",
            "clear_space": 0.2,
            "min_height_mm": 55,
            "affinity": ["rocker", "rear_wing", "front_fender"],
            "notes": "Placeholder artwork — replace with the real logo.",
        },
    },
]


def build_wordmark(word: str, color: tuple[int, int, int, int]) -> Image.Image:
    text = marks.text(word, None, 120, color, tracking=0.06)
    pad_x, pad_y = int(text.height * 0.5), int(text.height * 0.35)
    img = Image.new("RGBA", (text.width + pad_x * 2, text.height + pad_y * 2), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle(
        [0, 0, img.width - 1, img.height - 1],
        radius=int(img.height * 0.18),
        outline=color,
        width=max(3, img.height // 24),
    )
    img.alpha_composite(text, (pad_x, pad_y))
    return remix.trim(img)


def main() -> None:
    for sample in SAMPLES:
        target = LOGOS / sample["id"]
        target.mkdir(parents=True, exist_ok=True)
        art = build_wordmark(sample["word"], sample["color"])
        art.save(target / "default.png")
        remix.knockout(art, (255, 255, 255, 255)).save(target / "light.png")
        remix.knockout(art, (20, 20, 22, 255)).save(target / "dark.png")
        (target / "logo.yaml").write_text(
            yaml.safe_dump(sample["meta"], sort_keys=False), encoding="utf-8"
        )
        print(f"wrote {target.relative_to(ROOT)} ({art.width}×{art.height})")


if __name__ == "__main__":
    main()
