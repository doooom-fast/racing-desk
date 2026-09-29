"""The logo pass, as one driver for every car in the fleet.

A sponsor row is a group, and a group that does not fit is not a row: rather than stamping the
logos and letting the island mask cut whatever hangs over the edge, every row is fitted as a whole
- the largest scale at which the entire group lands inside the panel, slid along the panel to find
a place it does. Paired rows take the same scale on both sides of the car.

Each car's sheet differs, but the work is always the same three questions: which islands are the
body panels, which way does each one face, and where on them does a mark land whole. This answers
the third mechanically and takes the first two from a small per-car panel map in
``data/panels/<car>.json``, because they need a human look at the car's own stock paint schemes -
iRacing's sponsor text reads correctly on the car, so whichever rotation makes that text readable
is the rotation our art needs. ``sheet``, ``report`` and ``panel_map`` render those looks.

Mirrored pairs are detected, not assumed. Flanks and top halves pair by a vertical flip: the same
x, y mirrored about a constant, art turned 180. Wing faces pair by a 180 rotation, which mirrors x
as well. Sponsor rows account for the difference, so a row reads in the same order on both sides of
the car rather than running backwards on one of them.

The marks are the driver's own (``art/doooom``). The sponsors' are masks, one white-on-clear PNG
each in ``art/sponsors/masks``; a row whose masks are not all there is left off and said so.
"""

from __future__ import annotations

import glob
import json
import os
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, PngImagePlugin
from scipy import ndimage as ndi

from ..errors import LiveryError
from . import cars as cars_mod
from .patches import number_blocks, number_guide
from .shatter import DEFAULT_PREFIX

PngImagePlugin.MAX_TEXT_CHUNK = 1 << 30

PANELS = Path(__file__).resolve().parent.parent / "data" / "panels"
GAP = 28
BANDS = [("death", 56), ("blood_incantation", 34), ("darkthrone", 48), ("primitiveman", 26), ("sunn", 34)]
GEAR_A = [("yamaha", 24), ("brembo", 20), ("bbs", 24), ("heusinkveld", 14), ("cubecontrols", 18)]
GEAR_B = [("moza", 20), ("simlab", 17), ("lg", 24), ("nvidia", 18)]
MINSCALE = 0.55        # below this the logos stop being readable and become texture

WORD, LOCKUP, SPEED = "art_doooom.png", "ai_ps600.png", "art_speedsports.png"


def clean(img: Image.Image, lo: float = 0.35) -> Image.Image:
    a = np.clip((np.asarray(img).astype(float) / 255 - lo) / 0.30, 0, 1)
    ys, xs = np.where(a > 0.5)
    return Image.fromarray((a[ys.min():ys.max() + 1, xs.min():xs.max() + 1] * 255).astype(np.uint8))


class Art:
    """Where the marks are read from."""

    def __init__(self, art_root: str | Path):
        self.own = Path(art_root) / "doooom"
        self.masks = Path(art_root) / "sponsors" / "masks"
        self._masks: dict[str, Image.Image] = {}

    def mark(self, name: str) -> Image.Image:
        path = self.own / name
        if not path.exists():
            raise LiveryError(f"no {name} in {self.own}")
        # Pillow's size limit is for files from strangers; this art is the driver's own, and large.
        limit, Image.MAX_IMAGE_PIXELS = Image.MAX_IMAGE_PIXELS, None
        try:
            return clean(Image.open(path).convert("L"))
        finally:
            Image.MAX_IMAGE_PIXELS = limit

    def has_mask(self, name: str) -> bool:
        return (self.masks / f"{name}.png").exists()

    def mask(self, name: str) -> Image.Image:
        """A sponsor's mark as one band of coverage, however its file holds it.

        A mark on a clear ground is white everywhere it is looked at by colour, so where a file has
        transparency that is the mark; where it has none, its brightness is."""
        if name not in self._masks:
            with Image.open(self.masks / f"{name}.png") as im:
                clear = im.mode in ("RGBA", "LA", "PA") or "transparency" in im.info
                self._masks[name] = im.convert("RGBA").getchannel("A") if clear else im.convert("L")
        return self._masks[name]


