import struct, zlib, sys

P = r"C:\Users\admin\Downloads\stacked-16_Unknown_Duo-Band_20260922-111612454_0.png"
data = open(P, "rb").read()
print("size", len(data))
assert data[:8] == b"\x89PNG\r\n\x1a\n"

off = 8
chunks = []
idat = []
ihdr = None
while off < len(data):
    ln = struct.unpack(">I", data[off:off+4])[0]
    typ = data[off+4:off+8]
    body = data[off+8:off+8+ln]
    crc = struct.unpack(">I", data[off+8+ln:off+12+ln])[0]
    calc = zlib.crc32(typ + body) & 0xFFFFFFFF
    chunks.append((typ.decode("latin1"), ln, crc == calc))
    if typ == b"IHDR":
        ihdr = body
    if typ == b"IDAT":
        idat.append(body)
    off += 12 + ln

print("chunks:", chunks[:6], "..." if len(chunks) > 6 else "")
print("chunk types:", {t: sum(1 for c in chunks if c[0] == t) for t in {c[0] for c in chunks}})
print("all crc ok:", all(c[2] for c in chunks))

w, h, depth, ctype, comp, filt, inter = struct.unpack(">IIBBBBB", ihdr)
print(f"w={w} h={h} bitdepth={depth} colortype={ctype} compression={comp} filter={filt} interlace={inter}")

# raw scanline layout check
bpp = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype] * (depth // 8)
stride = w * bpp
raw = zlib.decompress(b"".join(idat))
print("raw len", len(raw), "expected", (stride + 1) * h, "match", len(raw) == (stride + 1) * h)
print("filter types used:", sorted({raw[y * (stride + 1)] for y in range(h)}))
