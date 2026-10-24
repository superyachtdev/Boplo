"""Minimal GIMP .xcf reader: lists layers and extracts each as a PIL RGBA image (8-bit, RLE or uncompressed)."""
import struct, sys, zlib
import numpy as np
from PIL import Image

class XCF:
    def __init__(self, path):
        self.b = open(path, 'rb').read(); b = self.b
        assert b[:9] == b'gimp xcf ', 'not xcf'
        ver = b[9:13]; self.ver = 0 if ver == b'file' else int(ver[1:].decode())
        self.p = 14
        self.w, self.h, self.base = self.u32(), self.u32(), self.u32()
        self.prec = self.u32() if self.ver >= 4 else 150
        self.comp = 0
        for t, d in self.props():
            if t == 17: self.comp = d[0]
        self.layers = []
        while True:
            ptr = self.ptr()
            if not ptr: break
            self.layers.append(self.layer(ptr))
    def u32(self):
        v = struct.unpack('>I', self.b[self.p:self.p + 4])[0]; self.p += 4; return v
    def i32(self):
        v = struct.unpack('>i', self.b[self.p:self.p + 4])[0]; self.p += 4; return v
    def ptr(self):
        if self.ver >= 11:
            v = struct.unpack('>Q', self.b[self.p:self.p + 8])[0]; self.p += 8; return v
        return self.u32()
    def props(self):
        out = []
        while True:
            t = self.u32(); n = self.u32(); d = self.b[self.p:self.p + n]; self.p += n
            if t == 0: break
            out.append((t, d))
        return out
    def layer(self, ptr):
        save = self.p; self.p = ptr
        w, h, typ = self.u32(), self.u32(), self.u32()
        n = self.u32(); name = self.b[self.p:self.p + n - 1].decode('utf-8', 'replace'); self.p += n
        L = {'name': name, 'w': w, 'h': h, 'type': typ, 'visible': True, 'opacity': 255, 'x': 0, 'y': 0, 'mode': 0, 'group': False, 'path': None}
        for t, d in self.props():
            if t == 8: L['visible'] = bool(struct.unpack('>I', d[:4])[0])
            elif t == 6: L['opacity'] = struct.unpack('>I', d[:4])[0]
            elif t == 33: L['opacity'] = int(struct.unpack('>f', d[:4])[0] * 255)
            elif t == 7: L['mode'] = struct.unpack('>I', d[:4])[0]
            elif t == 15: L['x'], L['y'] = struct.unpack('>ii', d[:8])
            elif t == 29: L['group'] = True
            elif t == 30: L['path'] = struct.unpack('>' + 'I' * (len(d) // 4), d)
        L['hptr'] = self.ptr(); L['mptr'] = self.ptr()
        self.p = save; return L
    def pixels(self, L):
        if L['group'] or not L['hptr']: return None
        save = self.p; self.p = L['hptr']
        w, h, bpp = self.u32(), self.u32(), self.u32()
        lp = self.ptr(); self.p = lp
        lw, lh = self.u32(), self.u32()
        tiles = []
        while True:
            t = self.ptr()
            if not t: break
            tiles.append(t)
        img = np.zeros((h, w, bpp), np.uint8)
        tx = (w + 63) // 64
        for k, t in enumerate(tiles):
            x0, y0 = (k % tx) * 64, (k // tx) * 64; tw, th = min(64, w - x0), min(64, h - y0); n = tw * th
            if self.comp == 1:
                p = t; out = np.zeros((bpp, n), np.uint8); b = self.b
                for c in range(bpp):
                    i = 0
                    while i < n:
                        op = b[p]; p += 1
                        if op <= 126: cnt = op + 1; out[c, i:i + cnt] = b[p]; p += 1; i += cnt
                        elif op == 127: cnt = b[p] * 256 + b[p + 1]; p += 2; out[c, i:i + cnt] = b[p]; p += 1; i += cnt
                        elif op == 128: cnt = b[p] * 256 + b[p + 1]; p += 2; out[c, i:i + cnt] = np.frombuffer(b, np.uint8, cnt, p); p += cnt; i += cnt
                        else: cnt = 256 - op; out[c, i:i + cnt] = np.frombuffer(b, np.uint8, cnt, p); p += cnt; i += cnt
                tile = out.T.reshape(th, tw, bpp)
            elif self.comp == 2:
                raw = zlib.decompress(self.b[t:t + 64 * 64 * bpp * 2 + 1024]) if False else zlib.decompressobj().decompress(self.b[t:])
                tile = np.frombuffer(raw[:n * bpp], np.uint8).reshape(th, tw, bpp)
            else:
                tile = np.frombuffer(self.b, np.uint8, n * bpp, t).reshape(th, tw, bpp)
            img[y0:y0 + th, x0:x0 + tw] = tile
        self.p = save
        mode = {1: 'L', 2: 'LA', 3: 'RGB', 4: 'RGBA'}[bpp]
        im = Image.fromarray(img[:, :, 0] if bpp == 1 else img, mode)
        return im.convert('RGBA')

if __name__ == '__main__':
    x = XCF(sys.argv[1]); print('ver', x.ver, x.w, x.h, 'comp', x.comp, 'prec', x.prec)
    for i, L in enumerate(x.layers): print(i, repr(L['name']), L['w'], L['h'], 'vis' if L['visible'] else 'hid', 'op', L['opacity'], 'mode', L['mode'], 'grp' if L['group'] else '', L['path'], (L['x'], L['y']))