def panel_config(folder: str, panels: str | Path = PANELS) -> dict[str, Any] | None:
    key = cars_mod.fold(folder)
    for f in sorted(Path(panels).glob("*.json")):
        if cars_mod.fold(f.stem) == key:
            return json.loads(f.read_text(encoding="utf-8"))
    return None


# ---------------------------------------------------------------- islands
def segment(work: str | Path, min_area: int = 900) -> np.ndarray:
    """Islands are the cells enclosed by the wireframe's green outlines."""
    work = str(work)
    wf = next((f for f in (os.path.join(work, n) for n in ("g_Wire.png", "g_New_Wire.png"))
               if os.path.exists(f)), None)
    if wf is None:
        raise LiveryError("no wireframe guide in %s" % work)
    w = np.array(Image.open(wf).convert("RGBA")).astype(int)
    R, G, Bc, A = (w[..., i] for i in range(4))
    border = ndi.binary_dilation((A > 60) & (G > 120) & (R < 140) & (Bc < 140), iterations=1)
    lab, n = ndi.label(~border)
    sizes = ndi.sum(np.ones_like(lab), lab, range(1, n + 1))
    bg = int(np.argmax(sizes)) + 1
    keep = [i for i in range(1, n + 1) if i != bg and sizes[i - 1] >= min_area]
    isl = np.zeros_like(lab)
    for k, i in enumerate(keep, 1):
        isl[lab == i] = k
    dist, (iy, ix) = ndi.distance_transform_edt(isl == 0, return_indices=True)
    isl = np.where((isl == 0) & (dist <= 3), isl[iy, ix], isl).astype(np.int16)
    np.save(os.path.join(work, "isl.npy"), isl)
    return isl


def load_isl(work: str | Path) -> np.ndarray:
    p = os.path.join(str(work), "isl.npy")
    return np.load(p) if os.path.exists(p) else segment(work)


def island_ids(isl: np.ndarray) -> list[int]:
    return [i for i in range(1, int(isl.max()) + 1) if (isl == i).any()]


def box(isl, i):
    ys, xs = np.where(isl == i)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def shape_of(isl, i):
    x0, y0, x1, y1 = box(isl, i)
    return isl[y0:y1 + 1, x0:x1 + 1] == i


def iou(a, b):
    h, w = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
    a, b = a[:h, :w], b[:h, :w]
    return (a & b).sum() / max(1, (a | b).sum())


def partner(isl, i, ids):
    """The island that mirrors i, with how it mirrors and the constants that map between them."""
    A = shape_of(isl, i)
    ax0, ay0, ax1, ay1 = box(isl, i)
    best = (0, None, None, None, None)
    for j in ids:
        if j == i:
            continue
        Bm = shape_of(isl, j)
        bx0, by0, bx1, by1 = box(isl, j)
        # Twins are rarely pixel-exact - the Nissan's sides differ by ten pixels of padding - so
        # allow a few percent before ruling a candidate out.
        if (abs(Bm.shape[0] - A.shape[0]) > max(4, .04 * A.shape[0])
                or abs(Bm.shape[1] - A.shape[1]) > max(4, .04 * A.shape[1])):
            continue
        for kind, T in (("flipV", Bm[::-1, :]), ("rot180", Bm[::-1, ::-1]), ("flipH", Bm[:, ::-1])):
            s = iou(A, T)
            if s > best[0]:
                best = (s, j, kind, ay0 + by1, ax0 + bx1)
    return best   # score, id, kind, ysum, xsum


