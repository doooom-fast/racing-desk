"""v13: sponsor strips and the Liquid Death lockup, over a v12 shatter+logo livery.

  nose      Liquid Death skull + wordmark beneath the DOOOOM lockup, reading from the front
  cockpit   metal bands along the cockpit opening, on the sidepod tops, ending at the cockpit's rear
  sill      sim-gear brands in white along the bottom of each flank, ending at the rear wheel

Both strips share one gap so the rhythm matches. Upper-half panels sit rotated 180 on the sheet,
lower-half panels upright, so each side reads correctly from outside.
"""
import sys, numpy as np
sys.path.insert(0, '/Volumes/Claude/prodrive-agents-worktrees/lotus-79-livery-2d6f42/skills/iracing-livery-placement/scripts')
import livery_uv as lu
from PIL import Image, PngImagePlugin
PngImagePlugin.MAX_TEXT_CHUNK = 1 << 30

SRC, OUT = sys.argv[1], sys.argv[2]
TOP = '51,63,61,56,62,66,46,50,78,70,30,31,34,94,96,87,41,91'
C, SZ = 1258, 2400
WHITE = np.array([238, 238, 238], float)
GLOSS = 22.0
GAP = 28                                   # shared rhythm for both strips, tightened
isl = np.load('isl.npy')
P = lu.Placer('art_doooom.png', TOP, car_size=SZ, center=C)

def load(n): return Image.open('logos/masks/%s.png' % n)
def clean(img, lo=0.35):
    a = np.clip((np.asarray(img).astype(float)/255 - lo)/0.30, 0, 1)
    ys, xs = np.where(a > 0.5)
    return Image.fromarray((a[ys.min():ys.max()+1, xs.min():xs.max()+1]*255).astype(np.uint8))

def stamp(canvas, img, cx, cy, h, rot=0):
    N = canvas.shape[0]
    w = img.size[0]*h/img.size[1]
    im = img.resize((max(1, int(w)), max(1, int(h))), Image.LANCZOS).rotate(rot, resample=Image.BICUBIC, expand=True)
    a = np.asarray(im).astype(float)/255; hh, ww = a.shape
    x0, y0 = int(cx-ww/2), int(cy-hh/2)
    sx, sy, dx, dy = max(0, -x0), max(0, -y0), max(0, x0), max(0, y0)
    cw, ch = min(ww-sx, N-dx), min(hh-sy, N-dy)
    if cw > 0 and ch > 0:
        canvas[dy:dy+ch, dx:dx+cw] = np.maximum(canvas[dy:dy+ch, dx:dx+cw], a[sy:sy+ch, sx:sx+cw])
    return w

def lay(logos, caps, anchor_rear, cy, rot, ids, scale):
    """One attempt at a row: logos at cap height x scale, fixed gap, ending at anchor_rear."""
    widths = [load(n).size[0]*c*scale/load(n).size[1] for n, c in zip(logos, caps)]
    x = anchor_rear; xs = []
    for w in reversed(widths): xs.insert(0, x - w/2); x -= w + GAP*scale
    tmp = np.zeros(isl.shape)                    # strips are placed straight in UV space
    for n, c, cx in zip(logos, caps, xs): stamp(tmp, load(n), cx, cy, c*scale, rot)
    ink = tmp > .5
    lost = int((ink & ~np.isin(isl, ids)).sum())
    return tmp, xs[0] - widths[0]/2, lost, int(ink.sum())

def fit_scale(logos, caps, anchor_rear, cy, rot, ids, shift_max=260, floor=0.55):
    """The largest scale at which this row fits somewhere along the panel."""
    scale = 1.0
    while scale >= floor:
        for shift in range(0, shift_max, 6):
            if lay(logos, caps, anchor_rear + shift, cy, rot, ids, scale)[2] == 0: return scale
        scale *= 0.96
    return floor

