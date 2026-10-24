"""swap.py in.glb out.glb imagename=newimage.jpg ...  — replace embedded images by name and drop unused buffer data"""
import sys, json, struct
src, dst = sys.argv[1], sys.argv[2]; reps = dict(a.split('=', 1) for a in sys.argv[3:])
b = open(src, 'rb').read(); jl = struct.unpack('<I', b[12:16])[0]; J = json.loads(b[20:20 + jl]); b0 = 20 + jl + 8
old = b[b0:b0 + struct.unpack('<I', b[20 + jl:24 + jl])[0]]
datas = []  # per view: bytes
for v in J['bufferViews']: datas.append(old[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']])
swapped = set()
for ii, im in enumerate(J.get('images', [])):
    if im.get('name') in reps:
        datas[im['bufferView']] = open(reps[im['name']], 'rb').read(); im['mimeType'] = 'image/jpeg'; swapped.add(ii)
# liveries are opaque JPEGs: their materials must not be drawn as translucent
for m in J.get('materials', []):
    t = m.get('pbrMetallicRoughness', {}).get('baseColorTexture')
    if t is not None and J['textures'][t['index']]['source'] in swapped and m['pbrMetallicRoughness'].get('baseColorFactor', [1, 1, 1, 1])[3] > .99:
        m.pop('alphaMode', None)
binb = bytearray()
for v, d in zip(J['bufferViews'], datas):
    while len(binb) % 4: binb.append(0)
    v['byteOffset'] = len(binb); v['byteLength'] = len(d); binb.extend(d)
while len(binb) % 4: binb.append(0)
J['buffers'] = [{'byteLength': len(binb)}]
jb = json.dumps(J).encode()
while len(jb) % 4: jb += b' '
with open(dst, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, 28 + len(jb) + len(binb))); f.write(struct.pack('<II', len(jb), 0x4E4F534A)); f.write(jb); f.write(struct.pack('<II', len(binb), 0x004E4942)); f.write(binb)
