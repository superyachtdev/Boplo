"""AC3D (.ac) -> glTF binary, for FlightGear aircraft exteriors.
Usage: python ac2glb.py model.ac out.glb [--exclude regex] [--gear regex] [--crease deg] [--tex name=path ...] [--maxtex 2048]
Axes: AC (FlightGear) x aft, y up, z left  ->  glTF +Z forward, +Y up, +X left (Boplo convention).
"""
import sys, re, os, json, struct, io, math, argparse
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('out'); ap.add_argument('parts', nargs='+', help='file.ac[@x,y,z] (FlightGear offsets, metres)')
ap.add_argument('--texdirs', default='')
ap.add_argument('--dump', default='')
ap.add_argument('--obj', default='')
ap.add_argument('--drop', default='')
ap.add_argument('--mirror', action='store_true')
ap.add_argument('--fus', default=r'(?i)^fuselage')
ap.add_argument('--exclude', default=r'(?i)fog|shadow|interior|inside|cockpit|flightdeck|light(s)?\b|lenz|lens|glow|halo|beam|_light|landlt|turnoff|logolt|winglts|strobe|beacon(lenz)?$|pilot|seat|yoke|panel|instrument|wiper|cargo_inside|windows-light')
ap.add_argument('--gear', default=r'(?i)^[NBWFM]LG|_LG|gear|wheel|tyre|tire|strut|compressor|hyd|torque|bogie|axle|brake|oleo|truck|drag.?brace|nosewheel|steer|tiller')
ap.add_argument('--geardoor', default=r'(?i)gear.?door|nosedoor|gearibdoor|geardoor')
ap.add_argument('--crease', type=float, default=40)
ap.add_argument('--tex', action='append', default=[])
ap.add_argument('--droptex', default=r'(?i)lights?/|glass_shader|fog|lightmap|surge|windows-lights')
ap.add_argument('--maxtex', type=int, default=2048)
ap.add_argument('--keep', default='')
a = ap.parse_args()
texmap = dict(t.split('=', 1) for t in a.tex)
texdirs = [d for d in a.texdirs.split(',') if d]
lines = []; i = 0; mats = []; matbase = 0; curdir = '.'; offset = np.zeros(3)
def resolve(tex):
    if tex in texmap: return texmap[tex]
    if os.path.basename(tex) in texmap: return texmap[os.path.basename(tex)]
    for d in [curdir] + texdirs:
        for c in (os.path.join(d, tex), os.path.join(d, os.path.basename(tex))):
            if os.path.exists(c): return os.path.abspath(c)
    return tex
def nxt():
    global i
    l = lines[i]; i += 1; return l
groups = {}  # key (tex, matidx, gear) -> lists
stats = {'objs': 0, 'skipped': [], 'tris': 0}

def parse_obj(M, L, path, skip):
    """M: 3x3 world rotation, L: world translation"""
    global i
    hdr = nxt().split()
    name = ''; tex = None; rot = np.eye(3); loc = np.zeros(3); verts = None; texrep = (1, 1); texoff = (0, 0); crease = a.crease; surfs = []
    while True:
        l = nxt()
        if not l.strip(): continue
        t = l.split()
        k = t[0]
        if k == 'name': name = l.split('"')[1] if '"' in l else t[1]
        elif k == 'data':
            n = int(t[1]); # data may span lines
            got = 0
            while got < n: got += len(nxt()) + 1
        elif k == 'texture': tex = resolve(l.split('"')[1])
        elif k == 'texrep': texrep = (float(t[1]), float(t[2]))
        elif k == 'texoff': texoff = (float(t[1]), float(t[2]))
        elif k == 'rot': rot = np.array([float(x) for x in t[1:10]]).reshape(3, 3)
        elif k == 'loc': loc = np.array([float(x) for x in t[1:4]])
        elif k == 'crease': crease = float(t[1])
        elif k in ('url', 'subdiv', 'hidden', 'locked', 'folded'): pass
        elif k == 'numvert':
            n = int(t[1]); verts = np.array([[float(x) for x in nxt().split()[:3]] for _ in range(n)])
        elif k == 'numsurf':
            n = int(t[1])
            for _ in range(n):
                st = nxt().split(); flags = int(st[1], 16)
                mat = 0; refs = []
                while True:
                    l2 = nxt().split()
                    if l2[0] == 'mat': mat = int(l2[1])
                    elif l2[0] == 'refs':
                        for _ in range(int(l2[1])):
                            r = nxt().split(); refs.append((int(r[0]), float(r[1]), float(r[2])))
                        break
                surfs.append((flags, mat, refs))
        elif k == 'kids':
            nk = int(t[1]); break
    WM = M @ rot.T if False else M @ rot   # AC3D rot is row-major 3x3 applied as v*rot? use M@rot and verify visually
    WL = L + M @ loc
    full = path + '/' + name
    sk = skip or bool(a.drop and re.search(a.drop, name)) or (re.search(a.exclude, name) and not (a.keep and re.search(a.keep, name))) or hdr[1] == 'light'
    if tex and re.search(a.droptex, tex): sk = True
    if sk and name: stats['skipped'].append(name)
    if verts is not None and surfs and not sk:
        stats['objs'] += 1
        V = (WM @ verts.T).T + WL
        isgear = bool(re.search(a.gear, full)) or bool(re.search(a.geardoor, name))
        if a.obj and not re.search(a.obj, name): pass
        else: add_mesh(V, surfs, tex, texrep, texoff, crease, isgear, name)
    for _ in range(nk): parse_obj(WM, WL, full, False)

