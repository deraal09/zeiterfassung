# Zeiterfassung – Ausgleichsstunden

Ein einfaches Zeiterfassungssystem, mit dem Ausgleichsstunden in der Berufsschule
erfasst und an die Schulleitung übermittelt werden können.

## Funktionen

- **LDAP-Login** – Anmeldung mit dem bestehenden Schulaccount (oder lokal per
  `/setup` angelegter Admin, siehe unten).
- **Ratelimit gegen Brute-Force-Logins** – ab dem 3. Fehlversuch in Folge für
  einen Benutzernamen wird die Anmeldung für 30 Sekunden gesperrt (auch mit
  danach korrektem Passwort); jeder weitere Fehlversuch nach Ablauf der
  vorherigen Sperre verdoppelt deren Dauer. Eine erfolgreiche Anmeldung setzt
  den Zähler zurück, technische Fehler (z. B. LDAP nicht erreichbar) zählen
  nicht als Fehlversuch. Siehe `src/auth/login-ratelimit.js`.
- **Schuljahr-Bezug** – alle Aufgabenbereiche und Zuweisungen gehören zu einem
  Schuljahr (Format `YYYY/YY`, Wechsel jeweils zum 1. August). Mit dem neuen
  Schuljahr fangen alle wieder bei 0 an.
- **Admin vergibt Ausgleichsstunden** – die Schulleitung weist einer Lehrkraft
  eine Anzahl Ausgleichsstunden zu (kein Titel nötig, korrigierbar). Die
  Lehrkraft wird darüber im Dashboard informiert. Optional kann der Admin
  direkt einen Aufgabenbereich der Lehrkraft zur Verknüpfung vorschlagen.
- **Verknüpfung per Vorschlag und Bestätigung** – eine Zuweisung mit einem
  Aufgabenbereich zu verknüpfen ist immer ein zweiseitiger Vorgang: schlägt
  der Admin einen Aufgabenbereich vor, muss die Lehrkraft ihn annehmen oder
  ablehnen (und stattdessen einen anderen vorschlagen); schlägt die
  Lehrkraft einen Aufgabenbereich vor, muss der Admin bestätigen. Solange
  für den (bestätigten) Aufgabenbereich noch keine Zeiten erfasst wurden,
  lässt sich die Verknüpfung noch per neuem Vorschlag ändern oder aufheben –
  sobald Zeiten erfasst sind, ist eine Änderung per Vorschlag gesperrt, damit
  niemandem bereits geleistete Arbeit nachträglich entzogen wird. Ohne jede
  Verknüpfung wird ein Aufgabenbereich einfach eigenständig für die
  Zeiterfassung genutzt (mit dem eigenen Ziel, siehe unten).
- **Verknüpfung lösen (Fehler korrigieren)** – die Lehrkraft kann eine
  bestätigte Verknüpfung jederzeit selbst lösen („Verknüpfung lösen“ an der
  Zuweisung im Dashboard), auch wenn dafür schon Zeiten erfasst sind. Die
  erfassten Zeiten bleiben dabei unverändert im Aufgabenbereich; die
  Ausgleichsstunden sind danach wieder „offen“ (der Admin sieht den Vermerk
  „von der Lehrkraft gelöst“) und lassen sich neu verknüpfen – wieder per
  Vorschlag und Bestätigung. Ein eigener offener Vorschlag der Lehrkraft wird
  dabei verworfen, ein Vorschlag der Schulleitung bleibt zur Entscheidung stehen.
- **Fälschlich zugewiesene Ausgleichsstunden löschen** – der Admin kann eine
  Zuweisung wieder vollständig entfernen, solange sie nicht mit einem
  Aufgabenbereich verknüpft ist, für den Zeiten erfasst wurden. Ist das der
  Fall, löst die Lehrkraft zuerst die Verknüpfung (die Zeiten bleiben
  erhalten); danach lässt sich die Zuweisung löschen.
- **Faktor gilt zentral pro Schuljahr** – einmal vom Admin festgelegt, für
  alle Lehrkräfte gleich, berechnet aus Zeitstunden pro Woche × Schulwochen
  (z. B. 1,7 × 40 = 68 Zeitstunden je Ausgleichsstunde und Schuljahr).
  Ändert sich einer der beiden Werte, wirkt sich das sofort auf alle
  Zuweisungen dieses Schuljahres aus.
