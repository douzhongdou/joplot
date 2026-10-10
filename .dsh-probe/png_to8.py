import struct, zlib, os
import numpy as np
from PIL import Image

P = r"C:\Users\admin\Downloads\stacked-16_Unknown_Duo-Band_20260922-111612454_0.png"
OUT = r"D:\HQL\code\tool\joplot\.dsh-probe\out"
os.makedirs(OUT, exist_ok=True)

data = open(P, "rb").read()
off, idat = 8, []
while off < len(data):
    ln = struct.unpack(">I", data[off:off+4])[0]
    typ = data[off+4:off+8]
    if typ == b"IHDR":
        w, h, depth, ctype = struct.unpack(">IIBB", data[off+8:off+18])
    if typ == b"IDAT":
        idat.append(data[off+8:off+8+ln])
    off += 12 + ln

bpp, stride = 6, w * 6
raw = zlib.decompress(b"".join(idat))
lines = np.frombuffer(raw, np.uint8).reshape(h, stride + 1)
BLK = 128


def rows(y0, y1):
    body = lines[y0:y1, 1:].astype(np.int32)
    dec = np.cumsum(body.reshape(y1 - y0, -1, bpp), axis=1) % 256
    px = dec.astype(np.uint8).reshape(y1 - y0, w, 3, 2)
    return ((px[:, :, :, 0].astype(np.uint16) << 8) | px[:, :, :, 1])


# pass 1: percentiles for the stretch window
hist = np.zeros(4096, np.int64)
for y0 in range(0, h, BLK):
    y1 = min(y0 + BLK, h)
    hist += np.bincount(rows(y0, y1).ravel() >> 4, minlength=4096)
cum = np.cumsum(hist)
total = hist.sum()
lo = int(np.searchsorted(cum, total * 0.001) << 4)
hi = int(np.searchsorted(cum, total * 0.999) << 4)
print("stretch window:", lo, hi)

# pass 2: full-res faithful >>8  +  stretched 4x downsample preview
p8 = np.empty((h, w, 3), np.uint8)
th, tw = h // 4, w // 4
thumb = np.empty((th, tw, 3), np.uint8)
for y0 in range(0, h, BLK):
    y1 = min(y0 + BLK, h)
    v = rows(y0, y1)
    p8[y0:y1] = (v >> 8).astype(np.uint8)
    s = np.clip((v.astype(np.int32) - lo) * 255 // max(hi - lo, 1), 0, 255).astype(np.uint8)
    t0, t1 = (y0 + 3) // 4, (y1 + 3) // 4
    if t1 > t0:
        sel = s[4 * t0 - y0: 4 * (t1 - 1) - y0 + 1: 4, ::4]
        thumb[t0:t1] = sel[: t1 - t0, :tw]

f1 = os.path.join(OUT, "stacked-16_8bit_downshift.png")
f2 = os.path.join(OUT, "stacked-16_8bit_stretch_thumb.png")
Image.fromarray(p8).save(f1, optimize=True)
Image.fromarray(thumb).save(f2)
print("mean 8bit value (downshift):", round(float(p8.mean()), 1))
for f in (f1, f2):
    print(f, os.path.getsize(f), Image.open(f).mode, Image.open(f).size)
