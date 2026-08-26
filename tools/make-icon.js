// Erzeugt das App-Icon als PNG und als Windows-ICO.
//
//   node tools/make-icon.js
//
// Warum generiert statt gezeichnet: Ein Icon muss bei 256 Pixeln gut aussehen
// und bei 16 noch lesbar sein — und 16 Pixel verzeihen nichts. Ein verkleinertes
// Bild wird dort zu Matsch. Aus einem 16x16-Raster heraus vergrössert ist jede
// Grösse gestochen scharf, und die kleinste ist die, die man am häufigsten
// sieht: im Startmenü, in der Taskleiste, im Explorer.
//
// Das passt ausserdem zur App selbst — sie zeichnet Pixelart. Ein weich
// gezeichnetes Symbol davor wäre ein Versprechen, das drinnen niemand einlöst.
//
// Die Farben kommen aus renderer/style.css (--accent, --accent2, --panel). Wer
// sie dort ändert, sollte sie hier nachziehen; automatisch auslesen wäre mehr
// Mechanik, als zwei Zahlen wert sind.
//
// Erzeugt wird nach build/ — dort sucht electron-builder seine Bau-Eingaben.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ZIEL = path.join(__dirname, '..', 'build');

// Aus renderer/style.css
const BG   = [0x15, 0x17, 0x1d, 255];   // --panel
const HAUT = [0xf7, 0x93, 0x1e, 255];   // --accent
const DUNK = [0xb8, 0x6c, 0x12, 255];   // Schatten dazu, von Hand abgedunkelt
const AUGE = [0x15, 0x17, 0x1d, 255];   // wie der Hintergrund: ausgestanzt
const MUND = [0x3d, 0xdc, 0x97, 255];   // --accent2

// 16x16. B=Haut, D=Schatten, A=Auge, M=Mund, .=Hintergrund
//
// Der Kopf sitzt absichtlich nicht mittig, sondern etwas nach oben: Unten
// braucht es Platz für Schultern, sonst schwebt er. Augen und Mund sind
// symmetrisch — bei dieser Auflösung fällt eine Spalte Versatz sofort auf.
const RASTER = [
  '................',
  '....BBBBBBBB....',
  '...BBBBBBBBBB...',
  '..BBBBBBBBBBBB..',
  '..BBBBBBBBBBBB..',
  '..BBAABBBBAABB..',
  '..BBAABBBBAABB..',
  '..BBBBBBBBBBBB..',
  '..BBBBBBBBBBBB..',
  '..BBMMMMMMMMBB..',
  '..BBMMMMMMMMBB..',
  '..BBBBBBBBBBBB..',
  '...DBBBBBBBBD...',
  '....DDBBBBDD....',
  '......DDDD......',
  '................'
];

const FARBE = {B: HAUT, D: DUNK, A: AUGE, M: MUND, '.': BG};

// Die Grössen, die Windows tatsächlich abfragt. 24 und 48 fehlen in vielen
// Icons und werden dann aus der nächstgrösseren heruntergerechnet — genau der
// Matsch, den dieses Skript vermeiden soll.
const GROESSEN = [16, 24, 32, 48, 64, 128, 256];

// ---- PNG von Hand ---------------------------------------------------------
//
// Ohne Abhängigkeit: zlib bringt Node mit, und mehr braucht ein PNG nicht. Eine
// Bildbibliothek für 60 Zeilen wäre ein Paket, das jemand pflegen müsste.