def add_mesh(V, surfs, tex, texrep, texoff, crease, isgear, oname=''):
    if os.environ.get('OBJBOX'): print('OBJ', oname, os.path.basename(tex or '-'), V.min(0).round(2).tolist(), V.max(0).round(2).tolist())
    # triangulate (fan), only polygons (flags type 0)
    tri = []  # (vi, u, v, mat)
    two = []
    for flags, mat, refs in surfs:
        typ = flags & 0xF
        if typ != 0 or len(refs) < 3: continue
        dbl = bool(flags & 0x20)
        for k in range(1, len(refs) - 1):
            tri.append((refs[0], refs[k], refs[k + 1], mat + matbase, dbl))
    if not tri: return
    # face normals
    P = np.array([[V[r[0]] for r in t[:3]] for t in tri])  # T x 3 x 3
    fn = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]); ln = np.linalg.norm(fn, axis=1); ok = ln > 1e-12
    fn[ok] /= ln[ok][:, None]
    # smooth normals per position with crease
    cosc = math.cos(math.radians(min(crease, 89)))
    from collections import defaultdict
    vf = defaultdict(list)
    for ti, t in enumerate(tri):
        for c in range(3): vf[t[c][0]].append(ti)
    for ti, t in enumerate(tri):
        if not ok[ti]: continue
        key = (tex, t[3], isgear)
        g = groups.setdefault(key, {'p': [], 'n': [], 'uv': [], 'o': []})
        g['o'].append(oname)
        for c in range(3):
            vi, u, v = t[c]
            fs = vf[vi]; n = np.zeros(3)
            for fj in fs:
                if ok[fj] and np.dot(fn[fj], fn[ti]) >= cosc: n += fn[fj]
            ln2 = np.linalg.norm(n); n = n / ln2 if ln2 > 0 else fn[ti]
            g['p'].append(V[vi]); g['n'].append(n); g['uv'].append((u * texrep[0] + texoff[0], 1 - (v * texrep[1] + texoff[1])))
        stats['tris'] += 1

for part in a.parts:
    fpath, _, off = part.partition('@')
    offset = np.array([float(x) for x in off.split(',')]) if off else np.zeros(3)
    lines = open(fpath, encoding='latin-1').read().split('\n'); i = 1; curdir = os.path.dirname(fpath) or '.'; matbase = len(mats)
    # FG offsets (x aft, y right, z up) -> AC (x aft, y up, z left)
    L0 = np.array([offset[0], offset[2], -offset[1]])
    while i < len(lines):
        l = lines[i]
        if l.startswith('MATERIAL'):
            i += 1
            t = l.split()
            nm = l.split('"')[1]
            def grab(key, n):
                j = t.index(key); return [float(x) for x in t[j + 1:j + 1 + n]]
            mats.append({'name': nm, 'rgb': grab('rgb', 3), 'emis': grab('emis', 3), 'spec': grab('spec', 3), 'shi': grab('shi', 1)[0], 'trans': grab('trans', 1)[0]})
        elif l.startswith('OBJECT'):
            parse_obj(np.eye(3), L0, '', False)
        else:
            i += 1

# axis remap AC(x aft, y up, z left?) -> ours(+X left, +Y up, +Z fwd)
def remap(p):
    p = np.asarray(p); return np.stack([-p[:, 2] if a.mirror else p[:, 2], p[:, 1], -p[:, 0]], 1)

