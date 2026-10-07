/* Offline-Karte im eigenen Fenster.
 * Eine PMTiles-Datei (Vektorkacheln im OpenMapTiles-Schema, z. B. Deutschland) liegt im Speicher der App (OPFS)
 * und wird von MapLibre wie die Online-Karte gezeichnet – ohne zweite App.
 * Lesen: eigener, kleiner PMTiles-v3-Leser. Laden: bereichsweise (Range) vom eigenen Server, fortsetzbar. */
(function () {
  'use strict';
  var B = FV.B, O = FV.O = {};
  var DATEI = 'deutschland.pmtiles';
  var STD_URL = 'https://www.fehnverleih.de/karten/deutschland.pmtiles';
  var BLOCK = 4 * 1024 * 1024;
  var stand = { art: 'leer', fertig: 0, gesamt: 0, fehler: '' };   // art: leer | teil | laedt | bereit
  var hoerer = [], leser = null, ctl = null, worker = null, wnr = 0, wwarte = {};

  /* ---------- PMTiles lesen ---------- */
  function varint(v, p) { var r = 0, m = 1, b; do { b = v[p.i++]; r += (b & 0x7f) * m; m *= 128; } while (b & 0x80); return r; }
  function u64(dv, o) { return dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 4294967296; }
  function drehen(n, x, y, rx, ry) { if (ry === 0) { if (rx === 1) { x = n - 1 - x; y = n - 1 - y; } return [y, x]; } return [x, y]; }
  function kachelId(z, x, y) {
    var n = Math.pow(2, z), acc = 0, t, s, rx, ry, d = 0, xy;
    for (t = 0; t < z; t++) acc += Math.pow(4, t);
    for (s = n / 2; s >= 1; s /= 2) {
      rx = (x & s) > 0 ? 1 : 0; ry = (y & s) > 0 ? 1 : 0;
      d += s * s * ((3 * rx) ^ ry);
      xy = drehen(n, x, y, rx, ry); x = xy[0]; y = xy[1];
    }
    return acc + d;
  }
  function verzeichnis(u8) {
    var p = { i: 0 }, n = varint(u8, p), id = new Float64Array(n), run = new Uint32Array(n), len = new Float64Array(n), off = new Float64Array(n), i, last = 0;
    for (i = 0; i < n; i++) { last += varint(u8, p); id[i] = last; }
    for (i = 0; i < n; i++) run[i] = varint(u8, p);
    for (i = 0; i < n; i++) len[i] = varint(u8, p);
    for (i = 0; i < n; i++) { var o = varint(u8, p); off[i] = o === 0 && i > 0 ? off[i - 1] + len[i - 1] : o - 1; }
    return { n: n, id: id, run: run, len: len, off: off };
  }
  function finde(d, id) {
    var lo = 0, hi = d.n - 1, m;
    while (lo <= hi) { m = (lo + hi) >> 1; if (d.id[m] < id) lo = m + 1; else if (d.id[m] > id) hi = m - 1; else return m; }
    if (hi >= 0 && (d.run[hi] === 0 || id - d.id[hi] < d.run[hi])) return hi;
    return -1;
  }
  function entpacken(u8) {
    if (!(u8[0] === 0x1f && u8[1] === 0x8b)) return Promise.resolve(u8);
    var s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(s).arrayBuffer().then(function (a) { return new Uint8Array(a); });
  }
  function Leser(datei) { this.d = datei; this.k = null; this.cache = []; }
  Leser.prototype.bytes = function (off, len) { return this.d.slice(off, off + len).arrayBuffer().then(function (a) { return new Uint8Array(a); }); };
  Leser.prototype.start = function () {
    var self = this;
    return this.bytes(0, 127).then(function (u) {
      var dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
      if (u.length < 127 || String.fromCharCode.apply(null, u.subarray(0, 7)) !== 'PMTiles' || u[7] !== 3) throw new Error('Das ist keine gültige Kartendatei (PMTiles 3).');
      if (u[99] !== 1) throw new Error('Die Kartendatei enthält keine Vektorkacheln.');
      self.k = { wurzelOff: u64(dv, 8), wurzelLen: u64(dv, 16), blattOff: u64(dv, 40), blattLen: u64(dv, 48), datenOff: u64(dv, 56), datenLen: u64(dv, 64),
        dirKomp: u[97], kachelKomp: u[98], minz: u[100], maxz: u[101],
        west: dv.getInt32(102, true) / 1e7, sued: dv.getInt32(106, true) / 1e7, ost: dv.getInt32(110, true) / 1e7, nord: dv.getInt32(114, true) / 1e7 };
      if (self.k.dirKomp > 2 || self.k.kachelKomp > 2) throw new Error('Die Kartendatei ist anders gepackt (nur gzip wird unterstützt).');
      return self;
    });
  };
  Leser.prototype.dir = function (off, len) {
    var self = this, key = off + ':' + len, i;
    for (i = 0; i < this.cache.length; i++) if (this.cache[i].k === key) { var e = this.cache.splice(i, 1)[0]; this.cache.push(e); return Promise.resolve(e.v); }
    return this.bytes(off, len).then(entpacken).then(function (u) {
      var v = verzeichnis(u); self.cache.push({ k: key, v: v }); if (self.cache.length > 48) self.cache.shift(); return v;
    });
  };
  /** Gibt die (entpackte) Kachel oder null zurück */
  Leser.prototype.kachel = function (z, x, y) {
    var self = this, k = this.k, id = kachelId(z, x, y);
    if (z < k.minz || z > k.maxz) return Promise.resolve(null);
    function schritt(off, len, tiefe) {
      return self.dir(off, len).then(function (d) {
        var i = finde(d, id); if (i < 0) return null;
        if (d.run[i] > 0) return self.bytes(k.datenOff + d.off[i], d.len[i]).then(entpacken);
        if (tiefe >= 3) return null;
        return schritt(k.blattOff + d.off[i], d.len[i], tiefe + 1);
      });
    }
    return schritt(k.wurzelOff, k.wurzelLen, 0);
  };

  /* ---------- Zustand ---------- */
  function melden() { hoerer.slice().forEach(function (f) { try { f(O.stand()); } catch (e) { console.error(e); } }); }
  function setze(s) { Object.keys(s).forEach(function (k) { stand[k] = s[k]; }); melden(); }
  O.stand = function () { return Object.assign({}, stand); };
  O.beiStand = function (f) { hoerer.push(f); return function () { var i = hoerer.indexOf(f); if (i >= 0) hoerer.splice(i, 1); }; };
  O.da = function () { return stand.art === 'bereit' && !!leser; };
  O.moeglich = function () { return !!(navigator.storage && navigator.storage.getDirectory && window.Worker && window.DecompressionStream); };
  O.url = function () { var e = (FV.app && FV.app.e) || {}; return (e.offlineUrl || STD_URL); };
  O.modus = function () { var e = (FV.app && FV.app.e) || {}; return e.offlineModus === 'immer' ? 'immer' : 'auto'; };
  /** Soll die Karte gerade aus der Offline-Datei gezeichnet werden? */
  O.erzwungen = false;
  O.nutzen = function () { return O.da() && (O.erzwungen || O.modus() === 'immer' || navigator.onLine === false); };
  O.grenzen = function () { return leser && leser.k ? [[leser.k.west, leser.k.sued], [leser.k.ost, leser.k.nord]] : null; };
  O.hat = function (lon, lat) { var g = O.grenzen(); return !g || (lon >= g[0][0] && lon <= g[1][0] && lat >= g[0][1] && lat <= g[1][1]); };

  /* ---------- Kartenkacheln für MapLibre ---------- */
  var geregelt = false;
  function protokoll() {
    if (geregelt || !window.maplibregl) return; geregelt = true;
    maplibregl.addProtocol('fvoff', function (p) {
      var m = /^fvoff:\/\/(\d+)\/(\d+)\/(\d+)/.exec(p.url);
      if (!m || !leser) return Promise.reject(new Error('Offline-Karte nicht bereit'));
      return leser.kachel(+m[1], +m[2], +m[3]).then(function (u) { return { data: u || new Uint8Array(0) }; });
    });
  }

  /* ---------- Kartenstil ---------- */
  var FARBE = { land: '#17361f', wasser: '#0e3a63', wald: '#123019', gruen: '#20492a', stadt: '#2a302c', gewerbe: '#2c2e31', haus: '#454a4d' };
  function notstil(maxz) {
    var w = function (c, b) { return ['interpolate', ['linear'], ['zoom'], 8, b * 0.55, 13, b, 17, b * 1.9]; };
    var str = function (id, kl, f, b) { return { id: id, type: 'line', source: 'om', 'source-layer': 'transportation', filter: ['in', 'class'].concat(kl), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': f, 'line-width': w(0, b) } }; };
    return { version: 8, name: 'fv-offline', sources: { om: { type: 'vector', tiles: ['fvoff://{z}/{x}/{y}'], minzoom: 0, maxzoom: maxz } },
      layers: [
        { id: 'hg', type: 'background', paint: { 'background-color': FARBE.land } },
        { id: 'wald', type: 'fill', source: 'om', 'source-layer': 'landcover', filter: ['in', 'class', 'wood', 'forest'], paint: { 'fill-color': FARBE.wald } },
        { id: 'gras', type: 'fill', source: 'om', 'source-layer': 'landcover', filter: ['in', 'class', 'grass', 'farmland', 'wetland'], paint: { 'fill-color': FARBE.gruen } },
        { id: 'park', type: 'fill', source: 'om', 'source-layer': 'park', paint: { 'fill-color': '#1a4627' } },
        { id: 'wohnen', type: 'fill', source: 'om', 'source-layer': 'landuse', filter: ['in', 'class', 'residential', 'suburb', 'neighbourhood'], paint: { 'fill-color': FARBE.stadt } },
        { id: 'gewerbe', type: 'fill', source: 'om', 'source-layer': 'landuse', filter: ['in', 'class', 'industrial', 'commercial', 'retail', 'railway'], paint: { 'fill-color': FARBE.gewerbe } },
        { id: 'wasser', type: 'fill', source: 'om', 'source-layer': 'water', paint: { 'fill-color': FARBE.wasser } },
        { id: 'fluss', type: 'line', source: 'om', 'source-layer': 'waterway', paint: { 'line-color': '#1a5d92', 'line-width': 1.4 } },
        { id: 'haus', type: 'fill', source: 'om', 'source-layer': 'building', minzoom: 13, paint: { 'fill-color': FARBE.haus, 'fill-opacity': 0.75 } },
        { id: 'grenze', type: 'line', source: 'om', 'source-layer': 'boundary', filter: ['<=', 'admin_level', 6], paint: { 'line-color': '#c9a24a', 'line-opacity': 0.45, 'line-width': 1 } },
        str('weg', ['path', 'track', 'pedestrian', 'service'], '#6f7a72', 1.5),
        str('nebenstr', ['minor', 'tertiary', 'secondary'], '#ded8c4', 3),
        str('hauptstr', ['primary', 'trunk'], '#e9c869', 4.5),
        str('autobahn', ['motorway'], '#f2b632', 5),
        str('bahn', ['rail', 'transit'], '#6f7680', 1.2)
      ] };
  }
  /** Der gespeicherte Online-Stil wird übernommen (gleiches Aussehen), nur die Kacheln kommen aus der Datei. */
  O.stil = function (basis) {
    var maxz = leser && leser.k ? leser.k.maxz : 14, st = null;
    try {
      if (basis && Array.isArray(basis.layers) && basis.sources) {
        st = JSON.parse(JSON.stringify(basis)); var vek = {};
        Object.keys(st.sources).forEach(function (k) {
          var q = st.sources[k];
          if (q.type === 'vector') { vek[k] = 1; st.sources[k] = { type: 'vector', tiles: ['fvoff://{z}/{x}/{y}'], minzoom: 0, maxzoom: maxz }; } else delete st.sources[k];
        });
        st.layers = st.layers.filter(function (l) { return l.type === 'background' || vek[l.source]; });
        delete st.sprite;
        if (!Object.keys(vek).length || st.layers.length < 3) st = null;
      }
    } catch (e) { st = null; }
    return st || notstil(maxz);
  };

  /* ---------- Speicher (OPFS) ---------- */
  var WORKER = "var h=null;onmessage=async function(e){var m=e.data;try{" +
    "if(m.c==='open'){var d=await navigator.storage.getDirectory();var f=await d.getFileHandle(m.name,{create:true});h=await f.createSyncAccessHandle();if(m.neu){h.truncate(0);}h.flush();postMessage({id:m.id,ok:true,size:h.getSize()});}" +
    "else if(m.c==='write'){h.write(new Uint8Array(m.buf),{at:m.pos});postMessage({id:m.id,ok:true});}" +
    "else if(m.c==='close'){if(h){h.flush();h.close();h=null;}postMessage({id:m.id,ok:true});}" +
    "}catch(err){postMessage({id:m.id,ok:false,err:String(err&&err.message||err)});}};";
  function wk(c, extra, transfer) {
    if (!worker) {
      worker = new Worker(URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' })));
      worker.onmessage = function (e) { var w = wwarte[e.data.id]; if (!w) return; delete wwarte[e.data.id]; if (e.data.ok) w.ok(e.data); else w.fehl(new Error(e.data.err)); };
    }
    return new Promise(function (ok, fehl) { var id = ++wnr; wwarte[id] = { ok: ok, fehl: fehl }; worker.postMessage(Object.assign({ c: c, id: id }, extra || {}), transfer || []); });
  }
  function wkEnde() { if (worker) { try { worker.terminate(); } catch (e) {} worker = null; wwarte = {}; } }
  function opfsDatei() { return navigator.storage.getDirectory().then(function (d) { return d.getFileHandle(DATEI); }).then(function (f) { return f.getFile(); }); }

  /* ---------- Starten: vorhandene Datei prüfen ---------- */
  O.bereit = null;
  O.pruefen = function () {
    var meta = B.lesen('okarte', {}) || {};
    if (!O.moeglich()) { setze({ art: 'leer', fehler: 'Auf diesem Gerät nicht möglich.' }); return Promise.resolve(); }
    protokoll();
    return opfsDatei().then(function (f) {
      if (meta.fertig && f.size === meta.gesamt) {
        var l = new Leser(f);
        return l.start().then(function () { leser = l; setze({ art: 'bereit', fertig: f.size, gesamt: f.size, fehler: '' }); });
      }
      if (f.size > 0 && meta.gesamt) { leser = null; setze({ art: 'teil', fertig: f.size, gesamt: meta.gesamt, fehler: '' }); }
      else { leser = null; setze({ art: 'leer', fertig: 0, gesamt: 0, fehler: '' }); }
    }).catch(function (e) {
      leser = null;
      if (meta.fertig) { meta.fertig = false; B.schreiben('okarte', meta); }
      setze({ art: 'leer', fertig: 0, gesamt: 0, fehler: e && e.name === 'NotFoundError' ? '' : String(e && e.message || e) });
    });
  };

  /* ---------- Laden (fortsetzbar) ---------- */
  function holeStueck(url, von, bis) {
    return fetch(url, { headers: { Range: 'bytes=' + von + '-' + bis }, cache: 'no-store' }).then(function (r) {
      if (r.status !== 206) { if (r.body && r.body.cancel) r.body.cancel(); throw new Error(r.status === 200 ? 'Der Server unterstützt kein Laden in Teilen (Range).' : 'Der Server antwortet mit Fehler ' + r.status + '.'); }
      return r.arrayBuffer();
    });
  }
  O.laden = function (url) {
    if (stand.art === 'laedt') return;
    if (!O.moeglich()) { setze({ fehler: 'Auf diesem Gerät nicht möglich.' }); return; }
    url = String(url || O.url()).trim();
    var meta = B.lesen('okarte', {}) || {}, mein = ctl = { stopp: false };
    leser = null; protokoll();
    setze({ art: 'laedt', fehler: '' });
    B.wach(true);
    fetch(url, { method: 'HEAD', cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(r.status === 404 ? 'Die Kartendatei wurde auf dem Server nicht gefunden.' : 'Der Server antwortet mit Fehler ' + r.status + '.');
      var gesamt = +r.headers.get('Content-Length') || 0;
      if (!gesamt) throw new Error('Die Größe der Kartendatei ist unbekannt.');
      return gesamt;
    }).then(function (gesamt) {
      var weiter = meta.url === url && meta.gesamt === gesamt && !meta.fertig;
      meta = { url: url, gesamt: gesamt, fertig: false }; B.schreiben('okarte', meta);
      return (navigator.storage.estimate ? navigator.storage.estimate() : Promise.resolve({})).then(function (q) {
        if (q && q.quota && q.usage != null && q.quota - q.usage < gesamt * 1.02 && !weiter) throw new Error('Nicht genug freier Speicher (' + Math.ceil(gesamt / 1e9 * 10) / 10 + ' GB nötig).');
        return wk('open', { name: DATEI, neu: !weiter });
      }).then(function (o) {
        var pos = weiter ? o.size : 0, fehlversuche = 0;
        setze({ fertig: pos, gesamt: gesamt });
        function runde() {
          if (mein.stopp) return Promise.resolve('stopp');
          if (pos >= gesamt) return Promise.resolve('fertig');
          var bis = Math.min(pos + BLOCK, gesamt) - 1;
          return holeStueck(url, pos, bis).then(function (buf) {
            if (buf.byteLength !== bis - pos + 1) throw new Error('Unvollständige Antwort vom Server.');
            return wk('write', { pos: pos, buf: buf }, [buf]).then(function () { pos = bis + 1; fehlversuche = 0; setze({ fertig: pos }); return runde(); });
          }, function (e) {
            if (e instanceof TypeError && ++fehlversuche <= 4 && !mein.stopp) return new Promise(function (ok) { setTimeout(ok, 2000 * fehlversuche); }).then(runde);   // kurzes Funkloch
            throw e;
          });
        }
        return runde();
      });
    }).then(function (ende) {
      return wk('close').catch(function () {}).then(function () {
        wkEnde();
        if (ende === 'fertig') { meta.fertig = true; B.schreiben('okarte', meta); return O.pruefen(); }
        return O.pruefen();
      });
    }, function (e) {
      return wk('close').catch(function () {}).then(function () {
        wkEnde();
        var msg = e instanceof TypeError ? 'Keine Verbindung zum Server. Bitte später fortsetzen.' : String(e && e.message || e);
        return O.pruefen().then(function () { setze({ fehler: msg }); });
      });
    }).then(function () { B.wach(false); if (ctl === mein) ctl = null; if (FV.K && FV.K.stilPruefen) FV.K.stilPruefen(); });
  };
  O.pause = function () { if (ctl) ctl.stopp = true; };
  O.loeschen = function () {
    if (ctl) ctl.stopp = true;
    var warte = ctl ? new Promise(function (ok) { var t = setInterval(function () { if (!ctl) { clearInterval(t); ok(); } }, 150); }) : Promise.resolve();
    return warte.then(function () {
      leser = null; B.schreiben('okarte', {});
      return navigator.storage.getDirectory().then(function (d) { return d.removeEntry(DATEI); }).catch(function () {});
    }).then(function () { setze({ art: 'leer', fertig: 0, gesamt: 0, fehler: '' }); if (FV.K && FV.K.stilPruefen) FV.K.stilPruefen(); });
  };

  O._t = { kachelId: kachelId, verzeichnis: verzeichnis, finde: finde, Leser: Leser };
  O.bereit = O.pruefen();
})();
