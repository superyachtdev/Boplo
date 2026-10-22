# Composite the aircraft renders with a soft ground shadow and crop them to 640x360 WebP (run after render.mjs).
from PIL import Image, ImageDraw, ImageFilter
import json, os, sys
src = sys.argv[1] if len(sys.argv) > 1 else 'r'; out = sys.argv[2] if len(sys.argv) > 2 else 'dist/aircraft'
meta = json.load(open(f'{src}/meta.json')); os.makedirs(out, exist_ok=True)
for id, m in meta.items():
    im = Image.open(f'{src}/{id}.png').convert('RGBA'); W, H = im.size
    xs = [m[k][0] for k in 'lrfbc']; ys = [m[k][1] for k in 'lrfbc']
    cx = sum(xs) / 5; cy = m['c'][1]; rx = (max(xs) - min(xs)) * .46; ry = (max(ys) - min(ys)) * .42 + 18
    sh = Image.new('L', (W, H), 0); ImageDraw.Draw(sh).ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=95); sh = sh.filter(ImageFilter.GaussianBlur(28))
    core = Image.new('L', (W, H), 0); ImageDraw.Draw(core).ellipse([cx - rx * .55, cy - ry * .45, cx + rx * .55, cy + ry * .45], fill=70); core = core.filter(ImageFilter.GaussianBlur(14))
    shadow = Image.new('RGBA', (W, H), (10, 25, 60, 0)); shadow.putalpha(Image.blend(sh, core, .4).point(lambda v: min(255, v * 1.6)))
    comp = Image.alpha_composite(shadow, im); x0, y0, x1, y1 = comp.getbbox()
    tw = max((x1 - x0) * 1.08, (y1 - y0) * 1.08 * 16 / 9); th = tw * 9 / 16; ccx, ccy = (x0 + x1) / 2, (y0 + y1) / 2
    box = [int(ccx - tw / 2), int(ccy - th / 2), int(ccx + tw / 2), int(ccy + th / 2)]
    canvas = Image.new('RGBA', (box[2] - box[0], box[3] - box[1]), (0, 0, 0, 0)); canvas.paste(comp, (-box[0], -box[1]), comp)
    canvas.resize((640, 360), Image.LANCZOS).save(f'{out}/{id}.webp', 'WEBP', quality=88, method=6)
