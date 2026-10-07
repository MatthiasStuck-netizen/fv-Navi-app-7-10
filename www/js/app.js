/* Fehnverleih Navi – Ablauf: Anmeldung, Reiter, Seitenwechsel, Fahrten, Standortmeldung */
(function () {
  'use strict';
  var B = FV.B, S = FV.S, G = FV.G, K = FV.K, F = FV.F;
  var $ = function (s, w) { return (w || document).querySelector(s); };
  var STD = { ansage: true, wc: true, laden: true, essen: true, tanken: true, wcAnsage: true, vorlesen: true, stimme: '', tempo: 1, hoehe: 1, offlineApp: 'app.organicmaps', fahrzeug: '', fahrzeugName: '', zuhause: '' };
  var app = FV.app = { e: Object.assign({}, STD, B.lesen('einstellungen', {}) || {}), z: { reiter: 'auftraege', tag: G.iso(new Date()), auftraege: [], ziele: {}, stand: '', laedt: false, fehler: '' }, stapel: [] };
  B.stimmeWaehlen(app.e.stimme, app.e.tempo, app.e.hoehe);   // gewählte Stimme gleich beim Start setzen
  FV.esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  var REITER = [['auftraege', 'kalender', 'Aufträge'], ['karte', 'karte', 'Karte'], ['lager', 'lager', 'Lager'], ['wetter', 'wolkig', 'Wetter'], ['fahrzeuge', 'lkw', 'Fahrzeuge'], ['einstellungen', 'zahnrad', 'Einstellungen']];
  var HOCH = { auftraege: 1, anmeldung: 1, sperre: 1 }, OHNE_LEISTE = { anmeldung: 1, sperre: 1 };

  app.speichern = function () { B.schreiben('einstellungen', app.e); };

  /* ---------- Seitenwechsel ---------- */
  app.zeige = function (name, p, art) {
    var alt = app.stapel[app.stapel.length - 1];
    if (alt && FV.Seiten[alt.name + '_weg']) FV.Seiten[alt.name + '_weg'](name);
    if (art === 'reiter') { app.stapel = []; app.z.reiter = name; }
    if (art === 'ersetzen') app.stapel.pop();
    app.stapel.push({ name: name, p: p || {} });
    zeichnen();
  };
  app.zurueck = function () {
    if (!$('#blatt').hidden) { app.blattZu(); return true; }
    // Während der Zielführung steht der Bildschirm fest: Die Zurück-Taste tut nichts. Beenden geht nur über das X (mit Rückfrage).
    if (app.oben() === 'fahrt') return true;
    if (document.body.classList.contains('vollbild')) { app.vollbild(false); return true; }
    if (app.stapel.length <= 1) { if (app.z.reiter !== 'auftraege' && S.angemeldet()) { app.zeige('auftraege', {}, 'reiter'); return true; } return false; }
    var alt = app.stapel.pop();
    if (FV.Seiten[alt.name + '_weg']) FV.Seiten[alt.name + '_weg']('zurueck');
    zeichnen(); return true;
  };
  /** Name der Seite, die gerade zu sehen ist */
  app.oben = function () { var s = app.stapel[app.stapel.length - 1]; return s ? s.name : ''; };
  /** Fester Knopf „Karte“: läuft eine Zielführung, zurück auf die laufende Strecke – sonst die Karte mit den Aufträgen von heute. */
  app.zurKarte = function () {
    app.blattZu();
    var laeuft = F.aktiv && app.z.lauf;
    if (laeuft && app.oben() === 'fahrt') return;
    var alt = app.stapel[app.stapel.length - 1];
    if (alt && FV.Seiten[alt.name + '_weg']) FV.Seiten[alt.name + '_weg']('karte');
    app.stapel = []; app.z.reiter = 'karte';
    app.zeige(laeuft ? 'fahrt' : 'uebersicht', laeuft ? {} : { tag: app.heute() });
  };
  app.neu = function () { zeichnen(); };
  function zeichnen() {
    var s = app.stapel[app.stapel.length - 1]; if (!s) return;
    document.body.className = 's-' + s.name + (document.body.classList.contains('vollbild') && s.name === 'fahrt' ? ' vollbild' : '') + (F.aktiv ? ' navi' : '');
    if (s.name !== 'fahrt') B.vollbild(false);
    $('#bannerbild').src = HOCH[s.name] ? 'img/banner-hoch.jpg' : 'img/banner-flach.jpg';
    var l = $('#leiste'); l.hidden = !!OHNE_LEISTE[s.name];
    l.innerHTML = REITER.map(function (r) { return '<button data-tun="reiter" data-r="' + r[0] + '"' + (r[0] === app.z.reiter ? ' class="akt"' : '') + '>' + FV.sym(r[1]) + r[2] + (r[0] === 'karte' ? '<i class="laeuft"></i>' : '') + '</button>'; }).join('');
    FV.Seiten[s.name](s.p);
  }
  app.vollbild = function (an) { document.body.classList.toggle('vollbild', !!an); B.vollbild(!!an); setTimeout(function () { if (K.map) K.map.resize(); }, 60); var k = $('#vollknopf'); if (k) k.innerHTML = FV.sym(an ? 'vollzu' : 'voll'); };

  /* ---------- Meldungen ---------- */
  var toastT = null, blaseT = null;
  app.toast = function (t, ms) { var e = $('#toast'); e.textContent = t; e.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { e.hidden = true; }, ms || 3200); };
  app.blatt = function (html) { var e = $('#blatt'); e.innerHTML = '<div class="innen">' + html + '</div>'; e.hidden = false; };
  app.blattZu = function () { var e = $('#blatt'); e.hidden = true; e.innerHTML = ''; if (frageOk) { var f = frageOk; frageOk = null; f(false); } };
  /** Rückfrage im eigenen Design. Liefert true/false. */
  var frageOk = null;
  app.frage = function (text, ja, nein) {
    return new Promise(function (ok) {
      var zeilen = String(text).split('\n');
      if (frageOk) { var f0 = frageOk; frageOk = null; f0(false); }
      frageOk = ok;
      app.blatt('<h2>' + FV.sym('info') + FV.esc(zeilen[0]) + '</h2>' + (zeilen.length > 1 ? '<p class="fragetext">' + FV.esc(zeilen.slice(1).join(' ')) + '</p>' : '') +
        '<div class="zweier"><button class="rand knopf" data-tun="frage" data-a="0">' + FV.esc(nein || 'Abbrechen') + '</button><button class="gold knopf" data-tun="frage" data-a="1">' + FV.esc(ja || 'Ja') + '</button></div>');
    });
  };
  FV.Tun.frage = function (e) { var f = frageOk; frageOk = null; app.blattZu(); if (f) f(e.getAttribute('data-a') === '1'); };
  /** Chat-Blase: erscheint oben, verschwindet nach 8 Sekunden von selbst */
  app.blase = function (von, text) {
    var e = $('#blase'); e.innerHTML = FV.sym('chat') + '<div><b>' + FV.esc(von) + '</b><span>' + FV.esc(text) + '</span></div>'; e.hidden = false;
    clearTimeout(blaseT); blaseT = setTimeout(function () { e.hidden = true; }, 8000);
    if (app.e.vorlesen !== false) B.sprich('Nachricht von ' + von + ': ' + text);
  };

  /* ---------- Anmeldung / Sperre ---------- */
  /** Abgemeldet (selbst oder vom Server). wer: Kennung des bisherigen Nutzers, damit seine laufende Fahrt noch ihm gehört. */
  app.abgemeldet = function (msg, wer) { F.stopp(); app.vollbild(false); app.aufraeumen(wer); B.ortStopp(); app.z.meldung = msg || ''; app.stapel = []; app.zeige('anmeldung'); };
  app.gesperrt = function (msg) { var s = app.stapel[app.stapel.length - 1]; if (s && s.name === 'sperre') return; F.stopp(); app.vollbild(false); K.leeren(); app.z.lauf = null; app.z.nav = null; app.z.meldung = msg || ''; app.stapel = []; app.zeige('sperre'); };
  /** Beim Abmelden: Was der bisherige Nutzer auf dem Handy hinterlassen hat, wird gelöscht – Auftragsliste, letzte Ziele,
   *  gemerkte Adressen, Einstellungen (mit „Zuhause“ und Fahrzeug) und der Kartenstil. Eine laufende Fahrt wird vorher
   *  abgeschlossen und geht unter seinem Namen ins Fahrtenbuch. Es bleiben nur die vor Ort gespeicherten Punkte von
   *  Lagerhalle und Verwaltung (gehören zum Betrieb, nicht zum Nutzer) und noch nicht gesendete Einträge der Warteschlange. */
  app.aufraeumen = function (wer) {
    if (S.demo) return;
    try { app.fahrtEnde('ohne Ziel', wer); } catch (e) {}
    ['auftraege', 'letzte', 'geo', 'fahrt', 'einstellungen', 'kartenstil'].forEach(function (k) { B.schreiben(k, null); });
    B.zaehlerNull();
    app.e = Object.assign({}, STD);
    var z = app.z;
    z.auftraege = []; z.ziele = {}; z.stand = ''; z.fehler = ''; z.nav = null; z.lauf = null; z.neu = null; z.artikel = null; z.fahrzeuge = null;
    z.treffer = null; z.tank = null; z.letzterAuftrag = ''; z.ausweis = ''; z.tag = app.heute(); z.reiter = 'auftraege'; z.meldenAus = false;
    G.vergessen(); K.leeren();
  };
  app.los = function () { app.stapel = []; app.zeige('auftraege', {}, 'reiter'); app.ladeAuftraege(); S.nachsenden(); B.ortStart(); if (!S.demo) fahrtPruefen(); };

  /* ---------- Aufträge ---------- */
  app.heute = function () { return G.iso(new Date()); };
  function termin(a) {
    var heute = app.heute(), raus = a.status === 'ausgegeben', lief = a.typ === 'Lieferung';
    var d = raus && a.bis ? a.bis : (a.datum || heute);
    var t = Object.assign({}, a);
    t.art = raus ? (lief ? 'abholung' : 'rueckgabe') : (lief ? 'lieferung' : 'auftrag');
    t.spaet = d < heute; t.tag = t.spaet ? heute : d; t.termin = d;
    t.zeit = a.ankunft_geplant || ''; t.bisZeit = a.abfahrt_geplant || '';
    return t;
  }
  app.ladeAuftraege = function () {
    var z = app.z; z.laedt = true; z.fehler = '';
    if (!z.auftraege.length && !S.demo) { var m = B.lesen('auftraege', null); if (m && m.liste) { z.auftraege = m.liste.map(termin); z.ziele = m.ziele || {}; z.stand = m.stand || ''; } }
    return S.ruf('navi_liste').then(function (r) {
      z.auftraege = (r.auftraege || []).map(termin); z.ziele = r.ziele || {}; z.stand = r.stand || ''; z.laedt = false;
      if (!S.demo) B.schreiben('auftraege', { liste: r.auftraege || [], ziele: z.ziele, stand: z.stand });
      if (app.stapel.length === 1 && app.z.reiter === 'auftraege') zeichnen();
    }).catch(function (e) { z.laedt = false; if (!e.stop) { z.fehler = e.message; if (app.stapel.length === 1 && app.z.reiter === 'auftraege') zeichnen(); } });
  };
  app.tagesliste = function (tag) {
    return app.z.auftraege.filter(function (a) { return a.tag === tag; }).sort(function (x, y) { return ((x.zeit || '99:99') + x.nr).localeCompare((y.zeit || '99:99') + y.nr); });
  };

  /* ---------- Fahrten (Kilometer zählen ab App-Start bis „Ziel erreicht“) ---------- */
  function fahrtPruefen() {
    var f = B.lesen('fahrt', null), jetzt = Date.now();
    if (f && f.start) {
      var m = B.zaehler().meter || 0;
      if (jetzt - f.start > 6 * 3600000) { if (m >= 300) app.fahrtEnde('ohne Ziel'); else app.fahrtNeu(); }
      return;
    }
    app.fahrtNeu();
  }
  app.fahrtNeu = function () { B.zaehlerNull(); B.schreiben('fahrt', { start: Date.now(), ziel: '', auftrag: '' }); };
  app.fahrtZiel = function (ziel, auftrag) { if (S.demo) return; var f = B.lesen('fahrt', null) || { start: Date.now() }; f.ziel = ziel || ''; f.auftrag = auftrag || ''; B.schreiben('fahrt', f); };
  /** Schließt die laufende Fahrt ab und schreibt sie ins Fahrtenbuch. Gibt die Kilometer zurück. */
  app.fahrtEnde = function (ersatzZiel, wer) {
    if (S.demo) { var dk = F.route ? Math.round(F.route.laenge / 100) / 10 : 0; if (dk) S.spaeter('fahrt_speichern', { km: dk, ziel: ersatzZiel || 'Fahrt' }); return dk; }
    var f = B.lesen('fahrt', null) || { start: Date.now() }, m = B.zaehler().meter || 0, km = Math.round(m / 100) / 10;
    if (m >= 200) {
      S.spaeter('fahrt_speichern', { start_ts: Math.round(f.start / 1000), ende_ts: Math.round(Date.now() / 1000), km: km, ziel: f.ziel || ersatzZiel || 'Fahrt', auftrag: f.auftrag || '',
        fahrzeug: app.e.fahrzeug || '', fahrzeug_name: app.e.fahrzeugName || '', quelle: f.ziel ? 'navigation' : 'frei' }, wer);
    }
    app.fahrtNeu();
    return m >= 200 ? km : 0;
  };

  /* ---------- Standort an die Verwaltung melden – nur während einer gestarteten Fahrt (Zielführung läuft) ----------
   * Ohne laufende Fahrt, nach „Ziel erreicht“, nach dem Beenden, bei gesperrter App und abgemeldet wird nichts gesendet. */
  var meldeZeit = 0;
  function melden(p) {
    var jetzt = Date.now();
    if (!F.aktiv || S.demo || !S.angemeldet() || jetzt - meldeZeit < 30000 || app.z.meldenAus) return;
    meldeZeit = jetzt;
    var f = B.lesen('fahrt', null) || {};
    S.ruf('navi_position', { lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5), tempo: p.tempo > 0 ? Math.round(p.tempo * 3.6) : 0, kurs: p.kurs >= 0 ? Math.round(p.kurs) : -1,
      fahrzeug: app.e.fahrzeug || '', fahrzeug_name: app.e.fahrzeugName || '', ziel: F.aktiv && F.ziel ? (F.ziel.name || '') : '', navi: F.aktiv, km: Math.round((B.zaehler().meter || 0) / 100) / 10 }, 10000)
      .catch(function (e) { if (e.unbekannt) app.z.meldenAus = true; });
  }

  /** Auftrag wurde auf dem Autobildschirm (Android Auto) angetippt: Route auf dem Handy öffnen */
  app.autoAuftrag = function (id) {
    if (!S.angemeldet() || F.aktiv) return;
    function los() { var a = app.z.auftraege.filter(function (x) { return x.id === id; })[0]; if (a) { app.blattZu(); FV.Tun.navi({ getAttribute: function () { return id; } }); return true; } return false; }
    if (!los()) app.ladeAuftraege().then(los);
  };

  /* ---------- Demo-Modus und Aufrufe von außen (fehnverleihnavi://…) ---------- */
  app.demoStart = function () { F.stopp(); app.z.lauf = null; app.z.nav = null; S.demo = true; app.z.auftraege = []; app.z.tag = app.heute(); app.z.meldenAus = false; app.los(); };
  app.demoEnde = function () { F.stopp(); S.abmeldenLokal(); app.z.auftraege = []; app.z.nav = null; app.z.lauf = null; app.z.reiter = 'auftraege'; app.stapel = []; if (S.angemeldet()) app.los(); else app.zeige('anmeldung'); };
  app.befehl = function (b) {
    b = String(b || '');
    if (b.indexOf('demo') !== 0) return;
    if (!S.demo) app.demoStart();
    if (b === 'demo') return;
    // demo/navi: Route zum ersten Auftrag zeigen · demo/fahrt: zusätzlich die Probefahrt starten
    var warte = 0, t = setInterval(function () {
      if (++warte > 60) return clearInterval(t);
      var a = app.tagesliste(app.heute())[0]; if (!a) return;
      clearInterval(t);
      FV.Tun.navi({ getAttribute: function () { return a.id; } });
      if (b !== 'demo/fahrt') return;
      var w2 = 0, t2 = setInterval(function () { if (++w2 > 120) return clearInterval(t2); if (app.z.nav && app.z.nav.route) { clearInterval(t2); FV.Tun['route-start'](); } }, 500);
    }, 500);
  };

  /* ---------- Start ---------- */
  app.sichtbar = function (an) { if (an && S.angemeldet()) { S.nachsenden(); if (app.stapel.length === 1 && app.z.reiter === 'auftraege') app.ladeAuftraege(); } };
  document.addEventListener('click', function (ev) {
    var e = ev.target.closest('[data-tun]'); if (!e) { if (ev.target.id === 'blatt') app.blattZu(); return; }
    var f = FV.Tun[e.getAttribute('data-tun')]; if (f) { ev.preventDefault(); f(e, ev); }
  });
  document.addEventListener('submit', function (ev) { ev.preventDefault(); var f = FV.Tun[ev.target.getAttribute('data-form')]; if (f) f(ev.target, ev); });
  window.addEventListener('error', function (e) { if (window.FV_TEST) (FV_TEST.fehler = FV_TEST.fehler || []).push(String(e.message)); });
  app.start = function () {
    B.beiOrt(melden);
    if (S.angemeldet()) app.los(); else app.zeige('anmeldung');
    setInterval(function () { if (S.angemeldet() && app.stapel.length === 1 && app.z.reiter === 'auftraege' && !document.hidden) app.ladeAuftraege(); }, 180000);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', app.start); else app.start();
})();
