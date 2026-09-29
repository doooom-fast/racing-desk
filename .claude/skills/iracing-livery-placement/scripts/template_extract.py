#!/usr/bin/env python3
"""Pull everything a build needs out of a template PSD, without Photoshop.

    template_extract.py "/path/Car.psd" --out work/

Writes the guide layers as PNGs (g_Wire, g_Mask, g_Number_Blocks, ...) and spec_default.png.

psd-tools cannot reproduce the spec map in one composite, because the template restricts each
channel group to a single channel through Advanced Blending, which it does not implement. Each
channel group is therefore composited on its own and assembled into R/G/B here, which matches
Photoshop's own export to within a rounding step.
"""
import argparse, os, re, sys
import numpy as np
import psd_tools
from PIL import Image

GUIDES = ('wire', 'mask', 'number', 'sponsor', 'mandatory', 'pitbox', 'cockpit', 'decal', 'scheme', 'base')

def slug(name): return re.sub(r'\W+', '_', name).strip('_')

def solo(psd, keep):
    """Show only `keep` and its ancestors. The target's own subtree is left alone: hiding a
    group's children composites it empty, and an empty document composites to white."""
    def contains(group, target):
        return any(l is target or (l.is_group() and contains(l, target)) for l in group)
    def walk(node):
        for l in node:
            if l is keep:
                l.visible = True                      # subtree keeps its own visibility
            elif l.is_group() and contains(l, keep):
                l.visible = True; walk(l)
            else:
                l.visible = False
    walk(psd)

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('psd'); ap.add_argument('--out', default='.')
    ap.add_argument('--patterns', action='store_true', help='also export the built-in paint patterns')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    psd = psd_tools.PSDImage.open(a.psd)
    print('%s  %dx%d' % (os.path.basename(a.psd), psd.width, psd.height))

    def flat_layers(node, depth=0):
        for l in node:
            yield l, depth
            if l.is_group(): yield from flat_layers(l, depth+1)

    spec_group = None
    for l, _ in flat_layers(psd):
        if l.is_group() and 'spec' in l.name.lower(): spec_group = l

    wrote = 0
    for l, _ in flat_layers(psd):
        low = l.name.lower()
        if l.is_group():
            if a.patterns and 'pattern' in low:
                for sub in l:
                    solo(psd, sub)
                    psd.composite(force=True).save(os.path.join(a.out, 'grp_%s__%s.png' % (slug(l.name), slug(sub.name))))
                    wrote += 1
            continue
        if spec_group is not None and any(l is x for x, _ in flat_layers(spec_group)): continue
        if not any(k in low for k in GUIDES): continue
        solo(psd, l)
        psd.composite(force=True).save(os.path.join(a.out, 'g_%s.png' % slug(l.name)))
        wrote += 1
        print('  g_%s.png' % slug(l.name))

    if spec_group is not None:
        out = np.zeros((psd.height, psd.width, 3), np.uint8)
        for g in spec_group:
            idx = next((i for i, k in enumerate(('red', 'green', 'blue')) if k in g.name.lower()), None)
            if idx is None: continue
            solo(psd, g)
            out[..., idx] = np.array(psd.composite(force=True).convert('L'))
            print('  spec %s -> channel %d' % (g.name, idx))
        Image.fromarray(out).save(os.path.join(a.out, 'spec_default.png'))
        wrote += 1
    print('wrote %d file(s) to %s' % (wrote, a.out))

if __name__ == '__main__':
    sys.exit(main())
