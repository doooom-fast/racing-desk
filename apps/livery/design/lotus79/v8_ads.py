import numpy as np
from PIL import Image, PngImagePlugin
PngImagePlugin.MAX_TEXT_CHUNK = 1<<30
isl = np.load('isl.npy')
DEATH = '/Users/kevinconboy/Downloads/Death_logo.png'
BLOOD = '/Users/kevinconboy/Downloads/281656d8e6ba2d7e86107635c0684be4.jpg'

def load_mask(path, mode):
    im = Image.open(path)
    a = (np.array(im.convert('RGBA'))[..., 3].astype(float)/255 if mode == 'alpha'
         else np.clip((np.array(im.convert('L')).astype(float)/255 - 0.35)/0.35, 0, 1))
    ys, xs = np.where(a > 0.5)
    return Image.fromarray((a[ys.min():ys.max()+1, xs.min():xs.max()+1]*255).astype(np.uint8))

def place(canvas, logo, rot, cx, cy, island_ids, height=None, length=None):
    if height is None: height = length*logo.size[1]/logo.size[0]
    w = int(round(logo.size[0]*height/logo.size[1]))
    im = logo.resize((w, int(height)), Image.LANCZOS).rotate(rot, resample=Image.BICUBIC, expand=True)
    arr = np.asarray(im).astype(float)/255
    h, w = arr.shape; x0, y0 = int(cx-w/2), int(cy-h/2)
    patch = np.zeros_like(canvas); patch[y0:y0+h, x0:x0+w] = arr
    keep = np.isin(isl, island_ids)
    canvas[:] = np.maximum(canvas, patch*keep)
    return int(((patch*keep) > 0.5).sum()), int((patch > 0.5).sum())

def save(mask, path):
    rgba = np.zeros((2048, 2048, 4), np.uint8); rgba[..., :3] = 255
    rgba[..., 3] = (np.clip(mask, 0, 1)*255).astype(np.uint8); Image.fromarray(rgba).save(path)

# NOSE: full DOOOOM SPEEDSPORTS lockup, orange. rot 270 = letter tops toward the tail, so it reads
# to someone in front of the car, with the lockup running across the nose.
nose = np.zeros((2048, 2048))
print('nose lockup: %d/%d px on the nose' % place(nose, load_mask('ai_ps600.png', 'luma'), 270, 500, 1258, [51], length=380))
save(nose, 'v8_nose.png')

# FLANKS: both logos on BOTH sides. DEATH forward by the front tyres, Blood Incantation aft by
# the rears. Upper flank island (car right) sits rotated 180 on the sheet; lower flank (car left)
# is upright, so each reads correctly when you stand at that side.
DEATH_X, DEATH_H = 880, 100
BLOOD_X, BLOOD_H = 1320, 112
death = np.zeros((2048, 2048)); blood = np.zeros((2048, 2048))
for ids, cy, rot, side in (([25], 628, 180, 'car right'), ([103], 1891, 0, 'car left')):
    on, tot = place(death, load_mask(DEATH, 'alpha'), rot, DEATH_X, cy, ids, height=DEATH_H)
    print('DEATH %-9s %d/%d px' % (side, on, tot))
    on, tot = place(blood, load_mask(BLOOD, 'luma'), rot, BLOOD_X, cy, ids, height=BLOOD_H)
    print('BLOOD %-9s %d/%d px' % (side, on, tot))
save(death, 'v8_ad_death.png'); save(blood, 'v8_ad_blood.png')
