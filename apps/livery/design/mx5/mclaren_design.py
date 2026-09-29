"""MX-5 painted as a 570S tribute: papaya body, black McLaren shapes, black logos.

The MX-5 has no side intake, so the 570S intake is PAINTED onto the door as a graphic. Same for
the rear bumper panels behind the rear wheels - the shape is kept, the geometry is not.

Side panels: island 72 (upright, front at low x, door x 640-1266, rear arch ~1600) and island 25,
which is the same panel rotated 180 on the sheet: (x,y) -> (1891-x, 2489-y).
"""
import numpy as np
from PIL import Image, ImageDraw, PngImagePlugin
PngImagePlugin.MAX_TEXT_CHUNK = 1 << 30
SZ = 2048
isl = np.load('isl.npy')
SIDE_L, SIDE_R = [72], [25]
FASCIA, ROOF, TRUNK, BANNER, HOOD = [39], [15], [75], [3], [35]
def mirror(pts): return [(1891-x, 2489-y) for x, y in pts]

def bez(p0, p1, p2, p3, n=26):
    out = []
    for i in range(n+1):
        t = i/n; u = 1-t
        out.append((u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0],
                    u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1]))
    return out

def draw(canvas, pts, ids):
    im = Image.new('L', (SZ, SZ), 0); ImageDraw.Draw(im).polygon([(float(x), float(y)) for x, y in pts], fill=255)
    canvas[:] = np.maximum(canvas, (np.asarray(im).astype(float)/255)*np.isin(isl, ids))

def both(canvas, pts):
    draw(canvas, pts, SIDE_L); draw(canvas, mirror(pts), SIDE_R)

def save(c, name):
    rgba = np.zeros((SZ, SZ, 4), np.uint8); rgba[..., :3] = 255
    rgba[..., 3] = (np.clip(c, 0, 1)*255).astype(np.uint8); Image.fromarray(rgba).save(name)
    return int((c > .5).sum())

# ---- 1. 570S side intake, painted on the door: a hook open toward the rear with a tendon above
intake = np.zeros((SZ, SZ))
# crescent with tapered ends, like the 570S intake mouth
outer = (bez((1272, 1742), (1180, 1662), (1020, 1672), (958, 1786)) +
         bez((958, 1786), (1000, 1902), (1130, 1948), (1268, 1922)))
inner = (bez((1268, 1922), (1150, 1880), (1062, 1842), (1036, 1784)) +
         bez((1036, 1784), (1074, 1728), (1170, 1730), (1272, 1742)))
both(intake, outer + inner[::-1])
tendon = (bez((1252, 1672), (1150, 1612), (992, 1630), (908, 1702)) +
          bez((908, 1702), (1004, 1676), (1152, 1662), (1258, 1706))[::-1])
both(intake, tendon)
print('side intake', save(intake, 'mc_1_intake.png'))

# ---- 2. rear bumper panel behind the rear wheel, 570S shape: curved wedge plus slats
rear = np.zeros((SZ, SZ))
panel = (bez((1640, 1768), (1668, 1700), (1726, 1648), (1812, 1626)) +
         [(1830, 1640), (1830, 1772), (1640, 1772)])
both(rear, panel)
for i, dx in enumerate((0, 40, 80)):
    slat = [(1668+dx, 1754-i*6), (1692+dx, 1748-i*6), (1716+dx, 1684-i*8), (1692+dx, 1690-i*8)]
    both(rear, slat)
print('rear bumper panel', save(rear, 'mc_2_rear.png'))

# ---- 3. rocker sill band under the door
sill = np.zeros((SZ, SZ))
both(sill, [(660, 1994), (1290, 1966), (1290, 2022), (660, 2022)])
print('sill', save(sill, 'mc_3_sill.png'))

