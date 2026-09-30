#!/usr/bin/env python3
"""iRacing helmet paints: fetch the template, probe its orientation, build helmet_<id>.tga.

    helmet.py template --out guides/            # download helmet.zip, extract guides (psd-tools)
    helmet.py probe    --guides guides/ --out probe/        # orientation test helmet
    helmet.py build    spec.json --out helmet_424242.tga   # compose a helmet from a spec
    helmet.py preview  helmet_424242.tga --guides guides/ --out preview.png

Needs numpy, scipy, pillow; `template` also needs psd-tools. Island names, colour chips and mark
anchors come from islands.json beside this script. Coordinates there are 1024-space and scale to
the output size, so a spec builds at 1024 (the template) or 2048 (the sim's maximum) unchanged.
"""
import argparse, io, json, os, sys, urllib.request, zipfile
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
MAP = json.load(open(os.path.join(HERE, 'islands.json')))
ZIP_URL = 'https://ir-core-sites.iracing.com/members/member_images/misctemplates/helmet.zip'
FONTS = ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/Library/Fonts/Arial Bold.ttf',
         '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'C:/Windows/Fonts/arialbd.ttf']

def font(px):
    for f in FONTS:
        if os.path.exists(f): return ImageFont.truetype(f, int(px))
    return ImageFont.load_default()

def rgb(v):
    if isinstance(v, str): v = v.lstrip('#'); return np.array([int(v[i:i+2], 16) for i in (0, 2, 4)], float)
    return np.array(v, float)

# --- template ---------------------------------------------------------------------------------

def _layer_rgba(layer, size):
    """A layer's own pixels on a full-size transparent canvas. Layers inside hidden groups
    composite empty in psd-tools, so read each one's pixels directly."""
    canvas = Image.new('RGBA', size, (0, 0, 0, 0))
    im = layer.topil()
    if im is None: return canvas
    im = im.convert('RGBA')
    x, y = layer.left, layer.top
    if x < 0 or y < 0:                                  # crop what hangs off the sheet
        im = im.crop((max(-x, 0), max(-y, 0), im.width, im.height)); x, y = max(x, 0), max(y, 0)
    canvas.alpha_composite(im, (x, y))
    return canvas

def cmd_template(a):
    from psd_tools import PSDImage
    os.makedirs(a.out, exist_ok=True)
    psd_path = a.psd
    if not psd_path:
        z = os.path.join(a.out, 'helmet.zip')
        if not os.path.exists(z):
            print('downloading', ZIP_URL)
            req = urllib.request.Request(ZIP_URL, headers={'User-Agent': 'livery-tool/1.0'})
            open(z, 'wb').write(urllib.request.urlopen(req, timeout=120).read())
        with zipfile.ZipFile(z) as zf:
            name = next(n for n in zf.namelist() if n.lower().endswith('.psd'))
            psd_path = os.path.join(a.out, os.path.basename(name))
            if not os.path.exists(psd_path): open(psd_path, 'wb').write(zf.read(name))
    psd = PSDImage.open(psd_path)
    size = psd.size
    layers = {l.name: l for l in psd.descendants()}
    groups = {l.name: l for l in psd if l.is_group()}
    def save(name, fn, bg=None):
        im = _layer_rgba(layers[name], size)
        if bg is not None:
            b = Image.new('RGBA', size, bg + (255,)); b.alpha_composite(im); im = b.convert('RGB')
        im.save(os.path.join(a.out, fn))
    save('Wire', 'g_Wire.png'); save('Mask', 'g_Mask.png'); save('helmet_decal', 'g_Decal.png')
    save('License', 'g_License.png')
    # base.png: the paintable area as the sim would get it with no pattern chosen - helmet colour,
    # visor tint, sunstrip, belt labels, colour chips. Builds paint over this.
    base = Image.new('RGBA', size, (0, 0, 0, 255))
    for l in reversed(list(groups['Paintable Area'])):
        if l.is_group() or not l.visible or l.name == 'Helmet Color': continue
        base.alpha_composite(_layer_rgba(l, size))
    base.convert('RGB').save(os.path.join(a.out, 'base.png'))
    islands_png(os.path.join(a.out, 'g_Mask.png'), os.path.join(a.out, 'islands.png'))
    if a.patterns:
        pd = os.path.join(a.out, 'patterns'); os.makedirs(pd, exist_ok=True)
        for l in groups['Paintable Area']:
            if l.is_group() and l.name == 'Patterns':
                for p in l:
                    b = base.copy(); b.alpha_composite(_layer_rgba(p, size))
                    b.convert('RGB').save(os.path.join(pd, p.name.replace('.tga', '.png')))
    print('template %s  %dx%d' % (psd_path, size[0], size[1]))
    print('guides   %s  (g_Wire g_Mask g_Decal g_License base islands%s)' % (a.out, ' patterns/' if a.patterns else ''))

