"""The art library: sponsor logos and source art, with the rules that come with them.

A logo is not just a PNG. It has a tier (does it get the door or the rocker?), a
clear space nobody may paint inside, a minimum height below which it stops being
legible on a broadcast, light and dark versions, and sometimes a hard rule that
it must never be recoloured. Keeping that beside the file is what lets a build
place a whole sponsor set without an art director watching every mark.

Layout on disk:

    art/logos/<id>/logo.yaml        metadata
    art/logos/<id>/default.png      artwork (any variant name works)
    art/logos/<id>/light.png
    art/sources/<whatever>.jpg      reference art to remix — no metadata needed
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence

import yaml
from PIL import Image

from . import color as colormod
from . import remix
from .errors import ArtError

IMAGE_SUFFIXES = (".png", ".webp", ".tga", ".jpg", ".jpeg")
TIERS = ("manufacturer", "primary", "secondary", "associate", "contingency")
LIGHT_NAMES = ("light", "white", "reverse", "knockout", "mono_light")
DARK_NAMES = ("dark", "black", "positive", "mono_dark")


@dataclass
class Logo:
    id: str
    root: Path
    brand: str = ""
    tier: str = "secondary"
    variants: dict[str, Path] = field(default_factory=dict)
    clear_space: float = 0.25          # multiples of the mark's height, all round
    min_height_mm: float = 60.0        # below this it stops reading on stream
    affinity: list[str] = field(default_factory=list)  # zones it belongs on
    lock_color: bool = False           # brand forbids recolouring
    background: str = "any"            # any | light | dark — what it needs behind it
    notes: str = ""
    source: str = ""

    def file(self, variant: str = "default") -> Path:
        if variant in self.variants:
            return self.variants[variant]
        if "default" in self.variants:
            return self.variants["default"]
        if self.variants:
            return next(iter(self.variants.values()))
        raise ArtError(f"logo {self.id!r} has no artwork files in {self.root}")

    def pick_variant(self, background: Sequence[int] | None) -> str:
        """Choose light/dark artwork for what it is going on top of."""
        if background is None:
            return "default" if "default" in self.variants else next(iter(self.variants), "default")
        dark_bg = colormod.relative_luminance(background) < 0.35
        preferred = LIGHT_NAMES if dark_bg else DARK_NAMES
        for name in preferred:
            if name in self.variants:
                return name
        return "default" if "default" in self.variants else next(iter(self.variants), "default")

    def load(self, variant: str = "default", trim: bool = True) -> Image.Image:
        path = self.file(variant)
        try:
            img = Image.open(path).convert("RGBA")
        except OSError as exc:
            raise ArtError(f"logo {self.id}: cannot read {path} ({exc})") from exc
        return remix.trim(img) if trim else img

    def aspect(self, variant: str = "default") -> float:
        img = self.load(variant)
        return img.width / max(1, img.height)

    def to_dict(self) -> dict[str, Any]:
        return {
            "brand": self.brand,
            "tier": self.tier,
            "clear_space": self.clear_space,
            "min_height_mm": self.min_height_mm,
            "affinity": list(self.affinity),
            "lock_color": self.lock_color,
            "background": self.background,
            "notes": self.notes,
            "source": self.source,
        }


class ArtLibrary:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.logos_dir = self.root / "logos"
        self.sources_dir = self.root / "sources"
        self._logos: dict[str, Logo] | None = None

    # ------------------------------------------------------------------ index

    def index(self, refresh: bool = False) -> dict[str, Logo]:
        if self._logos is not None and not refresh:
            return self._logos
        logos: dict[str, Logo] = {}
        if self.logos_dir.exists():
            for entry in sorted(self.logos_dir.iterdir()):
                if entry.is_dir():
                    logo = self._read_dir(entry)
                elif entry.suffix.lower() in IMAGE_SUFFIXES:
                    logo = self._read_loose(entry)
                else:
                    continue
                if logo:
                    logos[logo.id] = logo
        self._logos = logos
        return logos

    def _read_dir(self, directory: Path) -> Logo | None:
        variants = {
            f.stem: f for f in sorted(directory.iterdir())
            if f.suffix.lower() in IMAGE_SUFFIXES
        }
        if not variants:
            return None
        meta_path = directory / "logo.yaml"
        meta = yaml.safe_load(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        return self._build(directory.name, directory, variants, meta or {})

    def _read_loose(self, image: Path) -> Logo:
        meta_path = image.with_suffix(".yaml")
        meta = yaml.safe_load(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        return self._build(image.stem, image.parent, {"default": image}, meta or {})

    def _build(self, ident: str, root: Path, variants: dict[str, Path], meta: dict) -> Logo:
        tier = meta.get("tier", "secondary")
        if tier not in TIERS:
            raise ArtError(f"logo {ident}: tier must be one of {', '.join(TIERS)}, got {tier!r}")
        return Logo(
            id=ident,
            root=root,
            brand=meta.get("brand", ident.replace("-", " ").title()),
            tier=tier,
            variants=variants,
            clear_space=float(meta.get("clear_space", 0.25)),
            min_height_mm=float(meta.get("min_height_mm", 60.0)),
            affinity=list(meta.get("affinity") or []),
            lock_color=bool(meta.get("lock_color", False)),
            background=meta.get("background", "any"),
            notes=meta.get("notes", ""),
            source=meta.get("source", ""),
        )

    # ----------------------------------------------------------------- access

    def get(self, ident: str) -> Logo:
        logos = self.index()
        if ident not in logos:
            known = ", ".join(sorted(logos)) or "(the library is empty)"
            raise ArtError(f"no logo {ident!r} in {self.logos_dir}. Known: {known}")
        return logos[ident]

    def ids(self) -> list[str]:
        return sorted(self.index())

    def by_tier(self, tier: str) -> list[Logo]:
        return [logo for logo in self.index().values() if logo.tier == tier]

    def resolve_source(self, ref: str) -> Path:
        """Resolve an image reference from a spec: absolute, relative to the art
        root, or a bare name under art/sources/."""
        candidates = [Path(ref), self.root / ref, self.sources_dir / ref]
        for c in candidates:
            if c.exists():
                return c
        raise ArtError(
            f"art file {ref!r} not found. Looked in: {', '.join(str(c) for c in candidates)}"
        )

    # ------------------------------------------------------------------ write

    def import_logo(
        self,
        image_path: str | Path,
        ident: str,
        *,
        strip_background: bool = True,
        make_mono: bool = True,
        meta: dict[str, Any] | None = None,
    ) -> Logo:
        """Bring a supplied file into the library: clean it, derive variants, write metadata."""
        src = Path(image_path)
        if not src.exists():
            raise ArtError(f"no such file: {src}")
        img = Image.open(src).convert("RGBA")
        if strip_background:
            img = remix.remove_background(img)
        img = remix.trim(img)
        if img.width < 2 or img.height < 2:
            raise ArtError(f"{src} came out empty after trimming — is it blank?")

        target = self.logos_dir / ident
        target.mkdir(parents=True, exist_ok=True)
        img.save(target / "default.png")
        if make_mono:
            remix.knockout(img, (255, 255, 255, 255)).save(target / "light.png")
            remix.knockout(img, (17, 17, 19, 255)).save(target / "dark.png")

        info = {"brand": ident.replace("-", " ").title(), "source": str(src)}
        info.update(meta or {})
        palette = remix.extract_palette(img, 4)
        if palette:
            info.setdefault("notes", "palette: " + ", ".join(p.hex for p in palette[:4]))
        (target / "logo.yaml").write_text(
            yaml.safe_dump(info, sort_keys=False, allow_unicode=True), encoding="utf-8"
        )
        self._logos = None
        return self.get(ident)


def legibility_check(
    logo: Logo, height_px: float, ppm: float, background: Sequence[int] | None = None
) -> list[str]:
    """Warnings for a placement: too small to read, or wrong background for the art."""
    warnings: list[str] = []
    height_mm = height_px / max(1e-6, ppm) * 1000.0
    if height_mm < logo.min_height_mm:
        warnings.append(
            f"{logo.id}: {height_mm:.0f}mm tall on the car, below its {logo.min_height_mm:.0f}mm "
            f"minimum — it will smear at broadcast distance"
        )
    if background is not None and logo.background != "any":
        lum = colormod.relative_luminance(background)
        wants_light = logo.background == "light"
        if wants_light and lum < 0.35:
            warnings.append(f"{logo.id} wants a light background but is sitting on a dark panel")
        if not wants_light and lum > 0.65:
            warnings.append(f"{logo.id} wants a dark background but is sitting on a light panel")
    return warnings


def clear_space_box(
    box: tuple[int, int, int, int], clear_space: float
) -> tuple[int, int, int, int]:
    x, y, w, h = box
    pad = int(round(clear_space * h))
    return (x - pad, y - pad, w + 2 * pad, h + 2 * pad)


def boxes_overlap(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> bool:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return not (ax + aw <= bx or bx + bw <= ax or ay + ah <= by or by + bh <= ay)
