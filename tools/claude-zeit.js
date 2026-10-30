#!/usr/bin/env node
// Gleicht Claude-Code-Sitzungen mit der Zeiterfassung ab.
//
// Liest die lokalen Verlaeufe von Claude Code (~/.claude/projects/...), fasst
// die Aktivitaet je Sitzung zu Arbeitsbloecken zusammen und traegt sie ueber die
// API als Zeiten in den Aufgabenbereich ein, der dem Projekt zugeordnet ist.
// Laeuft komplett lokal; es werden nur Beginn, Ende und eine kurze Beschreibung
// uebertragen - nie der Inhalt der Chats.
//
// Aufruf: node tools/claude-zeit.js [abgleich|bereiche|status] [Optionen]
// Hilfe:  node tools/claude-zeit.js --hilfe

const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./claude-zeit-lib');

const HILFE = `Claude-Code-Zeiten mit der Zeiterfassung abgleichen

Aufruf:
  node tools/claude-zeit.js [befehl] [optionen]

Befehle:
  abgleich   Sitzungen des Projekts als Zeiten eintragen (Standard)
  bereiche   eigene Aufgabenbereiche auflisten
  status     Verbindung pruefen und laufende Erfassung anzeigen

Optionen fuer "abgleich":
  --projekt <pfad>            Projektordner (Standard: aktueller Ordner)
  --alle                      alle Projekte mit .zeiterfassung.json abgleichen
  --seit <JJJJ-MM-TT>         nur Bloecke ab diesem Tag (Standard: letzte 14 Tage)
  --pause <min>               Pause, ab der ein neuer Block beginnt (Standard: 15)
  --min <min>                 kuerzere Bloecke ignorieren (Standard: 1)
  --aufgabenbereich <titel|id>  ueberschreibt die Zuordnung der Projektdatei
  --unterprojekt <titel>      ueberschreibt das Unterthema der Projektdatei
  --trocken                   nur anzeigen, nichts senden

Zuordnung Projekt -> Aufgabenbereich: Datei .zeiterfassung.json im Projektordner
  { "aufgabenbereich": "Medienkonzept", "unterprojekt": "Kurs B",
    "beschreibung": "Claude Code: {projekt}", "anlegen": true }

Zugang (Umgebungsvariablen, Token unter "API-Zugang" in der Zeiterfassung):
  ZEITERFASSUNG_URL     z. B. https://zeit.example.de
  ZEITERFASSUNG_TOKEN   Token (beginnt mit zt_)
`;

// --- Kommandozeile ----------------------------------------------------------

function liesArgumente(argv) {
  const opt = { befehl: 'abgleich', pause: 15, min: 1, seitTage: 14 };
  const mitWert = new Set(['projekt', 'seit', 'pause', 'min', 'aufgabenbereich', 'unterprojekt']);
  const args = argv.slice();
  if (args[0] && !args[0].startsWith('-')) opt.befehl = args.shift();
  while (args.length) {
    const a = args.shift();
    if (!a.startsWith('--')) throw new Error(`Unerwartetes Argument: ${a}`);
    const name = a.slice(2);
    if (name === 'alle' || name === 'trocken' || name === 'hilfe') {
      opt[name] = true;
    } else if (mitWert.has(name)) {
      if (!args.length) throw new Error(`--${name} braucht einen Wert.`);
      opt[name] = args.shift();
    } else {
      throw new Error(`Unbekannte Option: ${a}`);
    }
  }
  opt.pause = Number(opt.pause);
  opt.min = Number(opt.min);
  if (!(opt.pause > 0) || !(opt.min >= 0)) throw new Error('--pause und --min muessen Zahlen sein (pause > 0).');
  return opt;
}

function seitGrenze(opt) {
  if (opt.seit) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(opt.seit);
    if (!m) throw new Error('--seit erwartet das Format JJJJ-MM-TT.');
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  }
  const jetzt = new Date();
  return new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() - opt.seitTage).getTime();
}

// --- API --------------------------------------------------------------------

function ladeZugang() {
  let url = (process.env.ZEITERFASSUNG_URL || '').trim().replace(/\/+$/, '');
  const token = (process.env.ZEITERFASSUNG_TOKEN || '').trim();
  if (!url || !token) {
    throw new Error(
      'ZEITERFASSUNG_URL und ZEITERFASSUNG_TOKEN sind nicht gesetzt.\n' +
        'Das Token erstellst du in der Zeiterfassung unter "API-Zugang".'
    );
  }
  if (!/\/api\/v1$/.test(url)) url += '/api/v1';
  return { url, token };
}

