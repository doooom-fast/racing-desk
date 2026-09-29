#!/usr/bin/env python3
"""Build a livery's paint + spec TGAs from layer PNGs. No Photoshop.

    build_livery.py config.json

Config is the same shape the Photoshop builder used:

    { "spec": "work/spec_default.png",        # from template_extract.py
      "out": "/dir/", "name": "DOOOOM", "base": [10,10,10],
      "underlay": ["work/g_car_decal.png"],   # template art to keep (stock decals, banners)
      "layers": [ {"png": "...", "color": [r,g,b], "rough": 255|null, "name": "..."} ],
      "chips": [[x0,x1,y0,y1], ...],          # colour-sampling patches, optional
      "chip_color": "accent" | [r,g,b],       # default: accent (the art colour)
      "number_blocks": "work/g_Number_Blocks.png" }   # optional, fails the build on a clash

Layers composite bottom to top with their own alpha, so soft edges and partial opacity survive -
which the Photoshop path could not do with flat fills. `rough` writes the spec map's green
channel; null leaves the template's own roughness.
"""
import json, os, sys
import numpy as np
from PIL import Image, PngImagePlugin
PngImagePlugin.MAX_TEXT_CHUNK = 1 << 30

def alpha_of(path):
    im = Image.open(path)
    a = np.array(im.convert('RGBA'))[..., 3].astype(float)/255
    return a

def main(cfg_path):
    cfg = json.load(open(cfg_path))
    out = cfg['out']; os.makedirs(out, exist_ok=True)
    spec_tpl = np.array(Image.open(cfg['spec']).convert('RGB')).astype(float)
    N = spec_tpl.shape[0]
    paint = np.zeros((N, N, 3), float); paint[:] = np.array(cfg['base'], float)
    rough = spec_tpl[..., 1].copy()

    for u in cfg.get('underlay') or []:            # template's own art, kept beneath ours
        im = np.array(Image.open(u).convert('RGBA')).astype(float)/255
        if im.shape[0] != N: continue
        m = im[..., 3:4]
        paint = paint*(1-m) + im[..., :3]*255*m
        print('  underlay %-35s %5.2f%%' % (os.path.basename(u)[:35], 100*(im[..., 3] > .5).mean()))

    for L in cfg['layers']:
        a = alpha_of(L['png'])
        if a.shape[0] != N:
            print('  skip %s (%dpx, sheet is %d)' % (L.get('name', L['png']), a.shape[0], N)); continue
        m = a[..., None]
        paint = paint*(1-m) + np.array(L['color'], float)*m
        if L.get('rough') is not None:
            rough = rough*(1-a) + float(L['rough'])*a
        print('  %-44s %5.2f%% of the sheet' % (L.get('name', '')[:44], 100*(a > .5).mean()))

    spec = spec_tpl.copy(); spec[..., 1] = rough

    chips = cfg.get('chips') or []
    if chips:
        cols, counts = np.unique(paint.round().astype(np.uint8).reshape(-1, 3), axis=0, return_counts=True)
        order = counts.argsort()[::-1]
        want = cfg.get('chip_color', 'accent')
        col = np.array(want, float) if isinstance(want, (list, tuple)) else cols[order[1 if want == 'accent' else 0]].astype(float)
        for (x0, x1, y0, y1) in chips: paint[y0:y1, x0:x1] = col
        print('  colour patches set to %s' % col.astype(int).tolist())

    nb = cfg.get('number_blocks')
    if nb and os.path.exists(nb):
        blocks = np.array(Image.open(nb).convert('RGBA'))[..., 3] > 100
        art = np.zeros((N, N), bool)
        for L in cfg['layers']:
            a = alpha_of(L['png'])
            if a.shape[0] == N: art |= a > .5
        hit = int((art & blocks).sum())
        print('  pixels under a number block: %d' % hit)
        if hit: print('  WARNING: art there is invisible on the car - the sim draws numbers over the paint')

    Image.fromarray(paint.round().astype(np.uint8)).save(os.path.join(out, 'car_%s.tga' % cfg['name']))
    Image.fromarray(spec.round().astype(np.uint8)).save(os.path.join(out, 'car_spec_%s.tga' % cfg['name']))
    print('wrote car_%s.tga + spec to %s' % (cfg['name'], out))

if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
