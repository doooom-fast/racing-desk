#!/usr/bin/env python3
"""Place flat artwork across the *car* (not the flat UV sheet) of an iRacing paint template.

Pipeline (all files live in one work dir, default: current dir):
  islands   wire.png                     -> isl.npy, islands_map.png, islands.tsv
  gapclose  --top 51,61,.. --center 1258 -> carY.npy      (collapse UV padding between top panels)
  search    --art art.png --top ...      -> ranked (L, angle, cx, cy) by % ink on top panels
  preview   --art art.png --top ... L,ang,cx,cy [...] -> cand_sheet.png (reconstructed top view)
  render    --art art.png --top ... L,ang,cx,cy       -> art_uv_rgba.png (drop into Photoshop)

Needs: numpy scipy pillow  (python3 -m venv v && v/bin/pip install numpy scipy pillow)
Inputs exported from the template PSD by ps_export_guides.jsx: g_Wire.png (UV wireframe with
island outlines), and the artwork rasterized by Photoshop (ai_600.png: white art on black).
"""
import argparse, sys, numpy as np
from PIL import Image, ImageDraw, ImageFont, PngImagePlugin
from scipy import ndimage as ndi
PngImagePlugin.MAX_TEXT_CHUNK = 1 << 30   # Photoshop PNGs carry huge XMP chunks
FONT = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'

def font(sz):
    try: return ImageFont.truetype(FONT, sz)
    except Exception: return ImageFont.load_default()

def wire_on_black(path):
    w = Image.open(path).convert('RGBA')
    return Image.alpha_composite(Image.new('RGBA', w.size, (0, 0, 0, 255)), w).convert('RGB')