# ---- 4. headlight sockets on the front fascia: McLaren eye with a comma tail
lamp = np.zeros((SZ, SZ))
for sx, x0 in ((1, 830), (-1, 1876)):
    eye = (bez((x0, 1012), (x0+sx*78, 986), (x0+sx*150, 1000), (x0+sx*168, 1046)) +
           bez((x0+sx*168, 1046), (x0+sx*120, 1040), (x0+sx*66, 1046), (x0, 1074)))
    draw(lamp, eye, FASCIA)
    comma = (bez((x0+sx*150, 1052), (x0+sx*120, 1092), (x0+sx*80, 1126), (x0+sx*40, 1138)) +
             bez((x0+sx*40, 1138), (x0+sx*86, 1106), (x0+sx*124, 1078), (x0+sx*158, 1040))[::-1])
    draw(lamp, comma, FASCIA)
print('head lamp sockets', save(lamp, 'mc_4_lamps.png'))

# ---- 5. lower front blade across the fascia
blade = np.zeros((SZ, SZ))
draw(blade, bez((820, 1180), (1100, 1226), (1500, 1226), (1890, 1178)) + [(1890, 1229), (820, 1229)], FASCIA)
print('front blade', save(blade, 'mc_5_blade.png'))

# ---- 6. black roof and windshield banner
roof = np.zeros((SZ, SZ))
draw(roof, [(1245, 262), (1850, 262), (1850, 420), (1245, 420)], ROOF)
draw(roof, [(1236, 20), (1858, 20), (1858, 108), (1236, 108)], BANNER)
print('roof + banner', save(roof, 'mc_6_roof.png'))

# ---- 7. black logos: DOOOOM on the rear quarter clear of the door number (x 492-614),
#        SPEEDSPORTS on the trunk lid, sponsor list along the sill, all in black
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
SPEED = clean(Image.open('art_speedsports.png').convert('L'))
LOGOS = {n: mask_of(p) for n, p in (('death', '/Volumes/Claude/doooom/art/Death_logo.png'),
        ('sunn', 'sunn.png'), ('liq', 'liquiddeath.png'), ('cisco', 'cisco.svg.png'))}
def stamp(canvas, img, cx, cy, ids, w=None, h=None, rot=0):
    if w is None: w = img.size[0]*h/img.size[1]
    if h is None: h = img.size[1]*w/img.size[0]
    im = img.resize((max(1,int(w)), max(1,int(h))), Image.LANCZOS).rotate(rot, resample=Image.BICUBIC, expand=True)
    a = np.asarray(im).astype(float)/255; hh, ww = a.shape
    x0, y0 = int(cx-ww/2), int(cy-hh/2); patch = np.zeros_like(canvas)
    sx, sy, dx, dy = max(0,-x0), max(0,-y0), max(0,x0), max(0,y0)
    cw, ch = min(ww-sx, SZ-dx), min(hh-sy, SZ-dy)
    if cw <= 0 or ch <= 0: return 0, 0
    patch[dy:dy+ch, dx:dx+cw] = a[sy:sy+ch, sx:sx+cw]
    keep = np.isin(isl, ids); canvas[:] = np.maximum(canvas, patch*keep)
    return int(((patch*keep) > .5).sum()), int((patch > .5).sum())

logos = np.zeros((SZ, SZ))
print('DOOOOM door L %d/%d' % stamp(logos, ART, 800, 1700, SIDE_L, w=330))
print('DOOOOM door R %d/%d' % stamp(logos, ART, 1091, 789, SIDE_R, w=330, rot=180))
print('DOOOOM trunk %d/%d' % stamp(logos, ART, 1876, 1850, TRUNK, w=280))
print('SPEEDSPORTS trunk %d/%d' % stamp(logos, SPEED, 1876, 1906, TRUNK, w=230))
CAP, GAP = 34, 44
ROW = [(LOGOS['death'], 1.30), (LOGOS['sunn'], 1.0), (LOGOS['liq'], 0.92), (LOGOS['cisco'], 1.0)]
widths = [l.size[0]*(CAP*k)/l.size[1] for l, k in ROW]
total = sum(widths) + GAP*(len(widths)-1)
for ids, cy, rot, centre in ((SIDE_L, 1952, 0, 900), (SIDE_R, 537, 180, 991)):
    x = centre + total/2; xs = []
    for w in reversed(widths): xs.insert(0, x - w/2); x -= w + GAP
    for (logo, k), cx in zip(ROW, xs): stamp(logos, logo, cx, cy, ids, h=CAP*k, rot=rot)
print('logos', save(logos, 'mc_7_logos.png'))