- **Aufgabenbereiche legt die Lehrkraft selbst an** – eigener freier Titel
  (z. B. "Administration Moodle"), optional mit einem eigenen vorläufigen
  Zeitstunden-Ziel (analog zur Admin-Eingabe). Eine neu zugewiesene
  Ausgleichsstunden-Menge kann entweder mit einem bestehenden Aufgabenbereich
  **verknüpft** (Vorschlag, siehe oben) oder direkt als neuer Aufgabenbereich
  **übernommen** werden (schlägt der neue Aufgabenbereich sofort zur
  Verknüpfung vor). Sobald eine Zuweisung bestätigt verknüpft ist, ersetzt
  deren offizielle Berechnung das eigene Ziel (das dann nicht mehr änderbar
  ist, aber zur Erinnerung sichtbar bleibt).
- **Aufgabenbereiche sind privat, bis sie freigegeben werden** – der Admin
  sieht einen Aufgabenbereich erst, wenn die Lehrkraft eine Zuweisung damit
  (bestätigt) verknüpft (dann ist er automatisch "offiziell") oder ihn über
  einen Haken auf der Aufgabenbereichs-Seite explizit für den Admin sichtbar
  macht. Schlägt die Lehrkraft eine Verknüpfung vor, wird der
  Aufgabenbereichstitel für den Admin vorab sichtbar, damit er den Vorschlag
  beurteilen kann.
- **Umrechnung** – benötigte Zeitstunden eines Aufgabenbereichs = Summe aller
  damit verknüpften (Ausgleichsstunden × Schuljahr-Faktor). Fortschritt wird
  als Balken angezeigt.
- **Unterthemen gliedern einen Aufgabenbereich optional weiter** – z. B.
  "Kurs A", "Kurs B" innerhalb eines Aufgabenbereichs, anlegbar im Reiter
  "Unterthemen" auf der Aufgabenbereichs-Seite. Rein optional, kein
  Pflichtfeld: ein Aufgabenbereich ohne Unterthemen funktioniert
  unverändert flach. Sobald das erste Unterthema angelegt wird, werden
  alle bis dahin nicht zugeordneten Zeiten automatisch dem Unterthema
  "Allgemein" zugeordnet – ab dann hat jede Zeit dieses Aufgabenbereichs
  eins. Beim Start des Timers oder beim Nachtragen lässt sich das
  Unterthema gleich mit auswählen (sonst "Allgemein"), und über das
  Aktion-Menü einer Zeile jederzeit einem anderen zuordnen. In der Tabelle
  "Erfasste Tätigkeiten" sind alle Unterthemen zunächst **eingeklappt** und
  zeigen nur ihre Gesamtzeit (Summe aller zugeordneten Zeiten) in der
  Kopfzeile; zum Ansehen und Bearbeiten wird das jeweilige Unterthema
  aufgeklappt. Aufgeklappte bleiben im selben Browser-Tab offen, auch wenn
  sich die Seite nach einer Änderung neu lädt.
- **Start/Stopp-Timer** – Tätigkeit kurz beschreiben, Start drücken, später Stopp
  drücken; die Zeit wird automatisch erfasst. Auf der Aufgabenbereichs-Seite ist das
  die standardmäßig sichtbare Ansicht (Reiter "Erfassen"); "Zeit nachtragen"
  und "CSV-Import" sind eigene Reiter, die nur bei Bedarf geöffnet werden.
- **Nachtragen** – vergessene Zeiten werden mit Datum, Von- und Bis-Uhrzeit
  nachgetragen (Dauer wird daraus berechnet) und korrekt chronologisch
  einsortiert. Reicht eine Tätigkeit über Mitternacht hinaus, wird zusätzlich
  das Bis-Datum angegeben; normalerweise bleibt dieses Feld leer. Bereits
  erfasste Einträge lassen sich jederzeit korrigieren – jede Änderung an
  Datum, Uhrzeit oder Beschreibung speichert sofort beim Verlassen des
  Feldes, ganz ohne Speichern-Button – oder über das Aktion-Menü löschen. Ein
  bereits synchronisierter Eintrag gilt nach einer Korrektur wieder als
  Entwurf, damit dem Admin kein veralteter Wert stehen bleibt. Hängen
  Änderungen an mehreren Feldern eines Eintrags zusammen (z. B. Bis-Datum UND
  Bis-Uhrzeit müssen sich ändern, damit ein über Mitternacht laufender,
  vergessener Eintrag wieder auf denselben Tag zurückfällt), speichert das
  Formular erst, sobald keines dieser Felder mehr den Fokus hat – ein
  Zwischenstand nach nur einer der beiden Änderungen würde sonst an der
  eigenen Prüfung (Ende vor Beginn, oder länger als 24 Stunden) scheitern und
  die andere Änderung mit verwerfen.
