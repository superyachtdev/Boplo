"""Paint Boplo liveries onto a FlightGear livery texture, using each texel's 3D position on the model.
python paint.py config.json  -> writes <out>/<id>-<livery>.jpg for every livery
config: { id, npz, meta, size, base: [layer specs], details: [layer specs], paint: regex (objects to paint), engine: regex, fin: regex|null,
          name_y: relative y of the titles, win_y: relative y of the windows, out }
layer spec: {"xcf": path, "layers": [names]} or {"png": path}
"""
import sys, json, re, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from xcf import XCF

LIVERIES = {
    'boplo': dict(base='#F5F7FA', tail='#0A62FF', accent='#9ED8FF', belly='#F5F7FA', engine='#0A62FF', art='spark', title='boplo', titleCol='#0A62FF', cheat='#0A62FF', wrap=True),
    'northwind': dict(base='#F5F7FA', tail='#0B1F3A', accent='#2BC4B6', belly='#0B1F3A', engine='#0B1F3A', art='band', title='NORTHWIND', titleCol='#0B1F3A', cheat='#2BC4B6', wrap=False),
    'solair': dict(base='#F7F5F2', tail='#F26B21', accent='#FFC23D', belly='#D9DCE1', engine='#F26B21', art='sun', title='solair', titleCol='#F26B21', cheat='#FFC23D', wrap=True),
    'fjord': dict(base='#F5F7FA', tail='#C8102E', accent='#F5F7FA', belly='#F5F7FA', engine='#9AA3AF', art='cross', title='FJORD AIR', titleCol='#C8102E', cheat=None, wrap=False),
    'verde': dict(base='#F5F7FA', tail='#0F7B5F', accent='#B6E36A', belly='#F5F7FA', engine='#F5F7FA', art='leaf', title='verde', titleCol='#0F7B5F', cheat='#B6E36A', wrap=True),
    'plain': dict(base='#F5F7FA', tail='#F5F7FA', accent='#C9CED6', belly='#F5F7FA', engine='#C9CED6', art='none', title=None, titleCol=None, cheat=None, wrap=False),
}
def rgb(h): n = int(h[1:], 16); return np.array([n >> 16 & 255, n >> 8 & 255, n & 255], np.float32)

