"""McLaren 720S GT3 logo pass.

Panels read from iRacing's own Pfaff scheme (car_pattern_001), where the sponsor text says which
way each island faces: on island 20 it reads upside down, on 78 upright, so 20 is the car's right
side rotated 180 on the sheet and 78 is the left, upright. Island 3 is the rear wing plane (the
big driveway.com panel), 12 its underside, 54 the bonnet carrying the number, 51 the rear flank.

Number blocks are hard constraints - the sim stamps numbers over paint - so nothing is placed on
them. Sponsor blocks are only suggestions and can be painted over.
"""
import numpy as np
from PIL import Image, PngImagePlugin
PngImagePlugin.MAX_TEXT_CHUNK = 1 << 30
SZ = 2048
isl = np.load('isl.npy')

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
def save(c, n):
    r = np.zeros((SZ, SZ, 4), np.uint8); r[..., :3] = 255
    r[..., 3] = (np.clip(c,0,1)*255).astype(np.uint8); Image.fromarray(r).save(n)
    return int((c > .5).sum())

R, L = [20], [78]            # car right (rotated on the sheet), car left (upright)
HOOD, WING, WING_U, FLANK = [54], [3], [12], [51]

# DOOOOM along each side, aft of the door number block at x 839-933
word = blank()
print('side R %d/%d' % stamp(word, ART, 1290, 700, R, w=680, rot=180))
print('side L %d/%d' % stamp(word, ART, 1290, 1712, L, w=680))
print('wordmark', save(word, '720s_1_word.png'))

# rear wing: DOOOOM across the plane and again underneath, so it reads from behind and below
rear = blank()
print('wing  %d/%d' % stamp(rear, ART, 330, 80, WING, w=600))
print('under %d/%d' % stamp(rear, ART, 330, 229, WING_U, w=600, rot=180))
print('rear', save(rear, '720s_2_rear.png'))

# bonnet: the lockup, clear of the number block at x 348-439 y 958-1062
nose = blank()
print('bonnet %d/%d' % stamp(nose, LOCK, 300, 1260, HOOD, w=300, rot=90))
print('nose', save(nose, '720s_3_nose.png'))

# SPEEDSPORTS on the rear flanks
ss = blank()
print('flank %d/%d' % stamp(ss, SPEED, 1903, 1200, FLANK, w=420, rot=90))
print('speedsports', save(ss, '720s_4_speed.png'))

# sponsor rows: bands high on the side, sim gear along the sill, both ending short of the number
CAP, GAP = 46, 28
BANDS = [('death',56),('blood_incantation',34),('darkthrone',48),('primitiveman',26),('sunn',34)]
GEAR_A = [('yamaha',24),('brembo',20),('bbs',24),('heusinkveld',14),('cubecontrols',18)]
GEAR_B = [('moza',20),('simlab',17),('lg',24),('nvidia',18)]
def row(c, items, anchor, cy, rot, ids):
    ws = [load(n).size[0]*h/load(n).size[1] for n, h in items]
    x = anchor; xs = []
    for w in reversed(ws): xs.insert(0, x-w/2); x -= w+GAP
    for (n, h), cx in zip(items, xs): stamp(c, load(n), cx, cy, ids, h=h, rot=rot)
    return xs[0]-ws[0]/2
spon = blank()
print('bands R from x=%d' % row(spon, BANDS, 1640, 540, 180, R))
print('bands L from x=%d' % row(spon, BANDS, 1640, 1872, 0, L))
print('gear A R from x=%d' % row(spon, GEAR_A, 1560, 845, 180, R))
print('gear B R from x=%d' % row(spon, GEAR_B, 1560, 900, 180, R))
print('gear A L from x=%d' % row(spon, GEAR_A, 1560, 1567, 0, L))
print('gear B L from x=%d' % row(spon, GEAR_B, 1560, 1512, 0, L))
print('sponsors', save(spon, '720s_5_spon.png'))
