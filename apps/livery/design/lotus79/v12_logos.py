"""Adds the white DOOOOM SPEEDSPORTS lockup to a v11 shatter livery.

Nose: reads to someone in front of the car (letter tops toward the tail, rot 270).
Wing: reads from behind (tops toward the nose, rot 90), on the wing's TOP face only - the
underside has its own map, so a wing_top-only placer keeps it off the bottom.
"""
import sys, numpy as np
sys.path.insert(0, '/Volumes/Claude/prodrive-agents-worktrees/lotus-79-livery-2d6f42/skills/iracing-livery-placement/scripts')
import livery_uv as lu
from PIL import Image, PngImagePlugin
PngImagePlugin.MAX_TEXT_CHUNK = 1 << 30

SRC = sys.argv[1]; OUT = sys.argv[2]
TOP = '51,63,61,56,62,66,46,50,78,70,30,31,34,94,96,87,41,91'
C, SZ = 1258, 2400
WHITE = np.array([238, 238, 238], float)
LOGO_ROUGH = 22.0                                   # gloss, matching the shards

isl = np.load('isl.npy')
P_nose = lu.Placer('art_doooom.png', TOP, car_size=SZ, center=C)
P_wing = lu.Placer('art_doooom.png', TOP, extra='wing_top.json', car_size=SZ, center=C)
# underside map samples the art mirrored across the centreline, so it reads right from below
P_under = lu.Placer('art_doooom.png', TOP, extra='wing_bottom.json', car_size=SZ, center=C)

def clean(img, lo=0.35):
    a = np.clip((np.asarray(img).astype(float)/255 - lo)/0.30, 0, 1)
    ys, xs = np.where(a > 0.5)
    return Image.fromarray((a[ys.min():ys.max()+1, xs.min():xs.max()+1]*255).astype(np.uint8))
LOCK = clean(Image.open('ai_ps600.png').convert('L'))

def stamp(canvas, img, cx, cy, w, rot):
    h = img.size[1]*w/img.size[0]
    im = img.resize((int(w), max(1, int(h))), Image.LANCZOS).rotate(rot, resample=Image.BICUBIC, expand=True)
    a = np.asarray(im).astype(float)/255; hh, ww = a.shape
    x0, y0 = int(cx-ww/2), int(cy-hh/2)
    canvas[y0:y0+hh, x0:x0+ww] = np.maximum(canvas[y0:y0+hh, x0:x0+ww], a)

nose_car = np.zeros((SZ, SZ)); stamp(nose_car, LOCK, 470, C, 380, 270)     # across the nose
top_car = np.zeros((SZ, SZ)); stamp(top_car, LOCK, 2055, C, 430, 90)       # wing top, reads from behind
# The underside map mirrors laterally, which flipped the lockup on the car. Rotating the other way
# corrects it, and it sits nearer the leading edge so a car behind on the grid can read DOOOOM.
under_car = np.zeros((SZ, SZ)); stamp(under_car, LOCK, 2012, C, 430, 270)
wing_mask = np.maximum(P_wing.uv(top_car), P_under.uv(under_car)) * np.isin(isl, [1])
mask = np.clip(np.maximum(P_nose.uv(nose_car) * np.isin(isl, [51]), wing_mask), 0, 1)

paint = np.array(Image.open(SRC + 'car_DOOOOM.tga').convert('RGB')).astype(float)
spec = np.array(Image.open(SRC + 'car_spec_DOOOOM.tga').convert('RGB')).astype(float)
m = mask[..., None]
paint = paint*(1-m) + WHITE*m
spec[..., 1] = spec[..., 1]*(1-mask) + LOGO_ROUGH*mask
Image.fromarray(paint.round().astype(np.uint8)).save(OUT + 'car_DOOOOM.tga')
Image.fromarray(spec.round().astype(np.uint8)).save(OUT + 'car_spec_DOOOOM.tga')
n = (P_nose.uv(nose_car)*np.isin(isl, [51]) > .5).sum()
w = (P_wing.uv(top_car)*np.isin(isl, [1]) > .5).sum()
u = (P_under.uv(under_car)*np.isin(isl, [1]) > .5).sum()
print('%s -> nose %d, wing top %d, wing underside %d' % (OUT.split('/')[-2], n, w, u))
