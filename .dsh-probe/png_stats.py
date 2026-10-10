import struct, zlib
import numpy as np

P = r"C:\Users\admin\Downloads\stacked-16_Unknown_Duo-Band_20260922-111612454_0.png"
data = open(P, "rb").read()

off = 8
idat = []
while off < len(data):
    ln = struct.unpack(">I", data[off:off+4])[0]
    typ = data[off+4:off+8]
    if typ == b"IHDR":
        w, h, depth, ctype = struct.unpack(">IIBB", data[off+8:off+18])
    if typ == b"IDAT":
        idat.append(data[off+8:off+8+ln])
    off += 12 + ln

bpp = 3 * (depth // 8)          # 6
stride = w * bpp
raw = zlib.decompress(b"".join(idat))
lines = np.frombuffer(raw, np.uint8).reshape(h, stride + 1)
print("filter types:", np.unique(lines[:, 0]))

hist = np.zeros((3, 4096), np.int64)   # 16bit >> 4
mins = np.full(3, 65535, np.int64)
maxs = np.zeros(3, np.int64)
BLK = 128
for y0 in range(0, h, BLK):
    y1 = min(y0 + BLK, h)
    body = lines[y0:y1, 1:].astype(np.int32)
    grp = body.reshape(y1 - y0, -1, bpp)
    dec = np.cumsum(grp, axis=1) % 256                      # Sub filter, all rows use filter 1
    px = dec.astype(np.uint8).reshape(y1 - y0, w, 3, 2)
    v = (px[:, :, :, 0].astype(np.uint16) << 8) | px[:, :, :, 1]   # big-endian
    for c in range(3):
        ch = v[:, :, c].ravel()
        mins[c] = min(mins[c], ch.min())
        maxs[c] = max(maxs[c], ch.max())
        hist[c] += np.bincount(ch >> 4, minlength=4096)

print("per-channel 16bit min:", mins, "max:", maxs)
for c in range(3):
    nz = np.nonzero(hist[c])[0]
    total = hist[c].sum()
    cum = np.cumsum(hist[c])
    def pct(p):
        return int(np.searchsorted(cum, total * p) << 4)
    print(f"ch{c}: nonzero buckets {nz.min()*16}..{nz.max()*16+15}  "
          f"p0.1={pct(0.001)} p1={pct(0.01)} p50={pct(0.5)} p99={pct(0.99)} p99.9={pct(0.999)}")

# how many of the low 8 bits are ever used (i.e. is it really 16-bit or 12-bit<<4 etc.)
low = np.zeros(3, np.int64)
for c in range(3):
    low[c] = sum(hist[c][i] for i in range(0, 4096) if i % 1 == 0 and (i & 0))  # placeholder
print("done")
