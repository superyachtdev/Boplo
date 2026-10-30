"""Give converted aircraft GLBs airliner-like materials: glossy clear-coated paint that reflects the sky, mirror glass,
bare metal on intakes, nozzles and chrome, matte rubber. Only the JSON chunk changes; geometry and textures stay.
python gloss.py model.glb [more.glb ...]   (rewrites in place; safe to run again)"""
import sys, json, struct, re

def classify(m):
    n = m.get('name', '').lower(); p = m.setdefault('pbrMetallicRoughness', {})
    col = p.get('baseColorFactor', [1, 1, 1, 1]); tex = 'baseColorTexture' in p; lum = sum(col[:3]) / 3; a = col[3] if len(col) > 3 else 1
    if re.search(r'glass|window|transp|canopy', n) or (not tex and a < .95): return 'glass'
    if re.search(r'chrome|alumin|nozzle|metal|steel|exhaust', n): return 'metal'
    if re.search(r'intake|interior|tyre|tire|rubber|black|dark|shade', n) or (not tex and lum < .12): return 'matte'
    if re.search(r'light|lamp|emit|red|green', n) and not tex: return 'lamp'
    return 'paint'

LOOK = {
    # roughness, metallic, clearcoat, clearcoat roughness
    'paint': (.3, 0.0, 1.0, .06),
    'glass': (.03, 0.0, 1.0, .02),
    'metal': (.28, .9, 0.0, 0.0),
    'matte': (.75, 0.0, 0.0, 0.0),
    'lamp': (.2, 0.0, .5, .05),
}

def gloss(path):
    b = bytearray(open(path, 'rb').read())
    assert b[:4] == b'glTF'
    jl = struct.unpack('<I', b[12:16])[0]; J = json.loads(b[20:20 + jl]); rest = b[20 + jl:]
    kinds = {}
    for m in J.get('materials', []):
        k = classify(m); kinds[k] = kinds.get(k, 0) + 1
        r, met, cc, ccr = LOOK[k]; p = m['pbrMetallicRoughness']
        p['roughnessFactor'] = r; p['metallicFactor'] = met
        ext = m.setdefault('extensions', {})
        if cc: ext['KHR_materials_clearcoat'] = {'clearcoatFactor': cc, 'clearcoatRoughnessFactor': ccr}
        else: ext.pop('KHR_materials_clearcoat', None)
        if not ext: m.pop('extensions')
    used = set(J.get('extensionsUsed', [])); used.add('KHR_materials_clearcoat'); J['extensionsUsed'] = sorted(used)
    js = json.dumps(J, separators=(',', ':')).encode(); js += b' ' * ((4 - len(js) % 4) % 4)
    out = b[:12] + struct.pack('<I', len(js)) + b'JSON' + js + rest
    out[8:12] = struct.pack('<I', len(out))
    open(path, 'wb').write(out)
    return kinds

if __name__ == '__main__':
    for f in sys.argv[1:]: print(f, gloss(f))
