"""v10 'RING DISSOLVE' - remix of the DOOOOM artwork in racing language.
Motifs pulled from the art itself: the double O ring, the torn fringe edge, the M lightning.
Racing language: nose chevrons, a spine stripe, a front-to-rear ring dissolve along the sidepods,
hash marks, a sponsor wall on the flanks, number rings.
Everything is drawn in CAR space; Placer maps it onto the UV islands."""
import sys, numpy as np
sys.path.insert(0, '/Volumes/Claude/prodrive-agents-worktrees/lotus-79-livery-2d6f42/skills/iracing-livery-placement/scripts')
import livery_uv as lu
from PIL import Image, ImageDraw, PngImagePlugin
PngImagePlugin.MAX_TEXT_CHUNK = 1 << 30

C, SZ = 1258, 2400
TOP = '51,63,61,56,62,66,46,50,78,70,30,31,34,94,96,87,41,91'
P = lu.Placer('art_doooom.png', TOP, extra='wing_maps.json', car_size=SZ, center=C, fallback='g_Mask.png')
P_TOP = lu.Placer('art_doooom.png', TOP, extra='wing_top.json', car_size=SZ, center=C)
P_BOT = lu.Placer('art_doooom.png', TOP, extra='wing_bottom.json', car_size=SZ, center=C)

def mask_of(path, _mode=None, _lo=None):
    """Logo -> alpha mask, whatever the file does. Real transparency wins; otherwise ink is
    whichever of dark-on-light or light-on-dark the image actually is. Guessing wrong turns a
    logo into a solid rectangle (Cisco was an opaque white-background thumbnail, Liquid Death
    was black art on transparency)."""
    im = Image.open(path)
    rgba = np.array(im.convert('RGBA')).astype(float)/255
    a, lum = rgba[..., 3], rgba[..., :3].mean(2)
    if a.min() < 0.5:                                   # genuine transparency
        m = a
    elif lum[[0, -1], :].mean() > 0.5:                  # ink on a light background
        # distance from white, not darkness: Cisco's light-blue ink fails a darkness test
        m = np.clip((1 - rgba[..., :3].min(2))/0.45, 0, 1)
    else:                                               # ink is light on a dark background
        m = np.clip((lum - 0.35)/0.30, 0, 1)
    ys, xs = np.where(m > 0.5)
    return Image.fromarray((m[ys.min():ys.max()+1, xs.min():xs.max()+1]*255).astype(np.uint8))

def clean(img, lo=0.35):
    """Motifs cropped from the rasterised art carry its dark background (~14% grey). Left as-is
    that paints a faint rectangle behind every shape. Stretch to a clean alpha, keeping edges."""
    a = np.clip((np.asarray(img).astype(float)/255 - lo)/0.30, 0, 1)
    return Image.fromarray((a*255).astype(np.uint8))

ART   = clean(Image.open('art_doooom.png').convert('L'))
RING  = ART.crop((1180, 0, 1630, 519));  RING = RING.crop(RING.getbbox())
LIGHT = ART.crop((1990, 0, 2798, 519));  LIGHT = LIGHT.crop(LIGHT.getbbox())
FRINGE= ART.crop((300, 395, 2000, 519)); FRINGE = FRINGE.crop(FRINGE.getbbox())
LOCK  = mask_of('ai_ps600.png')
SPEED = clean(Image.open('art_speedsports.png').convert('L'))
DEATH = mask_of('/Volumes/Claude/doooom/art/Death_logo.png')
BLOOD = mask_of('/Volumes/Claude/doooom/art/blood_incantation.jpg')
LIQ   = mask_of('liquiddeath.png')
CISCO = mask_of('cisco.svg.png')
SUNN  = mask_of('sunn.png')

def blank(): return np.zeros((SZ, SZ), float)
def stamp(canvas, img, cx, cy, w=None, h=None, rot=0, flip=False):
    if w is None: w = img.size[0]*h/img.size[1]
    if h is None: h = img.size[1]*w/img.size[0]
    im = img.resize((max(1, int(w)), max(1, int(h))), Image.LANCZOS)
    if flip: im = im.transpose(Image.FLIP_TOP_BOTTOM)
    im = im.rotate(rot, resample=Image.BICUBIC, expand=True)
    a = np.asarray(im).astype(float)/255
    hh, ww = a.shape; x0, y0 = int(cx-ww/2), int(cy-hh/2)
    sx, sy, dx, dy = max(0, -x0), max(0, -y0), max(0, x0), max(0, y0)
    cw, ch = min(ww-sx, SZ-dx), min(hh-sy, SZ-dy)
    if cw > 0 and ch > 0:
        reg = canvas[dy:dy+ch, dx:dx+cw]; canvas[dy:dy+ch, dx:dx+cw] = np.maximum(reg, a[sy:sy+ch, sx:sx+cw])
def poly(canvas, pts):
    im = Image.new('L', (SZ, SZ), 0); ImageDraw.Draw(im).polygon(pts, fill=255)
    canvas[:] = np.maximum(canvas, np.asarray(im).astype(float)/255)
