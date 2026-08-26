// Erzeugt die mitgelieferte Testfigur als PNG-Sprites.
//
//   node tools/make-demo-sprites.js
//
// Warum generiert statt gezeichnet: Die Regionen-Technik der App verlangt, dass
// alle Sprites bis auf Augen, Mund und Arme pixelgleich sind — sonst springt die
// Figur beim Blinzeln. Aus einer Funktion mit Schaltern fällt das gratis ab.
// Ausserdem liegen Augen und Mund so garantiert in den Standard-Kalibrierungs-
// boxen aus renderer/app.js (DEFAULT_CALIB), womit die Figur ohne Kalibrieren
// sofort richtig sitzt.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const W = 842, H = 1264;      // dieselbe Rahmung wie die echten Sprites
const PX = 14;                // Kantenlänge eines "Pixels" der Pixelart

// Muss zu DEFAULT_CALIB in renderer/app.js passen.
const EYE_BOX   = {x:0.328, y:0.206, w:0.240, h:0.122};
const MOUTH_BOX = {x:0.376, y:0.327, w:0.284, h:0.167};

const C = {
  skin:      [244, 196, 148, 255],
  skinShade: [214, 160, 112, 255],
  hair:      [ 74,  52,  38, 255],
  shirt:     [ 58,  74, 122, 255],
  shirtDark: [ 44,  56,  94, 255],
  eyeWhite:  [250, 250, 250, 255],
  pupil:     [ 30,  32,  40, 255],
  mouthIn:   [122,  52,  56, 255],
  tongue:    [206, 104, 108, 255],
  line:      [ 32,  28,  34, 255],
  heart:     [214,  62,  84, 255]
};

function canvas(){
  return { data: Buffer.alloc(W * H * 4, 0) };
}

// Alles zeichnet auf dem PX-Raster, damit die Kanten wirklich pixelig sind.
function block(cv, bx, by, bw, bh, col){
  const x0 = Math.max(0, bx * PX), y0 = Math.max(0, by * PX);
  const x1 = Math.min(W, (bx + bw) * PX), y1 = Math.min(H, (by + bh) * PX);
  for(let y = y0; y < y1; y++){
    let i = (y * W + x0) * 4;
    for(let x = x0; x < x1; x++, i += 4){
      cv.data[i] = col[0]; cv.data[i+1] = col[1]; cv.data[i+2] = col[2]; cv.data[i+3] = col[3];
    }
  }
}

// Ellipse auf dem Blockraster — ergibt die typischen Treppenkanten.
function blob(cv, cx, cy, rx, ry, col){
  for(let by = Math.floor(cy - ry); by <= Math.ceil(cy + ry); by++){
    for(let bx = Math.floor(cx - rx); bx <= Math.ceil(cx + rx); bx++){
      const dx = (bx + 0.5 - cx) / rx, dy = (by + 0.5 - cy) / ry;
      if(dx*dx + dy*dy <= 1) block(cv, bx, by, 1, 1, col);
    }
  }
}

const bw = Math.floor(W / PX), bh = Math.floor(H / PX);   // 60 x 90 Blöcke
const bx = f => Math.round(f * bw), by = f => Math.round(f * bh);

// ---------------------------------------------------------------------------
// Die Figur. eyes: 'open' | 'closed'   mouth: 0 | 1 | 2   arms: 'crossed' | 'open'
// ---------------------------------------------------------------------------
// Augen und Mund werden aus den Boxen abgeleitet, nicht aus der Bildmitte: die
// beiden Boxen sind gegeneinander versetzt (das Gesicht der echten Sprites ist
// leicht gedreht), und was ausserhalb der Box liegt, würde beim Blinzeln oder
// Sprechen als Rand stehenbleiben.
const eyeCX  = (EYE_BOX.x   + EYE_BOX.w / 2)   * bw;
const eyeCY  = (EYE_BOX.y   + EYE_BOX.h / 2)   * bh;
const mouthCX = (MOUTH_BOX.x + MOUTH_BOX.w / 2) * bw;
const mouthCY = (MOUTH_BOX.y + MOUTH_BOX.h * 0.5) * bh;
const faceCX = (eyeCX + mouthCX) / 2;

