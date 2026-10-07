#!/usr/bin/env python3
"""Navi-APK neu packen (ausgerichtet) und signieren (v1 + v2).  Aufruf: bauen.py <original.apk> <www-Ordner> <schluessel.p12> <passwort> <ziel.apk>"""
import sys, os, io, zipfile, struct, hashlib, subprocess, tempfile, shutil, datetime
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography import x509
from cryptography.x509.oid import NameOID

orig, www, p12, pw, ziel = sys.argv[1:6]
WORK = os.path.dirname(os.path.abspath(p12))

# ---------- 1) Schlüssel (einmalig anlegen, danach immer denselben nehmen) ----------
if not os.path.exists(p12):
    key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Fehnverleih Navi'), x509.NameAttribute(NameOID.ORGANIZATION_NAME, 'Fehnverleih')])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(days=1)).not_valid_after(now + datetime.timedelta(days=10000)).sign(key, hashes.SHA256()))
    open(p12, 'wb').write(pkcs12.serialize_key_and_certificates(b'fvnavi', key, cert, None, serialization.BestAvailableEncryption(pw.encode())))
    print('Neuer Schlüssel angelegt:', p12)
key, cert, _ = pkcs12.load_key_and_certificates(open(p12, 'rb').read(), pw.encode())

# ---------- 2) Neu packen: Reihenfolge und Kompression wie im Original, 4-Byte-ausgerichtet ----------
zo = zipfile.ZipFile(orig)
alt = {i.filename: i for i in zo.infolist()}
namen = [i.filename for i in zo.infolist() if not i.is_dir() and not (i.filename.startswith('META-INF/') and i.filename.rsplit('.', 1)[-1] in ('SF', 'RSA', 'DSA', 'EC', 'MF'))]
for root, _, files in os.walk(www):
    for f in sorted(files):
        n = 'assets/www/' + os.path.relpath(os.path.join(root, f), www).replace(os.sep, '/')
        if n not in alt and n not in namen: namen.append(n)

def holen(n):
    if n.startswith('assets/www/'):
        pfad = os.path.join(www, n[len('assets/www/'):])
        if os.path.exists(pfad): return open(pfad, 'rb').read()
    return zo.read(n)

def schreiben(zf, n, daten, komp):
    zi = zipfile.ZipInfo(n, (2026, 10, 7, 0, 0, 0)); zi.compress_type = komp; zi.create_system = 3
    base = zf.fp.tell() + 30 + len(n.encode()); need = (-base) % 4
    if komp == zipfile.ZIP_STORED and need:
        L = need + 4 if need + 4 >= 6 else need + 8
        zi.extra = struct.pack('<HHH', 0xD935, L - 4, 4) + b'\0' * (L - 6)
    zf.writestr(zi, daten)

roh = io.BytesIO()
with zipfile.ZipFile(roh, 'w') as zf:
    for n in namen:
        komp = zipfile.ZIP_STORED if (n in alt and alt[n].compress_type == 0) or n == 'resources.arsc' else zipfile.ZIP_DEFLATED
        schreiben(zf, n, holen(n), komp)

# ---------- 3) v1 (JAR-Signatur) mit jarsigner auf einer Kopie, Dateien übernehmen ----------
tmp = tempfile.mkdtemp()
u = os.path.join(tmp, 'u.apk'); s = os.path.join(tmp, 's.apk'); open(u, 'wb').write(roh.getvalue())
subprocess.run(['jarsigner', '-keystore', p12, '-storetype', 'PKCS12', '-storepass', pw, '-sigalg', 'SHA256withRSA', '-digestalg', 'SHA-256',
                '-sigfile', 'CERT', '-signedjar', s, u, 'fvnavi'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
zs = zipfile.ZipFile(s)
meta = [n for n in zs.namelist() if n.startswith('META-INF/') and n.rsplit('.', 1)[-1] in ('MF', 'SF', 'RSA')]
mf = zs.read('META-INF/MANIFEST.MF'); sf = zs.read('META-INF/CERT.SF')
fin = io.BytesIO()
with zipfile.ZipFile(io.BytesIO(roh.getvalue())) as a, zipfile.ZipFile(fin, 'w') as zf:
    for i in a.infolist():
        schreiben(zf, i.filename, a.read(i.filename), i.compress_type)
    for n in ('META-INF/MANIFEST.MF', 'META-INF/CERT.SF', 'META-INF/CERT.RSA'):
        schreiben(zf, n, zs.read(n), zipfile.ZIP_DEFLATED)
d = bytearray(fin.getvalue())

# ---------- 4) v2 (APK Signature Scheme v2) ----------
eocd = d.rfind(b'PK\x05\x06'); cd_off = struct.unpack_from('<I', d, eocd + 16)[0]
teil1, teil2, teil3 = bytes(d[:cd_off]), bytes(d[cd_off:eocd]), bytearray(d[eocd:])
struct.pack_into('<I', teil3, 16, cd_off)           # für die Prüfsumme: Verzeichnis-Anfang = Beginn des Signaturblocks
def chunks(b):
    for i in range(0, len(b), 1 << 20): yield b[i:i + (1 << 20)]
cd = []
for t in (teil1, teil2, bytes(teil3)):
    for c in chunks(t): cd.append(hashlib.sha256(b'\xa5' + struct.pack('<I', len(c)) + c).digest())
top = hashlib.sha256(b'\x5a' + struct.pack('<I', len(cd)) + b''.join(cd)).digest()
def lp(b): return struct.pack('<I', len(b)) + b
ALGO = 0x0103   # RSASSA-PKCS1-v1_5 mit SHA-256
der = cert.public_bytes(serialization.Encoding.DER)
signiert = lp(lp(struct.pack('<II', ALGO, len(top)) + top)) + lp(lp(der)) + lp(b'')
sig = key.sign(signiert, padding.PKCS1v15(), hashes.SHA256())
pub = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
signer = lp(signiert) + lp(lp(struct.pack('<II', ALGO, len(sig)) + sig)) + lp(pub)
wert = lp(lp(signer))
paar = struct.pack('<QI', 4 + len(wert), 0x7109871a) + wert
block = struct.pack('<Q', len(paar) + 24) + paar + struct.pack('<Q', len(paar) + 24) + b'APK Sig Block 42'
neu = bytearray(teil1 + block + teil2 + bytes(d[eocd:]))
struct.pack_into('<I', neu, len(teil1) + len(block) + len(teil2) + 16, cd_off + len(block))
open(ziel, 'wb').write(neu)
shutil.rmtree(tmp)
print('Fertig:', ziel, len(neu), 'Bytes')
