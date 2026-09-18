#!/usr/bin/env python3
"""Generate the minimal Tauri icon set without external tools.

Tauri's build fails without icons referenced in tauri.conf.json / its defaults.
We write a solid-color rounded square PNG (pure zlib, no deps), and an ICO
wrapping the same raw bitmap. macOS .icns is only needed for mac bundles, so
a minimal valid icns container with the PNG payload is produced too.
"""
import struct, zlib, os

OUT = "src-tauri/icons"
os.makedirs(OUT, exist_ok=True)

# RBuilder navy #06111f -> RGB
BG = (6, 17, 31)
FG = (77, 124, 255)  # accent dot

def png_bytes(size: int) -> bytes:
    # RGBA (Tauri requires RGBA icons); centered accent square on navy
    rows = []
    margin = size // 5
    for y in range(size):
        row = bytearray([0])  # filter none
        for x in range(size):
            if margin <= x < size - margin and margin <= y < size - margin:
                row += bytes(FG) + b"\xff"
            else:
                row += bytes(BG) + b"\xff"
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(typ: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + typ + data + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))

def ico_bytes(sizes=(16, 32, 48, 256)):
    images = [png_bytes(s) for s in sizes]
    header = struct.pack("<HHH", 0, 1, len(sizes))
    offset = 6 + 16 * len(sizes)
    entries = b""
    data = b""
    for s, img in zip(sizes, images):
        w = s % 256
        entries += struct.pack("<BBBBHHII", w, w, 0, 0, 1, 32, len(img), offset)
        offset += len(img)
        data += img
    return header + entries + data

def icns_bytes(size=512):
    # icns: 'icns' header + one it32/png entry
    png = png_bytes(512)
    icon_type = b"ic07" if size <= 128 else b"ic10"
    payload = icon_type + struct.pack(">I", len(png) + 8) + png
    return b"icns" + struct.pack(">I", len(payload) + 8) + payload

with open(f"{OUT}/icon.png", "wb") as f: f.write(png_bytes(512))
with open(f"{OUT}/32x32.png", "wb") as f: f.write(png_bytes(32))
with open(f"{OUT}/128x128.png", "wb") as f: f.write(png_bytes(128))
with open(f"{OUT}/128x128@2x.png", "wb") as f: f.write(png_bytes(256))
with open(f"{OUT}/icon.ico", "wb") as f: f.write(ico_bytes())
with open(f"{OUT}/icon.icns", "wb") as f: f.write(icns_bytes())
print("icons written:", sorted(os.listdir(OUT)))
