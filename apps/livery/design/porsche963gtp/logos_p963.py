"""Porsche 963 GTP logo pass.

Panels read from iRacing's own Penske scheme (car_pattern_001). Islands 22/103 are the flanks and
37/91 the upper body halves; each pair is a vertical flip of the other (IoU 0.997), so a feature at
(x, y) on the car-left island sits at (x, 2214-y) on the car-right one, with the art itself turned
180 - which is exactly how the stock PENSKE and HELLER decals are laid out. Island 84 is the rear
wing plane wearing PORSCHE along its length, 85 its lower face; both read with the art turned 270,
which is what puts DOOOOM across the back of the car.

Placements come from a largest-clear-rectangle fit per panel, so nothing is clipped by an island
edge. Number blocks are hard constraints - the sim stamps numbers over paint - so nothing is placed
on them. Sponsor blocks are only suggestions and can be painted over.
"""
import numpy as np
from PIL import Image, PngImagePlugin
PngImagePlugin.MAX_TEXT_CHUNK = 1 << 30
SZ = 2048
isl = np.load('isl.npy')
FLIP = 2214          # y + y' for both mirrored island pairs

def clean(img, lo=0.35):
    a = np.clip((np.asarray(img).astype(float)/255 - lo)/0.30, 0, 1)
    ys, xs = np.where(a > 0.5)
    return Image.fromarray((a[ys.min():ys.max()+1, xs.min():xs.max()+1]*255).astype(np.uint8))
def load(n): return Image.open('logos/masks/%s.png' % n)
ART = clean(Image.open('art_doooom.png').convert('L'))
LOCK = clean(Image.open('ai_ps600.png').convert('L'))
SPEED = clean(Image.open('art_speedsports.png').convert('L'))

def blank(): return np.zeros((SZ, SZ))
def stamp(c, img, cx, cy, ids, w=None, h=None, rot=0):
    if w is None: w = img.size[0]*h/img.size[1]
    if h is None: h = img.size[1]*w/img.size[0]
    im = img.resize((max(1,int(w)), max(1,int(h))), Image.LANCZOS).rotate(rot, resample=Image.BICUBIC, expand=True)
    a = np.asarray(im).astype(float)/255; hh, ww = a.shape
    x0, y0 = int(cx-ww/2), int(cy-hh/2)
    patch = np.zeros_like(c)
    sx, sy, dx, dy = max(0,-x0), max(0,-y0), max(0,x0), max(0,y0)
    cw, ch = min(ww-sx, SZ-dx), min(hh-sy, SZ-dy)
    if cw <= 0 or ch <= 0: return 0, 0
    patch[dy:dy+ch, dx:dx+cw] = a[sy:sy+ch, sx:sx+cw]
    keep = np.isin(isl, ids); c[:] = np.maximum(c, patch*keep)
    return int(((patch*keep) > .5).sum()), int((patch > .5).sum())
def both(c, img, cx, cy, w, left, right):
    """One element on the car-left panel and its mirror on the car-right one."""
    a = stamp(c, img, cx, cy, left, w=w)
    b = stamp(c, img, cx, FLIP-cy, right, w=w, rot=180)
    return '%d/%d  %d/%d' % (a + b)
def save(c, n):
    r = np.zeros((SZ, SZ, 4), np.uint8); r[..., :3] = 255
    r[..., 3] = (np.clip(c,0,1)*255).astype(np.uint8); Image.fromarray(r).save(n)
    return int((c > .5).sum())

FLANK_L, FLANK_R = [103], [22]      # sidepod / door flanks
TOP_L, TOP_R = [91], [37]           # upper body halves, seamed to the flanks
WING, WING_U = [84], [85]           # rear wing plane and its lower face

# DOOOOM along both flanks
word = blank()
print('flank %s' % both(word, ART, 1417, 1960, 378, FLANK_L, FLANK_R))
print('wordmark', save(word, 'p963_1_word.png'))

# rear wing: DOOOOM across the plane and again underneath, so it reads from behind and below
rear = blank()
print('wing  %d/%d' % stamp(rear, ART, 63, 1711, WING, w=582, rot=270))
print('under %d/%d' % stamp(rear, ART, 223, 1711, WING_U, w=348, rot=270))
print('rear', save(rear, 'p963_2_rear.png'))

# the lockup on the top deck, ahead of the rear wing
nose = blank()
print('deck %s' % both(nose, LOCK, 1544, 1629, 334, TOP_L, TOP_R))
print('lockup', save(nose, 'p963_3_nose.png'))

# sponsor rows: metal bands on the top deck, sim gear along the flank
CAP, GAP = 46, 28
BANDS = [('death',56),('blood_incantation',34),('darkthrone',48),('primitiveman',26),('sunn',34)]
GEAR_A = [('yamaha',24),('brembo',20),('bbs',24),('heusinkveld',14),('cubecontrols',18)]
GEAR_B = [('moza',20),('simlab',17),('lg',24),('nvidia',18)]
def row(c, items, cx, cy, W, left, right):
    """A row fitted to W, laid out left to right, and mirrored so it still reads that way on the
    far side: each logo turned 180 and its x reflected about the row centre, which keeps the
    sequence in the same order rather than running it backwards."""
    nat = [load(n).size[0]*h/load(n).size[1] for n, h in items]
    s = (W - GAP*(len(items)-1)) / sum(nat)
    x = cx - W/2
    for (n, h), w in zip(items, nat):
        lx = x + w*s/2
        stamp(c, load(n), lx, cy, left, h=h*s)
        stamp(c, load(n), 2*cx-lx, FLIP-cy, right, h=h*s, rot=180)
        x += w*s + GAP*s
    return s
spon = blank()
print('bands  scale %.2f' % row(spon, BANDS, 1509, 1698, 396, TOP_L, TOP_R))
print('gear A scale %.2f' % row(spon, GEAR_A, 1422, 1878, 394, FLANK_L, FLANK_R))
print('gear B scale %.2f' % row(spon, GEAR_B, 1713, 1791, 320, FLANK_L, FLANK_R))
print('sponsors', save(spon, 'p963_5_spon.png'))