# ---------------------------------------------------------------- fitting
def largest_fit(free, ids, isl, asp, wmin=100, wmax=900, step=6, region=None, swap=False):
    """Largest w whose whole w x asp*w box (swapped for a quarter turn) lies inside the island."""
    sh, sw = isl.shape
    m = np.isin(isl, ids) & free
    if region:
        r = np.zeros_like(m)
        x0, y0, x1, y1 = region
        r[y0:y1, x0:x1] = True
        m &= r
    ii = m.astype(np.int32).cumsum(0).cumsum(1)
    ii = np.pad(ii, ((1, 0), (1, 0)))
    best = None
    for w in range(wmin, wmax, step):
        bw, bh = (max(4, int(asp * w)), w) if swap else (w, max(4, int(asp * w)))
        if bh >= sh or bw >= sw:
            break
        s = ii[bh:, bw:] - ii[:-bh, bw:] - ii[bh:, :-bw] + ii[:-bh, :-bw]
        ys, xs = np.where(s == bw * bh)
        if not len(ys):
            break
        k = len(ys) // 2
        best = (w, int(xs[k] + bw / 2), int(ys[k] + bh / 2), bw, bh)
    return best


# ---------------------------------------------------------------- stamping
class Sheet:
    def __init__(self, isl, blocks=None):
        self.isl = isl
        self.h, self.w = isl.shape
        self.free = np.ones(isl.shape, bool)
        self.blocks = blocks
        if blocks is not None:
            self.free &= ~blocks

    def _placed(self, img, cx, cy, w, h, rot):
        if w is None:
            w = img.size[0] * h / img.size[1]
        if h is None:
            h = img.size[1] * w / img.size[0]
        im = img.resize((max(1, int(w)), max(1, int(h))), Image.LANCZOS).rotate(
            rot, resample=Image.BICUBIC, expand=True)
        ww, hh = im.size
        x0, y0 = int(cx - ww / 2), int(cy - hh / 2)
        sx, sy, dx, dy = max(0, -x0), max(0, -y0), max(0, x0), max(0, y0)
        cw, ch = min(ww - sx, self.w - dx), min(hh - sy, self.h - dy)
        return im, (sx, sy, dx, dy, cw, ch)

    def stamp(self, c, img, cx, cy, ids, w=None, h=None, rot=0):
        im, (sx, sy, dx, dy, cw, ch) = self._placed(img, cx, cy, w, h, rot)
        a = np.asarray(im).astype(float) / 255
        patch = np.zeros_like(c)
        if cw <= 0 or ch <= 0:
            return 0, 0
        patch[dy:dy + ch, dx:dx + cw] = a[sy:sy + ch, sx:sx + cw]
        keep = np.isin(self.isl, ids)
        c[:] = np.maximum(c, patch * keep)
        return int(((patch * keep) > .5).sum()), int((patch > .5).sum())

    def loss(self, img, cx, cy, ids, w=None, h=None, rot=0):
        """Ink this mark would lose to the island's edge - zero means it lands whole."""
        im, (sx, sy, dx, dy, cw, ch) = self._placed(img, cx, cy, w, h, rot)
        a = np.asarray(im) > 127
        if cw <= 0 or ch <= 0:
            return int(a.sum())
        ink = a[sy:sy + ch, sx:sx + cw]
        # A number block is as good as off the panel: the sim stamps its number over whatever is
        # there, so ink under one is ink lost. Counting it here lets the same search that avoids
        # panel edges avoid the blocks, on the mirrored side as well as the fitted one.
        inside = np.isin(self.isl[dy:dy + ch, dx:dx + cw], ids)
        if self.blocks is not None:
            inside &= ~self.blocks[dy:dy + ch, dx:dx + cw]
        return int(a.sum()) - int((ink & inside).sum())

    def occupy(self, cx, cy, bw, bh, pad=8):
        self.free[max(0, int(cy - bh / 2) - pad):int(cy + bh / 2) + pad,
                  max(0, int(cx - bw / 2) - pad):int(cx + bw / 2) + pad] = False


