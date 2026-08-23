# Zeiterfassung – Ausgleichsstunden

Ein einfaches Zeiterfassungssystem, mit dem Ausgleichsstunden in der Berufsschule
erfasst und an die Schulleitung übermittelt werden können.

## Funktionen

- **LDAP-Login** – Anmeldung mit dem bestehenden Schulaccount.
- **Kategorien (Überschriften)** – Admin weist jeder Lehrkraft eine oder mehrere
  Ausgleichsstunden-Kategorien zu (z. B. "1 Ausgleichsstunde Administration Moodle")
  mit Anzahl Ausgleichsstunden und einem Faktor.
- **Umrechnung** – benötigte Zeitstunden = Ausgleichsstunden × Faktor. Fortschritt
  wird pro Kategorie als Balken angezeigt.
- **Start/Stopp-Timer** – Tätigkeit kurz beschreiben, Start drücken, später Stopp
  drücken; die Zeit wird automatisch erfasst.
- **Nachtragen** – vergessene Zeiten können mit Datum/Von/Bis nachgetragen werden
  und werden korrekt chronologisch einsortiert.
- **Synchronisierung** – Lehrkräfte übermitteln ihre erfassten Zeiten per Button
  an die Admin-Ansicht; optional per Checkbox automatisch nach jedem Stopp/Eintrag.
- **Admin-Bereich** – Lehrkräfte werden per Live-Suche aus dem LDAP gesucht und
  bekommen Kategorien zugewiesen; Übersicht zeigt synchronisierte und noch offene
  (ungemeldete) Stunden je Kategorie.

## Technik

- Node.js ≥ 22, Express, EJS (serverseitiges Rendering, kein Build-Schritt nötig)
- SQLite (`better-sqlite3`) als Datenhaltung – keine externe Datenbank auf dem
  Server nötig, läuft als Datei im `data/`-Verzeichnis
- Sessions werden dateibasiert gespeichert (`session-file-store`), bleiben also
  auch nach einem Neustart der App erhalten
- LDAP-Anbindung über `ldapts` (Bind als Service-Account zur Benutzersuche,
  anschließend Bind mit den eingegebenen Zugangsdaten zur Passwortprüfung)

## Konfiguration

Alle Einstellungen erfolgen über Umgebungsvariablen, siehe `.env.example`.
Auf dem Server eine `.env`-Datei anlegen (wird nicht ins Git-Repository
übernommen) oder die Variablen über die Plesk-Oberfläche ("Node.js" →
"Custom Environment Variables") setzen.

Wichtige Variablen:

| Variable | Bedeutung |
|---|---|
| `LDAP_URL` | z. B. `ldaps://ldap.schule.de:636` |
| `LDAP_BIND_DN` / `LDAP_BIND_PASSWORD` | Service-Account mit Lesezugriff für die Benutzersuche |
| `LDAP_BASE_DN` | Suchbasis für Lehrkräfte |
| `LDAP_USER_FILTER` | Filter mit Platzhalter `{{username}}`, z. B. `(uid={{username}})`; bei Active Directory z. B. `(sAMAccountName={{username}})` |
| `LDAP_USERNAME_ATTR`, `LDAP_DISPLAY_NAME_ATTR`, `LDAP_EMAIL_ATTR` | LDAP-Attributnamen |
| `ADMIN_USERNAMES` | Komma-getrennte Liste von LDAP-Benutzernamen mit Admin-Rechten in der App |
| `SESSION_SECRET` | zufälliger, geheimer String für die Session-Verschlüsselung |
| `DB_PATH` | Pfad zur SQLite-Datei (Standard: `./data/zeiterfassung.db`) |

## Deployment auf Plesk (Node.js 22)

1. Repository in Plesk unter "Node.js" als Git-Quelle einrichten bzw. `git pull`
   im Zielverzeichnis ausführen.
2. Node.js-Version 22 auswählen.
3. "Application Startup File" auf `app.js` setzen.
4. `.env`-Datei im Projektverzeichnis anlegen (siehe `.env.example`) oder die
   Variablen als "Custom Environment Variables" in Plesk hinterlegen.
5. "NPM Install" in Plesk ausführen (bzw. `npm install --omit=dev` per SSH).
   `better-sqlite3` wird dabei kompiliert – auf dem Server müssen ggf. Build-Tools
   (`build-essential`, `python3`) vorhanden sein, falls kein passendes
   Prebuilt-Binary geladen werden kann.
6. App über Plesk neu starten.
7. Das Verzeichnis `data/` muss für den Node-Prozess beschreibbar sein (SQLite-
   Datenbank + Sessions); es ist in `.gitignore` ausgeschlossen, damit spätere
   `git pull`-Vorgänge die Daten nicht überschreiben.

Bei jedem weiteren Deployment reicht `git pull` im Projektverzeichnis plus
"NPM Install" (falls sich `package.json` geändert hat) und ein Neustart der App
über Plesk.
