"""Environment checks: is this machine set up to build and install paints?

Mostly it answers the questions that waste an evening — wrong Documents folder,
missing customer id, a stale mip the sim keeps loading instead of the TGA you
just wrote, a profile still marked draft.
"""

from __future__ import annotations

import importlib
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from . import tradingpaints
from .config import Config
from .profile import CarProfile
from .tga import describe

OK, WARN, FAIL = "ok", "warn", "fail"


@dataclass
class Check:
    name: str
    status: str
    detail: str = ""

    def line(self) -> str:
        mark = {OK: "✓", WARN: "!", FAIL: "✗"}[self.status]
        return f"{mark} {self.name}" + (f" — {self.detail}" if self.detail else "")


def run(config: Config, car: str | None = None) -> list[Check]:
    checks: list[Check] = []
    checks.extend(_dependencies())
    checks.extend(_paths(config))
    checks.extend(_tools(config))
    checks.append(_tradingpaints())
    if car:
        checks.extend(_car(config, car))
    return checks


def _dependencies() -> list[Check]:
    out = []
    for module, why, required in (
        ("PIL", "image compositing and TGA export", True),
        ("numpy", "canvas maths", True),
        ("yaml", "specs and profiles", True),
        ("psd_tools", "reading template PSDs (livery profile bootstrap)", False),
    ):
        try:
            mod = importlib.import_module(module)
            version = getattr(mod, "__version__", "")
            out.append(Check(f"python: {module}", OK, version))
        except ImportError:
            out.append(
                Check(
                    f"python: {module}",
                    FAIL if required else WARN,
                    f"missing — needed for {why}",
                )
            )
    return out


def _paths(config: Config) -> list[Check]:
    out = [
        Check(
            "config file",
            OK if config.source else WARN,
            config.source or "none found — using defaults (livery.yaml would pin them)",
        )
    ]
    paint = Path(config.iracing_paint_dir)
    if paint.exists():
        cars = [p.name for p in paint.iterdir() if p.is_dir()]
        out.append(Check("iRacing paint folder", OK, f"{paint} ({len(cars)} car folders)"))
    else:
        out.append(
            Check(
                "iRacing paint folder",
                WARN,
                f"{paint} does not exist — set iracing_paint_dir in livery.yaml if your "
                f"Documents folder is elsewhere (OneDrive moves it)",
            )
        )
    for label, path, required in (
        ("profiles", config.profiles_dir, True),
        ("liveries", config.liveries_dir, False),
        ("art", config.art_root, False),
    ):
        exists = Path(path).exists()
        out.append(
            Check(
                f"{label} directory",
                OK if exists else (FAIL if required else WARN),
                str(path) + ("" if exists else " — missing"),
            )
        )
    out.append(
        Check(
            "customer id",
            OK if config.customer_id else WARN,
            str(config.customer_id) if config.customer_id else
            "not set — builds need --customer-id, since the file name carries it",
        )
    )
    return out


def _tools(config: Config) -> list[Check]:
    out = []
    blender = shutil.which(config.blender) or (
        config.blender if Path(config.blender).exists() else None
    )
    if blender:
        try:
            version = subprocess.run(
                [blender, "--version"], capture_output=True, text=True, timeout=30
            ).stdout.strip().splitlines()[0]
        except Exception as exc:  # pragma: no cover - environment dependent
            version = f"found but would not run: {exc}"
        out.append(Check("blender", OK, version))
    else:
        out.append(
            Check("blender", WARN, "not found — 3D bakes and previews are unavailable")
        )
    return out


def _tradingpaints(settings_path: Path | None = None) -> Check:
    settings = tradingpaints.downloader_settings(settings_path)
    if settings is None:
        return Check("trading paints", OK, "downloader not installed — installed paints stay put")
    if settings.replaces_local_paints:
        detail = (
            "'Update my own paints' is on, so in session the Downloader replaces your paint with "
            "the one assigned on your account — upload each build (livery tp <spec>) or turn it off"
        )
        if settings.deletes_before_download:
            detail += "; it deletes the local files first"
        return Check("trading paints", WARN, detail)
    return Check(
        "trading paints", OK, "downloader installed; 'Update my own paints' is off, so installed paints survive sessions"
    )


def _car(config: Config, car: str) -> list[Check]:
    out = []
    profile_path = Path(config.profiles_dir) / f"{car}.yaml"
    if profile_path.exists():
        try:
            profile = CarProfile.load(profile_path)
            status = {"verified": OK, "checked": OK, "draft": WARN}[profile.confidence]
            out.append(
                Check(
                    f"profile {car}",
                    status,
                    f"{len(profile.zones)} zones, confidence {profile.confidence}, "
                    f"canvas {profile.canvas[0]}×{profile.canvas[1]}",
                )
            )
        except Exception as exc:
            out.append(Check(f"profile {car}", FAIL, str(exc)))
    else:
        out.append(
            Check(f"profile {car}", FAIL, f"none at {profile_path} — run: livery profile bootstrap {car}")
        )

    paint_dir = config.paint_dir(car)
    if not paint_dir.exists():
        out.append(
            Check(
                f"paint folder {car}",
                WARN,
                f"{paint_dir} does not exist yet — installing will create it, but check the "
                f"car_dirpath is right (livery cars show {car})",
            )
        )
        return out

    tgas = sorted(paint_dir.glob("*.tga"))
    out.append(Check(f"paint folder {car}", OK, f"{paint_dir} ({len(tgas)} tga)"))
    for tga in tgas:
        mip = tga.with_suffix(".mip")
        info = describe(tga)
        detail = f"{info['size'][0]}×{info['size'][1]} {info['bits']}-bit {info['compression']}"
        if mip.exists() and mip.stat().st_mtime >= tga.stat().st_mtime and tga.name.startswith("car_spec_"):
            # For the spec map a fresh .mip is the point: it's what Trading Paints takes.
            out.append(Check(f"  {tga.name}", OK, f"{detail} — the sim has written {mip.name}"))
        elif mip.exists() and mip.stat().st_mtime >= tga.stat().st_mtime:
            out.append(
                Check(
                    f"  {tga.name}",
                    WARN,
                    f"{detail} — its .mip is newer, so the sim is showing the cached copy. "
                    f"`livery install` deletes it; delete {mip.name} by hand otherwise",
                )
            )
        else:
            out.append(Check(f"  {tga.name}", OK, detail))
    return out


def summarize(checks: list[Check]) -> tuple[int, int]:
    return (
        sum(1 for c in checks if c.status == WARN),
        sum(1 for c in checks if c.status == FAIL),
    )
