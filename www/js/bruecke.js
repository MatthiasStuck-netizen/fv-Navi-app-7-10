/* Brücke zwischen Oberfläche und Android (Standort, Sprache, Kamera, Speicher, Internet).
 * Im Browser (Vorschau/Test) werden die Funktionen so gut wie möglich nachgebildet. */
window.FV = window.FV || {};
(function () {
  'use strict';
  var N = window.FVNative || null;
  var offen = {}, nr = 0, ortHoerer = [], letzterOrt = null;
  var B = FV.B = { nativ: !!N, gesprochen: [] };

  function neu(ok, fehl) { var id = 'r' + (++nr); offen[id] = { ok: ok, fehl: fehl }; return id; }

  /* Android ruft hier zurück */
  FV._nativ = function (typ, id, a, b) {
    if (typ === 'ort') { if (!B.probe) ortEmpfangen(a); return; }   // während einer Probefahrt zählt nur die gespielte Position
    if (typ === 'zurueck') { if (FV.app && FV.app.zurueck) FV.app.zurueck(); return; }
    if (typ === 'sichtbar') { if (FV.app && FV.app.sichtbar) FV.app.sichtbar(!!a); return; }
    var o = offen[id]; if (!o) return; delete offen[id];
    if (typ === 'fehler') o.fehl(new Error(String(a || 'Fehler'))); else if (typ === 'http') o.ok({ status: a, text: b || '' }); else o.ok(a);
  };

  /* ---------- Internet ---------- */
  B.http = function (o) {
    var kopf = o.kopf || {}, zeit = o.zeit || 20000;
    if (N) return new Promise(function (ok, fehl) { N.http(neu(ok, fehl), o.methode || 'GET', o.url, JSON.stringify(kopf), o.daten == null ? '' : String(o.daten), zeit); });
    var ab = new AbortController(), t = setTimeout(function () { ab.abort(); }, zeit);
    return fetch(o.url, { method: o.methode || 'GET', headers: kopf, body: o.daten == null ? undefined : o.daten, signal: ab.signal })
      .then(function (r) { return r.text().then(function (x) { clearTimeout(t); return { status: r.status, text: x }; }); })
      .catch(function (e) { clearTimeout(t); throw new Error(e && e.name === 'AbortError' ? 'Zeitüberschreitung' : 'Keine Verbindung'); });
  };
  B.json = function (o) {
    return B.http(o).then(function (r) {
      var j; try { j = JSON.parse(r.text); } catch (e) { throw new Error('Unerwartete Antwort (' + r.status + ')'); }
      if (r.status >= 400 && !o.auchFehler) { var er = new Error((j && (j.error || j.message || j.msg)) || ('Fehler ' + r.status)); er.status = r.status; throw er; }
      return j;
    });
  };

  /* ---------- Speicher ---------- */
  B.lesen = function (k, ersatz) {
    var v = null;
    try { v = N ? N.lesen(k) : localStorage.getItem('fv_' + k); } catch (e) {}
    if (v == null || v === '') return ersatz === undefined ? null : ersatz;
    try { return JSON.parse(v); } catch (e) { return v; }
  };
  B.schreiben = function (k, v) {
    var t = v == null ? '' : JSON.stringify(v);
    try { if (N) N.schreiben(k, t); else if (t === '') localStorage.removeItem('fv_' + k); else localStorage.setItem('fv_' + k, t); } catch (e) {}
  };
  /* Anmeldung liegt in Android, damit auch Android Auto sie kennt */
  B.anmeldung = function () {
    if (N) { try { return JSON.parse(N.anmeldung() || '{}'); } catch (e) { return {}; } }
    return B.lesen('anmeldung', {});
  };
  B.anmeldungSetzen = function (a) { if (N) N.anmeldungSetzen(a.token || '', a.rolle || '', a.name || ''); else B.schreiben('anmeldung', a.token ? a : null); };

  /* ---------- Standort ---------- */
  function ortEmpfangen(p) {
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { return; } }
    if (!p || typeof p.lat !== 'number') return;
    letzterOrt = p;
    ortHoerer.slice().forEach(function (f) { try { f(p); } catch (e) { console.error(e); } });
  }
  var wache = null;
  B.ortStart = function () {
    if (N) { N.ortStart(); return; }
    if (wache != null || !navigator.geolocation) return;
    wache = navigator.geolocation.watchPosition(function (g) {
      if (B.probe) return;
      ortEmpfangen({ lat: g.coords.latitude, lon: g.coords.longitude, genau: g.coords.accuracy, tempo: g.coords.speed == null ? -1 : g.coords.speed, kurs: g.coords.heading == null || isNaN(g.coords.heading) ? -1 : g.coords.heading, zeit: g.timestamp });
    }, function () {}, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  };
  B.ortStopp = function () { if (N) N.ortStopp(); else if (wache != null) { navigator.geolocation.clearWatch(wache); wache = null; } };
  B.beiOrt = function (f) { ortHoerer.push(f); return function () { var i = ortHoerer.indexOf(f); if (i >= 0) ortHoerer.splice(i, 1); }; };
  B.ort = function () { return letzterOrt; };
  B._simOrt = ortEmpfangen;   // für Tests und Vorschau
  /* Kilometerzähler (läuft in Android weiter, auch wenn der Bildschirm aus ist) */
  var simMeter = 0, simLetzter = null;
  B.beiOrt(function (p) {
    if (N) return;
    if (simLetzter && p.genau < 40) { var d = FV.G ? FV.G.abstand(simLetzter, p) : 0; if (d > 4 && d < 2000) { simMeter += d; simLetzter = p; } } else if (!simLetzter) simLetzter = p;
  });
  B.zaehler = function () { if (N) { try { return JSON.parse(N.zaehler() || '{}'); } catch (e) { return { meter: 0 }; } } return { meter: simMeter }; };
  B.zaehlerNull = function () { if (N) N.zaehlerNull(); simMeter = 0; simLetzter = letzterOrt; };

  /* ---------- Sprache, Bildschirm ---------- */
  B.sprich = function (text) {
    B.gesprochen.push(text); if (B.gesprochen.length > 50) B.gesprochen.shift();
    if (N) { N.sprich(text); return; }
    try { if (window.speechSynthesis) { var u = new SpeechSynthesisUtterance(text); u.lang = 'de-DE'; u.rate = webStimme.tempo; u.pitch = webStimme.hoehe;
      if (webStimme.name) { var v = speechSynthesis.getVoices().filter(function (x) { return x.name === webStimme.name; })[0]; if (v) u.voice = v; }
      speechSynthesis.speak(u); } } catch (e) {}
  };
  /* Stimmenauswahl: Liste der deutschen Stimmen, Wahl von Stimme, Tempo und Tonhöhe */
  var webStimme = { name: '', tempo: 1, hoehe: 1 };
  B.stimmen = function () {
    if (N) { try { return N.stimmen ? JSON.parse(N.stimmen() || '{}') : {}; } catch (e) { return {}; } }
    try {
      var l = (window.speechSynthesis ? speechSynthesis.getVoices() : []).filter(function (v) { return /^de\b/i.test(v.lang); });
      return { wahl: webStimme.name, stimmen: l.map(function (v) { return { name: v.name, land: (v.lang.split(/[-_]/)[1] || ''), netz: !v.localService, qualitaet: 300 }; }) };
    } catch (e) { return {}; }
  };
  B.stimmeWaehlen = function (name, tempo, hoehe) {
    tempo = +tempo || 1; hoehe = +hoehe || 1;
    if (N) { try { if (N.stimmeWaehlen) N.stimmeWaehlen(name || '', tempo, hoehe); } catch (e) {} return; }
    webStimme = { name: name || '', tempo: tempo, hoehe: hoehe };
  };
  B.sprachEinstellungen = function () { if (N) { try { if (N.sprachEinstellungen) N.sprachEinstellungen(); } catch (e) {} } };
  B.still = function () { if (N) N.still(); else try { speechSynthesis.cancel(); } catch (e) {} };
  B.wach = function (an) { if (N) N.wach(!!an); };
  B.vollbild = function (an) { if (N) N.vollbild(!!an); };

  /* ---------- Andere Apps ---------- */
  B.kartenApp = function (ziel) { if (N) N.kartenApp(ziel); else window.open('https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(ziel), '_blank'); };
  B.anrufen = function (tel) { if (N) N.anrufen(tel); else location.href = 'tel:' + encodeURIComponent(tel); };
  B.oeffnen = function (url) { if (N) N.oeffnen(url); else window.open(url, '_blank'); };
  /* ---------- Offline-Navi (Organic Maps / OsmAnd mit heruntergeladener Deutschland-Karte) ---------- */
  B.OFFLINE_APPS = { 'app.organicmaps': 'Organic Maps', 'net.osmand': 'OsmAnd' };
  B.appDa = function (paket) { if (N && N.appDa) { try { return !!N.appDa(paket); } catch (e) {} } return false; };
  /** Ziel an die Offline-Navi übergeben. ziel = { lat, lon, name, adresse }. Gibt false zurück, wenn die App fehlt. */
  B.offlineNavi = function (paket, ziel) {
    var name = String(ziel.name || ziel.adresse || 'Ziel').replace(/[()]/g, ' '), u1, u2, o = letzterOrt;
    if (ziel.lat != null && ziel.lon != null) {
      var ll = (+ziel.lat).toFixed(6) + ',' + (+ziel.lon).toFixed(6);
      u2 = 'geo:' + ll + '?q=' + ll + '(' + encodeURIComponent(name) + ')';
      u1 = (paket === 'app.organicmaps' && o) ? 'om://route?sll=' + o.lat.toFixed(6) + ',' + o.lon.toFixed(6) + '&saddr=' + encodeURIComponent('Mein Standort') + '&dll=' + ll + '&daddr=' + encodeURIComponent(name) + '&type=vehicle' : u2;
    } else { u1 = u2 = 'geo:0,0?q=' + encodeURIComponent(ziel.adresse || name); }   // ohne Koordinaten: Adresse in der Offline-Suche
    if (N && N.appMitZiel) { try { return !!N.appMitZiel(paket, u1, u2); } catch (e) { return false; } }
    window.open(u2, '_blank'); return true;
  };
  B.appLaden = function (paket) { B.oeffnen('https://play.google.com/store/apps/details?id=' + paket); };
  B.appStarten = function (paket, ersatzUrl) { if (N) return N.appStarten(paket, ersatzUrl || ''); if (ersatzUrl) window.open(ersatzUrl, '_blank'); return false; };

  /* ---------- Kamera ---------- */
  B.scan = function () {
    if (N) return new Promise(function (ok, fehl) { N.scan(neu(ok, fehl)); });
    return Promise.resolve(window.FV_TEST && FV_TEST.ausweis || prompt('Ausweis-Code (FVZ-…):') || '');
  };
  B.foto = function () {
    if (N) return new Promise(function (ok, fehl) { N.foto(neu(ok, fehl)); });
    if (window.FV_TEST && FV_TEST.foto) return Promise.resolve(FV_TEST.foto);
    return new Promise(function (ok, fehl) {
      var i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.capture = 'environment';
      i.onchange = function () { var f = i.files && i.files[0]; if (!f) return fehl(new Error('Kein Foto')); var r = new FileReader(); r.onload = function () { ok(String(r.result).replace(/^data:[^,]+,/, '')); }; r.onerror = function () { fehl(new Error('Foto nicht lesbar')); }; r.readAsDataURL(f); };
      i.click();
    });
  };
  B.info = function () { if (N) { try { return JSON.parse(N.info() || '{}'); } catch (e) {} } return { version: 'Vorschau', geraet: 'Browser' }; };
})();
