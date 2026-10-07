import fs from 'fs'; import vm from 'vm';
const W = process.argv[2]; const log = []; const wl = {};
const feld = { attrs: {}, parentNode: null, setAttribute(k, v) { this.attrs[k] = v; }, insertBefore() {}, className: '' };
const ziel = { insertBefore(e) { feld.parentNode = ziel; }, };
class Map { constructor(o) { this.o = o; this.h = {}; log.push('Map(' + (o.style.name || (o.style.sources.openmaptiles ? 'online-vektor' : '?')) + ')'); this.src = {};
  setTimeout(() => this.h.load && this.h.load(), 0); }
  on(e, f) { this.h[e] = f; } once(e, f) { this.h['1' + e] = f; } resize() {} getStyle() { return { layers: [] }; } getSource(k) { return this.src[k]; } getLayer() { return null; }
  addSource(k) { this.src[k] = { setData() {} }; } addLayer() {} touchZoomRotate = { disableRotation() {} }; getContainer() { return { clientHeight: 400 }; }
  setStyle(st) { log.push('setStyle(' + (st.name === 'fv-offline' || JSON.stringify(st.sources).includes('fvoff') ? 'OFFLINE' : 'online') + ')'); setTimeout(() => this.h['1style.load'] && this.h['1style.load'](), 0); } }
const nav = { onLine: false }; let da = true;
const onlineStil = { version: 8, name: 'liberty', sources: { openmaptiles: { type: 'vector', url: 'https://x' } }, layers: [{ id: 'bg', type: 'background' }, { id: 'a', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' }, { id: 'b', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation' }] };
const B = { lesen: (k, e) => (k === 'kartenstil' ? onlineStil : e === undefined ? null : e), schreiben() {}, ort: () => null };
const O = { nutzen: () => da && (nav.onLine === false), bereit: Promise.resolve(), stil: (b) => ({ version: 8, name: 'fv-offline', sources: { om: { type: 'vector', tiles: ['fvoff://{z}/{x}/{y}'] } }, layers: [{ id: 'x', type: 'background' }] }) };
const ctx = { FV: { B, G: { grenzen: () => [[0, 0], [1, 1]] }, O }, window: { maplibregl: { Map, Marker: class { constructor() {} setLngLat() { return this; } addTo() { return this; } remove() {} } }, addEventListener: (e, f) => (wl[e] = f), FV_TEST: null }, document: { createElement: () => feld }, fetch: () => Promise.reject(new Error('kein Netz')), setTimeout, Promise, console, Object, JSON, Math, Array, navigator: nav, maplibregl: null };
ctx.maplibregl = ctx.window.maplibregl; vm.createContext(ctx); vm.runInContext(fs.readFileSync(W + '/karte.js', 'utf8'), ctx);
const K = ctx.FV.K; const t = (ms) => new Promise((r) => setTimeout(r, ms));
await K.setzen(ziel); await t(30);
console.log('1) Start ohne Internet:', log.join(' → '), '| Kennzeichen:', feld.attrs['data-stil']);
log.length = 0; nav.onLine = true; wl.online(); await t(800);
console.log('2) Internet kommt:', log.join(' → '), '| Kennzeichen:', feld.attrs['data-stil']);
log.length = 0; nav.onLine = false; wl.offline(); await t(100);
console.log('3) Internet weg:', log.join(' → '), '| Kennzeichen:', feld.attrs['data-stil']);
log.length = 0; nav.onLine = true; wl.online(); await t(800); nav.onLine = false; await K.setzen(ziel); await t(100);
console.log('4) Reiter wieder geöffnet, inzwischen offline:', log.join(' → '), '| Kennzeichen:', feld.attrs['data-stil']);
log.length = 0; da = false; nav.onLine = false; wl.offline(); await t(100);
console.log('5) Offline, aber keine Karte geladen:', log.join(' → ') || 'bleibt wie sie ist (kein Wechsel)');
