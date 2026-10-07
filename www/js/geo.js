/* Rechnen mit Koordinaten, Adresssuche, Route, Tempolimits, Ladesäulen/WC, Wetter.
 * Dienste: OpenStreetMap (Nominatim/Photon), Valhalla + OSRM (FOSSGIS), Overpass, Bright Sky (DWD). */
(function () {
  'use strict';
  var B = FV.B, G = FV.G = {};
  var RAD = Math.PI / 180;
  G.DIENST = {
    valhalla: 'https://valhalla1.openstreetmap.de',
    osrm: 'https://routing.openstreetmap.de/routed-car',
    nominatim: 'https://nominatim.openstreetmap.org',
    photon: 'https://photon.komoot.io',
    overpass: ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'],
    wetter: 'https://api.brightsky.dev'
  };

  /* ---------- Grundrechnen ---------- */
  G.abstand = function (a, b) {
    var dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 12742000 * Math.asin(Math.min(1, Math.sqrt(s)));
  };
  G.kurs = function (a, b) {
    var y = Math.sin((b.lon - a.lon) * RAD) * Math.cos(b.lat * RAD);
    var x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  };
  G.polylinie = function (s, stellen) {
    var pts = [], i = 0, lat = 0, lon = 0, f = Math.pow(10, stellen || 6);
    while (i < s.length) {
      for (var k = 0; k < 2; k++) {
        var sh = 0, res = 0, b;
        do { b = s.charCodeAt(i++) - 63; res |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20);
        var d = (res & 1) ? ~(res >> 1) : (res >> 1);
        if (k === 0) lat += d; else lon += d;
      }
      pts.push([lon / f, lat / f]);
    }
    return pts;
  };
  G.kumuliert = function (punkte) {
    var k = new Array(punkte.length); k[0] = 0;
    for (var i = 1; i < punkte.length; i++) k[i] = k[i - 1] + G.abstand({ lon: punkte[i - 1][0], lat: punkte[i - 1][1] }, { lon: punkte[i][0], lat: punkte[i][1] });
    return k;
  };
  /** Nächster Punkt auf der Strecke. von/bis grenzen die Suche ein (Index der Streckenpunkte). */
  G.einrasten = function (r, p, von, bis) {
    var pts = r.punkte, n = pts.length;
    von = Math.max(0, von == null ? 0 : von); bis = Math.min(n - 2, bis == null ? n - 2 : bis);
    var cos = Math.cos(p.lat * RAD), best = null;
    for (var i = von; i <= bis; i++) {
      var ax = (pts[i][0] - p.lon) * cos * 111320, ay = (pts[i][1] - p.lat) * 110540;
      var bx = (pts[i + 1][0] - p.lon) * cos * 111320, by = (pts[i + 1][1] - p.lat) * 110540;
      var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      var t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
      var qx = ax + t * dx, qy = ay + t * dy, d = Math.sqrt(qx * qx + qy * qy);
      if (!best || d < best.entf) best = { idx: i, t: t, entf: d };
    }
    if (!best) return null;
    best.weg = r.kum[best.idx] + (r.kum[best.idx + 1] - r.kum[best.idx]) * best.t;
    best.lon = pts[best.idx][0] + (pts[best.idx + 1][0] - pts[best.idx][0]) * best.t;
    best.lat = pts[best.idx][1] + (pts[best.idx + 1][1] - pts[best.idx][1]) * best.t;
    best.kurs = G.kurs({ lon: pts[best.idx][0], lat: pts[best.idx][1] }, { lon: pts[best.idx + 1][0], lat: pts[best.idx + 1][1] });
    return best;
  };
  /** Punkt auf der Strecke bei einer Wegstrecke (Meter ab Start) */
  G.punktBei = function (r, weg) {
    var k = r.kum, lo = 0, hi = k.length - 1;
    if (weg <= 0) return { lon: r.punkte[0][0], lat: r.punkte[0][1], idx: 0 };
    if (weg >= k[hi]) return { lon: r.punkte[hi][0], lat: r.punkte[hi][1], idx: hi - 1 };
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (k[m] <= weg) lo = m; else hi = m; }
    var t = (weg - k[lo]) / Math.max(0.001, k[lo + 1] - k[lo]);
    return { lon: r.punkte[lo][0] + (r.punkte[lo + 1][0] - r.punkte[lo][0]) * t, lat: r.punkte[lo][1] + (r.punkte[lo + 1][1] - r.punkte[lo][1]) * t, idx: lo };
  };
  G.grenzen = function (punkte) {
    var w = 180, s = 90, o = -180, n = -90;
    punkte.forEach(function (p) { if (p[0] < w) w = p[0]; if (p[0] > o) o = p[0]; if (p[1] < s) s = p[1]; if (p[1] > n) n = p[1]; });
    return [[w, s], [o, n]];
  };

  /* ---------- Texte ---------- */
  G.meter = function (m) {
    if (m >= 10000) return Math.round(m / 1000) + ' km';
    if (m >= 1000) return (Math.round(m / 100) / 10).toString().replace('.', ',') + ' km';
    if (m >= 300) return Math.round(m / 50) * 50 + ' m';
    if (m >= 30) return Math.round(m / 10) * 10 + ' m';
    return 'Jetzt';
  };
  G.meterSprache = function (m) {
    if (m >= 1500) { var km = Math.round(m / 500) / 2; return (km === 1 ? 'einem Kilometer' : String(km).replace('.', ',') + ' Kilometern'); }
    if (m >= 900) return 'einem Kilometer';
    if (m >= 300) return Math.round(m / 100) * 100 + ' Metern';
    return Math.max(50, Math.round(m / 50) * 50) + ' Metern';
  };
  G.km = function (m) { return (m >= 100000 ? Math.round(m / 1000) : Math.round(m / 100) / 10).toString().replace('.', ',') + ' km'; };
  G.minuten = function (s) {
    var m = Math.max(1, Math.round(s / 60));
    return m < 60 ? m + ' Min.' : Math.floor(m / 60) + ' Std. ' + (m % 60 ? (m % 60) + ' Min.' : '');
  };
  G.minutenKurz = function (s) { var m = Math.max(1, Math.round(s / 60)); return m < 60 ? m + ' Min.' : Math.floor(m / 60) + ':' + ('0' + (m % 60)).slice(-2) + ' Std.'; };
  G.uhr = function (d) { d = d || new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); };

  /* ---------- Adresssuche ---------- */
  var geoMerker = B.lesen('geo', {}) || {}, nomZeit = 0;
  /** Gemerkte Adressen vergessen (beim Abmelden) */
  G.vergessen = function () { geoMerker = {}; };
  function adresseAus(a, name) {
    var str = [a.road || a.pedestrian || a.hamlet || '', a.house_number || ''].join(' ').trim();
    var ort = [a.postcode || '', a.city || a.town || a.village || a.municipality || a.suburb || ''].join(' ').trim();
    return { strasse: str || name || '', ort: ort };
  }
  G.suche = function (text, nahe) {
    text = String(text || '').trim();
    if (!text) return Promise.resolve([]);
    var p = { format: 'jsonv2', q: text, countrycodes: 'de,nl', limit: '6', addressdetails: '1', 'accept-language': 'de' };
    if (nahe) { p.viewbox = [nahe.lon - 0.9, nahe.lat + 0.6, nahe.lon + 0.9, nahe.lat - 0.6].join(','); }
    var q = Object.keys(p).map(function (k) { return k + '=' + encodeURIComponent(p[k]); }).join('&');
    var warte = Math.max(0, nomZeit + 1100 - Date.now()); nomZeit = Date.now() + warte;   // Nutzungsregel von Nominatim: höchstens eine Anfrage je Sekunde
    return new Promise(function (ok) { setTimeout(ok, warte); }).then(function () { return B.json({ url: G.DIENST.nominatim + '/search?' + q, zeit: 12000 }); }).then(function (l) {
      if (!Array.isArray(l) || !l.length) throw new Error('leer');
      return l.map(function (x) {
        var a = adresseAus(x.address || {}, x.name);
        var titel = x.name && x.name !== (x.address || {}).road && isNaN(parseInt(x.name, 10)) ? x.name : a.strasse;
        return { name: titel || text, adresse: [titel && titel !== a.strasse ? a.strasse : '', a.ort].filter(Boolean).join(', ') || x.display_name, lat: +x.lat, lon: +x.lon };
      });
    }).catch(function () {
      var u = G.DIENST.photon + '/api/?q=' + encodeURIComponent(text) + '&lang=de&limit=6' + (nahe ? '&lat=' + nahe.lat + '&lon=' + nahe.lon : '');
      return B.json({ url: u, zeit: 12000 }).then(function (j) {
        return (j.features || []).map(function (f) {
          var e = f.properties || {}, str = [e.street || '', e.housenumber || ''].join(' ').trim();
          return { name: e.name || str || text, adresse: [e.name ? str : '', [e.postcode || '', e.city || e.town || e.village || ''].join(' ').trim()].filter(Boolean).join(', '), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
        });
      });
    });
  };
  /** Adresse → Koordinate (mit Merker, damit jede Adresse nur einmal gesucht wird) */
  /** Schreibweisen einer Adresse, von genau bis ungefähr: [Text, ungefähr?] */
  G.varianten = function (adresse) {
    var t = String(adresse || '').replace(/\s*\n\s*/g, ', ').replace(/\s+/g, ' ').trim(), v = [[t, false]];
    function dazu(x, ung) { x = x.replace(/^[,\s]+|[,\s]+$/g, ''); if (x && !v.some(function (y) { return y[0] === x; })) v.push([x, ung]); }
    var ohneNr = function (s) { return s.replace(/\s+\d+\s*[a-zA-Z]?$/, ''); };
    var m = t.match(/^(.*?)[,\s]+(\d{5})\s+(.+)$/);
    if (m) {
      var str = m[1].replace(/,\s*$/, '').trim(), plz = m[2], ort = m[3].trim(), ort1 = ort.split(/[-\/(,]/)[0].trim();
      if (ort1 !== ort) dazu(str + ', ' + plz + ' ' + ort1, false);
      dazu(str + ', ' + plz, false);
      if (ohneNr(str) !== str) dazu(ohneNr(str) + ', ' + plz + ' ' + ort1, true);
      dazu(plz + ' ' + ort1, true);
    } else {
      var teile = t.split(',');
      if (teile.length > 1) { var s0 = teile[0].trim(), o0 = teile.slice(1).join(',').trim(); if (ohneNr(s0) !== s0) dazu(ohneNr(s0) + ', ' + o0, true); dazu(o0, true); }
    }
    return v;
  };
  /** Adresse → Koordinate (mit Merker, damit jede Adresse nur einmal gesucht wird). ungefaehr = nur Straße oder Ort gefunden. */
  G.finde = function (adresse, nahe) {
    var key = String(adresse || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key) return Promise.reject(new Error('Keine Adresse hinterlegt.'));
    if (geoMerker[key]) return Promise.resolve(geoMerker[key]);
    var v = G.varianten(adresse);
    function probier(i) {
      if (i >= v.length) return Promise.reject(new Error('Adresse nicht gefunden: ' + adresse));
      return G.suche(v[i][0], nahe).catch(function () { return []; }).then(function (l) {
        if (!l.length) return probier(i + 1);
        var k = Object.keys(geoMerker); if (k.length > 300) delete geoMerker[k[0]];
        var e = { lat: l[0].lat, lon: l[0].lon }; if (v[i][1]) e.ungefaehr = true; else { geoMerker[key] = e; B.schreiben('geo', geoMerker); }
        return e;
      });
    }
    return probier(0);
  };

  /* ---------- Route ---------- */
  var V_SYM = { 1: 'a_gerade', 2: 'a_gerade', 3: 'a_gerade', 7: 'a_gerade', 8: 'a_gerade', 17: 'a_gerade', 22: 'a_gerade', 9: 'a_lrechts', 10: 'a_rechts', 11: 'a_srechts', 12: 'a_wenden', 13: 'a_wenden',
    14: 'a_slinks', 15: 'a_links', 16: 'a_llinks', 18: 'a_abfr', 20: 'a_abfr', 19: 'a_abfl', 21: 'a_abfl', 23: 'a_gabr', 24: 'a_gabl', 25: 'a_einf', 37: 'a_einf', 38: 'a_einf', 26: 'a_kreisel', 27: 'a_kreisel', 4: 'a_ziel', 5: 'a_ziel', 6: 'a_ziel' };
  function ueberText(schritte) {
    var sum = {};
    schritte.forEach(function (s) { (s.namen || []).forEach(function (n) { if (/^[ABLK]\s?\d+/.test(n)) { var k = n.replace(/\s+/g, ''); sum[k] = (sum[k] || 0) + s.laenge; } }); });
    var top = Object.keys(sum).sort(function (a, b) { return sum[b] - sum[a]; }).filter(function (k) { return sum[k] > 800; }).slice(0, 2);
    if (!top.length) {
      var lang = schritte.slice().sort(function (a, b) { return b.laenge - a.laenge; })[0];
      return lang && lang.strasse ? 'Über ' + lang.strasse : '';
    }
    return 'Über ' + top.join(' und ');
  }
  function fertigeRoute(punkte, schritte, laenge, dauer, quelle) {
    var r = { punkte: punkte, kum: G.kumuliert(punkte), schritte: schritte, dauer: dauer, quelle: quelle, limits: [], pois: [] };
    r.laenge = r.kum[r.kum.length - 1] || laenge;
    schritte.forEach(function (s) { s.ab = Math.min(s.ab, punkte.length - 1); s.weg = r.kum[s.ab]; });
    r.ueber = ueberText(schritte);
    return r;
  }
  function valhalla(von, nach) {
    var body = { locations: [{ lat: von.lat, lon: von.lon }, { lat: nach.lat, lon: nach.lon }], costing: 'auto', units: 'kilometers', language: 'de-DE', directions_options: { units: 'kilometers', language: 'de-DE' } };
    if (von.kurs != null && von.kurs >= 0 && von.tempo > 3) { body.locations[0].heading = Math.round(von.kurs); body.locations[0].heading_tolerance = 60; }
    return B.json({ methode: 'POST', url: G.DIENST.valhalla + '/route', kopf: { 'Content-Type': 'application/json' }, daten: JSON.stringify(body), zeit: 20000 }).then(function (j) {
      var leg = j.trip && j.trip.legs && j.trip.legs[0];
      if (!leg || !leg.shape) throw new Error('Keine Route gefunden.');
      var punkte = G.polylinie(leg.shape, 6);
      var schritte = leg.maneuvers.map(function (m) {
        var namen = m.street_names || m.begin_street_names || [];
        return { ab: m.begin_shape_index, bis: m.end_shape_index, text: m.instruction || '', ansage: m.verbal_pre_transition_instruction || m.instruction || '',
          hinweis: m.verbal_transition_alert_instruction || m.instruction || '', art: V_SYM[m.type] || 'a_gerade', ziel: m.type >= 4 && m.type <= 6,
          namen: namen, strasse: namen[0] || '', laenge: (m.length || 0) * 1000, dauer: m.time || 0 };
      });
      return fertigeRoute(punkte, schritte, j.trip.summary.length * 1000, j.trip.summary.time, 'valhalla');
    });
  }
  var O_RICHT = { 'left': ['links abbiegen', 'a_links'], 'right': ['rechts abbiegen', 'a_rechts'], 'slight left': ['leicht links halten', 'a_llinks'], 'slight right': ['leicht rechts halten', 'a_lrechts'],
    'sharp left': ['scharf links abbiegen', 'a_slinks'], 'sharp right': ['scharf rechts abbiegen', 'a_srechts'], 'straight': ['geradeaus weiterfahren', 'a_gerade'], 'uturn': ['wenden', 'a_wenden'] };
  function osrmText(st) {
    var mv = st.maneuver || {}, r = O_RICHT[mv.modifier] || O_RICHT.straight, name = st.name || st.ref || '', auf = name ? ' auf ' + name : '';
    function gross(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
    switch (mv.type) {
      case 'depart': return ['Losfahren' + auf, 'a_gerade'];
      case 'arrive': return ['Sie haben Ihr Ziel erreicht', 'a_ziel'];
      case 'roundabout': case 'rotary': return ['Im Kreisverkehr die ' + (mv.exit || 1) + '. Ausfahrt nehmen' + (name ? ' Richtung ' + name : ''), 'a_kreisel'];
      case 'exit roundabout': case 'exit rotary': return ['Kreisverkehr verlassen' + auf, 'a_kreisel'];
      case 'merge': return ['Einfädeln' + auf, 'a_einf'];
      case 'on ramp': return ['Auffahrt nehmen' + auf, /left/.test(mv.modifier || '') ? 'a_abfl' : 'a_abfr'];
      case 'off ramp': return ['Ausfahrt nehmen' + auf, /left/.test(mv.modifier || '') ? 'a_abfl' : 'a_abfr'];
      case 'fork': return [(/left/.test(mv.modifier || '') ? 'Links halten' : 'Rechts halten') + auf, /left/.test(mv.modifier || '') ? 'a_gabl' : 'a_gabr'];
      case 'new name': case 'continue': if (!mv.modifier || mv.modifier === 'straight') return ['Weiter' + auf, 'a_gerade'];
      /* fällt durch */
      default: return [gross(r[0]) + auf, r[1]];
    }
  }
  function osrm(von, nach) {
    var u = G.DIENST.osrm + '/route/v1/driving/' + von.lon + ',' + von.lat + ';' + nach.lon + ',' + nach.lat + '?steps=true&geometries=polyline6&overview=false';
    return B.json({ url: u, zeit: 20000 }).then(function (j) {
      var ro = j.routes && j.routes[0], leg = ro && ro.legs && ro.legs[0];
      if (!leg) throw new Error('Keine Route gefunden.');
      var punkte = [], schritte = [];
      leg.steps.forEach(function (st) {
        var g = G.polylinie(st.geometry, 6), ab = Math.max(0, punkte.length - 1);
        if (punkte.length) g.shift();
        punkte = punkte.concat(g);
        var t = osrmText(st);
        schritte.push({ ab: st.maneuver.type === 'depart' ? 0 : ab, bis: punkte.length - 1, text: t[0], ansage: t[0] + '.', hinweis: t[0] + '.', art: t[1], ziel: st.maneuver.type === 'arrive',
          namen: [st.ref, st.name].filter(Boolean), strasse: st.name || st.ref || '', laenge: st.distance || 0, dauer: st.duration || 0 });
      });
      if (punkte.length < 2) throw new Error('Keine Route gefunden.');
      return fertigeRoute(punkte, schritte, ro.distance, ro.duration, 'osrm');
    });
  }
  G.route = function (von, nach) {
    return valhalla(von, nach).catch(function (e1) {
      return osrm(von, nach).catch(function (e2) { throw new Error(/Keine Route/.test(e1.message + e2.message) ? 'Keine Route gefunden.' : 'Die Route konnte nicht berechnet werden. Bitte Internet prüfen.'); });
    });
  };

  /* ---------- Tempolimits entlang der Route ---------- */
  G.limits = function (r) {
    if (r.quelle !== 'valhalla' && r.punkte.length > 4000) return Promise.resolve([]);
    var form = r.punkte.map(function (p) { return { lat: p[1], lon: p[0] }; });
    var body = { shape: form, costing: 'auto', shape_match: r.quelle === 'valhalla' ? 'edge_walk' : 'map_snap',
      filters: { attributes: ['edge.speed_limit', 'edge.begin_shape_index', 'edge.end_shape_index'], action: 'include' } };
    return B.json({ methode: 'POST', url: G.DIENST.valhalla + '/trace_attributes', kopf: { 'Content-Type': 'application/json' }, daten: JSON.stringify(body), zeit: 25000 }).then(function (j) {
      var l = [];
      (j.edges || []).forEach(function (e) {
        var v = e.speed_limit;
        if (typeof v !== 'number' || v <= 0 || v > 140 || e.begin_shape_index == null) return;   // unbekannt oder unbegrenzt: kein Schild
        var letzt = l[l.length - 1];
        if (letzt && letzt.kmh === v && letzt.bis >= e.begin_shape_index - 1) letzt.bis = e.end_shape_index;
        else l.push({ ab: e.begin_shape_index, bis: e.end_shape_index, kmh: Math.round(v) });
      });
      r.limits = l; return l;
    }).catch(function () { return []; });
  };
  G.limitBei = function (r, idx) {
    var l = r.limits || [];
    for (var i = 0; i < l.length; i++) if (idx >= l[i].ab && idx < l[i].bis) return l[i].kmh;
    return 0;
  };

  /* ---------- Ladesäulen, Parkplätze mit WC, Bäcker/Cafés und Diesel-Tankstellen entlang der Route ---------- */
  /** Rechtecke um je 20 km Strecke (mit 600 m Rand) – höchstens 12, also die nächsten 240 km */
  function kaesten(r) {
    var aus = [], schritt = 20000;
    for (var a = 0; a < r.laenge && aus.length < 12; a += schritt) {
      var s = 90, w = 180, n = -90, o = -180, ende = Math.min(r.laenge, a + schritt);
      for (var x = a; ; x = Math.min(ende, x + 250)) {
        var p = G.punktBei(r, x); if (p.lat < s) s = p.lat; if (p.lat > n) n = p.lat; if (p.lon < w) w = p.lon; if (p.lon > o) o = p.lon;
        if (x >= ende) break;
      }
      var dLat = 0.0055, dLon = 0.0055 / Math.cos((s + n) / 2 * RAD);
      aus.push('(' + [s - dLat, w - dLon, n + dLat, o + dLon].map(function (z) { return z.toFixed(4); }).join(',') + ')');
    }
    return aus;
  }
  G.pois = function (r, versuch) {
    var k = kaesten(r), u = 450;
    function je(filter) { return k.map(function (b) { return 'nwr' + filter + b + ';'; }).join(''); }
    var q = '[out:json][timeout:25];' +
      '(' + je('["amenity"="toilets"]["access"!~"private|customers|no"]') + ')->.t;' +
      '(nwr["amenity"="parking"](around.t:120);nwr["highway"~"^(rest_area|services)$"](around.t:200);)->.p;' +
      '(nwr.t(around.p:200);' + je('["highway"="rest_area"]["toilets"="yes"]') + je('["amenity"="parking"]["toilets"="yes"]') + ')->.wc;' +
      '.wc out center tags;' +
      '(' + je('["amenity"="charging_station"]') + ');out center tags;' +
      // Bäcker und Cafés, Tankstellen mit Diesel (alles außer ausdrücklich „kein Diesel“)
      '(' + je('["shop"="bakery"]') + je('["amenity"="cafe"]') + je('["amenity"="fuel"]["fuel:diesel"!="no"]') + ');out center tags;';
    function frag(i) {
      return B.json({ methode: 'POST', url: G.DIENST.overpass[i], kopf: { 'Content-Type': 'application/x-www-form-urlencoded' }, daten: 'data=' + encodeURIComponent(q), zeit: 30000 })
        .then(function (j) { if (!j || !Array.isArray(j.elements)) throw new Error('leer'); return j; })
        .catch(function (e) { if (i + 1 < G.DIENST.overpass.length) return frag(i + 1); throw e; });
    }
    return frag(0).then(function (j) {
      var aus = [], gesehen = {};
      (j.elements || []).forEach(function (e) {
        var lat = e.lat != null ? e.lat : e.center && e.center.lat, lon = e.lon != null ? e.lon : e.center && e.center.lon, t = e.tags || {};
        if (lat == null) return;
        var art = t.amenity === 'charging_station' ? 'laden' : t.amenity === 'fuel' ? 'tanken' : (t.shop === 'bakery' || t.amenity === 'cafe') ? 'essen' : 'wc';
        var s = G.einrasten(r, { lat: lat, lon: lon });
        if (!s || s.entf > (art === 'essen' ? 350 : u + 150)) return;   // Bäcker und Cafés nur, wenn sie nah an der Strecke liegen
        var key = art + Math.round(s.weg / (art === 'essen' ? 300 : 150));   // dicht beieinander liegende Einträge zusammenfassen
        if (gesehen[key]) return; gesehen[key] = 1;
        var offen = t.opening_hours === '24/7' ? 'immer offen' : (t.opening_hours ? 'geöffnet ' + t.opening_hours : '');
        var ersatz = { laden: 'Ladesäule', tanken: 'Tankstelle', essen: t.shop === 'bakery' ? 'Bäckerei' : 'Café', wc: 'Parkplatz mit WC' }[art];
        var p = { art: art, lat: lat, lon: lon, weg: s.weg, abseits: Math.round(s.entf), name: t.name || (art === 'tanken' ? t.brand : '') || t.operator || ersatz };
        if (art === 'laden') {
          var st = [];
          if (t['socket:type2_combo']) st.push('CCS'); if (t['socket:type2']) st.push('Typ 2'); if (t['socket:chademo']) st.push('CHAdeMO'); if (t['socket:schuko']) st.push('Schuko');
          p.info = [t.capacity ? (String(t.capacity) === '1' ? '1 Platz' : t.capacity + ' Plätze') : '', st.join(' · '), t.operator && t.operator !== p.name ? t.operator : ''].filter(Boolean).join(' · ');
        } else if (art === 'tanken') {
          p.info = [t.brand && t.brand !== p.name ? t.brand : '', t['fuel:diesel'] === 'yes' ? 'Diesel' : '', t['fuel:adblue'] === 'yes' ? 'AdBlue' : '', offen].filter(Boolean).join(' · ');
        } else if (art === 'essen') {
          p.info = [p.name !== ersatz ? ersatz : '', offen].filter(Boolean).join(' · ');
        } else {
          p.info = [t.fee === 'yes' ? 'gebührenpflichtig' : (t.fee === 'no' ? 'kostenlos' : ''), t.wheelchair === 'yes' ? 'barrierefrei' : '', t.opening_hours === '24/7' ? 'immer offen' : ''].filter(Boolean).join(' · ');
        }
        aus.push(p);
      });
      aus.sort(function (a, b) { return a.weg - b.weg; });
      r.pois = aus; r.poisDa = true; return aus;
    }).catch(function () {
      // freie Server sind manchmal überlastet: nach 25 Sekunden noch zweimal versuchen
      if ((versuch || 0) < 2) return new Promise(function (ok) { setTimeout(ok, 25000); }).then(function () { return G.pois(r, (versuch || 0) + 1); });
      return [];
    });
  };

  /* ---------- Wetter (Deutscher Wetterdienst über Bright Sky) ---------- */
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  G.iso = iso;
  G.wetter = function (lat, lon) {
    var heute = new Date(), ende = new Date(Date.now() + 5 * 86400000);
    var q = 'lat=' + lat.toFixed(3) + '&lon=' + lon.toFixed(3) + '&tz=Europe%2FBerlin';
    return Promise.all([
      B.json({ url: G.DIENST.wetter + '/current_weather?' + q, zeit: 15000 }).catch(function () { return null; }),
      B.json({ url: G.DIENST.wetter + '/weather?' + q + '&date=' + iso(heute) + '&last_date=' + iso(ende), zeit: 20000 })
    ]).then(function (a) {
      var st = (a[1].weather || []).map(function (w) {
        return { zeit: new Date(w.timestamp), temp: w.temperature, regen: w.precipitation || 0, wahrsch: w.precipitation_probability, wind: w.wind_speed, boe: w.wind_gust_speed, bild: w.icon || '', lage: w.condition || '' };
      }).filter(function (w) { return w.temp != null; });
      var j = a[0] && a[0].weather, jetzt = null;
      if (j) jetzt = { temp: j.temperature, wind: j.wind_speed_30 != null ? j.wind_speed_30 : j.wind_speed_10, boe: j.wind_gust_speed_30 != null ? j.wind_gust_speed_30 : j.wind_gust_speed_10, regen: j.precipitation_60 != null ? j.precipitation_60 : j.precipitation_30, feuchte: j.relative_humidity, bild: j.icon || '', lage: j.condition || '' };
      if (!jetzt) { var n = st.filter(function (w) { return w.zeit.getTime() >= Date.now() - 3600000; })[0]; if (n) jetzt = { temp: n.temp, wind: n.wind, boe: n.boe, regen: n.regen, bild: n.bild, lage: n.lage }; }
      var tage = {}, liste = [];
      st.forEach(function (w) {
        var k = iso(w.zeit), t = tage[k];
        if (!t) { t = tage[k] = { datum: k, min: 99, max: -99, regen: 0, boe: 0, bilder: {} }; liste.push(t); }
        if (w.temp < t.min) t.min = w.temp; if (w.temp > t.max) t.max = w.temp;
        t.regen += w.regen; if ((w.boe || 0) > t.boe) t.boe = w.boe;
        var h = w.zeit.getHours(); if (h >= 8 && h <= 19) t.bilder[w.bild] = (t.bilder[w.bild] || 0) + (/rain|snow|sleet|hail|thunder/.test(w.bild) ? 2 : 1);
      });
      liste.forEach(function (t) { var b = Object.keys(t.bilder).sort(function (x, y) { return t.bilder[y] - t.bilder[x]; })[0]; t.bild = b || 'cloudy'; });
      return { jetzt: jetzt, stunden: st, tage: liste };
    });
  };
  var W_SYM = { 'clear-day': 'sonne', 'clear-night': 'nacht', 'partly-cloudy-day': 'wolkig', 'partly-cloudy-night': 'wolkig', cloudy: 'wolke', fog: 'nebel', wind: 'wind', rain: 'regen', sleet: 'regen', snow: 'schnee', hail: 'regen', thunderstorm: 'gewitter' };
  var W_TXT = { 'clear-day': 'Sonnig', 'clear-night': 'Klar', 'partly-cloudy-day': 'Wolkig', 'partly-cloudy-night': 'Wolkig', cloudy: 'Bedeckt', fog: 'Nebel', wind: 'Windig', rain: 'Regen', sleet: 'Schneeregen', snow: 'Schnee', hail: 'Hagel', thunderstorm: 'Gewitter' };
  G.wetterSym = function (b) { return W_SYM[b] || 'wolke'; };
  G.wetterText = function (b) { return W_TXT[b] || 'Wetter'; };
})();