- **CSV-Import und -Export** – mehrere nachzutragende Zeiten auf einmal per
  CSV-Datei hochladen (Spalten: Datum, Von, Bis, Beschreibung, optional
  Bis-Datum für Tätigkeiten über Mitternacht und Unterthema). Komma,
  Semikolon, Tabulator und Pipe werden automatisch als Trennzeichen erkannt;
  Datum als `YYYY-MM-DD` oder `DD.MM.YYYY`. Ungültige Zeilen werden
  übersprungen und gezählt, gültige trotzdem importiert. Hat ein Aufgabenbereich
  Unterthemen, lässt sich beim Import zusätzlich eines aus einer Liste
  auswählen, das für alle Zeilen ohne eigene Unterthema-Spalte gilt – eine
  Spalte in der Datei hat für ihre Zeile trotzdem Vorrang. Umgekehrt lassen
  sich die (aktuell gefilterten) Zeiten eines Aufgabenbereichs als CSV-Datei
  exportieren – mit Semikolon als Trennzeichen, Komma als Dezimaltrennzeichen
  und UTF-8-BOM, damit Excel die Datei direkt korrekt öffnet.
- **Schuljahr wechseln** – die Übersicht zeigt standardmäßig das laufende
  Schuljahr; über die Auswahl in der Überschrift lassen sich frühere
  Schuljahre samt ihrer Aufgabenbereiche und Zeiten wieder öffnen. Zuweisungen in
  anderen Schuljahren werden darüber verlinkt, damit besonders noch nicht
  verknüpfte nicht übersehen werden. Eine Zuweisung kann nur mit einem
  Aufgabenbereich aus ihrem eigenen Schuljahr verknüpft werden – der Faktor
  hängt am Schuljahr der Zuweisung, das Ziel wird über den Aufgabenbereich
  angezeigt.
- **Sortierung und Filter der erfassten Tätigkeiten** – die Tabelle lässt sich
  per Klick auf die Spalte "Beginn" nach ältestem oder neuestem Datum zuerst
  sortieren; zusätzlich kann nach einem Datumsbereich (von/bis) und/oder einem
  Suchbegriff in der Beschreibung gefiltert werden.
- **Grafische Auswertung** – auf dem Dashboard über den Reiter "Auswertung"
  erreichbar (daneben der Reiter "Neuen Aufgabenbereich" fürs Anlegen),
  darunter zwei Unterreiter mit je einem Säulendiagramm. "Zeiten je
  Aufgabenbereich" zeigt die Zeiten des gewählten Schuljahres je
  Aufgabenbereich, unterteilt in bereits synchronisierte und noch nicht
  synchronisierte (Entwurf) Stunden, farblich unterschieden mit Legende;
  Aufgabenbereiche ohne erfasste Zeit erscheinen nicht im Diagramm. "Zeiten
  im Schuljahresverlauf" zeigt dieselben Zeiten stattdessen über die zwölf
  Monate des Schuljahres (August bis Juli) verteilt, dort farblich nach
  Aufgabenbereich unterschieden (bis zu acht Aufgabenbereiche mit fester,
  Delta-E-validierter Farbzuordnung je Aufgabenbereich, weitere fallen unter
  "Andere"), damit erkennbar ist, zu welcher Zeit im Schuljahr wie viel
  gearbeitet wurde; Monate ohne erfasste Zeit bleiben als sichtbare Lücke
  erhalten. Beide Diagramme lassen sich zwischen gestapelter und gruppierter
  Darstellung per Reiter umschalten. Reines HTML/CSS ohne Diagramm-Bibliothek;
  die Balken-Geometrie berechnet `src/util/auswertung.js` (inklusive
  Mindesthöhe von 2px für sehr kleine, aber von Null verschiedene Werte,
  damit sie nicht optisch verschwinden). Hat noch kein Aufgabenbereich
  irgendeine Zeit, bleibt der Reiter "Auswertung" ganz ausgeblendet.
- **Synchronisierung** – Lehrkräfte übermitteln ihre erfassten Zeiten per Button
  an die Admin-Ansicht; optional per Checkbox automatisch nach jedem Stopp/Eintrag.
- **Admin-Bereich** – für einen Admin-Account ist das der Startpunkt nach der
  Anmeldung (nicht die eigene Zeiterfassung, die für die Schulleitung nur
  zweitrangig ist; sie bleibt über "Meine Zeiten" erreichbar). Die Startseite
  zeigt nur das Nötigste: den Gesamtpool mit einem Balken je Pool und ein paar
  Kacheln (Lehrkräfte, Bereiche, Übersicht & Druck, Dokumente, Faktor,
  nächstes Schuljahr). Eine Unternavigation oben (Start · Pools · Bereiche ·
  Lehrkräfte · Zuweisen · Übersicht · Dokumente · Faktor) führt von jeder
  Admin-Seite mit einem Klick zu jeder Ansicht und behält das gewählte
  Schuljahr bei. **Oben rechts steht auf jeder Seite der Gesamtpool** des
  gewählten Schuljahres (Stunden insgesamt, vergeben, frei).
