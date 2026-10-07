/* Karte: MapLibre + OpenStreetMap-Daten (Vektorkacheln von OpenFreeMap), dunkel eingefärbt passend zum Design. */
(function () {
  'use strict';
  var G = FV.G, B = FV.B, K = FV.K = { map: null, bereit: false, folgt: false };
  var STIL_URL = 'https://tiles.openfreemap.org/styles/liberty';
  var feld = null, marken = {}, poiMarken = [], extraMarken = [], warte = [], beiGeste = null, stilArt = '';

  /* ---------- Kartenstil dunkel einfärben ---------- */
  function strassenfarbe(id) {
    if (/rail|transit/.test(id)) return '#6f7680';
    if (/motorway/.test(id)) return '#f2b632';
    if (/trunk|primary/.test(id)) return '#e9c869';
    if (/secondary|tertiary/.test(id)) return '#ded8c4';
    if (/path|pedestrian|cycle|steps|track|pier/.test(id)) return '#6f7a72';
    return '#aab0b6';
  }
  function einfaerben(st) {
    var weg = { poi: 1, housenumber: 1, mountain_peak: 1, aerodrome_label: 1 };
    st.layers = st.layers.filter(function (l) { return !weg[l['source-layer'] || ''] && l.type !== 'fill-extrusion' && !/poi|pattern/.test(l.id); });
    st.layers.forEach(function (l) {
      var sl = l['source-layer'] || '', id = l.id, p = l.paint = l.paint || {};
      if (l.type === 'background') { p['background-color'] = '#17361f'; return; }
      if (l.type === 'fill') {
        delete p['fill-pattern']; delete p['fill-outline-color'];
        var f = '#1b3f24';
        if (sl === 'water') f = '#0e3a63';
        else if (sl === 'landcover') f = /wood|forest|tree/.test(id) ? '#123019' : /sand|beach/.test(id) ? '#4b4526' : /ice|glacier/.test(id) ? '#73858c' : /wetland/.test(id) ? '#183c33' : '#20492a';
        else if (sl === 'landuse') f = /residential|suburb/.test(id) ? '#2a302c' : /industrial|commercial|retail|railway/.test(id) ? '#2c2e31' : /cemetery|pitch|stadium|school|hospital|kindergarten/.test(id) ? '#24402b' : '#22342a';
        else if (sl === 'park') f = '#1a4627';
        else if (sl === 'building') { f = '#454a4d'; p['fill-opacity'] = 0.75; }
        else if (sl === 'aeroway') f = '#34373b';
        else if (sl === 'transportation') f = '#3a3f44';
        p['fill-color'] = f;
        return;
      }
      if (l.type === 'line') {
        if (sl === 'waterway' || sl === 'water') p['line-color'] = '#1a5d92';
        else if (sl === 'boundary') { p['line-color'] = '#c9a24a'; p['line-opacity'] = 0.45; }
        else if (sl === 'transportation' || sl === 'aeroway') p['line-color'] = /casing|outline/.test(id) ? '#0b0e11' : strassenfarbe(id);
        else if (sl === 'park' || sl === 'landuse' || sl === 'landcover') p['line-color'] = '#2b5a35';
        else p['line-color'] = '#555b60';
        return;
      }
      if (l.type === 'symbol') {
        p['text-color'] = sl === 'water_name' || sl === 'waterway' ? '#a8cff2' : sl === 'transportation_name' ? '#f1ede2' : '#ffffff';
        p['text-halo-color'] = 'rgba(0,0,0,0.85)'; p['text-halo-width'] = 1.6; delete p['text-halo-blur'];
      }
    });
    return st;
  }
  var RASTER = { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19 } },
    layers: [{ id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-brightness-max': 0.82, 'raster-saturation': -0.15 } }] };
  function onlineStil() {
    var merker = B.lesen('kartenstil', null);
    function netz() {
      return fetch(STIL_URL).then(function (r) { if (!r.ok) throw new Error('stil'); return r.json(); }).then(function (st) {
        if (!st || !Array.isArray(st.layers) || !st.sources) throw new Error('stil');
        st = einfaerben(st);
        try { B.schreiben('kartenstil', st); } catch (e) {}
        return st;
      });
    }
    if (merker && merker.layers) { netz().catch(function () {}); stilArt = 'vektor'; return Promise.resolve(merker); }
    return netz().then(function (st) { stilArt = 'vektor'; return st; }).catch(function () { stilArt = 'raster'; return RASTER; });
  }
  /* Offline-Karte (Datei im Speicher der App) oder Online-Karte – gleiches Aussehen, nur andere Kachelquelle */
  function stilHolen() {
    var warte = (FV.O && FV.O.bereit) ? FV.O.bereit.catch(function () {}) : Promise.resolve();
    return warte.then(function () {
      if (FV.O && FV.O.nutzen()) { stilArt = 'offline'; return FV.O.stil(B.lesen('kartenstil', null)); }
      return onlineStil();
    });
  }
  function markeStil() { if (feld) feld.setAttribute('data-stil', stilArt); }
  /** Wechselt (bei offener Karte) zwischen Online- und Offline-Karte, wenn sich Netz oder Einstellung geändert haben */
  K.stilPruefen = function () {
    if (!K.map || !K.bereit) return;
    var soll = !!(FV.O && FV.O.nutzen());
    if (soll === (stilArt === 'offline')) return;
    var p = soll ? Promise.resolve(FV.O.stil(B.lesen('kartenstil', null))) : onlineStil();
    p.then(function (st) {
      stilArt = soll ? 'offline' : (st === RASTER ? 'raster' : 'vektor'); markeStil();
      var map = K.map; if (!map) return;
      map.setStyle(st, { diff: false });
      map.once('style.load', function () {
        ebenen();
        var s = map.getSource('route'); if (s && K._r) s.setData(linie(K._r.punkte));
        if (K._g) K.gefahren(K._g.r, K._g.s);
      });
    });
  };

  /* ---------- Karte anlegen / in eine Seite setzen ---------- */
  K.setzen = function (ziel) {
    if (!feld) { feld = document.createElement('div'); feld.id = 'karte'; }
    if (feld.parentNode !== ziel) ziel.insertBefore(feld, ziel.firstChild);
    if (K.map) { setTimeout(function () { if (K.map) { K.map.resize(); K.stilPruefen(); } }, 30); markeStil(); return Promise.resolve(K.map); }
    if (K._start) return K._start;
    if (!window.maplibregl) return Promise.reject(new Error('Karte nicht geladen'));
    K._start = stilHolen().then(function (stil) {
      markeStil();
      var o = B.ort(), mitte = o ? [o.lon, o.lat] : [7.70, 53.20];
      var map = K.map = new maplibregl.Map({ container: feld, style: stil, center: mitte, zoom: o ? 13 : 9.5, attributionControl: false, maxPitch: 60, dragRotate: false, pitchWithRotate: false, fadeDuration: 0 });
      try { map.touchZoomRotate.disableRotation(); } catch (e) {}
      map.on('error', function (e) { if (window.FV_TEST) (FV_TEST.kartenfehler = FV_TEST.kartenfehler || []).push(String(e && e.error && e.error.message || e)); });
      ['dragstart', 'zoomstart'].forEach(function (ev) { map.on(ev, function (e) { if (e && e.originalEvent && beiGeste) beiGeste(); }); });
      return new Promise(function (ok) {
        var fertig = false;
        function los() {
          if (fertig) return; fertig = true;
          ebenen(); K.bereit = true; warte.splice(0).forEach(function (f) { try { f(); } catch (e) { console.error(e); } });
          ok(map);
        }
        map.on('load', los); setTimeout(los, 6000);
      });
    });
    return K._start;
  };
  K.wenn = function (f) { if (K.bereit) f(); else warte.push(f); };
  K.beiGeste = function (f) { beiGeste = f; };
  K.stilArt = function () { return stilArt; };
  function ebenen() {
    var map = K.map, vor;
    try { var ls = map.getStyle().layers; for (var i = 0; i < ls.length; i++) if (ls[i].type === 'symbol') { vor = ls[i].id; break; } } catch (e) {}
    var leer = { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} };
    if (!map.getSource('route')) map.addSource('route', { type: 'geojson', data: leer });
    if (!map.getSource('gefahren')) map.addSource('gefahren', { type: 'geojson', data: leer });
    var rund = { 'line-cap': 'round', 'line-join': 'round' };
    function eb(id, quelle, farbe, breite) {
      if (map.getLayer(id)) return;
      map.addLayer({ id: id, type: 'line', source: quelle, layout: rund, paint: { 'line-color': farbe, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, breite * 0.55, 13, breite, 17, breite * 1.9] } }, vor);
    }
    eb('route-rand', 'route', '#0a3f96', 9); eb('route', 'route', '#2b93ff', 6); eb('gefahren', 'gefahren', '#7f8a96', 6);
  }

  /* ---------- Marken ---------- */
  function el(html, klasse) { var d = document.createElement('div'); if (klasse) d.className = klasse; d.innerHTML = html; return d; }
  var PIN = '<svg viewBox="0 0 34 44" width="34" height="44"><path d="M17 1C8.2 1 1 8 1 16.8 1 28.5 17 43 17 43s16-14.5 16-26.2C33 8 25.8 1 17 1z" fill="#e2231a" stroke="#fff" stroke-width="2"/><circle cx="17" cy="16.5" r="5.5" fill="#5a0b08"/></svg>';
  var AUTO = '<svg viewBox="0 0 44 60" width="44" height="60"><ellipse cx="22" cy="31" rx="19" ry="27" fill="#1a73e8" opacity=".28"/>' +
    '<path d="M11 14c0-6 4-9 11-9s11 3 11 9v32c0 5-4 8-11 8s-11-3-11-8z" fill="#ffffff" stroke="#1a56c4" stroke-width="2.2"/>' +
    '<path d="M13.5 22c0-2 3.5-4 8.500-4s8.500 2 8.500 4l-1.800 6h-13.400z" fill="#14315e"/><path d="M15 42h14l1.200 5c0 2-3 3-8.200 3s-8.200-1-8.200-3z" fill="#14315e"/>' +
    '<rect x="13.300" y="29.500" width="2" height="11" rx="1" fill="#14315e"/><rect x="28.700" y="29.500" width="2" height="11" rx="1" fill="#14315e"/>' +
    '<rect x="13" y="7.500" width="5" height="2.600" rx="1.300" fill="#ffd95a"/><rect x="26" y="7.500" width="5" height="2.600" rx="1.300" fill="#ffd95a"/></svg>';
  function marke(name, lon, lat, element, opt) {
    if (marken[name]) { marken[name].remove(); delete marken[name]; }
    if (lon == null || !K.map) return null;
    var o = Object.assign({ element: element }, opt || {});
    marken[name] = new maplibregl.Marker(o).setLngLat([lon, lat]).addTo(K.map);
    return marken[name];
  }
  K.hat = function (name) { return !!marken[name]; };
  K.ziel = function (z, schild, links) {
    marke('ziel', z && z.lon, z && z.lat, el(PIN, 'm-ziel'), { anchor: 'bottom' });
    marke('zielschild', z && schild ? z.lon : null, z && z.lat, el(schild || '', 'm-schild'), { anchor: links ? 'right' : 'left', offset: [links ? -22 : 22, -30] });
  };
  K.start = function (p, schild, links) {
    marke('start', p && p.lon, p && p.lat, el('', 'm-start'), { anchor: 'center' });
    marke('startschild', p && schild ? p.lon : null, p && p.lat, el(schild || '', 'm-schild'), { anchor: links ? 'right' : 'left', offset: [links ? -18 : 18, 0] });
  };
  K.auto = function (p, kurs) {
    if (!p) { marke('auto'); return; }
    if (marken.auto) { marken.auto.setLngLat([p.lon, p.lat]); marken.auto.setRotation(kurs || 0); return; }
    var m = marke('auto', p.lon, p.lat, el(AUTO, 'm-auto'), { anchor: 'center', rotationAlignment: 'map', pitchAlignment: 'viewport' });
    if (m) m.setRotation(kurs || 0);
  };
  K.pois = function (liste, beiTipp) {
    poiMarken.forEach(function (m) { m.remove(); }); poiMarken = [];
    if (!K.map) return;
    (liste || []).forEach(function (p) {
      var e = el(FV.sym({ laden: 'laden', tanken: 'tanken', essen: 'kaffee' }[p.art] || 'wc'), 'm-poi ' + p.art);
      e.addEventListener('click', function (ev) { ev.stopPropagation(); if (beiTipp) beiTipp(p); });
      poiMarken.push(new maplibregl.Marker({ element: e, anchor: 'center' }).setLngLat([p.lon, p.lat]).addTo(K.map));
    });
  };
  K.nummern = function (liste, beiTipp) {
    extraMarken.forEach(function (m) { m.remove(); }); extraMarken = [];
    if (!K.map) return;
    (liste || []).forEach(function (p) {
      var e = el(String(p.nr), 'm-nr');
      e.addEventListener('click', function (ev) { ev.stopPropagation(); if (beiTipp) beiTipp(p); });
      extraMarken.push(new maplibregl.Marker({ element: e, anchor: 'center' }).setLngLat([p.lon, p.lat]).addTo(K.map));
    });
  };

  /* ---------- Route zeichnen, Kamera ---------- */
  function linie(punkte) { return { type: 'Feature', geometry: { type: 'LineString', coordinates: punkte || [] }, properties: {} }; }
  K.route = function (r) { K._r = r || null; K._g = null; K.wenn(function () { var s = K.map.getSource('route'); if (s) s.setData(linie(r ? r.punkte : [])); var g = K.map.getSource('gefahren'); if (g) g.setData(linie([])); }); };
  K.gefahren = function (r, s) {
    K._g = s ? { r: r, s: s } : null;
    if (!K.bereit) return;
    var g = K.map.getSource('gefahren'); if (!g) return;
    g.setData(linie(s ? r.punkte.slice(0, s.idx + 1).concat([[s.lon, s.lat]]) : []));
  };
  K.rahmen = function (punkte, rand) {
    K.wenn(function () {
      if (!punkte || !punkte.length) return;
      var g = G.grenzen(punkte);
      if (punkte.length === 1 || (g[0][0] === g[1][0] && g[0][1] === g[1][1])) { K.map.easeTo({ center: punkte[0], zoom: 14, bearing: 0, pitch: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 500 }); return; }
      K.map.fitBounds(g, { padding: rand || { top: 60, bottom: 40, left: 40, right: 60 }, bearing: 0, pitch: 0, duration: 600, maxZoom: 16 });
    });
  };
  /** Kamera sitzt fest am Auto: Auto im unteren Drittel, Karte in Fahrtrichtung gedreht */
  K.folgen = function (p, kurs, zoom, sofort) {
    if (!K.bereit) return;
    var h = K.map.getContainer().clientHeight || 400;
    var o = { center: [p.lon, p.lat], bearing: kurs || 0, zoom: zoom, pitch: 48, padding: { top: Math.round(h * 0.42), bottom: 0, left: 0, right: 0 }, duration: sofort ? 0 : 950, easing: function (t) { return t; } };
    if (sofort) K.map.jumpTo(o); else K.map.easeTo(o);
  };
  K.mitte = function (p, zoom) { K.wenn(function () { K.map.easeTo({ center: [p.lon, p.lat], zoom: zoom || Math.max(K.map.getZoom(), 14), bearing: 0, pitch: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 500 }); }); };
  K.zoom = function (d) { if (K.bereit) { if (d > 0) K.map.zoomIn(); else K.map.zoomOut(); } };

  /* ---------- Kartenteile entlang der Route vorladen (bleiben im Zwischenspeicher, auch bei kurzem Funkloch) ---------- */
  K.vorladen = function (r) {
    if (!K.bereit || stilArt !== 'vektor') return;
    var muster = null;
    try { var qs = K.map.getStyle().sources; Object.keys(qs).forEach(function (k) { var q = K.map.getSource(k); if (!muster && q && q.type === 'vector' && q.tiles && q.tiles[0]) muster = q.tiles[0]; }); } catch (e) {}
    if (!muster) return;
    var z = 14, n = Math.pow(2, z), set = {}, liste = [];
    for (var w = 0; w <= r.laenge; w += 400) {
      var p = G.punktBei(r, w), x = Math.floor((p.lon + 180) / 360 * n);
      var y = Math.floor((1 - Math.log(Math.tan(p.lat * Math.PI / 180) + 1 / Math.cos(p.lat * Math.PI / 180)) / Math.PI) / 2 * n);
      var k = x + '/' + y; if (!set[k]) { set[k] = 1; liste.push(muster.replace('{z}', z).replace('{x}', x).replace('{y}', y)); }
      if (liste.length >= 160) break;
    }
    var i = 0;
    function weiter() { if (i >= liste.length) return; fetch(liste[i++]).then(function (x) { return x.arrayBuffer(); }).catch(function () {}).then(weiter); }
    weiter(); weiter(); weiter();
  };
  K.leeren = function () { K.route(null); K.ziel(null); K.start(null); K.auto(null); K.pois([]); K.nummern([]); };
  window.addEventListener('online', function () { setTimeout(K.stilPruefen, 600); });
  window.addEventListener('offline', function () { K.stilPruefen(); });
})();