def save(canvas, name, placer=None):
    uv = np.clip((placer or P).uv(canvas), 0, 1)
    rgba = np.zeros((2048, 2048, 4), np.uint8); rgba[..., :3] = 255; rgba[..., 3] = (uv*255).astype(np.uint8)
    Image.fromarray(rgba).save(name); return int((uv > .5).sum())

# ---------------------------------------------------------------- 1 ghost rings (texture only)

# ---------------------------------------------------------------- 2 nose chevrons (3 tones)
for i, (off, span) in enumerate(((0, 118), (64, 106), (124, 94))):   # clear of the nose number block
    ch = blank(); x = 378 + off
    poly(ch, [(x, C-span), (x+54, C-span), (x+122, C), (x+54, C+span), (x, C+span), (x+68, C)])
    print('chevron%d' % i, save(ch, 'v10_2_chevron%d.png' % i))

# ---------------------------------------------------------------- 3 spine stripe, torn edges
spine = blank()
poly(spine, [(395, C-40), (1943, C-34), (2160, C-34), (2160, C+34), (1943, C+34), (395, C+40)])
for s_ in (-1, 1):
    for x in range(560, 2140, 240):
        stamp(spine, FRINGE, x, C + s_*(44 - (x-395)*10/1548), w=230, h=24, flip=(s_ < 0))
print('spine', save(spine, 'v10_3_spine.png'))

# ---------------------------------------------------------------- 4 ring dissolve along sidepod tops
diss_a, diss_b = blank(), blank()
for i, (x, r) in enumerate(zip((755, 985, 1185, 1355), (240, 200, 165, 135))):
    for s_ in (-1, 1):
        stamp(diss_a if i % 2 == 0 else diss_b, RING, x, C + s_*265, w=r, h=r)
print('dissolve A', save(diss_a, 'v10_4_dissolveA.png'), 'B', save(diss_b, 'v10_4_dissolveB.png'))

# ---------------------------------------------------------------- 5 lightning hashes, outer decks
hash_ = blank()
for i, x in enumerate(range(1830, 2000, 78)):
    for s_ in (-1, 1):
        stamp(hash_, LIGHT, x, C + s_*415, w=100 - i*22, h=62 - i*13)
print('hashes', save(hash_, 'v10_5_hashes.png'))

# ---------------------------------------------------------------- 6 DOOOOM wordmark, rear deck
word = blank(); stamp(word, ART, 1700, C, w=840, rot=90)
print('wordmark', save(word, 'v10_6_wordmark.png'))

# ---------------------------------------------------------------- 7 SPEEDSPORTS, outer decks
ss = blank()
stamp(ss, SPEED, 1020, C-430, w=820, rot=180); stamp(ss, SPEED, 1020, C+430, w=820)
print('speedsports', save(ss, 'v10_7_speedsports.png'))

# ---------------------------------------------------------------- 8 sponsor wall, both flanks
spon_core, spon_hot = blank(), blank()
# A sponsor list, not a spread: every logo normalised to one cap height, one fixed gap between
# them, right-anchored just ahead of the flank number block (x 1225-1335) and running forward.
CAP, GAP, ANCHOR = 34, 46, 1205
ROW = [(DEATH, 1.30), (SUNN, 1.0), (LIQ, 0.92), (CISCO, 1.0)]      # per-logo optical size tweak
widths = [logo.size[0]*(CAP*k)/logo.size[1] for logo, k in ROW]
xs, x = [], ANCHOR
for w in reversed(widths):                                          # pack rear -> forward
    xs.insert(0, x - w/2); x -= w + GAP
for cy, rot in ((610, 180), (1906, 0)):
    for (logo, k), cx in zip(ROW, xs):
        target = spon_hot if logo is LIQ else spon_core
        stamp(target, logo, cx, cy, h=CAP*k, rot=rot)
print('sponsors core', save(spon_core, 'v10_8_sponsors_core.png'), 'hot', save(spon_hot, 'v10_8_sponsors_hot.png'))

# ---------------------------------------------------------------- 9 nose lockup + wing Blood Incantation
nose = blank(); stamp(nose, LOCK, 520, C, w=330, rot=270)
wing = blank(); stamp(wing, BLOOD, 2055, C, w=250, rot=90)      # wing TOP only
under = blank(); stamp(under, ART, 2055, C, w=430, rot=90)       # wing UNDERSIDE only
print('nose', save(nose, 'v10_9_nose.png'),
      'wing top BI', save(wing, 'v10_9_wing.png', P_TOP),
      'wing underside DOOOOM', save(under, 'v10_11_wing_under.png', P_BOT))

# ---------------------------------------------------------------- 10 torn fringe border on the flanks
border = blank()
for cy, flip in ((566, True), (1954, False)):
    for x in range(640, 1190, 230):
        stamp(border, FRINGE, x, cy, w=240, h=30, flip=flip)
print('flank border', save(border, 'v10_10_border.png'))
