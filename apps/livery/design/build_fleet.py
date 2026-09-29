#!/usr/bin/env python3
"""Build the shatter livery pair for every extracted car in the fleet.

The shatter maps across the UV sheet, so it needs no per-car panel knowledge - the same treatment
lands on any template. Colour-sampling patches and number blocks are found from each car's own
extracted guides, so the two rules hold per car without hand-tuning.
"""
import glob, os, subprocess, sys
import numpy as np
from PIL import Image, PngImagePlugin
from scipy import ndimage as ndi
PngImagePlugin.MAX_TEXT_CHUNK = 1 << 30

B = '/Volumes/Claude/doooom'
SHATTER = os.path.join(B, 'shatter_livery.py')
ORANGE, BLACK = '220,55,20', '10,10,10'

def rects(work):
    """Colour-sampling patches this car declares."""
    out = []
    for f in glob.glob(os.path.join(work, 'g_*.png')):
        n = os.path.basename(f).lower()
        if not any(k in n for k in ('pitbox', 'cockpit_color')): continue
        a = np.array(Image.open(f).convert('RGBA'))[..., 3] > 100
        if not a.any(): continue
        lab, _ = ndi.label(a)
        for sl in ndi.find_objects(lab):
            if (sl[0].stop-sl[0].start)*(sl[1].stop-sl[1].start) < 40: continue
            out.append('%d,%d,%d,%d' % (sl[1].start, sl[1].stop, sl[0].start, sl[0].stop))
    return ';'.join(out)

def numbers(work):
    for f in glob.glob(os.path.join(work, 'g_*umber*.png')): return f
    return None

done = []
for work in sorted(glob.glob(os.path.join(B, 'fleet', '*', 'work'))):
    car = os.path.basename(os.path.dirname(work))
    if not os.path.exists(os.path.join(work, 'spec_default.png')):
        print('%-28s no spec map, skipped' % car); continue
    chips = rects(work)
    for mode, body, art in (('shatter', BLACK, ORANGE), ('shatter-inverted', ORANGE, BLACK)):
        out = os.path.join(B, 'fleet', car, mode); os.makedirs(out, exist_ok=True)
        cmd = [sys.executable, SHATTER, work, out, os.path.join(work, 'spec_default.png'), body, art, 'none_*.png']
        if chips: cmd += ['--chips', chips]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode: print('%-28s %-16s FAILED %s' % (car, mode, r.stderr.strip().splitlines()[-1][:60])); continue
    nb = numbers(work)
    done.append((car, chips.count(';')+1 if chips else 0, bool(nb)))
    print('%-28s built both, %d colour patch(es), number blocks %s' % (car, chips.count(';')+1 if chips else 0, 'found' if nb else 'none'))
print('\n%d cars' % len(done))
