/* Zielführung: Position auf der Route, nächste Abbiegung, Ansagen, Neuberechnung, Kamera. */
(function () {
  'use strict';
  var G = FV.G, B = FV.B, K = FV.K;
  var F = FV.F = { aktiv: false, sichtbar: false, route: null, ziel: null, stand: null };
  var o = null, hoerer = null, zustand = null, folgeTimer = null, simTimer = null;

  function neuerZustand() { return { weg: 0, idx: 0, abseits: 0, neuUm: 0, rechnet: false, neuGesagt: false, fehl: 0, zoom: 16, gesagt: {}, wcGesagt: {}, start: Date.now(), angekommen: false, letzter: null }; }

  F.start = function (route, ziel, opt) {
    F.stopp(true);
    F.route = route; F.ziel = ziel; o = opt || {}; zustand = neuerZustand(); F.aktiv = true; K.folgt = true; F.stand = null;
    document.body.classList.add('navi');
    B.ortStart(); B.wach(true);
    hoerer = B.beiOrt(ort);
    K.beiGeste(function () { if (!F.aktiv) return; K.folgt = false; clearTimeout(folgeTimer); folgeTimer = setTimeout(function () { K.folgt = true; if (zustand && zustand.letzter) kamera(zustand.letzter, true); }, 8000); if (o.beiFolgen) o.beiFolgen(false); });
    var s0 = route.schritte[0];
    sag((s0 ? s0.ansage + ' ' : '') + 'Die Strecke ist ' + G.km(route.laenge).replace(' km', ' Kilometer') + ' lang.');
    var p = B.ort(); if (p) ort(p);
  };
  F.stopp = function (leise) {
    if (hoerer) { hoerer(); hoerer = null; }
    clearTimeout(folgeTimer); clearInterval(simTimer); simTimer = null; B.probe = false;
    if (F.aktiv && !leise) B.still();
    F.aktiv = false; K.beiGeste(null); B.wach(false);
    document.body.classList.remove('navi');
  };
  /** Die Fahrt-Seite ist zu sehen (an) oder der Fahrer schaut gerade auf eine andere Seite (aus).
   *  Die Zielführung läuft in beiden Fällen weiter; die Karte wird nur bewegt, solange sie zu sehen ist. */
  F.sicht = function (an) {
    F.sichtbar = !!an;
    if (an && F.aktiv && zustand && zustand.letzter) { K.auto(zustand.letzter.pos, zustand.letzter.kurs); kamera(zustand.letzter, true); }
  };
  F.zentrieren = function () { K.folgt = true; clearTimeout(folgeTimer); if (zustand && zustand.letzter) kamera(zustand.letzter, false); if (o && o.beiFolgen) o.beiFolgen(true); };
  F.uebersicht = function () { K.folgt = false; clearTimeout(folgeTimer); K.rahmen(F.route.punkte, { top: 110, bottom: 90, left: 40, right: 60 }); if (o && o.beiFolgen) o.beiFolgen(false); };

  function sag(t) { if (!o || o.ton !== false) { if (FV.app && FV.app.e && FV.app.e.ansage === false) return; B.sprich(t); } }
  function klein(t) { t = String(t || '').replace(/\.\s*$/, ''); return t.charAt(0).toLowerCase() + t.slice(1); }

  function kamera(k, sofort) {
    if (!K.folgt || !F.sichtbar) return;
    K.folgen(k.pos, k.kurs, zustand.zoom, sofort);
  }
  function zoomZiel(kmh, bisAbbiegen, limit) {
    var z = kmh < 25 ? 17 : kmh < 45 ? 16.5 : kmh < 70 ? 15.8 : kmh < 95 ? 15.1 : 14.4;
    if (limit && limit <= 50) z = Math.max(z, 16.4);          // in Ortschaften näher heran
    if (bisAbbiegen < 300) z = Math.max(z, 16.9);              // vor dem Abbiegen heranzoomen
    else if (bisAbbiegen < 700) z = Math.max(z, 16);
    return z;
  }

  function ort(p) {
    if (!F.aktiv || !F.route || zustand.angekommen) return;
    var r = F.route, z = zustand, jetzt = Date.now();
    if (p.genau > 80) return;
    var s = G.einrasten(r, p, z.idx - 4, z.idx + 90);
    if (!s || s.entf > 80) s = G.einrasten(r, p) || s;
    if (!s) return;
    var grenze = 40 + Math.min(p.genau || 0, 30);
    if (s.entf > grenze) z.abseits++; else { z.abseits = 0; z.neuGesagt = false; z.fehl = 0; }
    // Klappt die Neuberechnung nicht (Funkloch), wird in wachsenden Abständen still weiter versucht: 9, 18, 36, höchstens 60 Sekunden
    var pause = Math.min(60000, 9000 * Math.pow(2, z.fehl));
    if (z.abseits >= 4 && !z.rechnet && jetzt - z.neuUm > pause) { neuRechnen(p); }
    var aufRoute = s.entf <= grenze;
    if (aufRoute) { z.weg = s.weg; z.idx = s.idx; }
    var kmh = p.tempo >= 0 ? p.tempo * 3.6 : 0;
    var kurs = (p.tempo > 2 && p.kurs >= 0) ? p.kurs : s.kurs;
    var pos = aufRoute ? { lat: s.lat, lon: s.lon } : { lat: p.lat, lon: p.lon };

    /* nächste Abbiegung */
    var sch = r.schritte, n = -1, akt = 0;
    for (var i = 1; i < sch.length; i++) { if (sch[i].weg > z.weg + 4) { n = i; break; } akt = i; }
    var rest = Math.max(0, r.laenge - z.weg);
    var bis = n >= 0 ? sch[n].weg - z.weg : rest, schritt = n >= 0 ? sch[n] : sch[sch.length - 1];
    /* Restzeit: Rest des laufenden Abschnitts + alle folgenden */
    var ende = n >= 0 ? sch[n].weg : r.laenge, abschnitt = Math.max(1, ende - sch[akt].weg);
    var restS = (sch[akt].dauer || 0) * Math.min(1, Math.max(0, (ende - z.weg) / abschnitt));
    for (var k = akt + 1; k < sch.length; k++) restS += sch[k].dauer || 0;

    /* Ansagen */
    if (n >= 0 && aufRoute) {
      var v = Math.max(3, p.tempo > 0 ? p.tempo : 8), fern = Math.max(250, Math.min(1200, v * 25)), nah = Math.max(40, Math.min(160, v * 5.5));
      var davor = sch[n].weg - sch[n - 1].weg, m = z.gesagt[n] || 0;
      if (m < 2 && bis <= nah) { z.gesagt[n] = 2; sag(schritt.ziel ? 'Sie erreichen gleich Ihr Ziel.' : schritt.ansage); }
      else if (m < 1 && bis <= fern && bis > nah * 1.8 && davor > fern * 0.7) { z.gesagt[n] = 1; sag('In ' + G.meterSprache(bis) + ' ' + klein(schritt.hinweis || schritt.text) + '.'); }
    }
    /* Parkplatz mit WC drei Kilometer vorher ansagen */
    var wcIn = -1, e = FV.app && FV.app.e || {};
    (r.pois || []).forEach(function (q, qi) {
      if (q.art !== 'wc' || q.weg <= z.weg + 30) return;
      var d = q.weg - z.weg;
      if (wcIn < 0 || d < wcIn) wcIn = d;
      if (e.wc !== false && e.wcAnsage !== false && !z.wcGesagt[qi] && d <= 3150 && d >= 2500) { z.wcGesagt[qi] = 1; sag('In drei Kilometern Parkplatz mit WC.'); }
    });

    var limit = G.limitBei(r, z.idx);
    var zz = zoomZiel(kmh, bis, limit); z.zoom += Math.max(-0.35, Math.min(0.35, zz - z.zoom));
    z.letzter = { pos: pos, kurs: kurs };
    if (F.sichtbar) { K.auto(pos, kurs); K.gefahren(r, aufRoute ? s : null); } kamera(z.letzter, false);

    F.stand = { bis: bis, schritt: schritt, restM: rest, restS: restS, ankunft: new Date(jetzt + restS * 1000), kmh: Math.round(kmh), limit: limit, wcIn: wcIn, aufRoute: aufRoute, rechnet: z.rechnet };
    if (o.beiStand) o.beiStand(F.stand);

    /* Ziel erreicht */
    if (aufRoute && rest < 35 && (p.genau || 0) < 60) {
      z.angekommen = true; sag('Sie haben Ihr Ziel erreicht.');
      var cb = o.beiZiel; F.stopp(true); if (cb) cb();
    }
  }

  function neuRechnen(p) {
    var z = zustand; z.rechnet = true; z.neuUm = Date.now();
    if (!z.neuGesagt) { z.neuGesagt = true; sag('Die Route wird neu berechnet.'); }   // nur einmal je Abweichung, nicht bei jedem Versuch
    G.route({ lat: p.lat, lon: p.lon, kurs: p.kurs, tempo: p.tempo }, F.ziel).then(function (r) {
      if (!F.aktiv || zustand !== z) return;   // inzwischen beendet oder eine andere Route gestartet
      var gesamtStart = zustand.start; F.route = r; zustand = neuerZustand(); zustand.start = gesamtStart; zustand.neuUm = Date.now(); zustand.gesagt[0] = 2;
      if (F.sichtbar) K.route(r);
      G.limits(r); G.pois(r).then(function () { if (o.beiPois) o.beiPois(r.pois); });
      if (o.beiNeu) o.beiNeu(r);
      var q = B.ort(); if (q) ort(q);
    }).catch(function () { if (zustand === z) { z.rechnet = false; z.fehl++; z.neuUm = Date.now(); } });
  }

  /* ---------- Probefahrt (Vorschau/Test): fährt die Route automatisch ab ---------- */
  F.probefahrt = function (kmh, ab) {
    clearInterval(simTimer); B.probe = true;
    var weg = ab || 0, r = F.route, v = (kmh || 60) / 3.6;
    function tick() {
      if (!F.aktiv) { clearInterval(simTimer); return; }
      r = F.route; weg = Math.min(r.laenge, weg + v);
      var a = G.punktBei(r, weg), b = G.punktBei(r, Math.min(r.laenge, weg + 15));
      B._simOrt({ lat: a.lat, lon: a.lon, genau: 5, tempo: v, kurs: G.kurs(a, b), zeit: Date.now() });
    }
    simTimer = setInterval(tick, 1000); tick();
  };
  F.simSetze = function (weg, kmh) {
    var r = F.route, a = G.punktBei(r, weg), b = G.punktBei(r, Math.min(r.laenge, weg + 15));
    B._simOrt({ lat: a.lat, lon: a.lon, genau: 5, tempo: (kmh || 60) / 3.6, kurs: G.kurs(a, b), zeit: Date.now() });
  };
})();