- **Pools** – getrennte Töpfe an Ausgleichsstunden je Schuljahr (z. B.
  "Digitalisierung", "Schulentwicklung"). Der Gesamtpool ist die Summe aller
  Pools. **Jede vergebene Ausgleichsstunde muss einem Pool zugeordnet sein**;
  bei der Auswahl zeigt die Seite sofort, wie viele Stunden dort schon
  vergeben und wie viele noch frei sind, und **es lässt sich nie mehr
  vergeben, als der Pool enthält** – das gilt beim Zuweisen, beim Ändern der
  Stunden und beim Wechsel in einen anderen Pool und wird auf dem Server
  erzwungen (nicht nur im Formular). Ein Pool lässt sich nicht unter das
  bereits Vergebene verkleinern und erst löschen, wenn nichts mehr aus ihm
  vergeben ist. Bisherige Gesamtkontingente und Zuweisungen werden beim Update
  automatisch in einen Pool "Allgemein" je Schuljahr überführt.
- **Bereiche** – gliedern die Personen, die Ausgleichsstunden erhalten (z. B.
  nach Abteilung). Jede Zuweisung kann einem Bereich zugeordnet werden (optional);
  eine Person kann dadurch in verschiedenen Bereichen vorkommen. Nicht zu
  verwechseln mit den *Aufgaben*bereichen, die die Lehrkräfte selbst für ihre
  Zeiterfassung anlegen.
