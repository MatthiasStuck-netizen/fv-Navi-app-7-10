# Fehnverleih Navi – Offline-Karte im eigenen Fenster

Stand: Navi 3.4 + Offline-Karte. Die App ist eine WebView-App (Oberfläche in `www/`, Android-Teil kompiliert in der Basis-APK).

## Ordner
| Ordner | Inhalt |
|---|---|
| `www/` | Oberfläche (HTML/JS/CSS) – **hier wird weitergearbeitet**. `js/offline.js` ist neu (Offline-Karte), geändert: `karte.js`, `seiten.js`, `index.html`, `app.css` |
| `basis/` | Original-APK Navi 3.4 (liefert `classes.dex`, Manifest, Ressourcen, Android Auto) |
| `werkzeuge/` | `bauen.py` (neu packen, ausrichten, signieren v1+v2), `pruefen.py` (Kontrolle) |
| `tests/` | `laufen.sh` – Kartenleser, Kartenstil, Oberfläche (mit Attrappen) |
| `fertig/` | zuletzt gebaute APK |
| `doku/` | Anleitung für Kartendatei, Server und Installation |

## Bauen
    pip install cryptography          # + Java (jarsigner), Python 3, Node 22
    sh tests/laufen.sh
    python3 werkzeuge/bauen.py basis/Navi.3_4-original.apk www schluessel/fv-navi-schluessel.p12 <PASSWORT> build/Navi.apk
    python3 werkzeuge/pruefen.py build/Navi.apk basis/Navi.3_4-original.apk www

Automatisch: GitHub Actions „Navi bauen“ (bei jedem Push). Für Updates, die über die installierte App
passen, unter *Settings → Secrets → Actions* eintragen:
`FV_NAVI_KEYSTORE_BASE64` (Inhalt von `fv-navi-schluessel.p12` als Base64) und `FV_NAVI_KEYSTORE_PASSWORT`.
**Den Schlüssel selbst nie ins Repository legen** (steht in `.gitignore`).

## Reiter „Karte“ (Aufträge) und Offline
Der Reiter „Karte“ ist `Se.uebersicht` in `www/js/seiten.js` und nutzt dieselbe Karte (`karte.js`) wie die Fahrtführung.
Ohne Internet (oder mit Einstellung „Immer“) zeichnet `karte.js` über `offline.js` aus der geladenen Kartendatei – gleicher Stil,
gleiche Auftrags-Punkte, Kennzeichen „Offline-Karte“ unten links. Auftrags-Adressen werden ohne Internet nur gefunden, wenn sie
schon einmal online gesucht wurden (Merker in `geo.js`).

## Offline-Kartendatei per GitHub erzeugen („Start“-Knopf)
Der Auftrag `.github/workflows/karte-bauen.yml` erzeugt die Datei `deutschland.pmtiles` mit Planetiler aus den freien
OpenStreetMap-Daten (OpenMapTiles-Schema, wie die App es erwartet).

1. Projekt in ein eigenes GitHub-Repository legen (am besten **öffentlich**: bei privaten Repositories ist der kostenlose
   Speicher für Artifacts mit 500 MB zu klein für die Karte). Der Schlüssel `.p12` gehört nie hinein.
2. Im Repository: **Actions** → **Deutschland-Karte bauen** → **Run workflow**. Gebiet `germany` (oder zum Testen z. B. `bremen`),
   Zoom `14` (kleinere Datei: `12`). Der Lauf dauert für Deutschland voraussichtlich mehrere Stunden.
3. Am Ende beim Lauf unter **Artifacts** „Deutschland-Karte“ herunterladen und entpacken. Es sind mehrere Teile
   (`teil-00`, `teil-01`, …, je ca. 1,9 GB) und `pruefsumme.txt`.
4. Teile wieder zusammenfügen:
   - Windows (Eingabeaufforderung im Ordner): `copy /b teil-* deutschland.pmtiles`
   - Linux/Mac: `cat teil-* > deutschland.pmtiles`
   Kontrolle: `sha256sum deutschland.pmtiles` (Windows: `certutil -hashfile deutschland.pmtiles SHA256`) muss zu `pruefsumme.txt` passen.
5. Datei per FTP nach `www.fehnverleih.de/karten/deutschland.pmtiles` hochladen, `.htaccess` wie in `doku/LIESMICH-Offline-Karte.txt`.
6. In der Navi-App: Einstellungen → Offline-Karte → „Karte laden“.

Nicht getestet (GitHub-Lauf konnte von hier aus nicht gestartet werden): Laufzeit, Speicherbedarf (Planetiler bekommt 10 GB Heap, Platz wird freigeräumt),
Gebietsnamen. Schlägt der Lauf fehl, zuerst `bremen` probieren und die Fehlermeldung ansehen. Der Auftrag prüft die fertige Datei selbst (Format und Ebenen).

## Grenzen
* Android-Teil (Kotlin: Start, Standort, Sprache, Android Auto) liegt nur kompiliert vor. Änderungen dort brauchen den
  Quelltext oder ein Neuaufsetzen als Android-Projekt.
* Offline gibt es Karte, Position, Ziel, Luftlinie, Richtung – **keine** Straßenroute (Valhalla ist online).
* Offline-Karte: PMTiles im OpenMapTiles-Schema, geladen in den App-Speicher (OPFS), siehe `doku/`.
* Nicht auf einem echten Handy getestet.

## Mögliche nächste Schritte
Offline-Routing (z. B. GraphHopper/Valhalla als Android-Bibliothek, braucht den Android-Teil als Projekt),
Schriften für Ortsnamen offline, Karten-Download über die App-Oberfläche mit Bundesland-Auswahl.