function draw(eyes, mouth, arms){
  const cv = canvas();

  // Reihenfolge zählt: Hals zuerst, danach deckt ihn das Shirt ab; der Kopf
  // kommt darüber, damit Kinn und Hals ohne Lücke ineinander übergehen.
  block(cv, Math.round(faceCX - 4), by(0.46), 8, by(0.24), C.skinShade);

  // --- Körper: Schultern und Rumpf, unten aus dem Bild laufend
  blob(cv, faceCX - 11, by(0.66), 9, 5, C.shirt);                    // linke Schulter
  blob(cv, faceCX + 11, by(0.66), 9, 5, C.shirt);                    // rechte Schulter
  block(cv, Math.round(faceCX - 19), by(0.66), 38, by(0.36), C.shirt);
  block(cv, Math.round(faceCX - 19), by(0.66), 38, 2, C.shirtDark);  // Schulterkante

  // --- Kopf
  blob(cv, faceCX, by(0.32), 15, 18, C.skin);
  blob(cv, faceCX - 15, by(0.34), 2, 4, C.skinShade);                // Ohren
  blob(cv, faceCX + 15, by(0.34), 2, 4, C.skinShade);
  // Haar endet oberhalb der Augenbox, sonst hängt es den Augen ins Bild
  blob(cv, faceCX, by(0.165), 15, 7, C.hair);
  block(cv, Math.round(faceCX - 14), by(0.125), 28, by(0.05), C.hair);

  // --- Augen: bleiben komplett in EYE_BOX
  // 'wink' schliesst nur das rechte Auge (aus Sicht des Betrachters), damit die
  // Figur zwinkert statt zu blinzeln.
  const eyeDX = 3.4, eyeRX = 2.6, eyeRY = 2;
  for(const s of [-1, 1]){
    const cx = eyeCX + s * eyeDX;
    const shut = eyes === 'closed' || (eyes === 'wink' && s === 1);
    if(shut){
      block(cv, Math.round(cx - eyeRX), Math.round(eyeCY), Math.round(eyeRX * 2), 1, C.line);
    }else{
      blob(cv, cx, eyeCY, eyeRX, eyeRY, C.eyeWhite);
      blob(cv, cx, eyeCY, 1.4, 1.4, C.pupil);
    }
  }

  // --- Mund: bleibt komplett in MOUTH_BOX
  if(mouth === 0){
    block(cv, Math.round(mouthCX - 4), Math.round(mouthCY), 8, 1, C.line);
  }else if(mouth === 1){
    blob(cv, mouthCX, mouthCY, 4, 2.6, C.mouthIn);
    blob(cv, mouthCX, mouthCY + 1, 2.4, 1, C.tongue);
  }else{
    blob(cv, mouthCX, mouthCY, 5, 4.6, C.mouthIn);
    blob(cv, mouthCX, mouthCY + 1.6, 3, 2, C.tongue);
  }

  // --- Arme
  if(arms === 'crossed'){
    block(cv, Math.round(faceCX - 20), by(0.80), 40, 5, C.skin);
    block(cv, Math.round(faceCX - 20), by(0.80), 40, 1, C.skinShade);
    blob(cv, faceCX - 20, by(0.815), 4, 3, C.skin);
    blob(cv, faceCX + 20, by(0.815), 4, 3, C.skin);
  }else if(arms === 'open'){
    // Offene Geste: Arme nach aussen-unten. Die Hände müssen im Bild bleiben,
    // sonst sieht die Pose aus wie ein Beschnittfehler.
    for(const s of [-1, 1]){
      for(let k = 0; k < 8; k++){
        block(cv, Math.round(faceCX + s * (15 + k) - 1), by(0.72) + k, 3, 3, C.skin);
      }
      blob(cv, faceCX + s * 21, by(0.72) + 10, 4, 4, C.skin);
    }
  }else if(arms === 'wave'){
    // Winken: rechter Arm erhoben neben dem Kopf, linker bleibt unten am Körper
    for(let k = 0; k < 9; k++){
      block(cv, Math.round(faceCX + 15 + k * 0.5), by(0.70) - k, 3, 3, C.skin);
    }
    blob(cv, faceCX + 20, by(0.70) - 10, 5, 5, C.skin);              // winkende Hand
    for(let k = 0; k < 3; k++){                                        // gespreizte Finger
      block(cv, Math.round(faceCX + 18 + k * 2), by(0.70) - 15, 2, 3, C.skin);
    }
    for(let k = 0; k < 7; k++){
      block(cv, Math.round(faceCX - 15 - k * 0.5), by(0.72) + k, 3, 3, C.skin);
    }
    blob(cv, faceCX - 19, by(0.72) + 8, 4, 4, C.skin);
  }else{
    // Herz: beide Unterarme nach innen-oben, die Hände treffen sich unter dem
    // Kinn und bilden dort die Herzform.
    for(const s of [-1, 1]){
      for(let k = 0; k < 8; k++){
        block(cv, Math.round(faceCX + s * (16 - k * 1.2)), by(0.78) - k, 3, 3, C.skin);
      }
    }
    const hy = by(0.70);
    blob(cv, faceCX - 3, hy, 3.4, 3.4, C.heart);                       // linke Herzhälfte
    blob(cv, faceCX + 3, hy, 3.4, 3.4, C.heart);
    for(let k = 0; k < 7; k++){                                        // Spitze nach unten
      block(cv, Math.round(faceCX - 3.5 + k * 0.5), hy + 2 + k, Math.max(1, 7 - k), 1, C.heart);
    }
    blob(cv, faceCX - 6, hy + 1, 2, 3, C.skin);                        // Hände am Herz
    blob(cv, faceCX + 6, hy + 1, 2, 3, C.skin);
  }

  return cv;
}

