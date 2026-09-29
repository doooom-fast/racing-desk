"""Lotus 79 v11: the shatter artwork laid over the WHOLE car.

Darkness in the source drives orange opacity (dark shard = solid orange, pale shard = a hint of
it over black). Body is matte black, the art is gloss, so the shards catch light and the car
does not. The art is scaled to overrun the car's extents slightly, and it reaches every paintable
island - flanks, wings, small parts - not just the top band.
"""
import sys, numpy as np
sys.path.insert(0, '/Volumes/Claude/prodrive-agents-worktrees/lotus-79-livery-2d6f42/skills/iracing-livery-placement/scripts')
import livery_uv as lu
from PIL import Image, PngImagePlugin
PngImagePlugin.MAX_TEXT_CHUNK = 1 << 30

TOP = '51,63,61,56,62,66,46,50,78,70,30,31,34,94,96,87,41,91'
C, SZ = 1258, 2400
ORANGE = np.array([10, 10, 10], float)      # inverted: shards are black
BODY = np.array([220, 55, 20], float)       # inverted: body is orange
BODY_ROUGH, ART_ROUGH = 255.0, 22.0          # matte car, glossy shards

P = lu.Placer('art_doooom.png', TOP, extra='wing_maps.json', car_size=SZ, center=C, fallback='g_Mask.png')

src = np.array(Image.open('/Volumes/Claude/doooom/doooom-shatter-out/shatter_src_raster.png').convert('RGBA')).astype(float)/255
alpha_src = src[..., 3] * (1.0 - src[..., :3].mean(2))        # dark = opaque, light = faint
alpha_src = np.clip(alpha_src * 1.15, 0, 1)                    # a touch more presence overall

# cover the car: length 0..2200 in car space, lateral C +/- 600, art overruns both
art = Image.fromarray((alpha_src*255).astype(np.uint8))
W_CAR, H_CAR = 2320, 1225
art = art.resize((W_CAR, H_CAR), Image.LANCZOS).transpose(Image.FLIP_LEFT_RIGHT)  # dense end at the TAIL
car = np.zeros((SZ, SZ), float)
x0, y0 = 40, C - H_CAR//2
car[y0:y0+H_CAR, x0:x0+W_CAR] = np.asarray(art).astype(float)/255

a = np.clip(P.uv(car), 0, 1)[..., None]                        # alpha in UV space, whole car
paint = BODY*(1-a) + ORANGE*a
rough = BODY_ROUGH*(1-a[..., 0]) + ART_ROUGH*a[..., 0]

spec_tpl = np.array(Image.open('spec_default.png').convert('RGB')).astype(float)
spec = spec_tpl.copy(); spec[..., 1] = rough                   # keep template metallic/clearcoat

out = '/Volumes/Claude/doooom/lotus79-livery/v14_inverted_base/'
Image.fromarray(paint.round().astype(np.uint8)).save(out+'car_DOOOOM.tga')
Image.fromarray(spec.round().astype(np.uint8)).save(out+'car_spec_DOOOOM.tga')
np.save('v14_alpha.npy', a[..., 0])
cover = (a[..., 0] > 0.04)
print('art covers %.1f%% of the sheet; islands touched %d' % (100*cover.mean(), len(set(np.load('isl.npy')[cover].tolist()))))
print('paint: body %s  most-opaque shard %s' % (paint[5,5].round().astype(int).tolist(), paint[cover].max(0).round().astype(int).tolist()))
