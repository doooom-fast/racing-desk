#!/usr/bin/env python3
"""Keep the sim's colour-sampling patches on a deliberate colour: the body, or --accent for the art.

Templates carry small patches the sim reads a colour from rather than mapping onto the car: the
pit-box swatch in a corner, a cockpit-colour patch on some cars, and on others (the Dallara is the
documented case) single-pixel blocks in the top-left that set mirrors and wing undersides. Art laid
across the whole sheet can land on them, which tints things that are nowhere near the art.

    color_chips.py --find <template guide dir>              # locate a car's patches
    color_chips.py --check car.tga --rects 2026,2048,2026,2048
    color_chips.py --fix   car.tga --rects 2026,2048,2026,2048

Body colour is the sheet's most common colour, which on any sane livery is the paint.
"""
import argparse, glob, os, sys
import numpy as np
from PIL import Image, PngImagePlugin
from scipy import ndimage as ndi
PngImagePlugin.MAX_TEXT_CHUNK = 1 << 30

def find(dirname):
    """Patches a car's template declares, plus any tiny paintable island in the top-left."""
    out = []
    for f in sorted(glob.glob(os.path.join(dirname, 'g_*.png'))):
        n = os.path.basename(f)[2:-4].lower()
        if not any(k in n for k in ('pitbox', 'cockpit_color', 'cockpit color')): continue
        a = np.array(Image.open(f).convert('RGBA'))[..., 3] > 100
        if not a.any(): continue
        lab, _ = ndi.label(a)
        for sl in ndi.find_objects(lab):
            out.append((sl[1].start, sl[1].stop, sl[0].start, sl[0].stop, os.path.basename(f)[2:-4]))
    mask = os.path.join(dirname, 'g_Mask.png')
    if os.path.exists(mask):
        paint = np.array(Image.open(mask).convert('RGBA'))[..., 3] < 128
        lab, _ = ndi.label(paint)
        for sl in ndi.find_objects(lab):
            w, h = sl[1].stop - sl[1].start, sl[0].stop - sl[0].start
            if w <= 40 and h <= 40 and sl[1].start < 260 and sl[0].start < 260:
                out.append((sl[1].start, sl[1].stop, sl[0].start, sl[0].stop, 'top-left chip'))
    return out

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('tga', nargs='?'); ap.add_argument('--find'); ap.add_argument('--rects')
    ap.add_argument('--check', action='store_true'); ap.add_argument('--fix', action='store_true')
    ap.add_argument('--color', help='explicit r,g,b, when the heuristic picks a minor tone')
    ap.add_argument('--accent', action='store_true',
                    help='use the art colour (2nd most common) instead of the body colour')
    a = ap.parse_args()
    if a.find:
        r = find(a.find)
        print('\n'.join('x %4d-%4d y %4d-%4d  (%s)' % t for t in r) or 'no colour patches on this template')
        return 0
    if not (a.tga and a.rects): ap.error('need a .tga and --rects, or --find')
    rects = [tuple(int(v) for v in g.split(',')) for g in a.rects.split(';')]
    im = Image.open(a.tga).convert('RGB'); p = np.array(im)
    cols, counts = np.unique(p.reshape(-1, 3), axis=0, return_counts=True)
    order = counts.argsort()[::-1]
    body = cols[order[0]]
    if a.color:
        body = np.array([int(v) for v in a.color.split(',')], dtype=p.dtype)
    elif a.accent:                    # the shards' colour: second most common after the paint
        body = cols[order[1]]
        print('accent colour %s (%.1f%% of the sheet), paint is %s'
              % (body.tolist(), 100*counts[order[1]]/counts.sum(), cols[order[0]].tolist()))
    bad = 0
    for (x0, x1, y0, y1) in rects:
        reg = p[y0:y1, x0:x1]
        if not (reg == body).all():
            bad += 1
            print('MISMATCH x %d-%d y %d-%d: holds %s, body is %s'
                  % (x0, x1, y0, y1, np.unique(reg.reshape(-1, 3), axis=0)[0].tolist(), body.tolist()))
            if a.fix: p[y0:y1, x0:x1] = body
    if a.fix and bad:
        Image.fromarray(p).save(a.tga); print('set %d patch(es) to the body colour' % bad)
    print('%s: %d patch(es) checked, %d wrong' % (os.path.basename(a.tga), len(rects), bad))
    return 1 if (bad and not a.fix) else 0

if __name__ == '__main__':
    sys.exit(main())