let crcTabelle = null;
function crc32(buf){
  if(!crcTabelle){
    crcTabelle = new Int32Array(256);
    for(let n = 0; n < 256; n++){
      let c = n;
      for(let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTabelle[n] = c;
    }
  }
  let c = -1;
  for(let i = 0; i < buf.length; i++) c = crcTabelle[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

function pixel(groesse){
  const skala = groesse / 16;
  const zeilen = [];
  for(let y = 0; y < groesse; y++){
    const reihe = [0];                     // Filterbyte: 0 = keine Vorhersage
    for(let x = 0; x < groesse; x++){
      const c = FARBE[RASTER[Math.floor(y / skala)][Math.floor(x / skala)]];
      reihe.push(c[0], c[1], c[2], c[3]);
    }
    zeilen.push(Buffer.from(reihe));
  }
  return Buffer.concat(zeilen);
}

function png(groesse){
  const stueck = (typ, daten) => {
    const laenge = Buffer.alloc(4);
    laenge.writeUInt32BE(daten.length);
    const koerper = Buffer.concat([Buffer.from(typ, 'ascii'), daten]);
    const pruef = Buffer.alloc(4);
    pruef.writeUInt32BE(crc32(koerper) >>> 0);
    return Buffer.concat([laenge, koerper, pruef]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(groesse, 0);
  ihdr.writeUInt32BE(groesse, 4);
  ihdr[8] = 8;      // 8 Bit je Kanal
  ihdr[9] = 6;      // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    stueck('IHDR', ihdr),
    stueck('IDAT', zlib.deflateSync(pixel(groesse), {level: 9})),
    stueck('IEND', Buffer.alloc(0))
  ]);
}

// ---- ICO ------------------------------------------------------------------
//
// Seit Vista dürfen die Einträge PNG-Daten enthalten. Das erspart das alte
// BMP-Format mit seiner getrennten Transparenzmaske und den auf dem Kopf
// stehenden Zeilen.

function ico(groessen){
  const bilder = groessen.map(g => ({g, daten: png(g)}));
  const kopf = Buffer.alloc(6);
  kopf.writeUInt16LE(1, 2);                  // 1 = Icon (2 wäre ein Mauszeiger)
  kopf.writeUInt16LE(bilder.length, 4);

  let versatz = 6 + 16 * bilder.length;
  const eintraege = bilder.map(b => {
    const e = Buffer.alloc(16);
    e[0] = b.g >= 256 ? 0 : b.g;             // 0 steht für 256
    e[1] = e[0];
    e.writeUInt16LE(1, 4);                   // Farbebenen
    e.writeUInt16LE(32, 6);                  // Bit je Pixel
    e.writeUInt32LE(b.daten.length, 8);
    e.writeUInt32LE(versatz, 12);
    versatz += b.daten.length;
    return e;
  });
  return Buffer.concat([kopf, ...eintraege, ...bilder.map(b => b.daten)]);
}

// ---- schreiben und nachsehen ----------------------------------------------

// Das Raster zuerst, vor dem Erzeugen. Eine Zeile mit 15 statt 16 Zeichen oder
// ein Zeichen, das keine Farbe hat, lässt sonst mitten im Zeichnen einen
// Stapelauszug aus dem Bild fallen — und der sagt einem nicht, dass man sich
// oben im Raster vertippt hat.
const rasterFehler = [];
RASTER.forEach((z, i) => {
  if(z.length !== 16) rasterFehler.push('Zeile ' + (i + 1) + ' hat ' + z.length + ' statt 16 Zeichen');
  const unbekannt = [...new Set([...z].filter(c => !(c in FARBE)))];
  if(unbekannt.length) rasterFehler.push('Zeile ' + (i + 1) + ': unbekanntes Zeichen ' + unbekannt.join(' '));
});
if(rasterFehler.length){
  for(const f of rasterFehler) console.log('FEHLER  ' + f);
  console.log('Erlaubt sind: ' + Object.keys(FARBE).join(' '));
  process.exit(1);
}

fs.mkdirSync(ZIEL, {recursive: true});
const pngPfad = path.join(ZIEL, 'icon.png');
const icoPfad = path.join(ZIEL, 'icon.ico');
fs.writeFileSync(pngPfad, png(512));
fs.writeFileSync(icoPfad, ico(GROESSEN));

console.log('build/icon.png  ' + fs.statSync(pngPfad).size + ' Bytes (512x512)');
console.log('build/icon.ico  ' + fs.statSync(icoPfad).size + ' Bytes');

// Selbstprüfung: Ein kaputtes Icon fällt sonst erst auf, wenn die fertige .exe
// in der Taskleiste ein weisses Blatt zeigt — und dann sucht man es im
// Bauwerkzeug statt hier.
let fehler = 0;

const b = fs.readFileSync(icoPfad);
const anzahl = b.readUInt16LE(4);
if(b.readUInt16LE(2) !== 1){ console.log('FEHLER  keine gültige ICO-Kennung'); fehler++; }
if(anzahl !== GROESSEN.length){ console.log('FEHLER  ' + anzahl + ' statt ' + GROESSEN.length + ' Bilder'); fehler++; }

const PNG_KOPF = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
for(let i = 0; i < anzahl; i++){
  const o = 6 + 16 * i;
  const g = b[o] === 0 ? 256 : b[o];
  const laenge = b.readUInt32LE(o + 8);
  const start = b.readUInt32LE(o + 12);
  const ok = start + laenge <= b.length && b.slice(start, start + 8).equals(PNG_KOPF);
  if(!ok){ console.log('FEHLER  Eintrag ' + g + 'px ist unbrauchbar'); fehler++; }
}

console.log(fehler ? fehler + ' Fehler' : GROESSEN.join(', ') + ' Pixel — alle in Ordnung');
process.exit(fehler ? 1 : 0);
