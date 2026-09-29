"""Mazda MX-5 Cup livery: the same language as the Lotus and Nissan, laid out on this car's
panels. Panel identity comes from iRacing's historic pattern (car_pattern_001) plus the number
and sponsor block layers:
  25 / 72  whole-car sides (25 rotated 180 on the sheet), door number blocks at x 494-617
  35       hood (big sponsor block)
  15       roof / trunk panel      39  front fascia      3  windshield banner
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

SIDE_R, SIDE_L = [25], [72]     # whole-car side panels; 25 sits rotated 180 (mazda reads upside down)
HOOD, ROOF, FASCIA, BANNER = [35], [15], [39], [3]

# 1 DOOOOM wordmark along each side, above the door number block (x 494-617)
word = blank()
print('wordmark R %d/%d' % stamp(word, ART, 1100, 690, SIDE_R, w=600, rot=180))
print('wordmark L %d/%d' % stamp(word, ART, 1100, 1800, SIDE_L, w=600))
save(word, 'mx5_6_wordmark.png')

# 2 sponsor list along each side, forward of the wordmark, clear of the number block
CAP, GAP = 46, 52
ROW = [(DEATH, 1.30), (SUNN, 1.0), (LIQ, 0.92), (CISCO, 1.0)]
widths = [l.size[0]*(CAP*k)/l.size[1] for l, k in ROW]
total = sum(widths) + GAP*(len(widths)-1)
spon = blank()
for ids, cy, rot, centre in ((SIDE_R, 800, 180, 1150), (SIDE_L, 1690, 0, 1150)):
    x = centre + total/2; xs = []
    for w in reversed(widths): xs.insert(0, x - w/2); x -= w + GAP
    for (logo, k), cx in zip(ROW, xs): stamp(spon, logo, cx, cy, ids, h=CAP*k, rot=rot)
print('sponsors', save(spon, 'mx5_8_sponsors.png'))

# 3 torn fringe border along the sill of each side
border = blank()
for ids, cy, rot in ((SIDE_R, 845, 180), (SIDE_L, 1645, 0)):
    for x in range(260, 1800, 240): stamp(border, FRINGE, x, cy, ids, w=250, h=30, rot=rot)
print('border', save(border, 'mx5_10_border.png'))

# 4 hood: the lockup follows the template's own text direction there (mazda runs bottom-to-top),
#    with a ring pair behind it
nose = blank(); print('hood lockup %d/%d' % stamp(nose, LOCK, 300, 1240, HOOD, w=620, rot=90)); save(nose, 'mx5_9_nose.png')
da, db = blank(), blank()
for i, (y, r) in enumerate(zip((1050, 1430), (300, 240))):
    stamp(da if i % 2 == 0 else db, RING, 540, y, HOOD, w=r, h=r)

# 5 front fascia: chevron pair plus ring dissolve
for i, (off, span) in enumerate(((0, 150), (70, 130), (134, 112))):
    ch = blank(); x = 860 + off
    poly(ch, [(x, 1080-span), (x+58, 1080-span), (x+140, 1080), (x+58, 1080+span), (x, 1080+span), (x+82, 1080)], FASCIA)
    print('chevron%d' % i, save(ch, 'mx5_2_chevron%d.png' % i))
for i, (x, r) in enumerate(zip((1350, 1560, 1730), (250, 200, 160))):
    stamp(da if i % 2 == 0 else db, RING, x, 1080, FASCIA, w=r, h=r)
print('dissolve A', save(da, 'mx5_4_dissolveA.png'), 'B', save(db, 'mx5_4_dissolveB.png'))

# 6 roof/trunk panel: SPEEDSPORTS; windshield banner: DOOOOM (banner runs upside down on the sheet)
ss = blank(); print('speedsports %d/%d' % stamp(ss, SPEED, 1546, 392, ROOF, w=520)); save(ss, 'mx5_7_speedsports.png')
ban = blank(); print('banner %d/%d' % stamp(ban, ART, 1546, 63, BANNER, w=560, rot=180)); save(ban, 'mx5_11_banner.png')
bi = blank(); print('blood %d/%d' % stamp(bi, BLOOD, 1876, 1891, [75], w=240)); save(bi, 'mx5_12_blood.png')

# --- rear: DOOOOM must read across the back of the car. On a closed car that is the bumper
# (island 24, which lies rotated 90 on the sheet) plus the trunk lid (island 75) for the view
# from behind and above.
rear = blank()
print('rear bumper %d/%d' % stamp(rear, ART, 1920, 706, [24], w=470, rot=90))
print('trunk lid   %d/%d' % stamp(rear, ART, 1876, 1800, [75], w=280))
print('rear mark', save(rear, 'mx5_13_rear.png'))
