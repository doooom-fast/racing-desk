"""Trading Paints — the last mile for a paint that has to survive a race.

Trading Paints has no API. What it has is a Downloader on the rig which, with
"Update my own paints" on, deletes the paint files of every driver in the session
— you included — and downloads what each of them has assigned on
tradingpaints.com. So a paint put in place by ``livery install`` shows in the
sim's paint viewer and in offline sessions, and is gone the moment you join a
race, unless the same paint is the one assigned on your account.

Uploading is a form on the website. This module gets you to it with the right
files in hand, because the form is fussy in ways that waste an evening:

* the paint is a TGA or PNG, 1024×1024 or 2048×2048, nothing else;
* the spec map is a ``.mip``, not a TGA — and only the sim writes one, when it
  loads the car with ``car_spec_<id>.tga`` beside it;
* the number type must match the file: a ``car_num_`` paint is a Custom Number
  paint, which needs Trading Paints Pro to assign.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import webbrowser
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .config import Config
from .errors import LiveryError
from .spec import LiverySpec
from .tga import describe

# The Showroom upload form is also the My Paints one: "Just Me" instead of "Community".
UPLOAD_URL = "https://www.tradingpaints.com/upload/showroom"
ACCEPTED_SIZES = ((1024, 1024), (2048, 2048))
NUMBER_TYPES = {"custom": "Custom Number", "sim_stamped": "Sim-Stamped Number"}

# The Downloader's config.xml also holds the account's user id. Only these options are read.
_OPTIONS = {
    "Download my schemes": "updates_own_paints",
    "Delete schemes before downloading": "deletes_before_download",
    "Delete schemes once session ends": "deletes_after_session",
    "Keep my paints synced from website": "keeps_synced",
}


def downloader_config_path() -> Path:
    appdata = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    return Path(appdata) / "TradingPaints Downloader" / "config.xml"


@dataclass
class DownloaderSettings:
    path: Path
    updates_own_paints: bool | None = None
    deletes_before_download: bool | None = None
    deletes_after_session: bool | None = None
    keeps_synced: bool | None = None

    @property
    def replaces_local_paints(self) -> bool:
        return bool(self.updates_own_paints)


def downloader_settings(path: str | Path | None = None) -> DownloaderSettings | None:
    """The Downloader's options, or None when it isn't installed for this user."""
    source = Path(path) if path else downloader_config_path()
    if not source.exists():
        return None
    settings = DownloaderSettings(path=source)
    try:
        root = ET.fromstring(source.read_text(encoding="utf-8-sig"))
    except ET.ParseError:
        return settings
    for option in root.iter("Option"):
        name = (option.findtext("configname") or "").strip()
        attr = _OPTIONS.get(name)
        if not attr:
            continue
        value = (option.findtext("configvalue") or "").strip().lower()
        if value in ("true", "false"):
            setattr(settings, attr, value == "true")
    return settings


def session_warning(settings: DownloaderSettings | None, spec_path: str | Path | None = None) -> str | None:
    """One line for after an install, when the Downloader would undo it in session."""
    if not settings or not settings.replaces_local_paints:
        return None
    upload = f"livery tp {spec_path}" if spec_path else "livery tp <spec>"
    return (
        "Trading Paints will replace this in session with the paint assigned on your account "
        f"— upload it ({upload}) or turn off 'Update my own paints' in the Downloader"
    )


@dataclass
class UploadPackage:
    folder: Path
    car: str
    name: str
    number_type: str
    paint: Path
    spec_mip: Path | None = None
    problems: list[str] = field(default_factory=list)

    @property
    def ready(self) -> bool:
        return not self.problems

    def to_dict(self) -> dict[str, Any]:
        return {
            "url": UPLOAD_URL,
            "car": self.car,
            "title": self.name,
            "number_type": self.number_type,
            "pro_required": self.number_type == NUMBER_TYPES["custom"],
            "paint": str(self.paint),
            "spec_map": str(self.spec_mip) if self.spec_mip else None,
            "problems": list(self.problems),
        }

    def instructions(self) -> list[str]:
        lines = [
            f"upload folder  {self.folder}",
            f"paint          {self.paint.name}",
            f"spec map       {self.spec_mip.name if self.spec_mip else '(none yet)'}",
            f"vehicle        {self.car}",
            f"title          {self.name}",
            f"number type    {self.number_type}"
            + ("  (needs Trading Paints Pro to assign)" if self.number_type == NUMBER_TYPES["custom"] else ""),
            "visibility     Just Me, unless it is meant for the Showroom",
        ]
        return lines


def stage_for_upload(
    spec: LiverySpec, config: Config, ident: str, build_dir: Path | None = None
) -> UploadPackage:
    """Gather what the upload form takes into ``build/<car>/<livery>/tradingpaints/``.

    The paint comes from the build. The spec map's ``.mip`` comes from the paint
    folder, and only counts when it was made from this build's spec TGA: the
    installed TGA must be byte-identical to the built one, and the mip newer than it.
    """
    source = build_dir or (config.build_dir / spec.car / spec.slug)
    paint = source / config.albedo_name(spec.number_mode, ident)
    spec_tga = source / config.spec_name(ident)
    if not paint.exists():
        raise LiveryError(f"no built paint at {paint} — run: livery build <spec> first")

    info = describe(paint)
    if tuple(info["size"]) not in ACCEPTED_SIZES:
        raise LiveryError(
            f"Trading Paints takes 1024×1024 or 2048×2048 paints; {paint.name} is "
            f"{info['size'][0]}×{info['size'][1]}. Build with --resolution 2048 (or 1024)."
        )

    folder = source / "tradingpaints"
    folder.mkdir(parents=True, exist_ok=True)
    package = UploadPackage(
        folder=folder,
        car=spec.car,
        name=spec.name,
        number_type=NUMBER_TYPES[spec.number_mode],
        paint=folder / paint.name,
    )
    shutil.copy2(paint, package.paint)

    installed_tga = config.paint_dir(spec.car) / spec_tga.name
    mip = installed_tga.with_suffix(".mip")
    if not spec_tga.exists():
        package.problems.append(f"no spec map in the build ({spec_tga.name})")
    elif not installed_tga.exists() or _digest(installed_tga) != _digest(spec_tga):
        package.problems.append(
            "the installed spec map is not this build's — run `livery install <spec>`, then load "
            "the car in the sim so it writes the .mip"
        )
    elif not mip.exists() or mip.stat().st_mtime < installed_tga.stat().st_mtime:
        package.problems.append(
            f"the sim hasn't written {mip.name} for this build yet — load the car in the sim "
            "(the paint viewer under My Content is enough), then run this again"
        )
    else:
        package.spec_mip = folder / mip.name
        shutil.copy2(mip, package.spec_mip)

    (folder / "upload.json").write_text(json.dumps(package.to_dict(), indent=2), encoding="utf-8")
    return package


def open_upload(package: UploadPackage) -> None:
    """The form in the browser and the files beside it; the clicking is the user's."""
    if hasattr(os, "startfile"):  # Windows: Explorer on the staging folder
        os.startfile(package.folder)  # type: ignore[attr-defined]
    webbrowser.open(UPLOAD_URL)


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()
