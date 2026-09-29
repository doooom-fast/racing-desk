import sys; sys.path.insert(0,'/Volumes/Claude/prodrive-agents-worktrees/lotus-79-livery-2d6f42/skills/iracing-livery-placement/scripts')
import numpy as np, livery_uv as lu
from PIL import Image, PngImagePlugin
PngImagePlugin.MAX_TEXT_CHUNK=1<<30
TOP='51,63,61,56,62,66,46,50,78,70,30,31,34,94,96,87,41,91'
C=1258
def placer(art, fallback=None, extra='wing_maps.json'):
    return lu.Placer(art, TOP, extra=extra, car_size=2400, center=C, fallback=fallback)
def save(mask, path):
    rgba=np.zeros((2048,2048,4),np.uint8); rgba[...,:3]=255; rgba[...,3]=(np.clip(mask,0,1)*255).astype(np.uint8)
    Image.fromarray(rgba).save(path); return int((mask>0.5).sum())

# 1) watermark: DOOOOM at 2x the original 1450 reference, along the car, over EVERY paintable island
P = placer('art_doooom.png', fallback='g_Mask.png')
wm = np.clip(np.maximum(P.uv(P.car(2900, 45, 950, C)), P.uv(P.car(2900, -45, 1500, C))), 0, 1)
print('watermark px', save(wm, 'v8_watermark.png'))

# 2) main orange DOOOOM: one copy per side, each reading from that side.
#    car right = upper UV half -> rotated 180; car left = lower half -> upright.
P2 = placer('art_doooom.png')
right = P2.uv(P2.car(1150, 180, 1250, C-155))
left  = P2.uv(P2.car(1150,   0, 1250, C+155))
side = np.clip(np.maximum(right, left), 0, 1)
print('main orange px', save(side, 'v8_main_orange.png'))

# 3) SPEEDSPORTS matte orange along each sidepod top, readable from that side
P3 = placer('art_speedsports.png')
ss = np.clip(np.maximum(P3.uv(P3.car(1000, 180, 1150, C-420)), P3.uv(P3.car(1000, 0, 1150, C+420))), 0, 1)
print('speedsports px', save(ss, 'v8_speedsports.png'))

# quick top-view proof
paint=np.full((2048,2048,3), 10/255.)
for m,col in ((wm,(20,20,20)),(side,(197,80,45)),(ss,(197,80,45))):
    for c,v in enumerate(col): paint[...,c]=paint[...,c]*(1-m)+v/255*m
sheen=np.where((ss>0.5)|(wm>0.5),0.0,0.10)
view=np.stack([P.carview(np.clip(paint[...,c]+sheen,0,1)) for c in range(3)],-1)
cover=P.carview(np.ones((2048,2048)))>0; view[~cover]=0.93
im=Image.fromarray((view*255).astype(np.uint8)).crop((0,640,2400,1880)).rotate(-90, expand=True)
im.resize((im.width//2, im.height//2)).save('v8_preview_top.png'); print('preview ok')
