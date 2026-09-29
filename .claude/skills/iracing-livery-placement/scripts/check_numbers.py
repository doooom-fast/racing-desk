#!/usr/bin/env python3
"""Fail a livery whose art sits where iRacing will draw the car number.

The sim renders numbers over the paint at the template's Number Block locations, so anything
placed there is hidden on the car even though the sheet looks right. Run this before shipping.

    check_numbers.py --blocks g_Number_Blocks.png --layers 'art_*.png'
    check_numbers.py --blocks 'grp_Number_Blocks__*.png' --layers 'zxt_*.png' --pad 8

Exit code 1 if any layer overlaps a block, so it can gate a build.
"""
import argparse, glob, sys
import numpy as np
from PIL import Image, PngImagePlugin
from scipy import ndimage as ndi
PngImagePlugin.MAX_TEXT_CHUNK = 1 << 30

def alpha(path):
    a = np.array(Image.open(path).convert('RGBA'))[..., 3]
    return a > 100

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--blocks', required=True, help='glob for the template Number Block layer(s)')
    ap.add_argument('--layers', required=True, help='glob for the art layer PNGs to test')
    ap.add_argument('--pad', type=int, default=6, help='dilate the blocks by this many px (numbers overflow their box)')
    a = ap.parse_args()

    blocks = None
    for f in sorted(glob.glob(a.blocks)):
        m = alpha(f); blocks = m if blocks is None else (blocks | m)
    if blocks is None: sys.exit('no number-block layer matched %s' % a.blocks)
    if a.pad: blocks = ndi.binary_dilation(blocks, iterations=a.pad)
    lab, n = ndi.label(blocks)
    boxes = [(s[1].start, s[1].stop, s[0].start, s[0].stop) for s in ndi.find_objects(lab)
             if (s[0].stop - s[0].start) * (s[1].stop - s[1].start) > 2000]
    print('number blocks: ' + ', '.join('x %d-%d y %d-%d' % b for b in boxes))

    bad = 0
    for f in sorted(glob.glob(a.layers)):
        m = alpha(f)
        if m.shape != blocks.shape:      # previews and thumbnails share the glob; only test sheets
            print('skip  %-34s (%dx%d, not a UV sheet)' % (f.split('/')[-1], m.shape[1], m.shape[0]))
            continue
        if not m.any(): continue
        hit = (m & blocks).sum()
        if hit:
            bad += 1
            ys, xs = np.where(m & blocks)
            print('CLASH %-34s %6d px under a number, around x %d-%d y %d-%d'
                  % (f.split('/')[-1], hit, xs.min(), xs.max(), ys.min(), ys.max()))
        else:
            print('ok    %-34s' % f.split('/')[-1])
    print('\n%d layer(s) clash with number blocks' % bad)
    sys.exit(1 if bad else 0)

if __name__ == '__main__':
    main()
