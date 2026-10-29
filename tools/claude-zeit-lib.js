// Reine Logik des Abgleichs zwischen Claude-Code-Sitzungen und der
// Zeiterfassung - ohne Netzwerk und Dateizugriff, damit sie sich testen laesst.
// Das Kommandozeilenwerkzeug (claude-zeit.js) setzt sie mit Ein-/Ausgabe zusammen.

const MINUTE = 60 * 1000;

// Claude Code legt die Verlaeufe je Projekt in einem Ordner ab, dessen Name
// der Projektpfad mit "-" statt aller Zeichen ausser Buchstaben und Ziffern ist
// (z. B. /home/user/projekt -> -home-user-projekt).
function kodiereProjektPfad(pfad) {
  return String(pfad).replace(/[^a-zA-Z0-9]/g, '-');
}

// Liest den Text einer Sitzungsdatei (.jsonl, eine JSON-Zeile je Ereignis).
// Zeiten stammen aus den Nachrichten von Nutzer und Assistent; alles andere
// (Statuszeilen, Anhaenge, Warteschlange) sagt nichts ueber Aktivitaet aus.
// Kaputte Zeilen werden uebersprungen, damit eine halb geschriebene letzte
// Zeile den Abgleich nicht verhindert.
function leseSitzung(text) {
  const zeitpunkte = [];
  let sessionId = null;
  let cwd = null;
  for (const zeile of String(text).split('\n')) {
    if (!zeile.trim()) continue;
    let o;
    try {
      o = JSON.parse(zeile);
    } catch (e) {
      continue;
    }
    if (!o || (o.type !== 'user' && o.type !== 'assistant')) continue;
    const ms = Date.parse(o.timestamp);
    if (Number.isNaN(ms)) continue;
    zeitpunkte.push(ms);
    if (!sessionId && o.sessionId) sessionId = o.sessionId;
    if (!cwd && o.cwd) cwd = o.cwd;
  }
  zeitpunkte.sort((a, b) => a - b);
  return { sessionId, cwd, zeitpunkte };
}

// Fasst Zeitpunkte zu Arbeitsbloecken zusammen: liegt zwischen zwei Ereignissen
// mehr als pauseMinuten, beginnt ein neuer Block. Eine einzelne Nachricht ergibt
// einen Block der Laenge 0 (wird beim Runden auf mindestens eine Minute gehoben).
function baueBloecke(zeitpunkte, pauseMinuten) {
  const bloecke = [];
  const pause = pauseMinuten * MINUTE;
  for (const ms of zeitpunkte) {
    const letzter = bloecke[bloecke.length - 1];
    if (letzter && ms - letzter.ende <= pause) letzter.ende = ms;
    else bloecke.push({ start: ms, ende: ms });
  }
  return bloecke;
}

function naechsterMitternacht(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

// Ein Eintrag der Zeiterfassung darf hoechstens 24 Stunden umfassen und soll
// zu genau einem Tag gehoeren. Deshalb wird ein Block, der ueber Mitternacht
// (Ortszeit) laeuft, in Tagesabschnitte geteilt.
function teileAnMitternacht(block) {
  const teile = [];
  let von = block.start;
  for (;;) {
    const grenze = naechsterMitternacht(von);
    if (block.ende <= grenze) {
      teile.push({ start: von, ende: block.ende });
      return teile;
    }
    teile.push({ start: von, ende: grenze });
    von = grenze;
  }
}

// Die Zeiterfassung arbeitet minutengenau: Beginn abrunden, Ende aufrunden,
// mindestens eine Minute.
function rundeAufMinuten(teil) {
  const start = Math.floor(teil.start / MINUTE) * MINUTE;
  let ende = Math.ceil(teil.ende / MINUTE) * MINUTE;
  if (ende <= start) ende = start + MINUTE;
  return { start, ende };
}

// Wandelt die Blocks einer Sitzung in Eintraege fuer POST /eintraege/abgleich.
// Der Schluessel (external_id) haengt an Sitzung, Blockbeginn und Tagesabschnitt.
// Er bleibt gleich, wenn der Block spaeter waechst - ein erneuter Abgleich
// aktualisiert also den Eintrag, statt einen zweiten anzulegen.
function bloeckeZuEintraegen({ sessionId, bloecke, beschreibung, aufgabenbereichId, unterprojekt, mindestMinuten, seitMs }) {
  const eintraege = [];
  for (const block of bloecke) {
    if (seitMs !== undefined && block.start < seitMs) continue;
    const blockId = new Date(block.start).toISOString();
    teileAnMitternacht(block).forEach((teil, index) => {
      const gerundet = rundeAufMinuten(teil);
      if ((gerundet.ende - gerundet.start) / MINUTE < mindestMinuten) return;
      const eintrag = {
        external_id: `claude-code:${sessionId}:${blockId}:${index}`,
        aufgabenbereich_id: aufgabenbereichId,
        beschreibung,
        beginn: new Date(gerundet.start).toISOString(),
        ende: new Date(gerundet.ende).toISOString(),
      };
      if (unterprojekt) eintrag.unterprojekt = unterprojekt;
      eintraege.push(eintrag);
    });
  }
  return eintraege;
}

// Ersetzt {projekt} in der Beschreibungsvorlage.
function baueBeschreibung(vorlage, projektName) {
  return String(vorlage || 'Claude Code: {projekt}').replace(/\{projekt\}/g, projektName);
}

function formatDauer(minuten) {
  const h = Math.floor(minuten / 60);
  const m = Math.round(minuten % 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

module.exports = {
  kodiereProjektPfad,
  leseSitzung,
  baueBloecke,
  teileAnMitternacht,
  rundeAufMinuten,
  bloeckeZuEintraegen,
  baueBeschreibung,
  formatDauer,
};
