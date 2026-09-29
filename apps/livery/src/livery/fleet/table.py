"""Keeping the template table: which cars iRacing publishes a template for, and where.

The list is read from Trading Paints' public index of templates, a page that needs no login and
names, for each car, the folder the sim reads its paint from and iRacing's own download. The page
is somebody else's and is read as data: a row is taken only when its address is one of iRacing's
and its folder is a plain name, and nothing else on the page is followed or kept.

A refresh adds to the table and corrects it. It never takes a row out: a car the index has stopped
listing still has its template where it was.
"""

from __future__ import annotations

import html
import os
import re
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

from ..errors import LiveryError
from . import net
from .cars import TABLE, TemplateRow, fold, load
from .template import USER_AGENT, folder_for, is_template_address, plain_name

INDEX_HOST = "www.tradingpaints.com"
INDEX = f"https://{INDEX_HOST}/cartemplates"
MAX_PAGE_BYTES = 8 << 20            # the page is a fiftieth of this
FEWEST_ROWS = 50                    # fewer, and the page is not the index any more

COLUMNS = tuple(TemplateRow.__dataclass_fields__)

_CARD = re.compile(r'<div id="car"(.*?)</div>', re.S)
_LINK = re.compile(r'href="\s*([^"\s]+)\s*"')
_NAME = re.compile(r"<h3[^>]*>(.*?)</h3>", re.S)
_WHERE = re.compile(r'<span class="akkurat-mono">(.*)', re.S)
_FOLDER = re.compile(r"Documents/iRacing/paint/(.+)$")
_FILE = re.compile(r"(\d+)_template_(.+)\.zip$", re.I)


class _StayWithTheIndex(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        url = urlsplit(newurl)
        if url.scheme != "https" or url.hostname != INDEX_HOST:
            raise LiveryError("the template index sent the request on to another address; not followed")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _open(request, timeout=None):
    return net.opener(_StayWithTheIndex).open(request, timeout=timeout)


def fetch(opener: Callable[..., Any] | None = None) -> str:
    """The index page, as text."""
    request = urllib.request.Request(INDEX, headers={"User-Agent": USER_AGENT})
    with (opener or _open)(request, timeout=60) as response:
        page = response.read(MAX_PAGE_BYTES + 1)
    if len(page) > MAX_PAGE_BYTES:
        raise LiveryError("the template index is larger than the index is")
    return page.decode("utf-8", "replace")


def _text(markup: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", markup))).strip()


def read(page: str) -> tuple[list[TemplateRow], list[str]]:
    """The rows a page holds, and what was left out of them and why.

    A card is a link, a name and the folder, which the page writes in more than one way; the
    folder is read from its words, whatever they are wrapped in.
    """
    rows: dict[str, TemplateRow] = {}
    left_out: list[str] = []
    for card in _CARD.findall(page):
        link, name, where = _LINK.search(card), _NAME.search(card), _WHERE.search(card)
        if not (link and name and where):
            continue
        folder = _FOLDER.match(_text(where.group(1)))
        if not folder:
            continue
        paint_folder = folder.group(1).strip()
        address = link.group(1)
        try:
            folder_for(".", paint_folder)
            if not is_template_address(address):
                raise LiveryError("its address is not one of iRacing's")
            file = _FILE.match(plain_name(urlsplit(address).path, ".zip"))
            if not file:
                raise LiveryError("its file is not named as a template is")
        except LiveryError as exc:
            left_out.append(f"{paint_folder!r}: {exc}")
            continue
        key = fold(paint_folder)
        if key in rows:
            if rows[key].template_zip != address:
                left_out.append(f"{paint_folder!r}: listed twice, with two addresses; the first is kept")
            continue
        rows[key] = TemplateRow(_text(name.group(1)), paint_folder, file.group(2), file.group(1), address)
    return list(rows.values()), left_out


@dataclass
class Refreshed:
    rows: list[TemplateRow]
    added: list[TemplateRow] = field(default_factory=list)
    changed: list[TemplateRow] = field(default_factory=list)
    kept: list[TemplateRow] = field(default_factory=list)      # in the table, and not on the page
    left_out: list[str] = field(default_factory=list)


def merge(table: list[TemplateRow], page: list[TemplateRow], left_out: list[str] | None = None) -> Refreshed:
    """The table with what the page knows: its rows in their order, then the cars that are new."""
    listed = {fold(r.paint_folder): r for r in page}
    out = Refreshed(rows=[], left_out=list(left_out or []))
    seen = set()
    for old in table:
        key = fold(old.paint_folder)
        seen.add(key)
        new = listed.get(key)
        if new is None:
            out.kept.append(old)
            out.rows.append(old)
            continue
        # The folder stays as the table writes it; the rest is the page's.
        now = TemplateRow(new.car_name or old.car_name, old.paint_folder, new.template_code,
                          new.template_id, new.template_zip)
        if now.template_zip != old.template_zip:
            out.changed.append(now)
        out.rows.append(now)
    for key, new in listed.items():
        if key not in seen:
            out.added.append(new)
            out.rows.append(new)
    return out


def write(rows: list[TemplateRow], path: str | Path = TABLE) -> None:
    """The table, written whole or not at all, with the line endings it had."""
    path = Path(path)
    ending = "\r\n" if path.exists() and b"\r\n" in path.read_bytes() else "\n"
    for r in rows:
        for value in (getattr(r, c) for c in COLUMNS):
            if re.search(r"[\t\r\n]", value):
                raise LiveryError(f"{r.paint_folder!r}: a value that would not stay in its column")
    lines = ["\t".join(COLUMNS)] + ["\t".join(getattr(r, c) for c in COLUMNS) for r in rows]
    partial = path.with_name(path.name + ".part")
    try:
        with open(partial, "w", encoding="utf-8", newline="") as fh:
            fh.write(ending.join(lines) + ending)
        os.replace(partial, path)
    finally:
        partial.unlink(missing_ok=True)


def refresh(path: str | Path = TABLE, opener: Callable[..., Any] | None = None, dry: bool = False) -> Refreshed:
    rows, left_out = read(fetch(opener))
    if len(rows) < FEWEST_ROWS:
        raise LiveryError(f"the template index gave {len(rows)} cars, which is not the index; the table is as it was")
    before = load(path) if Path(path).exists() else []
    out = merge(before, rows, left_out)
    if not dry and out.rows != before:
        write(out.rows, path)
    return out
