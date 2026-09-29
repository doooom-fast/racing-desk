"""Nissan GTP ZX-T livery: the Lotus 'Ring Dissolve' language, re-laid for this car.

The ZX-T template is NOT a top-down unwrap - it is separate panels packed on the sheet - so every
element is placed on a named panel and clipped to it. Panel identity and orientation come from
iRacing's own historic pattern (car_pattern_001), which carries readable NISSAN / GOODYEAR text:

  52        front bodywork, nose at low x, centreline y=1025, symmetric (Bosch/Goodyear mirrored)
  6 / 134   large side panels; 6 is rotated 180 on the sheet (Goodyear reads upside down), 134 upright
  38 / 139  long side strips carrying NISSAN; 38 rotated 180, 139 upright
  55 / 111  number panels (the number blocks sit here), 55 rotated 180, 111 upright
  152       rear wing plane (NISSAN upside down -> rotated 180)
"""
import numpy as np
from PIL import Image, ImageDraw, PngImagePlugin
PngImagePlugin.MAX_TEXT_CHUNK = 1 << 30
SZ = 2048
isl = np.load('isl.npy')

def clean(img, lo=0.35):
    a = np.clip((np.asarray(img).astype(float)/255 - lo)/0.30, 0, 1)
    return Image.fromarray((a*255).astype(np.uint8))

def mask_of(path):
    im = Image.open(path); rgba = np.array(im.convert('RGBA')).astype(float)/255
    a, lum = rgba[..., 3], rgba[..., :3].mean(2)
    if a.min() < 0.5: m = a
    elif lum[[0, -1], :].mean() > 0.5: m = np.clip((1 - rgba[..., :3].min(2))/0.45, 0, 1)
    else: m = np.clip((lum - 0.35)/0.30, 0, 1)
    ys, xs = np.where(m > 0.5)
    return Image.fromarray((m[ys.min():ys.max()+1, xs.min():xs.max()+1]*255).astype(np.uint8))

ART = clean(Image.open('art_doooom.png').convert('L'))
RING = ART.crop((1180, 0, 1630, 519)); RING = RING.crop(RING.getbbox())
FRINGE = ART.crop((300, 395, 2000, 519)); FRINGE = FRINGE.crop(FRINGE.getbbox())
SPEED = clean(Image.open('art_speedsports.png').convert('L'))
LOCK = mask_of('ai_ps600.png')
DEATH = mask_of('/Volumes/Claude/doooom/art/Death_logo.png')
BLOOD = mask_of('/Volumes/Claude/doooom/art/blood_incantation.jpg')
LIQ = mask_of('liquiddeath.png'); CISCO = mask_of('cisco.svg.png'); SUNN = mask_of('sunn.png')

def blank(): return np.zeros((SZ, SZ), float)
def stamp(canvas, img, cx, cy, ids, w=None, h=None, rot=0):
    if w is None: w = img.size[0]*h/img.size[1]
    if h is None: h = img.size[1]*w/img.size[0]
    im = img.resize((max(1, int(w)), max(1, int(h))), Image.LANCZOS).rotate(rot, resample=Image.BICUBIC, expand=True)
    a = np.asarray(im).astype(float)/255
    hh, ww = a.shape; x0, y0 = int(cx-ww/2), int(cy-hh/2)
    patch = np.zeros_like(canvas)
    sx, sy, dx, dy = max(0, -x0), max(0, -y0), max(0, x0), max(0, y0)
    cw, ch = min(ww-sx, SZ-dx), min(hh-sy, SZ-dy)
    if cw <= 0 or ch <= 0: return 0, 0
    patch[dy:dy+ch, dx:dx+cw] = a[sy:sy+ch, sx:sx+cw]
    keep = np.isin(isl, ids)
    canvas[:] = np.maximum(canvas, patch*keep)
    return int(((patch*keep) > .5).sum()), int((patch > .5).sum())
def poly(canvas, pts, ids):
    im = Image.new('L', (SZ, SZ), 0); ImageDraw.Draw(im).polygon(pts, fill=255)
    canvas[:] = np.maximum(canvas, (np.asarray(im).astype(float)/255)*np.isin(isl, ids))
def save(c, name):
    rgba = np.zeros((SZ, SZ, 4), np.uint8); rgba[..., :3] = 255
    rgba[..., 3] = (np.clip(c, 0, 1)*255).astype(np.uint8); Image.fromarray(rgba).save(name)
    return int((c > .5).sum())