- **Pools und Bereiche gelten je Schuljahr** und sind pro Jahr anpassbar. Für
  ein neues Jahr lassen sie sich aus einem anderen übernehmen ("Aus einem
  anderen Schuljahr übernehmen" auf der Pool-Seite oder die Kachel "Nächstes
  Schuljahr"): Pools mit ihren Stunden, Bereiche und auf Wunsch auch die
  Zuweisungen der Lehrkräfte (ohne Verknüpfung zu Aufgabenbereichen und nur,
  soweit sie in den Pool passen). Bereits Vorhandenes wird nie überschrieben,
  der Vorgang lässt sich wiederholen.
- **Druckansichten mit Unterschriftsfeldern** – für jeden Pool, jeden Bereich
  und eine Übersicht aller Pools gibt es eine eigene Druckseite (A4, immer
  hell, auch im Dunkelmodus). Unten stehen links ein Feld für die
  **Schulleitung** und rechts eines für den **ÖPR (Örtlicher Personalrat)**.
  "Drucken / PDF" öffnet den Druckdialog des Browsers; dort lässt sich
  drucken oder "Als PDF speichern" wählen (der Seitentitel dient als
  Dateiname). Bewusst ohne serverseitige PDF-Bibliothek: kein zusätzliches
  Paket, das auf dem Server erst installiert werden müsste.
- **Unterschriebene Dokumente** – der Scan oder das Foto (PDF, JPG, PNG, bis
  15 MB) wird zum jeweiligen Pool, Bereich oder zur Gesamtübersicht
  hochgeladen und gehört zum Schuljahr; die Seite "Dokumente" zeigt je
  Ausdruck, ob die Unterschrift schon vorliegt ("1 von 7"). Der Dateityp wird
  am Inhalt erkannt (nicht am Namen), die Dateien liegen unter Zufallsnamen in
  `data/uploads/` und sind nur für Admins abrufbar. Mehrere Uploads zum selben
  Ziel sind möglich (neuer Scan nach Korrektur), es zählt der letzte. Pools und
  Bereiche mit hinterlegtem Dokument lassen sich nicht löschen. **Das Verzeichnis
  `data/uploads/` gehört mit in die Datensicherung** (wie die Datenbank).
- **Übersicht der Ausgleichsstunden** – Reiter "Pools" (mit Druck und Upload der
  Gesamtübersicht), "Pro Bereich", "Pro Person" und "Pro Aufgabenbereich" für
  ein wählbares Schuljahr. Die Tabellen zeigen zusätzlich die sich aus dem
  Faktor des gewählten Schuljahres ergebenden Zeitstunden und enden mit
  einer Gesamt-Zeile; die Summen von "Pro Person" und "Pro Aufgabenbereich"
  stimmen für dasselbe Schuljahr immer überein.
- **Aufgabenbereiche archivieren oder löschen** – die Lehrkraft kann einen
  eigenen Aufgabenbereich jederzeit archivieren (verschwindet aus der
  eigenen Übersicht, bleibt inklusive aller Zeiten erhalten – der Admin kann
  ihn bei Bedarf reaktivieren) oder, solange weder Zeiten noch eine
  Ausgleichsstunden-Verknüpfung daran hängen, vollständig löschen.
- **Responsives Design (Smartphone)** – Navigation und Register-Buttons
  brechen auf schmalen Bildschirmen um, statt seitlich abgeschnitten zu
  werden. Jede Datentabelle der App (Erfasste Tätigkeiten, Unterthemen,
  Admin-Bereich) wird auf Smartphone-Breite (≤ 640px) zu gestapelten,
  beschrifteten Karten je Zeile – vorher lagen hintere Spalten (Aktion-Menü,
  Aufgabenbereichs-Verknüpfung, Archivieren/Löschen) innerhalb eines seitlich
  scrollenden Rahmens ohne jedes Scroll-Indiz außerhalb des sichtbaren
  Bereichs. Ab Tablet-Breite bleiben es normale Tabellen.
- **Verschlüsselung der Tätigkeitsbeschreibungen** – die Beschreibungstexte in
  `time_entries` werden serverseitig mit AES-256-GCM verschlüsselt gespeichert
  (Schlüssel `ENCRYPTION_KEY`, siehe Konfiguration unten). Der Schutz gilt für
  die gespeicherten Daten selbst (DB-Datei, Backups) – unabhängig davon, wo
  oder bei welchem Hoster die App läuft, und bleibt auch bei einem
  Server-/Hosterwechsel bestehen, solange der Schlüssel separat mitgenommen
  wird. Bestehende, noch unverschlüsselte Einträge werden beim ersten Start
  nach dem Update automatisch verschlüsselt (Migration in `src/db.js`).

## API

Neben der Weboberfläche gibt es eine REST-API unter `/api/v1`, die in **beide
Richtungen** arbeitet: Programme können eigene Aufgabenbereiche und Zeiten
**lesen** und Zeiten **eintragen, ändern, löschen** oder per Timer erfassen.
Gedacht ist sie vor allem für den Abgleich mit Claude-Code-Sitzungen (siehe
unten), taugt aber für jedes Skript.

### Zugang

Jede Lehrkraft erstellt sich ihre Zugänge selbst: im Dashboard auf
**API-Zugang**, Namen vergeben, **Erstellen**. Das Token (`zt_…`) wird nur
dieses eine Mal angezeigt – gespeichert wird lediglich ein Hash. Ein Zugang
gilt ausschließlich für die **eigenen** Aufgabenbereiche und Zeiten (nie für den
Admin-Bereich oder andere Personen) und lässt sich jederzeit widerrufen. Wie
ein Passwort behandeln und nur über HTTPS verwenden.

Jeder Aufruf trägt den Header `Authorization: Bearer <Token>`; die API nutzt
weder Cookies noch CSRF-Token. Anfragen und Antworten sind JSON.

### Endpunkte

| Methode und Pfad | Zweck |
| --- | --- |
| `GET /me` | Konto, laufendes Schuljahr, Serverzeit, ob ein Timer läuft |
| `GET /aufgabenbereiche?schuljahr=2026/27\|alle&archiviert=1` | eigene Aufgabenbereiche samt Unterthemen und erfassten Stunden (Standard: laufendes Schuljahr, ohne archivierte) |
| `POST /aufgabenbereiche` `{titel, schuljahr?}` | legt einen Aufgabenbereich an – oder liefert den gleichnamigen des Schuljahres zurück (`angelegt: false`) |
| `GET /eintraege?aufgabenbereich_id=&von=&bis=&quelle=&external_id=&limit=&offset=` | Zeiten lesen (`von`/`bis` als Datum, inklusive) |
| `GET /eintraege/:id` | ein Eintrag |
| `POST /eintraege` | abgeschlossenen Eintrag anlegen (siehe unten) |
| `POST /eintraege/abgleich` `{eintraege: [...]}` | bis zu 200 Einträge auf einmal, jeder mit `external_id` |
| `PATCH /eintraege/:id` | `beschreibung`, `beginn`, `ende`, `unterprojekt(_id)` ändern |
| `DELETE /eintraege/:id` | Eintrag löschen |
| `GET /timer`, `POST /timer/start`, `POST /timer/stop` | laufende Erfassung (wie der Start/Stopp-Button) |

Ein Eintrag besteht aus `aufgabenbereich_id`, `beginn`, `ende` und optional
`beschreibung`, `unterprojekt` (Titel) oder `unterprojekt_id` und `external_id`:

```bash
curl -X POST "$ZEITERFASSUNG_URL/api/v1/eintraege" \
  -H "Authorization: Bearer $ZEITERFASSUNG_TOKEN" -H "Content-Type: application/json" \
  -d '{"aufgabenbereich_id": 3, "beschreibung": "Moodle-Kurs gebaut",
       "beginn": "2026-10-08 09:00", "ende": "2026-10-08 10:30"}'
```

- **Zeitangaben:** entweder `YYYY-MM-DD HH:MM` in Serverzeit (wie in der
  Oberfläche) oder ISO 8601 mit Zone (`2026-10-08T07:30:00Z`), die in die
  Serverzeit umgerechnet wird. Einträge sind minutengenau, höchstens 24 Stunden
  lang, das Ende muss nach dem Beginn liegen.
- **Wiederholbar (`external_id`):** ein selbst vergebener, stabiler Schlüssel je
  Eintrag. Derselbe Schlüssel legt keinen zweiten Eintrag an, sondern
  aktualisiert den vorhandenen (`status`: `angelegt`, `aktualisiert` oder
  `unveraendert`) – so lässt sich ein Abgleich beliebig oft wiederholen. Der
  Schlüssel ist nur je Benutzer eindeutig.
- **Unterthemen:** eine unbekannte Angabe ist ein Fehler (`422`), kein stilles
  Umbuchen. Ohne Angabe gilt wie in der Oberfläche das Auffang-Unterthema
  "Allgemein".
- **Status:** per API angelegte Einträge haben die Quelle `api` und sind – wie
  nachgetragene Zeiten – zunächst Entwurf, bis sie synchronisiert werden
  (oder sofort, wenn "Automatisch synchronisieren" aktiv ist). Ändert sich ein
  bereits synchronisierter Eintrag, wird er wieder zum Entwurf.
- **Fehler** kommen als `{"fehler": {"code": "...", "nachricht": "..."}}` mit
  passendem HTTP-Status (`401` Token, `404` unbekannt oder fremd, `409` Timer-
  Konflikt, `422` ungültige Eingabe).

### Claude-Code-Sitzungen mit der Zeiterfassung abgleichen

`tools/claude-zeit.js` liest die lokalen Verläufe von Claude Code
(`~/.claude/projects/…`), fasst die Aktivität je Sitzung zu Arbeitsblöcken
zusammen und trägt sie über die API ein. Es läuft auf dem eigenen Rechner und
kommt ohne zusätzliche Pakete aus (Node ≥ 22). Übertragen werden nur Beginn,
Ende und eine kurze Beschreibung – **nie der Inhalt der Chats**.

1. **Zugang einrichten** – Token wie oben erstellen und in der Shell setzen
   (oder in `~/.claude/settings.json` unter `"env"`):

   ```bash
   export ZEITERFASSUNG_URL="https://zeit.example.de"
   export ZEITERFASSUNG_TOKEN="zt_…"
   node tools/claude-zeit.js status        # Verbindung testen
   ```

2. **Projekt zuordnen** – im Projektordner eine Datei `.zeiterfassung.json`
   anlegen. Der Aufgabenbereich wird bei Bedarf automatisch angelegt:

   ```json
   { "aufgabenbereich": "Medienkonzept", "unterprojekt": "Kurs B",
     "beschreibung": "Claude Code: {projekt}", "anlegen": true }
   ```

   `unterprojekt` (muss existieren), `beschreibung` und `anlegen` sind
   optional; statt eines Titels geht auch die numerische ID.

3. **Abgleichen** – erst ansehen, dann eintragen:

   ```bash
   node tools/claude-zeit.js abgleich --trocken     # nur anzeigen
   node tools/claude-zeit.js abgleich               # eintragen
   ```

   Weitere Optionen: `--seit JJJJ-MM-TT` (Standard: 14 Tage), `--pause 15`
   (Minuten ohne Aktivität, ab denen ein neuer Block beginnt), `--min 1`
   (kürzere Blöcke ignorieren), `--alle` (jedes Projekt mit
   `.zeiterfassung.json`), `--projekt <pfad>`, `--aufgabenbereich`,
   `--unterprojekt`. Mit `bereiche` und `status` lassen sich Aufgabenbereiche
   und die Verbindung prüfen. Blöcke über Mitternacht werden je Tag geteilt.

Weil jeder Block einen stabilen Schlüssel trägt (`claude-code:<Sitzung>:<Beginn>`),
darf der Abgleich beliebig oft laufen: Bereits eingetragene Zeiten bleiben
unverändert, eine fortgesetzte Sitzung aktualisiert ihren Eintrag.

**Automatisch nach jeder Sitzung** (optional) – als Hook in
`~/.claude/settings.json`; Claude Code startet ihn im Projektordner:

```json
{ "hooks": { "SessionEnd": [ { "hooks": [
    { "type": "command", "command": "node /pfad/zur/zeiterfassung/tools/claude-zeit.js abgleich" }
] } ] } }
```

**Als Skill** – `tools/claude-code-skill/SKILL.md` nach
`~/.claude/skills/zeiterfassung/SKILL.md` kopieren und den Pfad darin anpassen;
danach genügt in einem Claude-Code-Chat `/zeiterfassung`.

## Technik

- Node.js ≥ 22, Express, EJS (serverseitiges Rendering, kein Build-Schritt nötig)
- SQLite (`better-sqlite3`) als Datenhaltung – keine externe Datenbank auf dem
  Server nötig, läuft als Datei im `data/`-Verzeichnis
- Sessions werden dateibasiert gespeichert (`session-file-store`), bleiben also
  auch nach einem Neustart der App erhalten
- LDAP-Anbindung über `ldapts` (Bind als Service-Account zur Benutzersuche,
  anschließend Bind mit den eingegebenen Zugangsdaten zur Passwortprüfung)

- **Neue Version = neues CSS/JS sofort** – die Adressen aller Stylesheets und
  Skripte tragen einen Inhalts-Hash (`?v=…`, siehe `src/util/asset-version.js`).
  Nach einem Update lädt der Browser (und ein vorgeschalteter Webserver wie bei
  Plesk) sie deshalb von selbst neu, statt eine neue Seite mit altem CSS
  darzustellen. Ein manuelles "hart neu laden" ist nicht mehr nötig.

### Absicherung

- **CSRF-Schutz** – jedes schreibende Formular trägt ein Token aus der
  Sitzung; ohne gültiges Token weist der Server die Anfrage mit 403 ab. Damit
  kann eine fremde Seite nicht im Namen einer angemeldeten Lehrkraft Zeiten
  löschen oder Zuweisungen ändern.
- **API-Zugänge** – persönliche Tokens (256 Bit Zufall), in der Datenbank nur
  als Hash abgelegt und widerrufbar. Ein Token erreicht nur die eigenen Zeiten
  der jeweiligen Lehrkraft; die API ist bewusst von Session und Admin-Bereich
  getrennt (siehe `src/routes/api.js`).
- **Sicherheits-Header** (`helmet`) – unter anderem eine
  Content-Security-Policy: Skripte laufen nur aus eigenen Dateien und aus dem
  einen Inline-Block, der die Nonce des jeweiligen Aufrufs trägt. Skripte in
  HTML-Attributen sind damit ausgeschlossen.
- **Ratelimit für Anmeldeversuche** – gezählt wird auf Benutzername *und*
  Adresse, mit unterschiedlichen Schwellen: hinter der Schul-Adresse sitzen
  viele Menschen, von denen sich regelmäßig jemand vertippt. Die Sperrdauer
  wächst mit jedem weiteren Fehlversuch, ist aber gedeckelt und verfällt nach
  einer ruhigen Phase – sonst ließe sich ein fremdes Konto dauerhaft
  aussperren.

### Tests

`npm test` führt die Testsuite aus (Node-eigener Test-Runner, keine
zusätzlichen Laufzeit-Abhängigkeiten), `npm run lint` prüft den Code mit
ESLint. Abgedeckt sind vor allem die Stellen, an denen
ein Fehler stillschweigend Daten kostet:

- **Migrationen** – für jede Schema-Stufe wird ein Altbestand nachgebaut und
  geprüft, dass der Start durchläuft und die Werte rechnerisch unverändert
  bleiben. Wichtig, weil die `CREATE TABLE`-Anweisungen immer das *aktuelle*
  Schema tragen: eine Migration, die in eine zwischenzeitlich entfernte Spalte
  schreibt, bricht den Start jeder älteren Installation ab.
- **Verschlüsselung** – Roundtrip sowie das Verhalten bei unlesbaren Werten.
- **Zuweisung ↔ Aufgabenbereich** – der Vorschlag/Bestätigen-Ablauf und die
  Sperre, sobald für einen Aufgabenbereich Zeiten erfasst wurden.
- **Eingabeprüfung von Datum und Uhrzeit** sowie die Berechnung der benötigten
  Zeitstunden.
- **API** – Anmeldung per Token, Trennung der Konten, Wiederholbarkeit über
  `external_id`, Umrechnung von Zeitzonen und die Fehlerfälle; dazu die Logik
  des Claude-Code-Abgleichs (Blockbildung, Mitternachtsteilung, stabile
  Schlüssel).
- **Pools, Bereiche, Druck und Upload** – die Pool-Grenze (Anlegen, Ändern,
  Wechsel; auch über die HTTP-Routen), die Übernahme ins nächste Schuljahr, die
  Druckseiten samt Unterschriftsfeldern sowie der Upload (Typprüfung am Inhalt,
  Größenlimit, CSRF, Zugriffsschutz).
- **Ratelimit und Redirect-Ziele** – die beiden Stellen, an denen eine zu
  lasche Regel direkt ausnutzbar wäre.
- **Schuljahres-Logik** – Wechsel am 1. August und die Prüfung der
  Schreibweise.

## Konfiguration

Alle Einstellungen erfolgen über Umgebungsvariablen, siehe `.env.example`.
Auf dem Server eine `.env`-Datei anlegen (wird nicht ins Git-Repository
übernommen) oder die Variablen über die Plesk-Oberfläche ("Node.js" →
"Custom Environment Variables") setzen.

Wichtige Variablen:

| Variable | Bedeutung |
|---|---|
| `LDAP_URL` | z. B. `ldaps://ldap.schule.de:636` |
| `LDAP_BIND_DN` / `LDAP_BIND_PASSWORD` | Service-Account mit Lesezugriff für die Benutzersuche (nicht nötig im Direkt-Bind-Modus, siehe unten) |
| `LDAP_BIND_USER_TEMPLATE` | Direkt-Bind-Modus: Anmeldung ohne Service-Account, z. B. `{{username}}@schule.de` oder `SCHULE\{{username}}` |
| `LDAP_BASE_DN` | Suchbasis für Lehrkräfte |
| `LDAP_USER_FILTER` | Filter mit Platzhalter `{{username}}`, z. B. `(uid={{username}})`; bei Active Directory z. B. `(sAMAccountName={{username}})` |
| `LDAP_USERNAME_ATTR`, `LDAP_DISPLAY_NAME_ATTR`, `LDAP_EMAIL_ATTR` | LDAP-Attributnamen (bei Active Directory: `sAMAccountName`, `displayName`) |
| `LDAP_TLS_CA_PFAD` | Nur bei `ldaps://` mit interner/selbstsignierter CA: Pfad zur PEM-Datei |
| `LDAP_TLS_REJECT_UNAUTHORIZED=false` | Zertifikatsprüfung abschalten (nur Notlösung, siehe Troubleshooting) |
| `ADMIN_USERNAMES` | Komma-getrennte Liste von LDAP-Benutzernamen mit Admin-Rechten in der App |
| `SESSION_SECRET` | **Pflicht.** Zufälliger, geheimer String zum Signieren der Session-Cookies. Erzeugen mit `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Ohne gesetzten Wert startet die App nicht (bewusst – mit einem bekannten Vorgabewert ließen sich fremde Sessions fälschen, auch die des Admins). |
| `DB_PATH` | Pfad zur SQLite-Datei (Standard: `./data/zeiterfassung.db`) |
| `ENCRYPTION_KEY` | **Pflicht.** 32-Byte-Schlüssel (64 Hex-Zeichen) zur Verschlüsselung der Tätigkeitsbeschreibungen. Erzeugen mit `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Ohne gesetzten Schlüssel startet die App nicht (bewusst, damit Daten nie unverschlüsselt landen). |

**Wichtig zu `ENCRYPTION_KEY`:** Der Schlüssel gehört nicht in die `.env`-Datei
im Backup der Datenbank, sondern separat aufbewahrt (Passwort-Tresor der
Schule). Bei einem Serverumzug beides mitnehmen: die `.db`-Datei *und* den
Schlüssel. Geht der Schlüssel verloren, sind die verschlüsselten Beschreibungen
unwiederbringlich verloren – es gibt bewusst keine Wiederherstellung ohne ihn.
Wird der Schlüssel nachträglich geändert, lassen sich bereits verschlüsselte
Altdaten nicht mehr entschlüsseln.

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

**Service-Account für die LDAP-Suche funktioniert nicht (falscher
`LDAP_BIND_DN`/`LDAP_BIND_PASSWORD`, oder gar kein Service-Account
vorhanden):** Statt weiter am Service-Account zu debuggen, kann
`LDAP_BIND_USER_TEMPLATE` gesetzt werden (Direkt-Bind-Modus) – dann bindet
jede Anmeldung direkt mit der eigenen Kennung der Lehrkraft, ganz ohne
Service-Account. `LDAP_BIND_DN`/`LDAP_BIND_PASSWORD` werden dann ignoriert
(nur noch für die LDAP-Suche im Admin-Bereich beim Zuweisen von
Aufgabenbereichen an noch nicht eingeloggte Lehrkräfte relevant – Lehrkräfte, die sich schon
einmal angemeldet haben, tauchen unabhängig davon in der normalen
Admin-Übersicht auf).