def islands_png(mask_png, out):
    """Label image: pixel value = 1 + index of the island in islands.json order, 0 elsewhere.
    The Mask layer is opaque brown over the unpaintable area and clear over the islands;
    islands are flood-filled from their seeds."""
    m = np.array(Image.open(mask_png).convert('RGBA')).astype(int)
    paint = m[..., 3] < 128
    lab, _ = ndi.label(paint)
    out_im = np.zeros(paint.shape, np.uint8)
    k = paint.shape[0] / MAP['size']
    for i, (name, isl) in enumerate(MAP['islands'].items()):
        sx, sy = int(isl['seed'][0]*k), int(isl['seed'][1]*k)
        if lab[sy, sx]: out_im[lab == lab[sy, sx]] = i + 1
        else: print('  warning: seed for %s is not on a paintable pixel' % name)
    Image.fromarray(out_im).save(out)

# --- shared geometry --------------------------------------------------------------------------

class Sheet:
    """Guides at the output size: base image, one boolean mask per island, scale factor."""
    def __init__(self, guides, size):
        self.N, self.k = size, size / MAP['size']
        base = Image.open(os.path.join(guides, 'base.png')).convert('RGB')
        self.base = np.array(base.resize((size, size), Image.LANCZOS)).astype(float)
        lab = Image.open(os.path.join(guides, 'islands.png')).resize((size, size), Image.NEAREST)
        lab = np.array(lab)
        self.mask = {n: lab == i + 1 for i, n in enumerate(MAP['islands'])}
    def box(self, bbox):
        x0, y0, x1, y1 = [int(round(v*self.k)) for v in bbox]; return x0, y0, x1, y1
    def anchor(self, name):
        an = MAP['anchors'][name]
        return an['at'][0]*self.k, an['at'][1]*self.k, an.get('rot', 0), an.get('max_w', 200)*self.k

def ink_from_image(path, mode='luma', invert=False):
    """Coverage 0..1 from an art file. luma: light = ink (art is light-on-dark, as in the livery
    pipeline). alpha: the alpha channel. dark-alpha: the shatter rule - dark, opaque = solid."""
    im = Image.open(path)
    if mode == 'alpha':
        a = np.array(im.convert('RGBA'))[..., 3].astype(float)/255
    elif mode == 'dark-alpha':
        s = np.array(im.convert('RGBA')).astype(float)/255
        a = np.clip(s[..., 3]*(1.0 - s[..., :3].mean(2))*1.15, 0, 1)
    else:
        a = np.array(im.convert('L')).astype(float)/255
        if invert: a = 1 - a
        # key out the art's own backdrop (the DOOOOM rasters sit on dark grey, not black)
        edge = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
        bg = float(np.median(edge))
        return np.clip((a - bg - 0.04) / max(1e-3, 1 - bg - 0.04), 0, 1)
    return 1 - a if invert else a

