"""TGA export — the only format iRacing reads for custom paints.

Details that matter:

* 24-bit unless the car's template needs an alpha channel (glass), then 32-bit.
* RLE compression on, always. It costs nothing and these files are big.
* The sim caches a ``.mip`` beside the TGA and only re-reads the TGA when the
  TGA is newer or the mip is gone. A build that does not invalidate the mip
  looks like a build that silently did nothing.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image


def save_tga(img: Image.Image, path: str | Path, bits: int = 24, rle: bool = True) -> Path:
    """Write a TGA the sim will accept."""
    if bits not in (24, 32):
        raise ValueError(f"iRacing paints are 24- or 32-bit TGA, not {bits}")
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    prepared = img.convert("RGBA" if bits == 32 else "RGB")
    prepared.save(out, format="TGA", compression="tga_rle" if rle else None)
    return out


def bust_mip(tga_path: str | Path) -> list[Path]:
    """Remove the sim's cached mip for a paint file so it re-reads the TGA.

    Returns whatever it deleted, for the build report.
    """
    tga = Path(tga_path)
    removed = []
    for candidate in (tga.with_suffix(".mip"), tga.with_suffix(".MIP")):
        if candidate.exists():
            candidate.unlink()
            removed.append(candidate)
    return removed


def describe(path: str | Path) -> dict[str, object]:
    """What is actually in a TGA on disk — used by `livery doctor`."""
    p = Path(path)
    with Image.open(p) as img:
        info = {
            "path": str(p),
            "size": list(img.size),
            "mode": img.mode,
            "bits": 32 if img.mode in ("RGBA", "LA") else 24,
            "compression": img.info.get("compression", "none"),
            "bytes": p.stat().st_size,
        }
    return info