# ---------------------------------------------------------------- islands
def cmd_islands(a):
    w = np.array(Image.open(a.wire).convert('RGBA')).astype(int)
    R, G, B, A = (w[..., i] for i in range(4))
    # island borders are drawn in a saturated outline colour (green in iRacing templates)
    border = (A > 60) & (G > 120) & (R < 140) & (B < 140)
    if a.border == 'white':
        border = (A > 60) & (R > 200) & (G > 200) & (B > 200)
    border = ndi.binary_dilation(border, iterations=1)
    lab, n = ndi.label(~border)
    sizes = ndi.sum(np.ones_like(lab), lab, range(1, n + 1))
    bg = int(np.argmax(sizes)) + 1
    keep = [i for i in range(1, n + 1) if i != bg and sizes[i - 1] >= a.min_area]
    isl = np.zeros_like(lab)
    for k, i in enumerate(keep, 1): isl[lab == i] = k
    dist, (iy, ix) = ndi.distance_transform_edt(isl == 0, return_indices=True)
    isl = np.where((isl == 0) & (dist <= 3), isl[iy, ix], isl).astype(np.int16)
    np.save('isl.npy', isl)
    H, W = isl.shape
    rng = np.random.default_rng(7); col = rng.integers(70, 230, (len(keep) + 1, 3)).astype(np.uint8); col[0] = 20
    out = Image.blend(Image.fromarray(col[isl]), wire_on_black(a.wire), 0.3); d = ImageDraw.Draw(out); f = font(max(14, W // 90))
    rows = []
    for k, sl in enumerate(ndi.find_objects(isl), 1):
        if sl is None: continue
        area = int((isl[sl] == k).sum()); cy, cx = ndi.center_of_mass(isl == k)
        rows.append((k, area, sl[1].start, sl[0].start, sl[1].stop, sl[0].stop, int(cx), int(cy)))
        if area > a.min_area * 3:
            d.text((cx - 10, cy - 11), str(k), fill=(0, 0, 0), font=f, stroke_width=3, stroke_fill=(255, 255, 255))
    if a.center: d.line([(0, a.center), (W, a.center)], fill=(255, 0, 0), width=2)
    out.save('islands_map.png'); out.resize((1024, 1024)).save('islands_map_small.png')
    with open('islands.tsv', 'w') as fh:
        fh.write('id\tarea\tx0\ty0\tx1\ty1\tcx\tcy\n')
        for r in sorted(rows, key=lambda r: -r[1]): fh.write('\t'.join(map(str, r)) + '\n')
    print(f'{len(rows)} islands -> isl.npy, islands_map.png, islands.tsv')

def top_mask(ids):
    return np.isin(np.load('isl.npy'), [int(x) for x in ids.split(',')])

# ---------------------------------------------------------------- gapclose
def cmd_gapclose(a):
    """Per UV column, walk outward from the centreline; short runs of non-top pixels that sit
    BETWEEN two top panels are UV padding (not real geometry) and get collapsed to zero width,
    so a stroke leaving one panel re-enters the neighbour at the same place. Long runs (cockpit
    opening, real holes) keep their width. Axis: --axis y means the car's centreline is a
    horizontal line (nose left/right); --axis x means a vertical centreline (nose up/down)."""
    top = top_mask(a.top)
    if a.axis == 'x': top = top.T
    H, W = top.shape; C = a.center
    carY = np.zeros((H, W), np.int32)
    for x in range(W):
        col = top[:, x]
        for step in (-1, 1):
            ys = list(range(C, -1, -1)) if step < 0 else list(range(C, H))
            flags = [bool(col[y]) for y in ys]
            cy, i, n, seen = 0, 0, len(ys), False
            while i < n:
                if flags[i]:
                    cy += 1; carY[ys[i], x] = C + step * cy; seen = True; i += 1
                else:
                    j = i
                    while j < n and not flags[j]: j += 1
                    collapse = seen and j < n and (j - i) < a.gap_max
                    for k in range(i, j):
                        if not collapse: cy += 1
                        carY[ys[k], x] = C + step * cy
                    i = j
    if a.axis == 'x': carY = carY.T
    np.save('carY.npy', carY); np.save('axis.npy', np.array([0 if a.axis == 'y' else 1]))
    print('carY.npy written (gap_max=%d, centre=%d, axis=%s)' % (a.gap_max, C, a.axis))

# ---------------------------------------------------------------- art rendering
class Placer:
    """extra: JSON list of rectangle maps for islands outside the gap-closed band (e.g. a rear wing):
      {"island": 1, "uv": [x0,y0,x1,y1], "car": [cx0,cy0,cx1,cy1], "mirror": false}
    UV rect corners map linearly onto car-space corners (reverse cx0/cx1 to flip an unfolded
    underside). "mirror": true samples the art mirrored across the centreline so an UNDERSIDE copy
    reads correctly from below. car_size enlarges the car canvas past the sheet (wing overhang)."""
    def __init__(s, art, top, thr_lo=0.25, thr_hi=0.8, extra=None, car_size=None, center=None, fallback=None):
        g = np.array(Image.open(art).convert('L')).astype(float) / 255
        g = np.clip((g - thr_lo) / (thr_hi - thr_lo), 0, 1)
        ys, xs = np.where(g > 0.5); g = g[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        s.logo = Image.fromarray((g * 255).astype(np.uint8))
        s.top = top_mask(top); s.H, s.W = s.top.shape
        s.carY = np.clip(np.load('carY.npy'), 0, s.H - 1)
        import os; s.axisx = os.path.exists('axis.npy') and bool(np.load('axis.npy')[0])
        s.XX = np.tile(np.arange(s.W), (s.H, 1)); s.YY = s.XX.T.copy()
        s.CH = s.CW = car_size or s.W
        s.center = center if center is not None else s.H // 2
        s.extra = []
        if extra:
            import json
            isl = np.load('isl.npy')
            for m in json.load(open(extra)):
                x0, y0, x1, y1 = m['uv']; c0x, c0y, c1x, c1y = m['car']
                lo_x, hi_x = sorted((x0, x1)); lo_y, hi_y = sorted((y0, y1))
                yy, xx = np.where((isl == m['island']) & (s.XX >= lo_x) & (s.XX < hi_x) & (s.YY >= lo_y) & (s.YY < hi_y))
                u = (xx - x0) / (x1 - x0); v = (yy - y0) / (y1 - y0)
                cx_ = np.clip(np.round(c0x + u * (c1x - c0x)).astype(int), 0, s.CW - 1)
                cy_ = np.round(c0y + v * (c1y - c0y)).astype(int)
                if m.get('mirror'): cy_ = 2 * s.center - cy_
                s.extra.append((yy, xx, np.clip(cy_, 0, s.CH - 1), cx_, bool(m.get('mirror')), m.get('name', 'island %d' % m['island'])))
        # everything else that is paintable (flanks, wings, small parts): identity mapping. The sheet
        # already lays most panels near where an unfold would put them, so art wraps over the edges
        # roughly continuously. Good enough for washes/watermarks; not for precise seam work.
        s.fill = None
        if fallback:
            paint = np.array(Image.open(fallback).convert('RGBA'))[:, :, 3] < 128
            claimed = s.top.copy()
            for yy, xx, _, _, _, _ in s.extra: claimed[yy, xx] = True
            s.fill = paint & ~claimed
    def car(s, L, ang, cx, cy):
        w = int(L); h = int(round(s.logo.size[1] * L / s.logo.size[0]))
        arr = np.asarray(s.logo.resize((w, h), Image.LANCZOS).rotate(ang, resample=Image.BICUBIC, expand=True)).astype(float) / 255
        out = np.zeros((s.CH, s.CW)); hh, ww = arr.shape; x0 = int(cx - ww / 2); y0 = int(cy - hh / 2)
        sx, sy, dx, dy = max(0, -x0), max(0, -y0), max(0, x0), max(0, y0)
        cw, ch = min(ww - sx, s.CW - dx), min(hh - sy, s.CH - dy)
        if cw > 0 and ch > 0: out[dy:dy + ch, dx:dx + cw] = arr[sy:sy + ch, sx:sx + cw]
        return out
    def uv(s, car):
        out = (car[s.YY, s.carY] if s.axisx else car[s.carY, s.XX]) * s.top
        for yy, xx, cy_, cx_, mir, _ in s.extra: out[yy, xx] = car[cy_, cx_]
        if s.fill is not None: out[s.fill] = car[:s.H, :s.W][s.fill]
        return out
    def carview(s, uvimg, include_extra=True):
        cv = np.zeros((s.CH, s.CW)); yy, xx = np.where(s.top)
        if include_extra:
            for ey, ex, cy_, cx_, mir, _ in s.extra:
                if not mir: cv[cy_, cx_] = uvimg[ey, ex]      # top-side extras drawn in the top view
        if s.axisx: cv[yy, s.carY[yy, xx]] = uvimg[yy, xx]
        else: cv[s.carY[yy, xx], xx] = uvimg[yy, xx]
        return cv

def parse_specs(specs): return [tuple(map(int, p.split(','))) for p in specs]

def cmd_search(a):
    P = Placer(a.art, a.top, extra=a.extra, car_size=a.car_size, center=a.center, fallback=a.fallback); res = []
    for L in map(int, a.lengths.split(',')):
        for ang in map(int, a.angles.split(',')):
            for cx in range(a.cx[0], a.cx[1] + 1, a.step):
                for cy in range(a.cy[0], a.cy[1] + 1, a.step):
                    c = P.car(L, ang, cx, cy); u = P.uv(c); res.append((u.sum() / max(c.sum(), 1), L, ang, cx, cy))
    res.sort(reverse=True)
    for r in res[:15]: print('on-top %.3f   L=%d ang=%d cx=%d cy=%d' % r)

def cmd_preview(a):
    P = Placer(a.art, a.top, extra=a.extra, car_size=a.car_size, center=a.center, fallback=a.fallback)
    wire = np.array(wire_on_black(a.wire).convert('L')).astype(float) / 255
    base = P.carview(np.where(P.top, 0.18 + 0.25 * wire, 0)); tiles = []
    for L, ang, cx, cy in parse_specs(a.specs):
        c = P.car(L, ang, cx, cy); seen = P.carview(P.uv(c)); ghost = c * 0.28
        rgb = np.stack([base] * 3, -1)
        rgb[..., 2] = np.maximum(rgb[..., 2], ghost); rgb[..., 0] = np.maximum(rgb[..., 0], ghost * 0.5)
        rgb[..., 0] = np.maximum(rgb[..., 0], seen * .95); rgb[..., 1] = np.maximum(rgb[..., 1], seen * .8); rgb[..., 2] = np.maximum(rgb[..., 2], seen * .3)
        im = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8))
        if a.crop: im = im.crop(tuple(a.crop))
        if a.rotate: im = im.rotate(a.rotate, expand=True)
        ImageDraw.Draw(im).text((20, 20), f'{L},{ang},{cx},{cy}', fill=(255, 255, 255), font=font(40))
        tiles.append(im.resize((im.width // 2, im.height // 2)))
    sheet = Image.new('RGB', (sum(t.width + 8 for t in tiles), tiles[0].height), (40, 40, 40)); x = 0
    for t in tiles: sheet.paste(t, (x, 0)); x += t.width + 8
    sheet.save(a.out); print('wrote', a.out, sheet.size)

def cmd_render(a):
    P = Placer(a.art, a.top, extra=a.extra, car_size=a.car_size, center=a.center, fallback=a.fallback); (L, ang, cx, cy), = parse_specs([a.spec])
    u = np.clip(P.uv(P.car(L, ang, cx, cy)), 0, 1)
    rgba = np.zeros((P.H, P.W, 4), np.uint8); rgba[..., :3] = 255; rgba[..., 3] = (u * 255).astype(np.uint8)
    Image.fromarray(rgba).save(a.out); Image.fromarray(rgba[..., 3]).save(a.out.replace('.png', '_mask.png'))
    print('wrote', a.out, 'ink px', int((u > .5).sum()))
    if a.shadow:
        # Offset "shadow" / half-outline: the art shifted in CAR space, minus the art itself, so
        # only the sliver that sticks out on one side remains. Shifting in car space (before the
        # UV remap) keeps the shadow continuous across panel seams.
        dx, dy = map(int, a.shadow.split(','))
        c = P.car(L, ang, cx, cy)
        if a.shadow_mode == 'strokes':
            sil = c                                   # every stroke casts its own shadow (outline look on line art)
        else:
            # solid silhouette: seal jagged gaps, fill letter counters / enclosed holes, so the art casts
            # ONE shadow and orange only shows past the far edge of the letterforms
            b = c > 0.5
            if a.shadow_close > 0:
                r = a.shadow_close; yy, xx = np.mgrid[-r:r + 1, -r:r + 1]; disk = (xx * xx + yy * yy) <= r * r
                b = ndi.binary_closing(np.pad(b, r + 1), structure=disk)[r + 1:-r - 1, r + 1:-r - 1]
            b = ndi.binary_fill_holes(b)
            sil = np.maximum(ndi.gaussian_filter(b.astype(float), 0.8), c)
        sil2 = ndi.shift(sil, (dy, dx), order=0, mode='constant', cval=0)
        sh = np.clip(P.uv(np.clip(sil2 - sil, 0, 1)), 0, 1)
        Image.fromarray((np.clip(sil, 0, 1) * 255).astype(np.uint8)).save(a.out.replace('.png', '_silhouette_carspace.png'))
        # layer-stack versions for the PSD: full offset shadow UNDER a knockout of the art's footprint,
        # with the art on top (editable like a normal designer stack; composite equals the trimmed shadow)
        for tag, img in (('_shadowfull', sil2), ('_knockout', sil)):
            rgba[..., 3] = (np.clip(P.uv(np.clip(img, 0, 1)), 0, 1) * 255).astype(np.uint8)
            Image.fromarray(rgba).save(a.out.replace('.png', tag + '.png'))
        out2 = a.out.replace('.png', '_shadow.png')
        rgba[..., 3] = (sh * 255).astype(np.uint8); Image.fromarray(rgba).save(out2)
        print('wrote', out2, 'shadow px', int((sh > .5).sum()))

def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter); sp = p.add_subparsers(dest='cmd', required=True)
    s = sp.add_parser('islands'); s.add_argument('wire'); s.add_argument('--min-area', type=int, default=800); s.add_argument('--center', type=int); s.add_argument('--border', choices=['green', 'white'], default='green')
    s = sp.add_parser('gapclose'); s.add_argument('--top', required=True); s.add_argument('--center', type=int, required=True); s.add_argument('--gap-max', type=int, default=60); s.add_argument('--axis', choices=['y', 'x'], default='y')
    for name in ('search', 'preview', 'render'):
        s = sp.add_parser(name); s.add_argument('--art', required=True); s.add_argument('--top', required=True)
        s.add_argument('--extra', help='JSON rectangle maps for islands outside the band (rear wing top/underside)')
        s.add_argument('--car-size', type=int, help='car canvas size in px when extras overhang the sheet (e.g. 2400)')
        s.add_argument('--center', type=int, help='car centreline (needed for mirrored underside maps)')
        s.add_argument('--fallback', help="paintable mask (g_Mask.png): every other paintable island gets an identity UV->car mapping so art wraps onto flanks/wings too")
        if name == 'search':
            s.add_argument('--lengths', default='1300,1450,1600,1800'); s.add_argument('--angles', default='40,45,50')
            s.add_argument('--cx', type=int, nargs=2, default=[800, 1600]); s.add_argument('--cy', type=int, nargs=2, default=[1200, 1300]); s.add_argument('--step', type=int, default=50)
        if name == 'preview':
            s.add_argument('--wire', default='g_Wire.png'); s.add_argument('--crop', type=int, nargs=4); s.add_argument('--rotate', type=int, default=0)
            s.add_argument('--out', default='cand_sheet.png'); s.add_argument('specs', nargs='+', help='L,angle,cx,cy in car space')
        if name == 'render':
            s.add_argument('--out', default='art_uv_rgba.png'); s.add_argument('spec', help='L,angle,cx,cy')
            s.add_argument('--shadow-mode', choices=['silhouette', 'strokes'], default='silhouette', help='silhouette = one offset shadow of the filled letterforms (drop shadow); strokes = per-stroke copy (reads as an outline on line art)')
            s.add_argument('--shadow-close', type=int, default=6, help='px closing radius to seal gaps before filling counters (silhouette mode)')
            s.add_argument('--shadow', help='dx,dy car-space px offset for a drop-shadow/half-outline layer (e.g. 24,0 = 2in rearward at ~12px/in, nose-left templates)')
    a = p.parse_args(); globals()['cmd_' + a.cmd](a)

if __name__ == '__main__': main()