def load_layers(spec, S):
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    for sp in spec:
        if 'png' in sp:
            im = Image.open(sp['png']).convert('RGBA'); out.alpha_composite(im.resize((S, S), Image.LANCZOS)); continue
        x = XCF(sp['xcf']); k = S / x.w
        for L in reversed(x.layers):  # bottom first
            if L['name'].strip() not in [n.strip() for n in sp['layers']]: continue
            im = x.pixels(L)
            if im is None: continue
            if L['opacity'] < 255: a = np.array(im); a[:, :, 3] = (a[:, :, 3].astype(int) * L['opacity'] // 255); im = Image.fromarray(a)
            full = Image.new('RGBA', (x.w, x.h), (0, 0, 0, 0)); full.alpha_composite(im, (max(0, L['x']), max(0, L['y'])))
            out.alpha_composite(full.resize((S, S), Image.LANCZOS))
    return out

def rasterize(P, UV, O, S, names):
    pos = np.zeros((S, S, 3), np.float32); oid = np.full((S, S), -1, np.int32); nrm = np.zeros((S, S, 3), np.float32)
    uniq = {n: i for i, n in enumerate(names)}
    for t in range(len(P)):
        uv = UV[t] * S; p = P[t]
        n = np.cross(p[1] - p[0], p[2] - p[0]); ln = np.linalg.norm(n)
        if ln < 1e-9: continue
        n /= ln
        x0, y0 = np.floor(uv.min(0) - 1).astype(int); x1, y1 = np.ceil(uv.max(0) + 1).astype(int)
        x0 = max(x0, 0); y0 = max(y0, 0); x1 = min(x1, S - 1); y1 = min(y1, S - 1)
        if x1 < x0 or y1 < y0: continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
        a, b, c = uv
        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-9: continue
        l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / den
        l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / den
        l3 = 1 - l1 - l2
        e = -1.2 / max(1, np.abs(uv[1] - uv[0]).max(), np.abs(uv[2] - uv[0]).max())  # ~1px dilation
        m = (l1 >= e) & (l2 >= e) & (l3 >= e)
        if not m.any(): continue
        X = l1 * p[0][:, None, None].T[..., 0] if False else None
        P3 = l1[..., None] * p[0] + l2[..., None] * p[1] + l3[..., None] * p[2]
        sl = (slice(y0, y1 + 1), slice(x0, x1 + 1))
        pos[sl][m] = P3[m]; oid[sl][m] = uniq[O[t]]; nrm[sl][m] = n
    return pos, oid, nrm

def main(cfg):
    S = cfg.get('size', 2048)
    d = dict(np.load(cfg['npz'])); meta = json.load(open(cfg['meta']))
    if cfg.get('tex'):
        k = d['tex'] == cfg['tex']; d = {kk: v[k] for kk, v in d.items()}
    if cfg.get('dark'):
        pr = np.array([bool(re.search(cfg['dark'], o)) for o in d['O']]); order = np.argsort(pr, kind='stable'); d = {kk: v[order] for kk, v in d.items()}
    D0 = d
    names = sorted(set(d['O'].tolist()))
    pos, oid, nrm = rasterize(d['P'], d['UV'], d['O'], S, names)
    base = load_layers(cfg['base'], S); det = load_layers(cfg.get('details', []), S)
    B = np.array(base.convert('RGB'), np.float32)
    rx = re.compile(cfg['paint']); ex = re.compile(cfg.get('nopaint', r'^$')); eng = re.compile(cfg.get('engine', r'(?i)eng|nacelle|cowl|reverser')); finr = re.compile(cfg['fin']) if cfg.get('fin') else None
    paintable = np.array([bool(rx.search(n)) and not ex.search(n) for n in names] + [False])
    isEng = np.array([bool(eng.search(n)) for n in names] + [False])
    isFin = np.array([bool(finr.search(n)) if finr else False for n in names] + [False])
    M = paintable[oid] & (oid >= 0)
    x, y, z = pos[..., 0], pos[..., 1], pos[..., 2]
    hh = meta['hgt'] / 2; L = meta['len']; tz = meta['tailZ']; dia = meta['dia']
    yr = y / hh; zr = (z - tz) / L
    E = M & isEng[oid]
    finTop = meta['fin'][1]
    F = M & ~E & ((isFin[oid]) | ((y > hh * 1.05) & (np.abs(x) < 1.2) & (zr < .3)))
    Fu = M & ~E & ~F
    # shading: keep the base texture's light/dark detail (panel lines, shadows) by its luminance relative to its own white
    lum = B.mean(-1); ref = np.percentile(lum[M], 90) if M.any() else 240
    shade = np.clip(lum / max(ref, 1), 0, 1.08)
    if cfg.get('clean'):
        # drop the source livery's logos and lettering from the shading: saturated paint, and anything near it, counts as plain white
        mx = B.max(-1); mn = B.min(-1); sat = (mx - mn) / np.maximum(mx, 1)
        logo = Image.fromarray(((sat > .22) | (mx < 40)).astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(cfg.get('clean_px', 25)))
        shade[np.array(logo) > 0] = 1
    for r in cfg.get('clean_rects', []):
        u0, v0, u1, v1 = [int(v * S) for v in r]; shade[v0:v1, u0:u1] = 1
    shade = shade[..., None]
    out = {}
    WIN = np.zeros((S, S), bool)
    if cfg.get('carry_dark'):
        cd = cfg['carry_dark']; src = np.array(Image.open(cd['src']).convert('RGB').resize((S, S), Image.LANCZOS), np.float32)
        sl = src.mean(-1); smx = src.max(-1); ssat = (smx - src.min(-1)) / np.maximum(smx, 1)
        WIN = Fu & (y > cd['ymin']) & (y < cd['ymax']) & (sl < cd.get('lum', 90)) & (ssat < .3) & (np.abs(x) > dia * .3)
    if cfg.get('windows'):
        w = cfg['windows']; yw = w['y']; pitch = w['pitch']; ww = w.get('w', .24); wh = w.get('h', .34)
        skip = []
        for n in set(D0['O'].tolist()):
            if re.search(w.get('doors', r'^$'), n):
                Pd = D0['P'][D0['O'] == n].reshape(-1, 3)
                if Pd[:, 1].max() - Pd[:, 1].min() > 1.4: skip.append(((Pd[:, 2].min() + Pd[:, 2].max()) / 2, (Pd[:, 2].max() - Pd[:, 2].min()) / 2 + .3))
        ph = (z - w['z0']) / pitch; dz = (ph - np.round(ph)) * pitch
        WIN = Fu & (np.abs(x) > dia * .3) & ((np.abs(dz) / (ww / 2)) ** 4 + (np.abs(y - yw) / (wh / 2)) ** 4 < 1) & (z <= w['z0'] + .01) & (z >= w['z1'])
        for zc, hw in skip: WIN &= ~(np.abs(z - zc) < hw)
    for lid, LV in LIVERIES.items():
        C = np.zeros((S, S, 3), np.float32) + rgb(LV['base'])
        bel = cfg.get('belly_y', -.42); win = cfg.get('win_y', .2)
        Cb = Fu & (yr < bel)
        C[Cb] = rgb(LV['belly'])
        if LV['cheat']:
            band = Fu & (yr > bel - .0) & (yr < bel + .07) & (zr > .08) & (zr < .93)
            if LV['belly'] == LV['base']: band = Fu & (yr > bel + .02) & (yr < bel + .1) & (zr > .1) & (zr < .9)
            C[band] = rgb(LV['cheat'])
        if LV['wrap']:
            # tail colour wraps down the rear fuselage with a diagonal edge
            wr = Fu & (zr < .07 + .1 * (yr + 1) / 2) & (yr > -.6)
            C[wr] = rgb(LV['tail'])
        C[F] = rgb(LV['tail']); C[E] = rgb(LV['engine'])
        # tail art, in the side projection (z, y) of the fin
        if LV['art'] != 'none' and F.any():
            fz, fy = z[F], y[F]; zc = (np.percentile(fz, 10) + np.percentile(fz, 90)) / 2; yc = (np.percentile(fy, 20) + np.percentile(fy, 95)) / 2
            hs = (np.percentile(fy, 98) - np.percentile(fy, 5)) / 2
            dz = (z - zc) / hs; dy = (y - yc) / hs
            if LV['art'] == 'spark':
                C[F & (np.sqrt(np.abs(dz) / .62) + np.sqrt(np.abs(dy) / .62) < 1)] = rgb(LV['accent'])
            elif LV['art'] == 'band':
                C[F & (np.abs(dz + dy * .6) < .18)] = rgb(LV['accent'])
            elif LV['art'] == 'sun':
                C[F & (np.hypot(dz, dy) < .42)] = rgb(LV['accent'])
            elif LV['art'] == 'cross':
                C[F & ((np.abs(dz + .05) < .1) | (np.abs(dy - .05) < .1))] = rgb(LV['accent'])
            elif LV['art'] == 'leaf':
                C[F & (np.hypot(dz / .9, dy / .45) < .55) & (np.abs(dy - dz * .25) > .035)] = rgb(LV['accent'])
        if cfg.get('windows') or cfg.get('carry_dark'):
            C = np.where(WIN[..., None], rgb('#27303B'), C)
        # titles on both sides of the fuselage, read nose-first on each side
        if LV['title']:
            ppm = 40; zmin, zmax = tz, meta['noseTip']; W = int((zmax - zmin) * ppm); H = int(meta['hgt'] * 3 * ppm)
            can = Image.new('L', (W, H), 0); dr = ImageDraw.Draw(can)
            th = cfg.get('title_h', 1.0) * meta['hgt'] / 5.9 * 1.0
            font = ImageFont.truetype('/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf', int(th * ppm * 1.25))
            zc = zmin + L * cfg.get('title_z', .62); yt = cfg.get('title_y', .6) * hh
            tw = dr.textlength(LV['title'], font=font)
            # canvas x = z (nose to the right), y = up
            cxp = (zc - zmin) * ppm; cyp = H / 2 - yt * ppm
            dr.text((cxp - tw / 2, cyp), LV['title'], font=font, fill=255, anchor='lm')
            T = np.array(can, np.float32) / 255
            # left side (x>0) is seen with the nose to the left: mirror z
            zz = np.where(x > 0, 2 * zc - z, z)
            ci = np.clip(((zz - zmin) * ppm).astype(int), 0, W - 1); cj = np.clip((H / 2 - y * ppm).astype(int), 0, H - 1)
            a = T[cj, ci] * (Fu & (np.abs(x) > dia * .25))
            C = C * (1 - a[..., None]) + rgb(LV['titleCol']) * a[..., None]
        Cs = np.clip(C * shade, 0, 255)
        R = np.where(M[..., None], Cs, B)
        if cfg.get('dark'):
            dk = np.array([bool(re.search(cfg['dark'], n)) for n in names] + [False])[oid] & (oid >= 0)
            R[dk] = np.clip(rgb('#2A3340') * (.75 + .35 * shade[dk]), 0, 255)
        for r in cfg.get('blank_rects', []):
            u0, v0, u1, v1 = [int(v * S) for v in r]; R[v0:v1, u0:u1] = 248
        im = Image.fromarray(R.astype(np.uint8), 'RGB').convert('RGBA'); im.alpha_composite(det)
        if cfg.get('fill_rects'):
            dr2 = ImageDraw.Draw(im)
            for r in cfg['fill_rects']: dr2.rectangle([int(r[0] * S), int(r[1] * S), int(r[2] * S), int(r[3] * S)], fill=r[4])
        p = f"{cfg['out']}/{cfg['id']}{cfg.get('suffix', '')}-{lid}.jpg"; im.convert('RGB').save(p, 'JPEG', quality=86, optimize=True, progressive=True); out[lid] = p
    print('painted', cfg['id'], {k: round(np.count_nonzero(v) / S / S, 3) for k, v in {'M': M, 'F': F, 'E': E}.items()})
    return out

if __name__ == '__main__':
    main(json.load(open(sys.argv[1])))