def stamp(cov, sheet, cx, cy, rot, width, height=None):
    """Place a coverage array on the sheet centred at (cx, cy), scaled to width (or height),
    rotated rot degrees counter-clockwise. Returns a full-sheet coverage array."""
    ys, xs = np.where(cov > 0.02)
    if len(xs): cov = cov[ys.min():ys.max()+1, xs.min():xs.max()+1]      # trim to the ink
    h, w = cov.shape
    s = (height / h) if height else (width / w)
    im = Image.fromarray((cov*255).astype(np.uint8)).resize((max(1, int(w*s)), max(1, int(h*s))), Image.LANCZOS)
    if rot: im = im.rotate(rot, Image.BICUBIC, expand=True)
    out = Image.new('L', (sheet.N, sheet.N), 0)
    out.paste(im, (int(round(cx - im.width/2)), int(round(cy - im.height/2))))
    return np.asarray(out).astype(float)/255

def text_cov(text, px):
    f = font(px)
    l, t, r, b = f.getbbox(text)
    im = Image.new('L', (r - l + 8, b - t + 8), 0)
    ImageDraw.Draw(im).text((4 - l, 4 - t), text, fill=255, font=f)
    return np.asarray(im).astype(float)/255

def save_tga(arr, path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    Image.fromarray(np.clip(arr, 0, 255).round().astype(np.uint8), 'RGB').save(path)

# --- probe ------------------------------------------------------------------------------------

PROBE_COLOURS = [(230, 40, 40), (240, 150, 20), (230, 220, 30), (60, 190, 60), (30, 170, 200), (50, 80, 230),
                 (150, 60, 220), (230, 70, 170), (140, 90, 40), (120, 120, 120), (250, 250, 250), (20, 20, 20)]

def cmd_probe(a):
    """Orientation test. The shell is cut into a 4x3 grid of coloured cells, each carrying a
    chirality-revealing letter (a mirror or a turn changes how it reads) and an arrow pointing
    to the sheet's top. Every other island gets its own colour and name. In the sim, note which
    cell is on each side, the brow, the chin and the back, and how its letter reads."""
    sh = Sheet(a.guides, a.size)
    out = sh.base.copy()
    cols, rows = 4, 3
    x0, y0, x1, y1 = sh.box(MAP['islands']['shell']['bbox'])
    letters = 'FGJKLNPQRSZ7'
    legend = []
    for r in range(rows):
        for c in range(cols):
            i = r*cols + c
            cx0 = x0 + (x1-x0)*c//cols; cx1 = x0 + (x1-x0)*(c+1)//cols
            cy0 = y0 + (y1-y0)*r//rows; cy1 = y0 + (y1-y0)*(r+1)//rows
            cell = np.zeros((sh.N, sh.N), bool); cell[cy0:cy1, cx0:cx1] = True
            cell &= sh.mask['shell']
            col = np.array(PROBE_COLOURS[i])
            out[cell] = col
            ink = _ink_for(col)
            lab = letters[i] + '\u2191'
            # centre on the part of the cell that is really shell, and size to fit inside it
            ys, xs = np.where(cell)
            core = ndi.binary_erosion(cell, iterations=max(2, int(12*sh.k)))
            if core.any(): ys, xs = np.where(core)
            cx, cy = xs.mean(), ys.mean()
            half_h = min(cy - ys.min(), ys.max() - cy); half_w = min(cx - xs.min(), xs.max() - cx)
            cov = stamp(text_cov(lab, 200), sh, cx, cy, 0, None, min(2*half_h*0.8, 2*half_w*0.8*0.6)) * cell
            out = out*(1-cov[..., None]) + ink*cov[..., None]
            legend.append('%s  %-7s cell col %d row %d (sheet x %d-%d, y %d-%d)' % (letters[i], _cname(i), c, r, cx0, cx1, cy0, cy1))
    others = [n for n in MAP['islands'] if n != 'shell']
    for j, n in enumerate(others):
        col = np.array(PROBE_COLOURS[(j*5 + 3) % len(PROBE_COLOURS)])
        m = sh.mask[n]; out[m] = col
        bx0, by0, bx1, by1 = sh.box(MAP['islands'][n]['bbox'])
        ink = _ink_for(col)
        cov = stamp(text_cov(n.upper() + ' \u2191', 120), sh, (bx0+bx1)/2, (by0+by1)/2, 0,
                    (bx1-bx0)*0.6, None)
        hmax = (by1-by0)*0.7
        if cov.any() and (np.ptp(np.where(cov.any(1))[0]) > hmax):
            cov = stamp(text_cov(n.upper() + ' \u2191', 120), sh, (bx0+bx1)/2, (by0+by1)/2, 0, None, hmax)
        cov *= m
        out = out*(1-cov[..., None]) + ink*cov[..., None]
        legend.append('%-12s %s' % (n, _cname((j*5 + 3) % len(PROBE_COLOURS))))
    for j, (n, c) in enumerate((k, v) for k, v in MAP['chips'].items() if not k.startswith('_')):
        bx0, by0, bx1, by1 = sh.box(c['bbox']); col = np.array(PROBE_COLOURS[(j*4 + 1) % 12])
        out[by0:by1, bx0:bx1] = col
        legend.append('chip %-12s %s' % (n, _cname((j*4 + 1) % 12)))
    os.makedirs(a.out, exist_ok=True)
    name = 'helmet_%s.tga' % a.id if a.id else 'helmet_probe.tga'
    save_tga(out, os.path.join(a.out, name))
    render_preview(out, a.guides, os.path.join(a.out, 'probe_preview.png'))
    open(os.path.join(a.out, 'probe_legend.txt'), 'w').write(PROBE_HELP + '\n'.join(legend) + '\n')
    print('\n'.join(legend)); print('wrote', os.path.join(a.out, name))

def _ink_for(col):
    lum = 0.2126*col[0] + 0.7152*col[1] + 0.0722*col[2]
    return np.array([0., 0., 0.]) if lum > 140 else np.array([255., 255., 255.])

def _cname(i):
    return ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink', 'brown', 'grey', 'white', 'black'][i]

PROBE_HELP = """Helmet orientation probe.
Install it as the helmet for one car (Documents/iRacing/paint/<car>/helmet_<id>.tga), sit in the car,
and look at the driver from outside (replay camera, or the garage). For each of: helmet left side,
right side, brow (above the visor), chin, crown, back - write down the letter you see and how it
reads: upright, upside down, turned left/right, or mirrored. The arrow after each letter points to
the top of the sheet. That is enough to set every anchor's rot in islands.json.

"""

# --- build ------------------------------------------------------------------------------------

def cmd_build(a):
    spec = json.load(open(a.spec))
    root = os.path.dirname(os.path.abspath(a.spec))
    p = lambda f: f if os.path.isabs(f) else os.path.join(root, f)
    sh = Sheet(p(spec['guides']), spec.get('size', 2048))
    out = sh.base.copy()
    # 1. flat colours. 'background' covers the whole sheet, small unnamed islands included;
    # 'keep' restores the template's pixels for an island (the visor tint, the belt labels)
    if 'background' in spec: out[:] = rgb(spec['background'])
    for n, col in spec.get('fill', {}).items():
        out[sh.mask[n]] = sh.base[sh.mask[n]] if col == 'keep' else rgb(col)
    for n, col in spec.get('chips', {}).items():
        x0, y0, x1, y1 = sh.box(MAP['chips'][n]['bbox']); out[y0:y1, x0:x1] = rgb(col)
    # 2. an art field across one or more islands (the shard field), in one colour
    for fld in spec.get('fields', []):
        cov = ink_from_image(p(fld['image']), fld.get('mode', 'luma'), fld.get('invert', False))
        ys_, xs_ = np.where(cov > 0.05)                 # fit the ink, not the canvas around it
        if len(xs_): cov = cov[ys_.min():ys_.max()+1, xs_.min():xs_.max()+1]
        im = Image.fromarray((cov*255).astype(np.uint8))
        if fld.get('flip'): im = im.transpose(Image.FLIP_LEFT_RIGHT)
        if fld.get('rot'): im = im.rotate(fld['rot'], Image.BICUBIC, expand=True)
        regions = fld.get('regions', ['shell'])
        m = np.zeros((sh.N, sh.N), bool)
        for n in regions: m |= sh.mask[n]
        ys, xs = np.where(m)
        bw, bh = xs.max()-xs.min()+1, ys.max()-ys.min()+1
        s = max(bw/im.width, bh/im.height) * fld.get('scale', 1.08)     # cover, with overrun
        im = im.resize((int(im.width*s), int(im.height*s)), Image.LANCZOS)
        ox, oy = [int(v*sh.k) for v in fld.get('offset', (0, 0))]
        canvas = Image.new('L', (sh.N, sh.N), 0)
        canvas.paste(im, (int((xs.min()+xs.max())/2 - im.width/2) + ox, int((ys.min()+ys.max())/2 - im.height/2) + oy))
        c = np.asarray(canvas).astype(float)/255 * m * fld.get('opacity', 1.0)
        out = out*(1-c[..., None]) + rgb(fld['color'])*c[..., None]
    # 3. marks: art or text at a named anchor, clipped to the island under it
    for mk in spec.get('marks', []):
        cx, cy, rot, max_w = sh.anchor(mk['anchor'])
        rot = mk.get('rot', rot)
        cov = text_cov(mk['text'], 200) if 'text' in mk else ink_from_image(p(mk['image']), mk.get('mode', 'luma'), mk.get('invert', False))
        w = mk.get('width', 1.0) * max_w
        placed = stamp(cov, sh, cx + mk.get('dx', 0)*sh.k, cy + mk.get('dy', 0)*sh.k, rot, w,
                       mk['height']*sh.k if 'height' in mk else None)
        clip = sh.mask[mk.get('island', _island_at(sh, cx, cy))]
        lost = (placed * ~clip).sum() / max(placed.sum(), 1)
        if lost > 0.01: print('  warning: %s at %s loses %.0f%% of its ink to the island edge' % (mk.get('text', os.path.basename(mk.get('image', ''))), mk['anchor'], 100*lost))
        placed *= clip
        out = out*(1-placed[..., None]) + rgb(mk['color'])*placed[..., None]
    save_tga(out, a.out)
    if a.preview: render_preview(out, p(spec['guides']), a.preview)
    print('wrote %s  (%dx%d, 24-bit)' % (a.out, sh.N, sh.N))

def _island_at(sh, x, y):
    for n, m in sh.mask.items():
        if m[int(y), int(x)]: return n
    return 'shell'

# --- preview ----------------------------------------------------------------------------------

def render_preview(arr, guides, out, size=1024):
    """The paint with the wireframe over it at low opacity, at 1024 for eyeballing."""
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).resize((size, size), Image.LANCZOS).convert('RGBA')
    wire = Image.open(os.path.join(guides, 'g_Wire.png')).convert('RGBA').resize((size, size))
    w = np.array(wire); w[..., 3] = (w[..., 3] * 0.25).astype(np.uint8)
    im.alpha_composite(Image.fromarray(w))
    im.convert('RGB').save(out)

