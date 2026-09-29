"""Where things live on this machine.

A personal tool should know the local layout and never ask twice. Config comes
from, in order: explicit CLI flags, environment variables, ``livery.yaml`` in the
project, then platform defaults.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

CONFIG_NAMES = ("livery.yaml", "livery.yml", ".livery.yaml")
ENV_PREFIX = "LIVERY_"


def _default_documents() -> Path:
    home = Path.home()
    for candidate in (home / "Documents", home / "OneDrive" / "Documents"):
        if candidate.exists():
            return candidate
    return home / "Documents"


@dataclass
class Config:
    root: Path = field(default_factory=Path.cwd)
    customer_id: str | None = None
    iracing_paint_dir: Path = field(default_factory=lambda: _default_documents() / "iRacing" / "paint")
    iracing_install_dir: Path | None = None
    # The livery library the desk's Paints page reads: <library_dir>/<car>/<version>/. Where the fleet
    # build writes. Default: the checkout the desk finds for itself, in the paint directory.
    library_dir: Path | None = None
    profiles_dir: Path = field(default_factory=lambda: Path("profiles"))
    liveries_dir: Path = field(default_factory=lambda: Path("liveries"))
    art_root: Path = field(default_factory=lambda: Path("art"))
    build_dir: Path = field(default_factory=lambda: Path("build"))
    templates_dir: Path = field(default_factory=lambda: Path("templates"))
    blender: str = "blender"
    # Filename patterns. Kept as config because iRacing's naming has shifted over
    # the years and `livery doctor` is what tells you which the sim is reading.
    albedo_pattern: str = "car_{id}.tga"
    albedo_custom_number_pattern: str = "car_num_{id}.tga"
    spec_pattern: str = "car_spec_{id}.tga"
    source: str | None = None

    # ------------------------------------------------------------------- load

    @classmethod
    def load(cls, start: str | Path | None = None) -> "Config":
        root = Path(start or Path.cwd()).resolve()
        data: dict[str, Any] = {}
        source = None
        for directory in [root, *root.parents]:
            for name in CONFIG_NAMES:
                candidate = directory / name
                if candidate.exists():
                    data = yaml.safe_load(candidate.read_text(encoding="utf-8")) or {}
                    source = str(candidate)
                    root = directory
                    break
            if source:
                break

        cfg = cls(root=root, source=source)
        for key, value in data.items():
            if not hasattr(cfg, key):
                raise ValueError(f"{source}: unknown config key {key!r}")
            current = getattr(cfg, key)
            setattr(cfg, key, Path(value) if isinstance(current, Path) else value)
        cfg._apply_env()
        cfg._absolutize()
        return cfg

    def _apply_env(self) -> None:
        for key in (
            "customer_id", "iracing_paint_dir", "iracing_install_dir", "library_dir", "profiles_dir",
            "liveries_dir", "art_root", "build_dir", "templates_dir", "blender",
        ):
            env = os.environ.get(ENV_PREFIX + key.upper())
            if env:
                current = getattr(self, key)
                setattr(self, key, Path(env) if isinstance(current, Path) or key.endswith("_dir") else env)
        if os.environ.get("IRACING_CUSTOMER_ID") and not self.customer_id:
            self.customer_id = os.environ["IRACING_CUSTOMER_ID"]

    def _absolutize(self) -> None:
        for key in ("profiles_dir", "liveries_dir", "art_root", "build_dir", "templates_dir"):
            value = Path(getattr(self, key))
            if not value.is_absolute():
                setattr(self, key, (self.root / value).resolve())
        self.iracing_paint_dir = Path(self.iracing_paint_dir).expanduser()
        if self.iracing_install_dir:
            self.iracing_install_dir = Path(self.iracing_install_dir).expanduser()
        # A blank library_dir is no library_dir: the default stands. A relative one is beside the config.
        named = str(self.library_dir).strip() if self.library_dir is not None else ""
        if named:
            library = Path(named).expanduser()
            self.library_dir = library if library.is_absolute() else (self.root / library).resolve()
        else:
            self.library_dir = None

    # ------------------------------------------------------------------ paths

    def paint_dir(self, car: str) -> Path:
        return self.iracing_paint_dir / car

    def library(self) -> Path:
        return self.library_dir or self.iracing_paint_dir / "doooom-iRacing-liveries" / "cars"

    def albedo_name(self, number_mode: str, ident: str) -> str:
        pattern = (
            self.albedo_custom_number_pattern if number_mode == "custom" else self.albedo_pattern
        )
        return pattern.format(id=ident)

    def spec_name(self, ident: str) -> str:
        return self.spec_pattern.format(id=ident)

    def require_customer_id(self, override: str | None = None) -> str:
        ident = override or self.customer_id
        if not ident:
            raise ValueError(
                "no iRacing customer id. Put `customer_id: 123456` in livery.yaml, set "
                "LIVERY_CUSTOMER_ID, or pass --customer-id."
            )
        return str(ident)

    def to_dict(self) -> dict[str, Any]:
        out = {}
        for key, value in self.__dict__.items():
            out[key] = str(value) if isinstance(value, Path) else value
        return out
