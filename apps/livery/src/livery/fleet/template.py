"""A car's paint template: fetching it, and reading out of it what a build needs.

iRacing publishes a layered PSD per car. A build does not need the PSD, only a few things in it:
the guide layers (wireframe, mask, number blocks, the colour patches) and the car's own spec map.
``extract`` writes those as PNGs into a work folder, and the PSD can go.

psd-tools cannot reproduce the spec map in one composite, because the template restricts each
channel group to a single channel through Advanced Blending, which it does not implement. Each
channel group is therefore composited on its own and assembled into R/G/B here, which matches
Photoshop's own export to within a rounding step.
"""

from __future__ import annotations

import os
import re
import shutil
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

from ..errors import LiveryError
from .cars import TemplateRow

# Where iRacing publishes templates. The table is data, and data is not allowed to say where to go.
TEMPLATE_HOST = "ir-core-sites.iracing.com"
USER_AGENT = "livery-tool/1.0"
MAX_ZIP_BYTES = 1 << 30          # the largest on record is a tenth of this
MAX_PSD_BYTES = 4 << 30

GUIDES = ("wire", "mask", "number", "sponsor", "mandatory", "pitbox", "cockpit", "decal", "scheme", "base")
# The guides a build cannot do without: leave one out and the shard field is painted over a patch
# the sim reads a colour from.
NEEDED = ("pitbox", "cockpit")


def is_template_address(address: str) -> bool:
    url = urlsplit(address)
    return url.scheme == "https" and url.hostname == TEMPLATE_HOST


class _StayWithIRacing(urllib.request.HTTPRedirectHandler):
    """A template comes from iRacing's host, and being sent on elsewhere does not change that."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not is_template_address(newurl):
            raise LiveryError("the template host sent the request on to another address; not followed")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _open(request, timeout=None):
    return urllib.request.build_opener(_StayWithIRacing).open(request, timeout=timeout)


def default_cache() -> Path:
    """The app's own data folder. Templates are iRacing's files and stay out of every repository."""
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    return Path(base) / "Racing Desk" / "templates"


def folder_for(cache: str | Path, paint_folder: str) -> Path:
    """A car's folder in the cache. The paint folder's name, which is a plain name or it is refused."""
    name = str(paint_folder).strip()
    if not name or name in (".", "..") or re.search(r'[\\/:*?"<>|]', name):
        raise LiveryError(f"not a paint folder name: {paint_folder!r}")
    return Path(cache) / name


def fetch(row: TemplateRow, cache: str | Path, opener: Callable[..., Any] | None = None) -> Path:
    """Download a car's template archive into the cache, once. Returns the archive."""
    url = urlsplit(row.template_zip)
    if not is_template_address(row.template_zip) or not url.path.lower().endswith(".zip"):
        raise LiveryError(f"{row.paint_folder}: the template address is not one of iRacing's")
    target = folder_for(cache, row.paint_folder)
    target.mkdir(parents=True, exist_ok=True)
    archive = target / plain_name(url.path, ".zip")
    if archive.exists() and zipfile.is_zipfile(archive):
        return archive

    request = urllib.request.Request(row.template_zip, headers={"User-Agent": USER_AGENT})
    partial = archive.with_suffix(".part")
    try:
        with (opener or _open)(request, timeout=300) as response, open(partial, "wb") as fh:
            size = 0
            while True:
                chunk = response.read(1 << 20)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_ZIP_BYTES:
                    raise LiveryError(f"{row.paint_folder}: the template is larger than any template is")
                fh.write(chunk)
        if not zipfile.is_zipfile(partial):
            raise LiveryError(f"{row.paint_folder}: what came back is not an archive")
        partial.replace(archive)
    finally:
        partial.unlink(missing_ok=True)
    return archive


def plain_name(name: str, suffix: str) -> str:
    """The file name at the end of a path from somewhere else, or a refusal.

    What is left after the last separator - a slash either way, or the colon of a drive or a stream
    - and nothing a Windows file name cannot hold.
    """
    last = re.split(r"[\\/:]", str(name))[-1].strip()
    if (not last.lower().endswith(suffix) or len(last) == len(suffix)
            or last.startswith(".") or re.search(r'[*?"<>|\x00-\x1f]', last)):
        raise LiveryError(f"not a file name this takes: {name!r}")
    return last


