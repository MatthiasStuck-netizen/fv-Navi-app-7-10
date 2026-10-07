#!/bin/sh
# Alle Tests: Kartenleser (mit erzeugter Testdatei), Kartenstil, Oberfläche (mit Attrappen)
set -e
cd "$(dirname "$0")"
python3 gen.py
node test.mjs ../www/js/offline.js
node stil.mjs ../www/js/offline.js
node ui.mjs ../www/js | tail -6
node karte.mjs ../www/js
for f in ../www/js/*.js; do node --check "$f"; done && echo "Syntax aller JS-Dateien ok"
