import sys, zipfile, struct, hashlib, subprocess
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
apk, orig, www = sys.argv[1:4]
d = open(apk, 'rb').read(); z = zipfile.ZipFile(apk); zo = zipfile.ZipFile(orig)
print('ZIP-Test:', 'ok' if z.testzip() is None else 'FEHLER')
# Ausrichtung gespeicherter Dateien
bad = []
for i in z.infolist():
    if i.compress_type == 0:
        o = i.header_offset + 30 + len(i.filename.encode()) + struct.unpack_from('<H', d, i.header_offset + 28)[0]
        if o % 4: bad.append(i.filename)
print('Gespeichert & 4-Byte-ausgerichtet:', [i.filename for i in z.infolist() if i.compress_type == 0], '| Fehlausrichtung:', bad or 'keine')
# Inhalt: unverändert außer Oberfläche
gleich = all(z.read(n) == zo.read(n) for n in zo.namelist() if not n.startswith('META-INF/') and not n.startswith('assets/www/') and not n.endswith('/'))
print('Android-Teil (classes.dex, Manifest, Ressourcen) identisch zum Original:', gleich)
geaendert = sorted(n for n in z.namelist() if n.startswith('assets/www/') and (n not in zo.namelist() or z.read(n) != zo.read(n)))
print('Geänderte/neue Oberflächen-Dateien:', geaendert)
fehlt = [n for n in zo.namelist() if not n.startswith('META-INF/') and not n.endswith('/') and n not in z.namelist()]
print('Im Original vorhanden, jetzt fehlend:', fehlt or 'nichts')
# v1
r = subprocess.run(['jarsigner', '-verify', '-strict', apk], capture_output=True, text=True); print('v1 jarsigner:', [l for l in r.stdout.splitlines() if 'verified' in l or 'jar' in l.lower()][:2])
# v2 neu und unabhängig lesen
eocd = d.rfind(b'PK\x05\x06'); cdo = struct.unpack_from('<I', d, eocd + 16)[0]
assert d[cdo - 16:cdo] == b'APK Sig Block 42'
gr = struct.unpack_from('<Q', d, cdo - 24)[0]; start = cdo - gr - 8
assert struct.unpack_from('<Q', d, start)[0] == gr
pos = start + 8; v2 = None
while pos < cdo - 24:
    l, i = struct.unpack_from('<QI', d, pos)
    if i == 0x7109871a: v2 = d[pos + 12: pos + 8 + l]
    pos += 8 + l
def rd(b, p): n = struct.unpack_from('<I', b, p)[0]; return b[p + 4:p + 4 + n], p + 4 + n
sg, _ = rd(v2, 0); signer, _ = rd(sg, 0)
signed, p = rd(signer, 0); sigs, p = rd(signer, p); pub, p = rd(signer, p)
algo, sl = struct.unpack_from('<II', sigs, 4); sig = sigs[12:12 + sl]
key = serialization.load_der_public_key(pub); key.verify(sig, signed, padding.PKCS1v15(), hashes.SHA256())
print('v2 Signatur gültig (RSA-SHA256), Algorithmus', hex(algo))
dig, q = rd(signed, 0); certs, q = rd(signed, q); dd, _ = rd(dig, 0); ta, tl = struct.unpack_from('<II', dd, 0); soll = dd[8:8 + tl]
t1, t2 = d[:start], d[cdo:eocd]; t3 = bytearray(d[eocd:]); struct.pack_into('<I', t3, 16, start)
def ch(b):
    return [hashlib.sha256(b'\xa5' + struct.pack('<I', len(b[i:i + 1048576])) + b[i:i + 1048576]).digest() for i in range(0, len(b), 1048576)]
# Verzeichnis liegt in der Datei NACH dem Block: Abschnitt 2 = d[cdo:eocd]
alle = ch(t1) + ch(t2) + ch(bytes(t3))
ist = hashlib.sha256(b'\x5a' + struct.pack('<I', len(alle)) + b''.join(alle)).digest()
print('v2 Prüfsumme des gesamten Inhalts stimmt:', ist == soll)
c0, _ = rd(certs, 0); cert = x509.load_der_x509_certificate(c0); print('Zertifikat:', cert.subject.rfc4514_string(), '| gültig bis', cert.not_valid_after_utc.date())
print('Signaturblock beginnt bei', start, 'Verzeichnis bei', cdo, '| EOCD zeigt auf', cdo)