out = {'groups': []}
bin_ = bytearray(); views = []; accs = []; gmats = []; meshes = {'body': [], 'gear': []}; images = []; textures = []; teximg = {}
def addview(b, target=None):
    while len(bin_) % 4: bin_.append(0)
    off = len(bin_); bin_.extend(b); v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(b)}
    if target: v['target'] = target
    views.append(v); return len(views) - 1
def tex_index(tex):
    if tex in teximg: return teximg[tex]
    path = tex if os.path.exists(tex) else None
    if not path: teximg[tex] = None; print('missing tex', tex); return None
    im = Image.open(path); hasA = im.mode in ('RGBA', 'LA', 'P') and im.convert('RGBA').getextrema()[3][0] < 250
    im = im.convert('RGBA' if hasA else 'RGB')
    if max(im.size) > a.maxtex: k = a.maxtex / max(im.size); im = im.resize((int(im.width * k), int(im.height * k)), Image.LANCZOS)
    buf = io.BytesIO()
    if hasA: im.save(buf, 'PNG', optimize=True); mime = 'image/png'
    else: im.save(buf, 'JPEG', quality=88); mime = 'image/jpeg'
    images.append({'bufferView': addview(buf.getvalue()), 'mimeType': mime, 'name': os.path.basename(tex)})
    textures.append({'source': len(images) - 1, 'sampler': 0})
    teximg[tex] = (len(textures) - 1, hasA); return teximg[tex]

allP = []
for (tex, mi, gear), g in groups.items():
    P = remap(np.array(g['p'], np.float32)).astype(np.float32); N = remap(np.array(g['n'], np.float32)).astype(np.float32); UV = np.array(g['uv'], np.float32)
    # remap flips handedness? x'=z,y'=y,z'=-x : det = +1 (rotation), winding preserved
    allP.append(P)
    if a.mirror:
        P = P.reshape(-1, 3, 3)[:, ::-1].reshape(-1, 3).copy(); N = N.reshape(-1, 3, 3)[:, ::-1].reshape(-1, 3).copy(); UV = UV.reshape(-1, 3, 2)[:, ::-1].reshape(-1, 2).copy()
    g['P'], g['N'], g['UV'] = P, N, UV
allP = np.concatenate(allP)
# ---- recentre: origin on the fuselage axis, slightly ahead of the main gear (about where the centre of gravity sits) ----
gearP = np.concatenate([g['P'] for k, g in groups.items() if k[2]] or [np.zeros((0, 3), np.float32)])
bodyP = np.concatenate([g['P'] for k, g in groups.items() if not k[2]])
bmn, bmx = bodyP.min(0), bodyP.max(0)
cx = (bmn[0] + bmx[0]) / 2
if len(gearP):
    gz = gearP[:, 2]; mid = (gz.min() + gz.max()) / 2
    mainZ = gz[gz < mid].mean(); noseZ = gz[gz >= mid].mean()
else:
    mainZ = bmn[2] + (bmx[2] - bmn[2]) * .45; noseZ = bmx[2] - (bmx[2] - bmn[2]) * .12
cz = mainZ + .08 * (noseZ - mainZ)
zs = mainZ + .62 * (noseZ - mainZ)
fusP = np.concatenate([g['P'].reshape(-1, 3, 3)[[bool(re.search(a.fus, o)) for o in g['o']]].reshape(-1, 3) for k, g in groups.items() if not k[2]])
sl = fusP[np.abs(fusP[:, 2] - zs) < 3]
if len(sl) < 20: sl = fusP
cy = (sl[:, 1].min() + sl[:, 1].max()) / 2
dia = float(sl[:, 0].max() - sl[:, 0].min()); hgt = float(sl[:, 1].max() - sl[:, 1].min())
T = np.array([cx, cy, cz], np.float32)
for g in groups.values(): g['P'] = g['P'] - T
allP = allP - T; bodyP = bodyP - T; gearP = gearP - T
mn, mx = allP.min(0), allP.max(0)
li = bodyP[:, 0].argmax(); fi = bodyP[:, 1].argmax()
meta = {'span': float(bmx[0] - bmn[0]), 'len': float(bmx[2] - bmn[2]), 'dia': dia, 'hgt': hgt, 'yMin': float(mn[1]), 'noseTip': float(bodyP[:, 2].max()), 'tailZ': float(bodyP[:, 2].min()),
        'mainZ': float(mainZ - cz), 'noseZ': float(noseZ - cz), 'tip': [round(float(v), 2) for v in bodyP[li]], 'fin': [round(float(v), 2) for v in bodyP[fi]], 'gearVerts': int(len(gearP))}