async function api(zugang, methode, pfad, body) {
  let res;
  try {
    res = await fetch(zugang.url + pfad, {
      method: methode,
      headers: {
        Authorization: `Bearer ${zugang.token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(`Die Zeiterfassung ist nicht erreichbar (${zugang.url}): ${err.cause?.code || err.message}`, { cause: err });
  }
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (err) {
    throw new Error(`Unerwartete Antwort (HTTP ${res.status}) - stimmt ZEITERFASSUNG_URL?`, { cause: err });
  }
  if (!res.ok) {
    const f = json && json.fehler;
    throw new Error(f ? `${f.nachricht} (${f.code})` : `HTTP ${res.status}`);
  }
  return json;
}

// --- Projekte und Sitzungen -------------------------------------------------

function claudeVerzeichnis() {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
}

function ladeProjektDatei(ordner) {
  const datei = path.join(ordner, '.zeiterfassung.json');
  if (!fs.existsSync(datei)) return null;
  try {
    return JSON.parse(fs.readFileSync(datei, 'utf8'));
  } catch (err) {
    throw new Error(`${datei} ist kein gueltiges JSON: ${err.message}`, { cause: err });
  }
}

function findeProjekte(opt) {
  const wurzel = claudeVerzeichnis();
  if (!fs.existsSync(wurzel)) throw new Error(`Keine Claude-Code-Verlaeufe gefunden (${wurzel}).`);

  if (!opt.alle) {
    const ordner = path.resolve(opt.projekt || process.cwd());
    const transkripte = path.join(wurzel, lib.kodiereProjektPfad(ordner));
    if (!fs.existsSync(transkripte)) throw new Error(`Fuer ${ordner} gibt es keine Claude-Code-Sitzungen (${transkripte}).`);
    return [{ ordner, transkripte }];
  }

  const projekte = [];
  for (const name of fs.readdirSync(wurzel)) {
    const transkripte = path.join(wurzel, name);
    if (!fs.statSync(transkripte).isDirectory()) continue;
    // Der echte Projektpfad steht in den Sitzungen selbst (der Ordnername
    // ist verlustbehaftet kodiert).
    const datei = fs.readdirSync(transkripte).find((f) => f.endsWith('.jsonl'));
    if (!datei) continue;
    const { cwd } = lib.leseSitzung(fs.readFileSync(path.join(transkripte, datei), 'utf8'));
    if (cwd && fs.existsSync(cwd)) projekte.push({ ordner: cwd, transkripte });
  }
  return projekte;
}

function sammleEintraege(projekt, cfg, opt, seitMs) {
  const eintraege = [];
  const projektName = path.basename(projekt.ordner);
  const beschreibung = lib.baueBeschreibung(cfg.beschreibung, projektName);
  for (const datei of fs.readdirSync(projekt.transkripte)) {
    if (!datei.endsWith('.jsonl')) continue;
    const sitzung = lib.leseSitzung(fs.readFileSync(path.join(projekt.transkripte, datei), 'utf8'));
    if (!sitzung.zeitpunkte.length) continue;
    const sessionId = sitzung.sessionId || path.basename(datei, '.jsonl');
    eintraege.push(
      ...lib.bloeckeZuEintraegen({
        sessionId,
        bloecke: lib.baueBloecke(sitzung.zeitpunkte, opt.pause),
        beschreibung,
        aufgabenbereichId: null,
        unterprojekt: cfg.unterprojekt,
        mindestMinuten: opt.min,
        seitMs,
      })
    );
  }
  return eintraege.sort((a, b) => a.beginn.localeCompare(b.beginn));
}

// --- Ausgabe ----------------------------------------------------------------

const lokal = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return { tag: `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`, zeit: `${p(d.getHours())}:${p(d.getMinutes())}` };
};

function zeigeEintraege(eintraege) {
  let summe = 0;
  for (const e of eintraege) {
    const a = lokal(e.beginn);
    const b = lokal(e.ende);
    const min = (Date.parse(e.ende) - Date.parse(e.beginn)) / 60000;
    summe += min;
    console.log(`  ${a.tag}  ${a.zeit}-${b.zeit}  ${lib.formatDauer(min).padStart(10)}  ${e.beschreibung}`);
  }
  console.log(`  ${'-'.repeat(40)}\n  ${eintraege.length} Bloecke, zusammen ${lib.formatDauer(summe)}`);
}

// --- Befehle ----------------------------------------------------------------

async function loeseAufgabenbereich(zugang, wert, cfg) {
  if (/^\d+$/.test(String(wert))) return { id: Number(wert), titel: `#${wert}` };
  if (cfg.anlegen === false) {
    const liste = await api(zugang, 'GET', '/aufgabenbereiche');
    const treffer = liste.aufgabenbereiche.find((b) => b.titel.toLowerCase() === String(wert).toLowerCase());
    if (!treffer) throw new Error(`Aufgabenbereich "${wert}" existiert nicht (und "anlegen" ist ausgeschaltet).`);
    return { id: treffer.id, titel: treffer.titel };
  }
  const bereich = await api(zugang, 'POST', '/aufgabenbereiche', { titel: String(wert) });
  if (bereich.angelegt) console.log(`  Aufgabenbereich "${bereich.titel}" (${bereich.schuljahr}) neu angelegt.`);
  if (bereich.archiviert) throw new Error(`Aufgabenbereich "${bereich.titel}" ist archiviert - bitte in der Zeiterfassung reaktivieren.`);
  return { id: bereich.id, titel: bereich.titel };
}

async function abgleich(opt) {
  const seitMs = seitGrenze(opt);
  const projekte = findeProjekte(opt);
  const zugang = opt.trocken ? null : ladeZugang();
  const gesamt = { angelegt: 0, aktualisiert: 0, unveraendert: 0, fehler: 0 };
  let uebersprungen = 0;

  for (const projekt of projekte) {
    const datei = ladeProjektDatei(projekt.ordner) || {};
    const cfg = { ...datei };
    if (opt.aufgabenbereich) cfg.aufgabenbereich = opt.aufgabenbereich;
    if (opt.unterprojekt) cfg.unterprojekt = opt.unterprojekt;

    if (!cfg.aufgabenbereich) {
      if (opt.alle) {
        uebersprungen++;
        continue;
      }
      throw new Error(
        `Dem Projekt ${projekt.ordner} ist kein Aufgabenbereich zugeordnet.\n` +
          'Lege eine Datei .zeiterfassung.json im Projektordner an, z. B.:\n' +
          '  { "aufgabenbereich": "Medienkonzept" }\n' +
          'oder gib --aufgabenbereich <titel|id> an.'
      );
    }

    const eintraege = sammleEintraege(projekt, cfg, opt, seitMs);
    console.log(`\n${path.basename(projekt.ordner)}  ->  ${cfg.aufgabenbereich}${cfg.unterprojekt ? ` / ${cfg.unterprojekt}` : ''}`);
    if (!eintraege.length) {
      console.log('  Keine Bloecke im gewaehlten Zeitraum.');
      continue;
    }
    zeigeEintraege(eintraege);
    if (opt.trocken) {
      console.log('  (Trockenlauf - nichts gesendet)');
      continue;
    }

    const bereich = await loeseAufgabenbereich(zugang, cfg.aufgabenbereich, cfg);
    eintraege.forEach((e) => { e.aufgabenbereich_id = bereich.id; });
    for (let i = 0; i < eintraege.length; i += 100) {
      const antwort = await api(zugang, 'POST', '/eintraege/abgleich', { eintraege: eintraege.slice(i, i + 100) });
      for (const k of Object.keys(gesamt)) gesamt[k] += antwort.zusammenfassung[k];
      for (const r of antwort.ergebnisse.filter((x) => x.status === 'fehler')) {
        console.log(`  Fehler bei ${r.external_id}: ${r.fehler.nachricht} (${r.fehler.code})`);
      }
    }
  }

  if (opt.alle && uebersprungen) console.log(`\n${uebersprungen} Projekt(e) ohne .zeiterfassung.json uebersprungen.`);
  if (!opt.trocken) {
    console.log(
      `\nFertig: ${gesamt.angelegt} angelegt, ${gesamt.aktualisiert} aktualisiert, ${gesamt.unveraendert} unveraendert, ${gesamt.fehler} Fehler.`
    );
    if (gesamt.fehler) process.exitCode = 1;
  }
}

async function bereiche() {
  const zugang = ladeZugang();
  const liste = await api(zugang, 'GET', '/aufgabenbereiche');
  if (!liste.aufgabenbereiche.length) return console.log('Keine Aufgabenbereiche im laufenden Schuljahr.');
  for (const b of liste.aufgabenbereiche) {
    const up = b.unterprojekte.length ? `  [${b.unterprojekte.map((u) => u.titel).join(', ')}]` : '';
    console.log(`#${String(b.id).padEnd(4)} ${b.titel}  (${b.erfasst_stunden.toFixed(2)} h)${up}`);
  }
}

async function status() {
  const zugang = ladeZugang();
  const ich = await api(zugang, 'GET', '/me');
  console.log(`Verbunden als ${ich.anzeigename} (${ich.benutzername}), Schuljahr ${ich.aktuelles_schuljahr}.`);
  const timer = await api(zugang, 'GET', '/timer');
  console.log(timer.laeuft ? `Laeuft: ${timer.eintrag.beschreibung} seit ${timer.eintrag.beginn}` : 'Keine laufende Erfassung.');
}

async function haupt() {
  const opt = liesArgumente(process.argv.slice(2));
  if (opt.hilfe || opt.befehl === 'hilfe') return console.log(HILFE);
  if (opt.befehl === 'abgleich') return abgleich(opt);
  if (opt.befehl === 'bereiche') return bereiche();
  if (opt.befehl === 'status') return status();
  throw new Error(`Unbekannter Befehl: ${opt.befehl}\n\n${HILFE}`);
}

haupt().catch((err) => {
  console.error(`Fehler: ${err.message}`);
  process.exitCode = 1;
});
