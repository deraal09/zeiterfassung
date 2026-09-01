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
| `LDAP_USERNAME_ATTR`, `LDAP_DISPLAY_NAME_ATTR`, `LDAP_EMAIL_ATTR` | LDAP-Attributnamen (bei Active Directory: `sAMAccountName`, `displayName`) |
| `LDAP_TLS_CA_PFAD` | Nur bei `ldaps://` mit interner/selbstsignierter CA: Pfad zur PEM-Datei |
| `LDAP_TLS_REJECT_UNAUTHORIZED=false` | Zertifikatsprüfung abschalten (nur Notlösung, siehe Troubleshooting) |
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

Alternativ zum manuellen Neustart-Klick erkennt Passenger auch die Datei
`tmp/restart.txt` (Verzeichnis `tmp/` bei Bedarf selbst anlegen, ist
gitignored): sobald diese Datei neu erstellt/berührt wird, startet Passenger
die App beim nächsten Request automatisch neu. Praktisch für ein Deploy-Skript:

```bash
npm install && npm rebuild better-sqlite3 && mkdir -p tmp && touch tmp/restart.txt
```

`npm rebuild better-sqlite3` fängt automatisch ab, falls sich die in Plesk
eingestellte Node.js-Version zwischenzeitlich geändert hat (siehe Troubleshooting).

## Troubleshooting

Auf einem Plesk-Server mit mehreren Node.js-Apps im selben Vhost-Baum sind uns
folgende Fehlerbilder begegnet:

**Passenger-Fehlerseite ("We're sorry, but something went wrong")**
Sagt für sich allein nichts – im Node.js-Panel unter "Log" bzw. per SSH in
`~/logs/` (Pfad ist je nach Plesk-Setup unterschiedlich) nach dem eigentlichen
Absturzgrund suchen, bevor man etwas ändert.

**`Error: The module '.../better_sqlite3.node' was compiled against a
different Node.js version` (`NODE_MODULE_VERSION` X vs. Y)**
`better-sqlite3` enthält ein natives Modul, das beim `npm install` gegen die
gerade aktive Node.js-Version kompiliert wird. Wurde `npm install` unter einer
anderen Node-Version ausgeführt als der in Plesk für die Domain eingestellten
(z. B. weil die SSH-Shell einen anderen `node`/`npm` im `PATH` hat als
Passenger), passt das kompilierte Modul nicht mehr. Fix:
```bash
# Plesk-verwalteten Node-Interpreter-Pfad ermitteln:
ls /opt/plesk/node/
# damit explizit neu installieren (Pfad anpassen):
rm -rf node_modules
/opt/plesk/node/22/bin/npm install --omit=dev
/opt/plesk/node/22/bin/node -e "console.log(process.version, process.versions.modules)"
```
Die letzte Zeile muss die gleiche `NODE_MODULE_VERSION` zeigen, die die
Fehlermeldung als "requires" nennt.

**Vorsicht bei `export PATH=...`:** `export PATH=/opt/plesk/node/22/bin:PATH`
(ohne `$` vor dem zweiten `PATH`) überschreibt den PATH komplett statt ihn zu
erweitern – alle folgenden Befehle in dieser Shell finden dann u. U. gar
keine Programme mehr bzw. den falschen `node`. Immer `$PATH` (mit Dollarzeichen).

**Mehrere Apps im selben Vhost-Baum teilen sich einen Systembenutzer:**
Falls (wie hier) mehrere Domains demselben Plesk-Systembenutzer gehören:
node_modules-Ordner müssen diesem Benutzer gehören, nicht `root` – sonst
scheitert der nächste `npm install` (auch über den Plesk-UI-Button) mit
`EACCES`, weil er vorhandene, root-eigene Dateien nicht überschreiben kann.
Nach einer manuellen Installation als `root` sicherheitshalber:
```bash
chown -R <domain-systembenutzer>:<gruppe> node_modules
```

**LDAP-Login zeigt "Anmeldung derzeit nicht möglich" (nicht "Passwort
falsch")** → das ist ein technischer Verbindungsfehler, kein falsches
Passwort. Häufigste Ursache bei einem internen Active-Directory-Server mit
`ldaps://`: ein selbstsigniertes/internes TLS-Zertifikat, dem Node.js nicht
vertraut. Fix: `LDAP_TLS_CA_PFAD` auf die PEM-Datei der internen CA setzen,
oder als Notlösung `LDAP_TLS_REJECT_UNAUTHORIZED=false` (siehe
`.env.example`). Den genauen Fehler zeigt der App-Log (`console.error`
in `src/routes/auth.js`).
