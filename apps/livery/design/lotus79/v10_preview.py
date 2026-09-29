import sys, numpy as np
sys.path.insert(0,'/Volumes/Claude/prodrive-agents-worktrees/lotus-79-livery-2d6f42/skills/iracing-livery-placement/scripts')
import livery_uv as lu
from PIL import Image, PngImagePlugin
PngImagePlugin.MAX_TEXT_CHUNK=1<<30
from v10_stack import STACK, BASE
TOP='51,63,61,56,62,66,46,50,78,70,30,31,34,94,96,87,41,91'
P = lu.Placer('art_doooom.png', TOP, extra='wing_maps.json', car_size=2400, center=1258, fallback='g_Mask.png')
paint = np.zeros((2048,2048,3)); paint[:] = np.array(BASE)/255
rough = np.full((2048,2048), 37/255)
for f,col,ro,_ in STACK:
    m = np.array(Image.open(f))[...,3].astype(float)/255
    for c in range(3): paint[...,c] = paint[...,c]*(1-m) + col[c]/255*m
    if ro is not None: rough = rough*(1-m) + ro/255*m
sheen = (1-rough)*0.10
view = np.stack([P.carview(np.clip(paint[...,c]+sheen,0,1)) for c in range(3)],-1)
cover = P.carview(np.ones((2048,2048)))>0; view[~cover]=0.93
im = Image.fromarray((view*255).astype(np.uint8)).crop((0,640,2400,1880)).rotate(-90, expand=True)
im.resize((im.width//2, im.height//2)).save('v10_preview_top.png')
disp=(np.clip(paint+sheen[...,None],0,1)*255).astype(np.uint8)
Image.fromarray(disp[545:715, 600:1480]).rotate(180).resize((1760,340)).save('v10_preview_flank.png')
Image.fromarray(disp[1040:1480, 40:620]).rotate(90, expand=True).save('v10_preview_nose.png')
print('ok')
