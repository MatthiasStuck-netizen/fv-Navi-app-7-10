import gzip, struct, json, sys
def d2xy(n, d):                      # unabhängige Umkehrung (Wikipedia)
    x = y = 0; t = d; s = 1
    while s < n:
        rx = 1 & (t // 2); ry = 1 & (t ^ rx)
        if ry == 0:
            if rx == 1: x = s - 1 - x; y = s - 1 - y
            x, y = y, x
        x += s * rx; y += s * ry; t //= 4; s *= 2
    return x, y
def varint(v):
    o = bytearray()
    while True:
        b = v & 0x7f; v >>= 7
        if v: o.append(b | 0x80)
        else: o.append(b); return bytes(o)
ids = {}                              # (z,x,y) -> tileId
acc = 0
for z in range(0, 5):
    n = 2 ** z
    for d in range(n * n):
        x, y = d2xy(n, d); ids[(z, x, y)] = acc + d
    acc += n * n
json.dump({f"{z}/{x}/{y}": i for (z, x, y), i in ids.items()}, open('ids.json', 'w'))
# Kacheln: je 3 aufeinanderfolgende IDs (ab 30) teilen sich denselben Inhalt (Run-Length)
byid = {i: k for k, i in ids.items()}
data = bytearray(); entries = []     # (id, off, len, run)
i = 0; maxid = max(byid)
while i <= maxid:
    z, x, y = byid[i]
    run = 3 if (30 <= i <= 32) else 1
    payload = gzip.compress(('T%d/%d/%d' % (z, x, y)).encode())
    entries.append((i, len(data), len(payload), run)); data += payload; i += run
def dirbytes(es):
    out = varint(len(es)); last = 0
    for e in es: out += varint(e[0] - last); last = e[0]
    for e in es: out += varint(e[3])
    for e in es: out += varint(e[2])
    prev = None
    for e in es:
        out += varint(0 if (prev is not None and e[1] == prev[1] + prev[2]) else e[1] + 1); prev = e
    return gzip.compress(out)
direct = [e for e in entries if e[0] < 20]; rest = [e for e in entries if e[0] >= 20]
leaves = bytearray(); ptr = []
for chunk in (rest[:len(rest)//2], rest[len(rest)//2:]):
    b = dirbytes(chunk); ptr.append((chunk[0][0], len(leaves), len(b), 0)); leaves += b
root = dirbytes(direct + ptr)
meta = gzip.compress(json.dumps({'vector_layers': [{'id': x} for x in ('water', 'transportation', 'building', 'landcover', 'place')]}).encode())
off_root = 127; off_meta = off_root + len(root); off_leaf = off_meta + len(meta); off_data = off_leaf + len(leaves)
h = bytearray(b'PMTiles') + bytes([3])
for v in (off_root, len(root), off_meta, len(meta), off_leaf, len(leaves), off_data, len(data), len(entries), len(entries), len(entries)): h += struct.pack('<Q', v)
h += bytes([1, 2, 2, 1, 0, 4])        # clustered, internal gzip, tile gzip, mvt, minz 0, maxz 4
h += struct.pack('<iiii', int(5.8e7), int(47.2e7), int(15.1e7), int(55.1e7)) + bytes([4]) + struct.pack('<ii', 0, 0)
assert len(h) == 127, len(h)
open('test.pmtiles', 'wb').write(h + root + meta + leaves + data)
print('ok', len(entries), 'Einträge,', len(ids), 'Kacheln')