class Pair:
    """A mirrored pair of panels and the map between them.

    iRacing lays a car out with its left side low on the sheet: on every template read so far the
    lower island of a vertically flipped pair carries its stock sponsor text upright and the upper
    one carries it turned 180. So the lower island leads, whichever order the config names them."""

    def __init__(self, isl, left, right):
        if box(isl, left)[1] < box(isl, right)[1]:
            left, right = right, left
        self.left, self.right = [left], [right]
        s, j, kind, ysum, xsum = partner(isl, left, [right])
        if j is None:
            raise LiveryError("islands %s and %s do not mirror" % (left, right))
        self.kind, self.ysum, self.xsum, self.score = kind, ysum, xsum, s

    def center(self, cx, cy):
        """Where a centred mark goes on the far panel, and how far to turn it."""
        if self.kind == "rot180":
            return self.xsum - cx, self.ysum - cy, 180
        return cx, self.ysum - cy, 180
    # A row does NOT get mirrored as a group. Race sponsors sit at the same station along the car
    # on both sides - each mark is turned to read correctly where it is, and the running order
    # stays put. Reversing the group is what a mirror does to a photograph, not what a sign
    # writer does to a car, so every logo maps through center() like any other mark.


def save_layer(c, path) -> int:
    r = np.zeros((*c.shape, 4), np.uint8)
    r[..., :3] = 255
    r[..., 3] = (np.clip(c, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(r).save(path)
    return int((c > .5).sum())


# ---------------------------------------------------------------- reading a car
def best_pattern(work: str | Path) -> str | None:
    """The stock scheme with the most ink on it, which is the one carrying sponsor text. A few
    templates ship no schemes at all, so fall back to whichever guide carries the most artwork."""
    work = str(work)
    esc = glob.escape(work)
    pats = [p for p in glob.glob(os.path.join(esc, "grp_Car_Patterns__*_tga.png"))
            if "spec" not in os.path.basename(p)]
    if not pats:
        pats = [p for p in glob.glob(os.path.join(esc, "g*.png"))
                if not any(k in os.path.basename(p).lower() for k in ("wire", "mask", "umber", "pitbox"))]
    if not pats:
        return None
    cache = os.path.join(work, ".best_pattern")
    if os.path.exists(cache):
        c = os.path.join(work, open(cache, encoding="utf-8").read().strip())
        if os.path.isfile(c):
            return c

    # File size favours smooth gradient schemes, which carry no text at all. Score on fine detail
    # instead: sponsor lettering makes far more small-scale contrast than any airbrush fade.
    def detail(f):
        g = np.asarray(Image.open(f).convert("L").resize((512, 512))).astype(float)
        return float((ndi.maximum_filter(g, 3) - ndi.minimum_filter(g, 3) > 50).mean())

    best = max(pats, key=detail)
    with open(cache, "w", encoding="utf-8") as fh:
        fh.write(os.path.basename(best))
    return best


def _backdrop(work, isl) -> Image.Image:
    pat = best_pattern(work)
    if pat:
        return Image.open(pat).convert("RGB")
    return Image.new("RGB", (isl.shape[1], isl.shape[0]), (50, 50, 50))


def _tile(src, isl, i, max_w, max_h, max_scale, back):
    x0, y0, x1, y1 = box(isl, i)
    c = src.crop((x0, y0, x1 + 1, y1 + 1))
    m = Image.fromarray(((isl[y0:y1 + 1, x0:x1 + 1] == i) * 255).astype("uint8"))
    c = Image.composite(c, Image.new("RGB", c.size, back), m)
    sc = min(max_w / c.width, max_h / c.height, max_scale)
    return c.resize((max(1, int(c.width * sc)), max(1, int(c.height * sc))))


def sheet(work: str | Path, n: int = 10) -> tuple[list[str], Path | None]:
    """Islands, mirrored pairs, and a contact sheet to read them from."""
    isl = load_isl(work)
    ids = island_ids(isl)
    areas = sorted(((int((isl == i).sum()), i) for i in ids), reverse=True)
    lines = ["%d islands; largest:" % len(ids)]
    for ar, i in areas[:n]:
        x0, y0, x1, y1 = box(isl, i)
        s, j, kind, ysum, xsum = partner(isl, i, ids)
        p = "  pairs %3d %s %.2f ysum %d" % (j, kind, s, ysum) if j and s > .9 else ""
        lines.append("  %3d %7d px  x %4d-%4d  y %4d-%4d%s" % (i, ar, x0, x1, y0, y1, p))
    pat = best_pattern(work)
    if not pat:
        lines.append("no stock patterns extracted")
        return lines, None
    lines.append("reading from %s" % os.path.basename(pat))
    src = Image.open(pat).convert("RGB")
    tiles = [(i, _tile(src, isl, i, 700, 300, 2.0, (0, 80, 0))) for _, i in areas[:n]]
    W = max(t.width for _, t in tiles)
    H = sum(t.height + 20 for _, t in tiles)
    out = Image.new("RGB", (W, H), (22, 22, 22))
    d = ImageDraw.Draw(out)
    y = 0
    for i, t in tiles:
        x0, y0, x1, y1 = box(isl, i)
        d.text((4, y + 4), "island %d   x %d-%d  y %d-%d" % (i, x0, x1, y0, y1), fill=(255, 220, 0))
        out.paste(t, (0, y + 16))
        y += t.height + 20
    p = Path(work) / "panels_sheet.png"
    out.save(p)
    return lines, p


def contact(works: dict[str, str | Path], out: str | Path, n: int = 5, width: int = 460,
            ids: list[int] | None = None) -> Path:
    """Several cars' main panels on one sheet, so a batch of orientation calls takes one look."""
    cols = []
    for car, work in works.items():
        isl = load_isl(work)
        src = _backdrop(work, isl)
        every = island_ids(isl)
        want = ids or [i for _, i in sorted(((int((isl == i).sum()), i) for i in every), reverse=True)[:n]]
        tiles = [(i, _tile(src, isl, i, width, 230, 2.5, (0, 70, 0))) for i in want if (isl == i).any()]
        h = sum(t.height + 18 for _, t in tiles) + 24
        col = Image.new("RGB", (width, h), (20, 20, 20))
        d = ImageDraw.Draw(col)
        d.text((4, 4), car, fill=(120, 255, 120))
        y = 22
        for i, t in tiles:
            d.text((4, y), "island %d" % i, fill=(255, 210, 0))
            col.paste(t, (0, y + 14))
            y += t.height + 18
        cols.append(col)
    W = sum(c.width + 10 for c in cols)
    H = max(c.height for c in cols)
    img = Image.new("RGB", (W, H), (12, 12, 12))
    x = 0
    for c in cols:
        img.paste(c, (x, 0))
        x += c.width + 10
    img.save(out)
    return Path(out)


def report(work: str | Path, car: str = "", n: int = 14) -> list[str]:
    """Everything about a car's sheet that reads better as numbers than as a picture."""
    isl = load_isl(work)
    ids = island_ids(isl)
    nb = number_blocks(work, pad=0)
    holds: dict[int, int] = {}
    if nb is not None:
        lab, count = ndi.label(nb)
        for k in range(1, count + 1):
            ys, xs = np.where(lab == k)
            if len(ys) < 400:
                continue
            v = isl[ys, xs]
            v = v[v > 0]
            if not len(v):
                continue          # a block sitting entirely in UV padding
            k2 = int(np.bincount(v).argmax())
            holds[k2] = holds.get(k2, 0) + 1
    areas = sorted(((int((isl == i).sum()), i) for i in ids), reverse=True)[:n]
    lines = ["== %s: %d islands" % (car, len(ids))]
    for ar, i in areas:
        x0, y0, x1, y1 = box(isl, i)
        s2, j, kind, ysum, xsum = partner(isl, i, ids)
        pr = ("pair %3d %-6s %.2f ysum %-5d xsum %-5d" % (j, kind, s2, ysum, xsum)
              if j and s2 > .9 else "%-38s" % "no twin")
        lines.append("  %3d %7d  x %4d-%4d (%4d)  y %4d-%4d (%4d)  %s%s"
                     % (i, ar, x0, x1, x1 - x0, y0, y1, y1 - y0, pr, "  NUMBER" if i in holds else ""))
    return lines


def panel_map(work: str | Path, n: int = 26) -> Path:
    """The whole sheet at once: the car's own stock scheme, island numbers on the panels big
    enough to carry a mark, and the number blocks it must not cover."""
    isl = load_isl(work)
    out = _backdrop(work, isl).copy()
    guide = number_guide(work)
    if guide:
        m = np.array(Image.open(guide).convert("RGBA"))[..., 3] > 10
        ov = np.asarray(out).astype(float)
        ov[m] = ov[m] * 0.35 + np.array([0, 160, 255]) * 0.65
        out = Image.fromarray(ov.astype("uint8"))
    d = ImageDraw.Draw(out)
    ids = island_ids(isl)
    areas = sorted(((int((isl == i).sum()), i) for i in ids), reverse=True)
    for ar, i in areas[:n]:
        cy, cx = ndi.center_of_mass(isl == i)
        d.text((cx - 14, cy - 16), str(i), fill=(255, 40, 0), stroke_width=4, stroke_fill=(255, 255, 255))
    p = Path(work) / "panels_map.png"
    out.resize((1400, 1400)).save(p)
    return p


# ---------------------------------------------------------------- the pass
def place(work: str | Path, cfg: dict[str, Any], art: Art) -> list[str]:
    """Fit and stamp the marks a panel map names, as layers ``<prefix>_*.png`` in the work folder."""
    work = str(work)
    isl = load_isl(work)
    sh = Sheet(isl, number_blocks(work))
    pre = cfg.get("prefix", DEFAULT_PREFIX)
    for f in glob.glob(os.path.join(glob.escape(work), pre + "_*.png")):
        os.remove(f)
    ART, LOCK, SPEEDSPORTS = art.mark(WORD), art.mark(LOCKUP), art.mark(SPEED)
    flank = Pair(isl, *cfg["flank"]) if cfg.get("flank") else None
    top = Pair(isl, *cfg["top"]) if cfg.get("top") else None
    body = flank or top
    deck = top or flank
    rep: list[str] = []

    def blank():
        return np.zeros(isl.shape)

    def put(c, img, pair, wmin, label, region=None):
        asp = img.size[1] / img.size[0]
        r = largest_fit(sh.free, pair.left, isl, asp, wmin=wmin, region=region)
        if not r:
            rep.append("%-9s no room" % label)
            return None
        w, cx, cy, bw, bh = r
        mx, my, rot = pair.center(cx, cy)
        # The far panel is a near-perfect mirror, not a perfect one, so a mark fitted on one side
        # can still catch the other side's edge. Shrink both together until neither loses ink.
        for _ in range(14):
            if sh.loss(img, cx, cy, pair.left, w=w) + sh.loss(img, mx, my, pair.right, w=w, rot=rot) == 0:
                break
            w = int(w * 0.96)
        # The mark is stamped at the size the shrinking ended on, as it always was. When that still
        # loses ink the line says how much landed, so a clipped mark is seen in the report.
        lost = sh.loss(img, cx, cy, pair.left, w=w) + sh.loss(img, mx, my, pair.right, w=w, rot=rot)
        got_l, tot_l = sh.stamp(c, img, cx, cy, pair.left, w=w)
        got_r, tot_r = sh.stamp(c, img, mx, my, pair.right, w=w, rot=rot)
        sh.occupy(cx, cy, bw, bh)
        sh.occupy(mx, my, bw, bh)
        line = "%-9s w=%-4d at %d,%d  %s %s" % (label, w, cx, cy, pair.kind, pair.left + pair.right)
        if lost:
            line += "  CLIPPED: %d%% landed" % (100 * (got_l + got_r) // max(1, tot_l + tot_r))
        rep.append(line)
        return r

    def row(c, items, pairs, wmin, label):
        absent = [n for n, _ in items if not art.has_mask(n)]
        if absent:
            rep.append("%-9s left off: no mask for %s" % (label, ", ".join(absent)))
            return
        nat = [art.mask(n).size[0] * h / art.mask(n).size[1] for n, h in items]
        full = sum(nat) + GAP * (len(items) - 1)
        asp = max(h for _, h in items) / full
        r = pair = None
        for cand in [p for p in pairs if p]:
            got = largest_fit(sh.free, cand.left, isl, asp, wmin=max(wmin, int(full * MINSCALE)))
            if got and (r is None or got[0] > r[0]):
                r, pair = got, cand
        if not r:
            rep.append("%-9s no room at a readable size" % label)
            return
        W0, cx0, cy, bw, bh = r

        def lay(W, cx, stamp_it=False):
            """Total ink the group would lose at this size and position, on both sides."""
            s = W / full
            x = cx - W / 2
            lost = 0
            for (n, h), w in zip(items, nat):
                lx = x + w * s / 2
                mx, my, rot = pair.center(lx, cy)
                if stamp_it:
                    sh.stamp(c, art.mask(n), lx, cy, pair.left, h=h * s)
                    sh.stamp(c, art.mask(n), mx, my, pair.right, h=h * s, rot=rot)
                else:
                    lost += sh.loss(art.mask(n), lx, cy, pair.left, h=h * s)
                    lost += sh.loss(art.mask(n), mx, my, pair.right, h=h * s, rot=rot)
                x += w * s + GAP * s
            return lost, s

        W, cx, done = W0, cx0, False
        for k in range(14):
            W = int(W0 * 0.96 ** k)
            if W < full * MINSCALE:
                break
            for shift in sorted(range(-180, 181, 6), key=abs):
                if lay(W, cx0 + shift)[0] == 0:
                    cx, done = cx0 + shift, True
                    break
            if done:
                break
        if not done:
            rep.append("%-9s no room at a readable size" % label)
            return
        _, s = lay(W, cx, stamp_it=True)
        sh.occupy(cx, cy, bw, bh)
        sh.occupy(*pair.center(cx, cy)[:2], bw, bh)
        rep.append("%-9s W=%-4d at %d,%d  scale %.2f" % (label, W, cx, cy, s))

    # 1. DOOOOM along both flanks
    c = blank()
    if body:
        put(c, ART, body, cfg.get("word_min", 280), "word")
    n1 = save_layer(c, os.path.join(work, pre + "_1_word.png"))
    # 2. DOOOOM across the back, the one mark every car must carry
    c = blank()
    for key, lbl in (("rear", "rear"), ("rear_under", "rear_u")):
        r = cfg.get(key)
        if not r:
            continue
        rot = r.get("rot", 0)
        ids = r["ids"]
        asp = ART.size[1] / ART.size[0]
        fit = largest_fit(sh.free, ids, isl, asp, wmin=cfg.get("rear_min", 200), swap=rot % 180 != 0)
        if not fit:
            rep.append("%-9s no room" % lbl)
            continue
        w, cx, cy, bw, bh = fit
        got, tot = sh.stamp(c, ART, cx, cy, ids, w=w, rot=rot)
        sh.occupy(cx, cy, bw, bh)
        rep.append("%-9s w=%-4d at %d,%d rot %d  %d%%" % (lbl, w, cx, cy, rot, 100 * got // max(1, tot)))
    # A wing often unwraps with both of its faces stacked in one island - the SF23's YOKOHAMA
    # reads upright on the top half and turned 180 on the bottom, and the iR-01's dallara does the
    # same. Marking both halves puts DOOOOM across the back whichever half faces the following car.
    for r in ([cfg["rear_split"]] if cfg.get("rear_split") else []):
        ids = r["ids"]
        x0, y0, x1, y1 = box(isl, ids[0])
        mid = (y0 + y1) // 2
        asp = ART.size[1] / ART.size[0]
        for half, (ya, yb, rot) in enumerate(((y0, mid, 0), (mid, y1 + 1, 180))):
            fit = largest_fit(sh.free, ids, isl, asp, wmin=r.get("min", 160), region=(x0, ya, x1 + 1, yb))
            if not fit:
                rep.append("%-9s no room" % ("rear %d" % half))
                continue
            w, cx, cy, bw, bh = fit
            got, tot = sh.stamp(c, ART, cx, cy, ids, w=w, rot=rot)
            sh.occupy(cx, cy, bw, bh)
            rep.append("%-9s w=%-4d at %d,%d rot %d  %d%%"
                       % ("rear %d" % half, w, cx, cy, rot, 100 * got // max(1, tot)))
    n2 = save_layer(c, os.path.join(work, pre + "_2_rear.png"))
    # 3. the lockup, on the top deck where there is one
    c = blank()
    # The lockup carries DOOOOM too, so putting it on the surface that already wears the wordmark
    # reads as the same logo twice. Where there is no second surface, the flank gets SPEEDSPORTS
    # on its own instead - a second mark, not a second DOOOOM.
    second = {"lockup": LOCK, "speed": SPEEDSPORTS}[cfg.get("lock_art", "lockup")]
    if deck is body:
        second = SPEEDSPORTS
    if deck:
        put(c, second, deck, cfg.get("lock_min", 240), "second")
    # 3b. panels with no mirror twin - a top-down deck, a single rear plane - take a mark of
    # their own at the rotation the car's stock scheme says reads correctly there.
    for i, solo in enumerate(cfg.get("solo", [])):
        img = {"word": ART, "lockup": LOCK, "speed": SPEEDSPORTS}[solo.get("art", "lockup")]
        asp = img.size[1] / img.size[0]
        rot = solo.get("rot", 0)
        fit = largest_fit(sh.free, solo["ids"], isl, asp, wmin=solo.get("min", 200), swap=rot % 180 != 0)
        if not fit:
            rep.append("%-9s no room" % ("solo %d" % i))
            continue
        w, cx, cy, bw, bh = fit
        sh.stamp(c, img, cx, cy, solo["ids"], w=w, rot=rot)
        sh.occupy(cx, cy, bw, bh)
        rep.append("%-9s w=%-4d at %d,%d rot %d  %s" % ("solo %d" % i, w, cx, cy, rot, solo["ids"]))
    n3 = save_layer(c, os.path.join(work, pre + "_3_lockup.png"))

    # 4. sponsors: bands on the deck, sim gear along the flanks
    c = blank()
    row(c, BANDS, [deck, body], cfg.get("bands_min", 260), "bands")
    row(c, GEAR_A, [body, deck], cfg.get("gear_min", 240), "gear A")
    row(c, GEAR_B, [body, deck], cfg.get("gear_min", 200), "gear B")
    n4 = save_layer(c, os.path.join(work, pre + "_5_spon.png"))
    total = n1 + n2 + n3 + n4
    rep.append("%-9s %d px art on the sheet (%.1f%%)" % ("total", total, 100 * total / isl.size))

    # number blocks are a hard constraint
    blocks = number_blocks(work, pad=4)
    if blocks is not None:
        bad = [os.path.basename(f) for f in sorted(glob.glob(os.path.join(glob.escape(work), pre + "_*.png")))
               if (np.array(Image.open(f))[..., 3] > 40)[blocks].any()]
        rep.append("NUMBER CLASH: %s" % ", ".join(bad) if bad
                   else "number blocks clear (%s)" % os.path.basename(number_guide(work)))
    else:
        rep.append("no number-block guide found")
    return rep
