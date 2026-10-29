---
name: zeiterfassung
description: Gleicht die Claude-Code-Sitzungen dieses Projekts mit der Zeiterfassung (Ausgleichsstunden) ab und traegt die Arbeitszeiten ein. Nutzen, wenn der Nutzer Zeiten erfassen, eintragen oder abgleichen will, z. B. "trag meine Zeiten ein" oder "Zeiterfassung abgleichen".
---

# Zeiterfassung abgleichen

Das Werkzeug liegt in diesem Repository unter `tools/claude-zeit.js`. Der
Aufgabenbereich steht in `.zeiterfassung.json` im Projektordner.

Voraussetzung: die Umgebungsvariablen `ZEITERFASSUNG_URL` und
`ZEITERFASSUNG_TOKEN` sind gesetzt. Fehlen sie, dem Nutzer sagen, dass er das
Token unter "API-Zugang" in der Zeiterfassung erstellt und in der Umgebung
hinterlegt - und nichts weiter versuchen.

## Vorgehen

1. Zuerst einen Trockenlauf machen und das Ergebnis dem Nutzer zeigen:

   ```
   NODE_USE_ENV_PROXY=1 node tools/claude-zeit.js abgleich --trocken
   ```

2. Erst nach ausdruecklicher Zustimmung des Nutzers wirklich eintragen:

   ```
   NODE_USE_ENV_PROXY=1 node tools/claude-zeit.js abgleich
   ```

3. Das Ergebnis ("angelegt / aktualisiert / unveraendert / Fehler") kurz
   zusammenfassen. Der Abgleich ist wiederholbar: bereits eingetragene
   Zeiten werden nicht doppelt angelegt, sondern bei Bedarf aktualisiert.

Hinweise:

- `NODE_USE_ENV_PROXY=1` sorgt dafuer, dass Node in der Cloud-Umgebung den
  vorgegebenen Proxy nutzt. Meldet das Werkzeug "nicht erreichbar", ist die
  Adresse der Zeiterfassung vermutlich in den Netzwerkregeln der Umgebung nicht
  freigegeben - das dem Nutzer sagen, nicht umgehen.

- Mit `--seit JJJJ-MM-TT` lassen sich aeltere Sitzungen nachtragen
  (Standard: die letzten 14 Tage).
- Uebertragen werden nur Beginn, Ende und eine kurze Beschreibung - nie der
  Inhalt der Chats.
- Die Eintraege erscheinen in der Zeiterfassung als Entwurf und werden dort
  wie alle anderen synchronisiert.
- Das Token niemals in Dateien, Commits oder Ausgaben schreiben.
