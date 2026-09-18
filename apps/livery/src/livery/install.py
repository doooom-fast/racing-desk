"""Staging builds and installing them where iRacing looks.

Builds go to ``build/<car>/<livery>/`` first, always. Installing is a separate,
explicit step that copies into ``Documents/iRacing/paint/<car_dirpath>/``,
snapshots anything it replaces, and invalidates the sim's mip cache.
"""

from __future__ import annotations

import json
import shutil
import time
from dataclasses import dataclass
from pathlib import Path

from .config import Config
from .render import RenderResult
from .spec import LiverySpec
from .tga import bust_mip, save_tga


@dataclass
class BuildArtifacts:
    albedo: Path
    spec_map: Path
    report: Path
    preview: Path | None = None

    def files(self) -> list[Path]:
        return [p for p in (self.albedo, self.spec_map) if p]


def stage(
    result: RenderResult,
    spec: LiverySpec,
    config: Config,
    ident: str,
    out_dir: Path | None = None,
) -> BuildArtifacts:
    """Write the paint files and their report into the build directory."""
    target = out_dir or (config.build_dir / spec.car / spec.slug)
    target.mkdir(parents=True, exist_ok=True)

    bits = 32 if result.canvas.glass_alpha is not None else 24
    albedo_path = save_tga(
        result.canvas.albedo_image(), target / config.albedo_name(spec.number_mode, ident), bits=bits
    )
    # The spec map always carries an alpha channel: that channel *is* the
    # specular mask, so it can never be dropped to 24-bit.
    spec_path = save_tga(result.canvas.spec_image(), target / config.spec_name(ident), bits=32)

    result.report.outputs = {"albedo": str(albedo_path), "spec_map": str(spec_path)}
    report_path = target / "build-report.json"
    report_path.write_text(json.dumps(result.report.to_dict(), indent=2), encoding="utf-8")
    return BuildArtifacts(albedo=albedo_path, spec_map=spec_path, report=report_path)


def install(
    artifacts: BuildArtifacts,
    config: Config,
    car: str,
    backup: bool = True,
    dry_run: bool = False,
) -> dict[str, list[str]]:
    """Copy staged paint files into the sim's paint folder."""
    destination = config.paint_dir(car)
    actions: dict[str, list[str]] = {"copied": [], "replaced": [], "mips_removed": [], "skipped": []}
    if not destination.parent.exists():
        raise FileNotFoundError(
            f"{destination.parent} does not exist — is iRacing installed for this user? "
            f"Set iracing_paint_dir in livery.yaml if your Documents folder is elsewhere."
        )
    if not dry_run:
        destination.mkdir(parents=True, exist_ok=True)

    stamp = time.strftime("%Y%m%d-%H%M%S")
    for src in artifacts.files():
        dst = destination / src.name
        if dst.exists():
            actions["replaced"].append(str(dst))
            if backup and not dry_run:
                shutil.copy2(dst, dst.with_suffix(dst.suffix + f".bak-{stamp}"))
        if dry_run:
            actions["skipped"].append(f"{src} → {dst}")
            continue
        shutil.copy2(src, dst)
        actions["copied"].append(str(dst))
        actions["mips_removed"].extend(str(p) for p in bust_mip(dst))
    return actions
