import fs from 'fs'; import vm from 'vm';
const ctx = { FV: { B: { lesen: () => ({}), schreiben() {}, wach() {} } }, window: { Worker: 1, DecompressionStream }, navigator: { storage: {}, onLine: true }, console, Blob, Response, DecompressionStream, Promise, setTimeout, URL };
vm.createContext(ctx); vm.runInContext(fs.readFileSync(process.argv[2], 'utf8'), ctx);
const O = ctx.FV.O;
const basis = { version: 8, sprite: 'https://x/sprite', glyphs: 'https://x/{fontstack}/{range}.pbf', sources: { openmaptiles: { type: 'vector', url: 'https://x/planet' }, bild: { type: 'raster', tiles: ['x'] } },
  layers: [{ id: 'bg', type: 'background', paint: {} }, { id: 'wasser', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' }, { id: 'str', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation' }, { id: 'ort', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place' }, { id: 'raster', type: 'raster', source: 'bild' }] };
const a = O.stil(basis);
console.log('aus Online-Stil:', JSON.stringify(a.sources), '| Ebenen:', a.layers.map((l) => l.id).join(','), '| sprite:', a.sprite, '| glyphs behalten:', !!a.glyphs, '| Original unverändert:', !!basis.sources.openmaptiles.url && !!basis.sprite);
const b = O.stil(null);
const ids = new Set(b.layers.map((l) => l.id)); console.log('Notstil: Ebenen', b.layers.length, 'eindeutig:', ids.size === b.layers.length, '| Quellen ok:', b.layers.every((l) => l.type === 'background' || b.sources[l.source]), '| Kacheln:', b.sources.om.tiles[0]);