def row(canvas, logos, caps, anchor_rear, cy, rot, ids, shift_max=260, floor=0.55, scale0=1.0):
    """A sponsor row is a group, and a group that does not fit is not a row.

    Stamping first and masking afterwards silently ate the front of a strip - the death logo came
    off the car with its edge cut. So try the row where it was asked for, then walk it backwards
    along the panel, and only when no position fits shrink the whole group a step and walk it
    again. Every logo keeps the same relative size and spacing; the row just gets smaller or sits
    further back, which is what a sign writer would do with a panel that is too short."""
    scale = scale0
    while scale >= floor:
        best = None
        for shift in range(0, shift_max, 6):
            tmp, front, lost, ink = lay(logos, caps, anchor_rear + shift, cy, rot, ids, scale)
            if lost == 0 and ink:
                canvas[:] = np.maximum(canvas, tmp)
                if shift or scale < 1: print('    row %s: scale %.2f, moved back %d px' % (logos[0], scale, shift))
                return front
            if best is None or lost < best: best = lost
        scale *= 0.96
    raise SystemExit('row %s cannot be fitted on island %s' % (logos, ids))

car = np.zeros((SZ, SZ))            # nose art lives in car space; the strips are UV-direct
uvm = np.zeros(isl.shape)

# --- nose: Liquid Death sits ABOVE the DOOOOM lockup, toward the driver, clear of the number
# block at x 261-354 which was covering it on the car.
skull, ld = load('liquid_death_skull'), load('liquiddeath')
stamp(car, ld,    541, C, 22, 270)        # wordmark nearest DOOOOM
stamp(car, skull, 578, C, 44, 270)        # skull above it, as in the Liquid Death lockup
nose = P.uv(car) * np.isin(isl, [51])

# --- cockpit strip: aligned to the cockpit opening (x 789-1301, lateral 1199-1321): rows hug the
# opening's lateral edges and end level with its REAR edge.
BANDS = ['death', 'blood_incantation', 'darkthrone', 'primitiveman', 'sunn']
CAPS_B = [58, 36, 50, 28, 36]
# Both sides take the tighter of the two fits, so the strip is the same size on each flank.
sc = min(fit_scale(BANDS, CAPS_B, 1301, 1105, 180, [46]), fit_scale(BANDS, CAPS_B, 1301, 1413, 0, [78]))
front_r = row(uvm, BANDS, CAPS_B, 1301, 1105, 180, [46], scale0=sc)   # car right, rotated on the sheet
front_l = row(uvm, BANDS, CAPS_B, 1301, 1413, 0,   [78], scale0=sc)   # car left, upright

# --- sill strip: ends ahead of the flank number block (x 1300-1416), which was covering the
# rearmost mark on the car.
GEAR_A = ['yamaha', 'brembo', 'bbs', 'heusinkveld', 'cubecontrols']
CAPS_A = [26, 22, 26, 15, 20]
GEAR_B = ['moza', 'simlab', 'lg', 'nvidia']
CAPS_Bb = [22, 19, 26, 20]
sa = min(fit_scale(GEAR_A, CAPS_A, 1288, 600, 180, [25]), fit_scale(GEAR_A, CAPS_A, 1288, 1916, 0, [103]))
sb = min(fit_scale(GEAR_B, CAPS_Bb, 1288, 660, 180, [25]), fit_scale(GEAR_B, CAPS_Bb, 1288, 1856, 0, [103]))
front_g = row(uvm, GEAR_A, CAPS_A, 1288, 600, 180, [25], scale0=sa)
row(uvm, GEAR_B, CAPS_Bb, 1288, 660, 180, [25], scale0=sb)
row(uvm, GEAR_A, CAPS_A, 1288, 1916, 0, [103], scale0=sa)
row(uvm, GEAR_B, CAPS_Bb, 1288, 1856, 0, [103], scale0=sb)

mask = np.clip(np.maximum(nose, uvm), 0, 1)
paint = np.array(Image.open(SRC + 'car_DOOOOM.tga').convert('RGB')).astype(float)
spec = np.array(Image.open(SRC + 'car_spec_DOOOOM.tga').convert('RGB')).astype(float)
m = mask[..., None]
Image.fromarray((paint*(1-m) + WHITE*m).round().astype(np.uint8)).save(OUT + 'car_DOOOOM.tga')
spec[..., 1] = spec[..., 1]*(1-mask) + GLOSS*mask
Image.fromarray(spec.round().astype(np.uint8)).save(OUT + 'car_spec_DOOOOM.tga')
nb = np.array(Image.open('g_Number_Block_Locations.png').convert('RGBA'))[..., 3] > 100
clash = int(((mask > .5) & nb).sum())
print('%s: nose %d px | cockpit row from x=%d | sill row from x=%d | pixels under a number block: %d'
      % (OUT.split('/')[-2], (nose > .5).sum(), front_r, front_g, clash))
