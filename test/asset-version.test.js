const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { berechne } = require('../src/util/asset-version');

function wurzel() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'));
  fs.mkdirSync(path.join(dir, 'css'));
  fs.mkdirSync(path.join(dir, 'js'));
  fs.writeFileSync(path.join(dir, 'css', 'style.css'), 'body { color: black; }');
  fs.writeFileSync(path.join(dir, 'js', 'app.js'), 'console.log(1);');
  return dir;
}

test('die Versionsnummer bleibt gleich, solange sich keine Datei aendert', () => {
  const dir = wurzel();
  assert.equal(berechne(dir), berechne(dir));
  assert.match(berechne(dir), /^[0-9a-f]{10}$/);
});

test('eine geaenderte, neue oder umbenannte Datei aendert die Versionsnummer', () => {
  const dir = wurzel();
  const vorher = berechne(dir);

  fs.writeFileSync(path.join(dir, 'css', 'style.css'), 'body { color: white; }');
  const nachAenderung = berechne(dir);
  assert.notEqual(nachAenderung, vorher, 'geaenderter Inhalt');

  fs.writeFileSync(path.join(dir, 'js', 'neu.js'), '');
  const nachNeu = berechne(dir);
  assert.notEqual(nachNeu, nachAenderung, 'neue Datei');

  fs.renameSync(path.join(dir, 'js', 'neu.js'), path.join(dir, 'js', 'anders.js'));
  assert.notEqual(berechne(dir), nachNeu, 'umbenannte Datei');
});

test('andere Dateien (Bilder, Manifest) beeinflussen die Nummer nicht', () => {
  const dir = wurzel();
  const vorher = berechne(dir);
  fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), '{}');
  fs.writeFileSync(path.join(dir, 'css', 'bild.png'), 'x');
  assert.equal(berechne(dir), vorher);
});

test('alle Seiten binden CSS und Skripte mit Versionsnummer ein', () => {
  const glob = (ordner) =>
    fs.readdirSync(ordner, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? glob(path.join(ordner, e.name)) : [path.join(ordner, e.name)]));
  const ohne = [];
  for (const datei of glob(path.join(__dirname, '..', 'views')).filter((f) => f.endsWith('.ejs'))) {
    for (const zeile of fs.readFileSync(datei, 'utf8').split('\n')) {
      if (/(?:src|href)="\/public\/(?:css|js)\/[^"]+\.(?:css|js)"/.test(zeile)) ohne.push(`${path.relative(process.cwd(), datei)}: ${zeile.trim()}`);
    }
  }
  assert.deepEqual(ohne, [], 'Adressen ohne ?v=<%= assetVersion %> wuerden nach einem Update veraltet aus dem Cache kommen');
});