def unpack(archive: str | Path, into: str | Path) -> Path | None:
    """Take the PSD out of a template archive. The largest one, when there are several.

    Only a PSD is taken, and only under its own file name: an archive does not get to choose where
    on the disk its files land.
    """
    into = Path(into)
    into.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        members = []
        for m in z.infolist():
            if m.is_dir():
                continue
            try:
                name = plain_name(m.filename, ".psd")
            except LiveryError:
                continue                     # not a PSD, a resource fork, or no name at all
            members.append((m, name))
        if not members:
            return None
        member, name = max(members, key=lambda pair: pair[0].file_size)
        if member.file_size > MAX_PSD_BYTES:
            raise LiveryError(f"{Path(archive).name}: the PSD inside is larger than any template is")
        out = into / name
        if out.resolve().parent != into.resolve():
            raise LiveryError(f"{Path(archive).name}: the PSD inside is named for another folder")
        with z.open(member) as src, open(out, "wb") as dst:
            shutil.copyfileobj(src, dst, 1 << 20)
    return out


def slug(name: str) -> str:
    return re.sub(r"\W+", "_", name).strip("_")


def _solo(psd, keep) -> None:
    """Show only ``keep`` and its ancestors. The target's own subtree is left alone: hiding a
    group's children composites it empty, and an empty document composites to white."""
    def contains(group, target) -> bool:
        return any(l is target or (l.is_group() and contains(l, target)) for l in group)

    def walk(node) -> None:
        for l in node:
            if l is keep:
                l.visible = True                      # subtree keeps its own visibility
            elif l.is_group() and contains(l, keep):
                l.visible = True
                walk(l)
            else:
                l.visible = False

    walk(psd)


def _flat(node, depth: int = 0):
    for l in node:
        yield l, depth
        if l.is_group():
            yield from _flat(l, depth + 1)


def extract(psd_path: str | Path, out: str | Path, patterns: bool = False) -> dict[str, Any]:
    """Write the guide layers (``g_<name>.png``) and ``spec_default.png`` into ``out``.

    ``patterns`` also writes the car's stock paint schemes (``grp_<group>__<scheme>.png``). They
    are the only reliable cue for which way a panel faces, so the logo pass wants them; the shard
    field does not.
    """
    try:
        import numpy as np
        import psd_tools
        from PIL import Image
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise LiveryError("reading templates needs psd-tools: pip install 'prodrive-livery[templates]'") from exc

    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    psd = psd_tools.PSDImage.open(psd_path)

    spec_group = None
    for l, _ in _flat(psd):
        if l.is_group() and "spec" in l.name.lower():
            spec_group = l
    in_spec = [x for x, _ in _flat(spec_group)] if spec_group is not None else []

    guides: list[str] = []
    schemes: list[str] = []
    skipped: list[dict[str, str]] = []

    def write(layer, name: str, needed: bool) -> bool:
        """One layer on its own, as a PNG. A layer that cannot be drawn is left out and noted,
        unless the build cannot do without it."""
        try:
            _solo(psd, layer)
            psd.composite(force=True).save(out / name)
            return True
        except Exception as exc:  # noqa: BLE001 - psd-tools raises what it likes, ImportError among them
            why = f"{type(exc).__name__}: {str(exc).splitlines()[0] if str(exc) else ''}".strip()
            if needed:
                raise LiveryError(f"the layer {layer.name!r} could not be read ({why})") from exc
            skipped.append({"layer": str(layer.name), "why": why})
            return False

    for l, _ in _flat(psd):
        low = l.name.lower()
        if l.is_group():
            if patterns and "pattern" in low:
                for sub in l:
                    name = "grp_%s__%s.png" % (slug(l.name), slug(sub.name))
                    if write(sub, name, needed=False):
                        schemes.append(name)
            continue
        if any(l is x for x in in_spec):
            continue
        if not any(k in low for k in GUIDES):
            continue
        name = "g_%s.png" % slug(l.name)
        if write(l, name, needed=any(k in low for k in NEEDED)):
            guides.append(name)

    channels: list[str] = []
    if spec_group is not None:
        spec = np.zeros((psd.height, psd.width, 3), np.uint8)
        for g in spec_group:
            idx = next((i for i, k in enumerate(("red", "green", "blue")) if k in g.name.lower()), None)
            if idx is None:
                continue
            # A spec map short of a channel is not the car's spec map, so this one is never skipped.
            try:
                _solo(psd, g)
                spec[..., idx] = np.array(psd.composite(force=True).convert("L"))
            except Exception as exc:  # noqa: BLE001
                first = str(exc).splitlines()[0] if str(exc) else ""
                raise LiveryError(
                    f"the spec map's {g.name!r} could not be read ({type(exc).__name__}: {first})") from exc
            channels.append(("red", "green", "blue")[idx])
        # A group named for the spec map with no channel in it is not a spec map.
        if channels:
            Image.fromarray(spec).save(out / "spec_default.png")

    return {
        "size": [psd.width, psd.height],
        "guides": guides,
        "schemes": schemes,
        "skipped": skipped,
        "spec_channels": channels,
        "spec": bool(channels),
    }