def cmd_preview(a):
    render_preview(np.array(Image.open(a.tga).convert('RGB')).astype(float), a.guides, a.out)
    print('wrote', a.out)

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest='cmd', required=True)
    t = sp.add_parser('template', help='download helmet.zip and extract the guides')
    t.add_argument('--out', required=True); t.add_argument('--psd', help='use this Helmet.psd instead of downloading')
    t.add_argument('--patterns', action='store_true', help="also render iRacing's 69 built-in patterns")
    pr = sp.add_parser('probe', help='write an orientation test helmet')
    pr.add_argument('--guides', required=True); pr.add_argument('--out', required=True)
    pr.add_argument('--id', help='name it helmet_<id>.tga, ready to drop into a car folder')
    pr.add_argument('--size', type=int, default=1024)
    b = sp.add_parser('build', help='compose a helmet from a JSON spec')
    b.add_argument('spec'); b.add_argument('--out', required=True); b.add_argument('--preview')
    v = sp.add_parser('preview', help='render a helmet TGA over the wireframe')
    v.add_argument('tga'); v.add_argument('--guides', required=True); v.add_argument('--out', required=True)
    a = ap.parse_args()
    {'template': cmd_template, 'probe': cmd_probe, 'build': cmd_build, 'preview': cmd_preview}[a.cmd](a)

if __name__ == '__main__':
    main()
