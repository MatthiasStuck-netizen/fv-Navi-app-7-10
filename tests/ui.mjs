import fs from 'fs'; import vm from 'vm';
const W = process.argv[2];
const log = []; const els = {};
const el = (id) => (els[id] = els[id] || { id, innerHTML: '', outerHTML: '', value: 'https://www.fehnverleih.de/karten/deutschland.pmtiles' });
const document = { querySelector: (s) => (['#okblock', '#vfuss', '#okurl', '#seite'].includes(s) ? el(s) : null) };
let stand = { art: 'leer', fertig: 0, gesamt: 0, fehler: '' }, ort = { lat: 53.0, lon: 7.0, tempo: 5, kurs: 90, genau: 5 }, hoerer = [];
const K = new Proxy({}, { get: (t, k) => (...a) => { log.push(k + '(' + JSON.stringify(a).slice(0, 90) + ')'); } });
const FV = { esc: (t) => String(t == null ? '' : t), sym: (n) => '[' + n + ']',
  B: { lesen: () => null, schreiben() {}, ort: () => ort, ortStart() {}, wach: (x) => log.push('wach' + x), beiOrt: (f) => { hoerer.push(f); return () => log.push('abgemeldet'); }, OFFLINE_APPS: {}, appDa: () => false },
  S: {}, F: {}, K,
  O: { stand: () => stand, moeglich: () => true, modus: () => 'auto', url: () => 'https://www.fehnverleih.de/karten/deutschland.pmtiles', da: () => stand.art === 'bereit', hat: () => true, beiStand() {}, erzwungen: false, laden: (u) => log.push('laden ' + u), pause() {}, loeschen() {} },
  app: { e: {}, z: { nav: null }, speichern() { log.push('gespeichert'); }, toast: (t) => log.push('toast: ' + t), frage: () => ({ then: (f) => f(true) }), neu() {}, oben: () => 'fahrt' } };
const ctx = { FV, document, console, Math, Date, JSON, Promise, setTimeout, clearTimeout, navigator: { onLine: true } }; vm.createContext(ctx);
const geo = fs.readFileSync(W + '/geo.js', 'utf8');
try { vm.runInContext(geo, ctx); } catch (e) { console.log('geo.js nicht ladbar im Test:', e.message); }
FV.G = FV.G || {};
vm.runInContext(fs.readFileSync(W + '/seiten.js', 'utf8'), ctx);
const Tun = FV.Tun;
function render(art, extra) { stand = Object.assign({ art, fertig: 0, gesamt: 0, fehler: '' }, extra || {}); Tun['okarte-modus']({ getAttribute: () => 'auto' }); return els['#okblock'].outerHTML; }
for (const [a, x] of [['leer', {}], ['teil', { fertig: 1.2e9, gesamt: 4e9 }], ['laedt', { fertig: 2e9, gesamt: 4e9 }], ['bereit', { fertig: 4e9, gesamt: 4e9 }], ['leer', { fehler: 'Der Server antwortet mit Fehler 404.' }]]) {
  const h = render(a, x); console.log('--', a, h.includes('Weiterladen') ? '[Weiterladen]' : '', h.includes('Karte laden') ? '[Karte laden]' : '', x.fehler ? '(Fehler)' : '', '→', h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 170));
}
Tun['okarte-laden']({}); console.log('Laden angestoßen:', log.filter((l) => l.startsWith('laden')).join());
// Offline unterwegs
stand = { art: 'bereit', fertig: 4e9, gesamt: 4e9, fehler: '' }; FV.app.z.nav = { ziel: { adresse: 'Hauptstr. 1\n26789 Leer', name: 'Kunde' }, nach: { lat: 53.2, lon: 7.45 } };
log.length = 0; Tun['offline-fahren']();
console.log('Offline-Fahrt:', log.join(' | ').slice(0, 330));
console.log('Fußzeile:', els['#vfuss'].innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), '| erzwungen:', FV.O.erzwungen);
log.length = 0; ort = { lat: 53.1, lon: 7.2, tempo: 6, kurs: 45, genau: 5 }; hoerer.forEach((f) => f(ort)); console.log('Neue Position →', log.join(' | ').slice(0, 260));
log.length = 0; try { Tun['offline-ende'](); } catch (e) { log.push('(Testumgebung: Seite neu aufbauen nicht simuliert)'); } console.log('Beenden:', log.join(' | ').slice(0, 200), '| erzwungen:', FV.O.erzwungen);
FV.app.z.nav = { ziel: { adresse: 'X' } }; log.length = 0; Tun['offline-fahren'](); console.log('Ohne Koordinaten:', log.filter((l) => l.startsWith('toast')).join());