FRONT, CY = [52], 1025                       # front bodywork + its centreline
SIDE_R, SIDE_L = [6], [134]                  # large side panels (R rotated 180 on the sheet)
STRIP_R, STRIP_L = [38], [139]               # long side strips
NUM_R, NUM_L = [55], [111]                   # number panels
WING = [152]

# 1 nose chevrons, three tones, pointing forward (-x)
for i, (off, span) in enumerate(((0, 300), (62, 265), (120, 232))):
    ch = blank(); x = 60 + off
    poly(ch, [(x, CY-span), (x+52, CY-span), (x+132, CY), (x+52, CY+span), (x, CY+span), (x+80, CY)], FRONT)
    print('chevron%d' % i, save(ch, 'zxt_2_chevron%d.png' % i))

# 2 nose lockup, reads from in front of the car (tops toward the tail = rot 270)
nose = blank(); print('nose lockup %d/%d' % stamp(nose, LOCK, 300, CY, FRONT, w=560, rot=270)); save(nose, 'zxt_9_nose.png')

# 3 ring dissolve across the front bodywork, shrinking rearward, two tones
da, db = blank(), blank()
for i, (x, r) in enumerate(zip((300, 400), (300, 230))):
    for s in (-1, 1): stamp(da if i % 2 == 0 else db, RING, x, CY + s*300, FRONT, w=r, h=r)
for i, (dx, r) in enumerate(zip((300, 215, 145), (230, 175, 130))):     # trailing the wordmark
    stamp(da if i % 2 == 0 else db, RING, 1603 - dx, 430, SIDE_R, w=r, h=r)
    stamp(da if i % 2 == 0 else db, RING, 1598 + dx, 1614, SIDE_L, w=r, h=r)
print('dissolve A', save(da, 'zxt_4_dissolveA.png'), 'B', save(db, 'zxt_4_dissolveB.png'))

# 4 DOOOOM wordmark on both big side panels, each reading for its own side
word = blank()
print('wordmark R %d/%d' % stamp(word, ART, 1603, 275, SIDE_R, w=470, rot=180))
print('wordmark L %d/%d' % stamp(word, ART, 1598, 1769, SIDE_L, w=470))
save(word, 'zxt_6_wordmark.png')

# 5 SPEEDSPORTS on the number panels, clear of the number block
ss = blank()
# clear of the number blocks (x 931-1103): the sim draws numbers over the paint
stamp(ss, SPEED, 860, 860, NUM_R, w=230, rot=180); stamp(ss, SPEED, 1120, 1430, NUM_L, w=230)
print('speedsports', save(ss, 'zxt_7_speedsports.png'))

# 6 sponsor list along the side strips: one cap height, one gap, anchored at the rear
CAP, GAP = 42, 46
ROW = [(DEATH, 1.30), (SUNN, 1.0), (LIQ, 0.92), (CISCO, 1.0)]
widths = [l.size[0]*(CAP*k)/l.size[1] for l, k in ROW]
spon = blank()
total = sum(widths) + GAP*(len(widths)-1)
for ids, cy, rot, centre in ((STRIP_R, 402, 180, 1135), (STRIP_L, 1655, 0, 1139)):
    anchor = centre + total/2
    x = anchor
    xs = []
    for w in reversed(widths): xs.insert(0, x - w/2); x -= w + GAP
    for (logo, k), cx in zip(ROW, xs): stamp(spon, logo, cx, cy, ids, h=CAP*k, rot=rot)
print('sponsors', save(spon, 'zxt_8_sponsors.png'))

# 7 torn fringe border along both side strips
border = blank()
for ids, cy, rot in ((STRIP_R, 360, 180), (STRIP_L, 1697, 0)):
    for x in range(860, 1440, 210): stamp(border, FRINGE, x, cy, ids, w=220, h=28, rot=rot)
print('border', save(border, 'zxt_10_border.png'))

# 8 rear wing: DOOOOM across it (the wing sits rotated 180 on the sheet)
wing = blank(); print('wing %d/%d' % stamp(wing, ART, 290, 1930, WING, w=520, rot=180)); save(wing, 'zxt_11_wing.png')
# 9 Blood Incantation on the front bodywork tail end
bi = blank(); print('blood %d/%d' % stamp(bi, BLOOD, 880, 1964, [157], w=240)); save(bi, 'zxt_12_blood.png')
