"""Shatter livery for any car: the shatter art over the whole sheet, plus that car's logo layers.

Cars whose templates are packed panels (Nissan, MX-5) have no car-space band to map through, so
the art is laid across the UV sheet itself. For an abstract shard field that reads fine; seam
continuity only matters for lettering.

  shatter_livery.py <workdir> <out dir> <spec png> <body r,g,b> <art r,g,b> <layer glob> [--flip]
                    [--exclude a,b] [--chips x0,x1,y0,y1;...]
                    [--exclude substr,substr]
"""
import sys, glob, numpy as np
from PIL import Image, PngImagePlugin
PngImagePlugin.MAX_TEXT_CHUNK = 1 << 30

work, out, specpng, body, art, layerglob = sys.argv[1:7]
flip = '--flip' in sys.argv
excl = []
for i, a_ in enumerate(sys.argv):
    if a_ == '--exclude' and i + 1 < len(sys.argv): excl = sys.argv[i+1].split(',')
BODY = np.array([float(v) for v in body.split(',')])
ART = np.array([float(v) for v in art.split(',')])
WHITE = np.array([238., 238., 238.])
BODY_ROUGH, ART_ROUGH, LOGO_ROUGH = 255., 22., 22.

src = np.array(Image.open('/Volumes/Claude/doooom/doooom-shatter-out/shatter_src_raster.png').convert('RGBA')).astype(float)/255
alpha = np.clip(src[..., 3] * (1.0 - src[..., :3].mean(2)) * 1.15, 0, 1)   # dark shard = opaque
im = Image.fromarray((alpha*255).astype(np.uint8))
if flip: im = im.transpose(Image.FLIP_LEFT_RIGHT)

spec_tpl = np.array(Image.open(specpng).convert('RGB')).astype(float)
N = spec_tpl.shape[0]
# cover the sheet, overrunning it so no edge is bare
scale = max(N*1.12/im.size[0], N*1.12/im.size[1])
im = im.resize((int(im.size[0]*scale), int(im.size[1]*scale)), Image.LANCZOS)
a = np.zeros((N, N))
ox, oy = (im.size[0]-N)//2, (im.size[1]-N)//2
a[:, :] = np.asarray(im).astype(float)[oy:oy+N, ox:ox+N]/255

paint = BODY*(1-a[..., None]) + ART*a[..., None]
rough = BODY_ROUGH*(1-a) + ART_ROUGH*a

logos = np.zeros((N, N))
for f in sorted(glob.glob(work + '/' + layerglob)):
    if any(e and e in f for e in excl): continue
    m = np.array(Image.open(f).convert('RGBA'))[..., 3]
    if m.shape[0] != N: continue
    logos = np.maximum(logos, m.astype(float)/255)
lm = logos[..., None]
paint = paint*(1-lm) + WHITE*lm
rough = rough*(1-logos) + LOGO_ROUGH*logos

# colour-sampling patches (pit box, cockpit): give them the art colour, not the paint
chips = []
for i, a_ in enumerate(sys.argv):
    if a_ == '--chips' and i + 1 < len(sys.argv):
        chips = [tuple(int(v) for v in g.split(',')) for g in sys.argv[i+1].split(';')]
for (x0, x1, y0, y1) in chips: paint[y0:y1, x0:x1] = ART
if chips: print('  %d colour patch(es) set to the art colour %s' % (len(chips), ART.astype(int).tolist()))

spec = spec_tpl.copy(); spec[..., 1] = rough
Image.fromarray(paint.round().astype(np.uint8)).save(out + '/car_DOOOOM.tga')
Image.fromarray(spec.round().astype(np.uint8)).save(out + '/car_spec_DOOOOM.tga')
print('%-26s art covers %.1f%% | logos %.1f%% | body %s' % (out.split('/')[-2], 100*(a > .04).mean(), 100*(logos > .5).mean(), BODY.astype(int).tolist()))
