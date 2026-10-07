/* Verbindung zur Fehnverleih-Warenwirtschaft (warenwirtschaft.php, Adresse …/?lagerapp) */
(function () {
  'use strict';
  var B = FV.B;
  var S = FV.S = { url: 'https://www.fehnverleih.de/?lagerapp', an: B.anmeldung() || {} };
  S.demo = false;
  S.angemeldet = function () { return S.demo || !!(S.an && S.an.token); };
  S.admin = function () { return S.an && S.an.rolle === 'admin'; };
  /** Kennung des angemeldeten Nutzers (Rolle und Name). Daran hängt, wem ein Eintrag der Warteschlange gehört. */
  S.wer = function () { return S.an && S.an.token ? (S.an.rolle || '') + '|' + (S.an.name || '') : ''; };

  function senden(daten, zeit) {
    if (S.demo) return new Promise(function (ok) { setTimeout(function () { ok(FV.Demo.server(daten)); }, 120); });
    return B.http({ methode: 'POST', url: S.url, kopf: { 'Content-Type': 'application/json; charset=utf-8', 'Accept': 'application/json' }, daten: JSON.stringify(daten), zeit: zeit || 20000 })
      .then(function (r) {
        var j; try { j = JSON.parse(r.text); } catch (e) { throw new Error(r.status === 404 ? 'Server-Adresse nicht gefunden.' : 'Der Server antwortet nicht wie erwartet.'); }
        return j;
      });
  }
  /** Ruft eine Aktion auf. Wirft bei Fehlern; meldet Abmeldung und Stempel-Sperre an die App. */
  S.ruf = function (aktion, daten, zeit) {
    var d = Object.assign({ aktion: aktion, token: S.an.token || '' }, daten || {});
    return senden(d, zeit).then(function (r) {
      if (r.typ === 'abgemeldet') { var wer = S.wer(); S.abmeldenLokal(); if (FV.app) FV.app.abgemeldet('Deine Anmeldung ist abgelaufen. Bitte neu anmelden.', wer); var e1 = new Error('Abgemeldet'); e1.stop = true; throw e1; }
      if (r.typ === 'gesperrt') { if (FV.app) FV.app.gesperrt(r.msg || ''); var e2 = new Error(r.msg || 'Gesperrt'); e2.stop = true; throw e2; }
      if (r.typ !== 'ok') { var e3 = new Error(r.msg || 'Serverfehler'); e3.antwort = r; e3.unbekannt = /Unbekannte Aktion/i.test(r.msg || ''); throw e3; }
      if (!S.demo && r.name && r.name !== S.an.name) {
        var alt = S.wer(); S.an.name = r.name; B.anmeldungSetzen(S.an);
        var neu = S.wer(), n = 0; if (alt) schlange.forEach(function (x) { if (x.wer === alt) { x.wer = neu; n++; } }); if (n) merken();   // eigene Einträge behalten ihren Besitzer
      }
      return r;
    });
  };
  S.anmelden = function (admin, passwort, ausweis) {
    var geraet = 'Fehnverleih Navi · ' + (B.info().geraet || 'Android');
    var d = admin ? { aktion: 'login_admin', passwort: passwort, geraet: geraet } : { aktion: 'login_ma', code: ausweis, passwort: passwort, geraet: geraet };
    return senden(d).then(function (r) {
      if (r.typ !== 'ok' || !r.token) throw new Error(r.msg || 'Anmeldung fehlgeschlagen.');
      S.an = { token: r.token, rolle: r.rolle || (admin ? 'admin' : 'lager'), name: r.name || '' };
      B.anmeldungSetzen(S.an);
      return S.an;
    });
  };
  S.abmeldenLokal = function () { if (S.demo) { S.demo = false; S.an = B.anmeldung() || {}; return; } S.an = {}; B.anmeldungSetzen({}); };
  S.abmelden = function () { var p = S.angemeldet() ? S.ruf('abmelden').catch(function () {}) : Promise.resolve(); return p.then(S.abmeldenLokal); };

  /* ---------- Warteschlange: Fahrten und Tankbelege gehen nicht verloren, wenn kein Netz da ist ----------
   * Jeder Eintrag gehört dem Nutzer, der ihn angelegt hat (wer). Gesendet wird er nur, solange genau dieser Nutzer
   * angemeldet ist – nie unter dem Namen des nächsten, der sich am selben Handy anmeldet. */
  var ALT = 30 * 86400000;   // nach 30 Tagen verfallen liegengebliebene Einträge
  var schlange = (B.lesen('schlange', []) || []).filter(function (x) { return x && x.a && (!x.t || Date.now() - x.t < ALT); }), sendet = null;
  function merken() { if (schlange.length > 60) schlange = schlange.slice(-60); B.schreiben('schlange', schlange); }
  function weg(x) { var i = schlange.indexOf(x); if (i >= 0) schlange.splice(i, 1); merken(); }
  /* Einträge ohne Besitzer stammen aus Version 3.0 und gehen an den, der gerade angemeldet ist (wie bisher). */
  function meins(x) { var ich = S.wer(); return !!ich && (!x.wer || x.wer === ich); }
  /** Legt einen Eintrag in die Warteschlange. wer: Besitzer, falls nicht der gerade angemeldete Nutzer (beim Abmelden). */
  S.spaeter = function (aktion, daten, wer) {
    if (S.demo) { FV.Demo.server(Object.assign({ aktion: aktion }, daten)); return; }
    schlange.push({ a: aktion, d: daten, t: Date.now(), wer: wer || S.wer() }); merken(); S.nachsenden();
  };
  /** Eigene Einträge, die noch auf Übertragung warten */
  S.wartend = function () { return schlange.filter(meins).length; };
  /** Sendet die eigenen Einträge der Reihe nach. Das Ergebnis ist fertig, wenn nichts mehr geht (leer oder kein Netz). */
  S.nachsenden = function () {
    if (sendet) return sendet;
    if (S.demo || !S.angemeldet()) return Promise.resolve();
    var x = schlange.filter(meins)[0];
    if (!x) return Promise.resolve();
    if (!x.wer) { x.wer = S.wer(); merken(); }
    sendet = S.ruf(x.a, x.d, 45000).then(function () { weg(x); return true; }, function (e) {
      // Der Server kennt die Aktion noch nicht (alte warenwirtschaft.php), kein Netz oder abgemeldet: Eintrag behalten, später erneut versuchen
      if (e.unbekannt || e.stop || !e.antwort) return false;
      weg(x); return true;   // endgültig abgelehnt (z. B. ungültige Daten) – nicht ewig wiederholen
    }).then(function (weiter) { sendet = null; return weiter ? S.nachsenden() : undefined; });
    return sendet;
  };
})();