print('META', json.dumps({k: (round(v, 2) if isinstance(v, float) else v) for k, v in meta.items()}))
json.dump(meta, open(os.path.splitext(a.out)[0] + '.json', 'w'))
if a.dump:
    D = {'P': [], 'UV': [], 'O': [], 'tex': []}
    for (tex, mi, gear), g in groups.items():
        if tex and re.search(a.dump, os.path.basename(tex)):
            n = len(g['P']) // 3
            D['P'].append(g['P'].reshape(n, 3, 3)); D['UV'].append(g['UV'].reshape(n, 3, 2)); D['O'] += g['o']; D['tex'] += [os.path.basename(tex)] * n
    np.savez_compressed(os.path.splitext(a.out)[0] + '_uv.npz', P=np.concatenate(D['P']), UV=np.concatenate(D['UV']), O=np.array(D['O']), tex=np.array(D['tex']))
print('bbox', mn.round(2), mx.round(2), 'size', (mx - mn).round(2), 'tris', stats['tris'])

matcache = {}
for (tex, mi, gear), g in groups.items():
    P, N, UV = g['P'], g['N'], g['UV']
    key = np.concatenate([np.round(P, 4), np.round(N, 3), np.round(UV, 5)], 1)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    P, N, UV = P[first], N[first], UV[first]; idx = inv.reshape(-1).astype(np.uint32); n = len(P)
    ti = tex_index(tex) if tex else None
    m = mats[mi] if mi < len(mats) else {'rgb': [.8, .8, .8], 'spec': [.3] * 3, 'shi': 30, 'trans': 0, 'emis': [0, 0, 0], 'name': 'x'}
    mk = (ti[0] if ti else None, mi)
    if mk not in matcache:
        alpha = 1 - m['trans']
        col = m['rgb'] if not ti else [1, 1, 1]
        if re.search(r'(?i)glass|window', m['name']) and not ti and alpha < .9: col, alpha = [.07, .09, .12], .92
        if not ti and max(m['emis']) > .3: col, alpha = [.08, .1, .13], 1
        pbr = {'baseColorFactor': [*[float(c) for c in col], float(alpha)], 'metallicFactor': 0.1, 'roughnessFactor': float(max(.15, 1 - min(m['shi'], 128) / 128 * .85))}
        if ti: pbr['baseColorTexture'] = {'index': ti[0]}
        md = {'name': m['name'][:40], 'pbrMetallicRoughness': pbr, 'doubleSided': True}
        if alpha < .99 or (ti and ti[1]): md['alphaMode'] = 'BLEND'
        gmats.append(md); matcache[mk] = len(gmats) - 1
    aP = len(accs); accs.append({'bufferView': addview(P.tobytes(), 34962), 'componentType': 5126, 'count': n, 'type': 'VEC3', 'min': P.min(0).tolist(), 'max': P.max(0).tolist()})
    aN = len(accs); accs.append({'bufferView': addview(N.tobytes(), 34962), 'componentType': 5126, 'count': n, 'type': 'VEC3'})
    attrs = {'POSITION': aP, 'NORMAL': aN}
    if ti: aT = len(accs); accs.append({'bufferView': addview(UV.tobytes(), 34962), 'componentType': 5126, 'count': n, 'type': 'VEC2'}); attrs['TEXCOORD_0'] = aT
    i16 = n < 65535
    aI = len(accs); accs.append({'bufferView': addview((idx.astype(np.uint16) if i16 else idx).tobytes(), 34963), 'componentType': 5123 if i16 else 5125, 'count': len(idx), 'type': 'SCALAR'})
    meshes['gear' if gear else 'body'].append({'attributes': attrs, 'indices': aI, 'material': matcache[mk]})

gm = []; nodes = []
for k in ('body', 'gear'):
    if meshes[k]: gm.append({'name': k, 'primitives': meshes[k]}); nodes.append({'name': k, 'mesh': len(gm) - 1})
while len(bin_) % 4: bin_.append(0)
J = {'asset': {'version': '2.0', 'generator': 'Boplo ac2glb'}, 'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': gm, 'materials': gmats, 'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(bin_)}]}
if images: J['images'] = images; J['textures'] = textures; J['samplers'] = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}]
jb = json.dumps(J).encode()
while len(jb) % 4: jb += b' '
with open(a.out, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(bin_)))
    f.write(struct.pack('<II', len(jb), 0x4E4F534A)); f.write(jb)
    f.write(struct.pack('<II', len(bin_), 0x004E4942)); f.write(bin_)
print('wrote', a.out, os.path.getsize(a.out), 'objs', stats['objs'], 'prims', sum(len(v) for v in meshes.values()), 'skipped', sorted(set(stats['skipped']))[:60])
