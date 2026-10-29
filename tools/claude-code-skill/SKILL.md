---
name: zeiterfassung
description: Gleicht die Claude-Code-Sitzungen dieses Projekts mit der Zeiterfassung (Ausgleichsstunden) ab und traegt die Arbeitszeiten ein. Nutzen, wenn der Nutzer Zeiten erfassen, eintragen oder abgleichen will, z. B. "trag meine Zeiten ein" oder "Zeiterfassung abgleichen".
disable-model-invocation: true
---

# Zeiterfassung abgleichen

Das Werkzeug liegt im Repository der Zeiterfassung unter `tools/claude-zeit.js`.
Ersetze `<PFAD>` unten durch den Ordner, in dem dieses Repository liegt
(einmalig anpassen, nachdem du diese Datei nach `~/.claude/skills/zeiterfassung/SKILL.md`
kopiert hast).

Voraussetzung: die Umgebungsvariablen `ZEITERFASSUNG_URL` und
`ZEITERFASSUNG_TOKEN` sind gesetzt, und im Projektordner liegt eine
`.zeiterfassung.json` mit dem Aufgabenbereich, z. B.
`{ "aufgabenbereich": "Medienkonzept" }`.

## Vorgehen

1. Zuerst einen Trockenlauf machen und das Ergebnis dem Nutzer zeigen:

   ```
   node <PFAD>/tools/claude-zeit.js abgleich --trocken
   ```

2. Nur wenn der Nutzer einverstanden ist, wirklich eintragen:

   ```
   node <PFAD>/tools/claude-zeit.js abgleich
   ```

3. Das Ergebnis ("angelegt / aktualisiert / unveraendert / Fehler") kurz
   zusammenfassen. Der Abgleich ist wiederholbar: bereits eingetragene
   Zeiten werden nicht doppelt angelegt, sondern bei Bedarf aktualisiert.

Hinweise:

- Mit `--seit JJJJ-MM-TT` lassen sich aeltere Sitzungen nachtragen
  (Standard: die letzten 14 Tage), mit `--alle` alle Projekte, die eine
  `.zeiterfassung.json` haben.
- Uebertragen werden nur Beginn, Ende und eine kurze Beschreibung - nie der
  Inhalt der Chats.
- Die Eintraege erscheinen in der Zeiterfassung als Entwurf und werden dort
  wie alle anderen synchronisiert.