// ---------------------------------------------------------------------------
// Minimaler PNG-Writer (RGBA, 8 bit) — reicht für Flächen ohne Zwischentöne.
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for(let n = 0; n < 256; n++){
    let c = n;
    for(let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf){
  let c = -1;
  for(let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data){
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function toPng(cv){
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // RGBA
  // 10..12 = compression, filter, interlace = 0

  const raw = Buffer.alloc(H * (W * 4 + 1));
  for(let y = 0; y < H; y++){
    raw[y * (W * 4 + 1)] = 0;   // Filter "none"
    cv.data.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, {level: 9})),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------------------------------------------------------------------------

const OUT = path.join(__dirname, '..', 'sprites');
const FILES = [
  ['demo_open.png',       'open',   1, 'crossed'],  // Basis + Augen offen + Mund offen
  ['demo_close.png',      'closed', 0, 'crossed'],  // Augen zu + Mund zu
  ['demo_close_open.png', 'closed', 2, 'crossed'],  // Mund weit
  ['demo_wink.png',       'wink',   1, 'crossed'],  // Zwinkern: nur ein Auge zu
  ['demo_open_arms.png',  'open',   1, 'open'],     // Pose: gestikulierend
  ['demo_wave.png',       'open',   1, 'wave'],     // Geste: winken
  ['demo_heart.png',      'open',   1, 'heart']     // Geste: Herz mit den Händen
];

fs.mkdirSync(OUT, {recursive: true});
const drawn = {};
for(const [name, eyes, mouth, arms] of FILES){
  const cv = draw(eyes, mouth, arms);
  drawn[name] = cv;
  const png = toPng(cv);
  fs.writeFileSync(path.join(OUT, name), png);
  console.log(name.padEnd(22), (png.length / 1024).toFixed(1) + ' KB');
}

// --- Selbsttest ------------------------------------------------------------
// Die App tauscht nur Augen- und Mundregion aus. Weicht ein Sprite ausserhalb
// seiner Box ab, bleibt beim Blinzeln oder Sprechen ein Rand stehen — und man
// sieht es erst im Betrieb. Also hier nachrechnen.
function boxPx(b){
  return {x0: Math.floor(b.x * W), y0: Math.floor(b.y * H),
          x1: Math.ceil((b.x + b.w) * W), y1: Math.ceil((b.y + b.h) * H)};
}

function diff(a, b, box){
  const r = boxPx(box);
  let inside = 0, outside = 0;
  for(let y = 0; y < H; y++){
    for(let x = 0; x < W; x++){
      const i = (y * W + x) * 4;
      if(a.data.readUInt32BE(i) === b.data.readUInt32BE(i)) continue;
      if(x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) inside++;
      else outside++;
    }
  }
  return {inside, outside};
}

// Verglichen werden Varianten, die sich in genau einem Merkmal unterscheiden —
// zwei fertige Dateien unterscheiden sich in Augen *und* Mund und taugen nicht
// als Prüfung.
let bad = 0;
const checks = [
  ['Augen zu',    draw('open', 1, 'crossed'), draw('closed', 1, 'crossed'), EYE_BOX],
  ['Zwinkern',    draw('open', 1, 'crossed'), draw('wink',   1, 'crossed'), EYE_BOX],
  ['Mund offen',  draw('open', 0, 'crossed'), draw('open',   1, 'crossed'), MOUTH_BOX],
  ['Mund weit',   draw('open', 0, 'crossed'), draw('open',   2, 'crossed'), MOUTH_BOX]
];
console.log('');
for(const [label, a, b, box] of checks){
  const d = diff(a, b, box);
  const ok = d.outside === 0;
  if(!ok) bad++;
  console.log(label.padEnd(14), d.inside + ' Pixel in der Box, ' + d.outside +
              ' ausserhalb  ' + (ok ? 'OK' : 'FEHLER — Rand bleibt stehen'));
}
process.exit(bad ? 1 : 0);
