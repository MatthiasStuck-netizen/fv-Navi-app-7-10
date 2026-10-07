/* Demo-Modus: Beispieldaten ohne Server, damit man die App ansehen und eine Probefahrt machen kann.
 * Es wird nichts gespeichert und nichts an die Verwaltung gesendet. */
(function () {
  'use strict';
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function A(id, nr, kunde, adresse, an, ab, status, tel, notiz, tage) {
    var d = iso(new Date(Date.now() + (tage || 0) * 86400000));
    return { id: id, nr: nr, datum: d, bis: d, datum_text: '', ankunft_geplant: an, abfahrt_geplant: ab, kunde: kunde, telefon: tel, adresse: adresse, typ: 'Lieferung', status: status,
      status_text: status === 'ausgegeben' ? 'Ausgegeben' : 'Bestätigt', notiz: notiz || '', ist_ankunft: '', ist_abfahrt: '', abfahrt_ziel: '' };
  }
  var neuNr = 45, fahrten = [
    { id: 'x1', fahrer: 'Jan Beispiel', fahrzeug: 'Dacia Spring', ziel: 'Familie Meyer, Hauptstraße 12', start: 'gestern 07:42', ende: 'gestern 08:06', km_text: '19,4 km', getankt: false },
    { id: 'x2', fahrer: 'Jan Beispiel', fahrzeug: 'Dacia Spring', ziel: 'Lagerhalle', start: 'gestern 10:15', ende: 'gestern 10:41', km_text: '19,1 km', getankt: false }];
  FV.Demo = {
    server: function (d) {
      function ok(x) { return Object.assign({ typ: 'ok', frei: true, rolle: 'admin', name: 'Demo', seit: '' }, x || {}); }
      switch (d.aktion) {
        case 'status': case 'abmelden': case 'navi_position': case 'tank_beleg': return ok({ msg: 'Demo' });
        case 'navi_liste': return ok({ stand: 'Demo-Daten', auftraege: [
          A('a1', 'A-0041', 'Familie Meyer', 'Hauptstraße 12, 26842 Ostrhauderfehn', '08:00', '10:00', 'bestaetigt', '04952 123456', 'Zelt 6×12 m, Einfahrt hinter dem Haus.'),
          A('a4', 'A-0035', 'Schule Rhauderfehn', 'Schulstraße 3, 26817 Rhauderfehn', '09:00', '11:00', 'ausgegeben', '04952 99887'),
          A('a2', 'A-0042', 'Firma Schmidt', 'Industriestraße 5, 26842 Ostrhauderfehn', '12:30', '16:00', 'bestaetigt', '04952 222333'),
          A('a5', 'A-0043', 'Herr Müller', 'Mühlenstraße 18, 26849 Filsum', '14:00', '15:30', 'bestaetigt', '0160 4443322'),
          A('a3', 'A-0039', 'Hochzeit Familie Janssen', 'Am Deich 6, 26842 Ostrhauderfehn', '17:00', '23:00', 'bestaetigt', '0171 5550101'),
          A('a6', 'A-0044', 'Musikverein', 'Hauptstraße 80, 26842 Ostrhauderfehn', '10:00', '', 'bestaetigt', '', '', 1)],
          ziele: { lagerhalle: { name: 'Lagerhalle', adresse: 'Schulze-Flimmenstraße 20, 26689 Apen-Augustfehn' }, verwaltung: { name: 'Verwaltung', adresse: 'Am Deich 6, Ostrhauderfehn' } } });
        case 'navi_zeit': return ok({ zeit: '', neu: true, ziel: '' });
        case 'navi_anwesend': return ok({ anwesend: [{ name: 'Jan Beispiel', seit: '07:30', dauer: '2:15', mid: 'aa', gast: false, adresse: 'Fehnweg 4, 26842 Ostrhauderfehn', tel: '0170 1112233' },
          { name: 'Silke Muster', seit: '08:05', dauer: '1:40', mid: 'bb', gast: false, adresse: 'Kanalstraße 9, 26689 Apen', tel: '0151 9998877' }, { name: 'Tom Aushilfe', seit: '09:00', dauer: '0:45', mid: 'cc', gast: true, adresse: '', tel: '' }] });
        case 'artikel': return ok({ artikel: [{ id: 'z1', name: 'Zelt 6×12 m', kat: 'Zelte', imhaus: 3 }, { id: 'b1', name: 'Bierzeltgarnitur', kat: 'Möbel', imhaus: 44 }, { id: 's1', name: 'Stehtisch mit Husse', kat: 'Möbel', imhaus: 22 }, { id: 'l1', name: 'Lautsprecher-Set', kat: 'Technik', imhaus: 2 }] });
        case 'auftrag_neu_app': return ok({ nr: 'A-00' + (neuNr++), id: 'neu', sonder: !!d.sonderwunsch });
        case 'fahrzeuge': return ok({ fahrzeuge: [{ id: 'f1', name: 'Dacia Spring', kennzeichen: 'LER-FV 24' }, { id: 'f2', name: 'Transporter', kennzeichen: 'LER-FV 7' }] });
        case 'fahrtenbuch_liste': return ok({ fahrten: fahrten });
        case 'fahrt_speichern':
          fahrten.unshift({ id: 'n' + fahrten.length, fahrer: 'Demo', fahrzeug: d.fahrzeug_name || 'Dacia Spring', ziel: d.ziel, start: 'heute', ende: 'heute', km_text: String(d.km).replace('.', ',') + ' km', getankt: false });
          return ok({ msg: 'Demo' });
        default: return { typ: 'err', msg: 'Unbekannte Aktion.' };
      }
    }
  };
})();
