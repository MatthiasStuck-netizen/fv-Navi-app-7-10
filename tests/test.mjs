import fs from 'fs'; import vm from 'vm';
const src = fs.readFileSync(process.argv[2], 'utf8');
const ctx = { FV: { B: { lesen: () => ({}), schreiben() {}, wach() {} } }, window: { Worker: 1, DecompressionStream, maplibregl: null }, navigator: { storage: {}, onLine: true }, console, Blob, Response, DecompressionStream, Promise, setTimeout, URL };
ctx.window.window = ctx.window; vm.createContext(ctx); vm.runInContext(src, ctx);
const T = ctx.FV.O._t, ids = JSON.parse(fs.readFileSync('ids.json'));
let bad = 0;
for (const [k, id] of Object.entries(ids)) { const [z, x, y] = k.split('/').map(Number); if (T.kachelId(z, x, y) !== id) { bad++; if (bad < 4) console.log('FALSCH', k, T.kachelId(z, x, y), id); } }
console.log('Kachel-IDs geprüft:', Object.keys(ids).length, 'falsch:', bad);
const buf = fs.readFileSync('test.pmtiles'); const datei = new Blob([buf]);
const l = await new T.Leser(datei).start(); console.log('Kopf:', JSON.stringify(l.k));
let ok = 0, fail = 0;
for (const k of Object.keys(ids)) { const [z, x, y] = k.split('/').map(Number); const u = await l.kachel(z, x, y);
  const t = u && new TextDecoder().decode(u); const idn = ids[k]; const lauf = idn >= 30 && idn <= 32;
  const erw = lauf ? null : 'T' + k; if ((lauf && t && /^T\d/.test(t)) || (!lauf && t === erw)) ok++; else { fail++; if (fail < 4) console.log('FEHLER', k, t, erw); } }
console.log('Kacheln gelesen ok:', ok, 'Fehler:', fail);
console.log('Kachel außerhalb (z5):', await l.kachel(5, 0, 0), '| fehlt im Archiv:', (await l.kachel(4, 0, 0)) ? 'vorhanden' : 'null');
