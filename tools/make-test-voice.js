// Erzeugt tools/test-voice.wav — eine Testdatei für die Sprachausgabe des Avatars.
//
//   node tools/make-test-voice.js
//
// Eine beliebige MP3 täte es auch, aber sie sagt einem nichts: Bleibt der Mund zu,
// weiß man nicht, ob die Verstärkung zu niedrig steht, die Schwelle zu hoch liegt
// oder der Ton gar nicht erst am Analysator ankommt. Diese Datei ist deshalb so
// gebaut, dass jeder Abschnitt genau eine Sache prüft — und man an der Stelle, an
// der es hakt, gleich weiß, welcher Regler gemeint ist:
//
//   1. leise Silben    -> Schwelle offen: der Mund muss halb aufgehen
//   2. laute Silben    -> Schwelle weit:  der Mund muss weit aufgehen
//   3. gezogener Ton   -> Erkennung gezogener Töne: der Mund bleibt offen stehen,
//                         statt zu klappern, und der Pegelbalken färbt sich gelb
//   4. leise Silben    -> zurück auf halb, damit man den Unterschied direkt sieht
//
// Gesprochen wird nichts — es ist ein Summen mit Silbenhüllkurve. Für die
// Lippensynchronisation ist das kein Unterschied: Sie misst ausschließlich den
// Pegelverlauf und hat von Sprache ohnehin keinen Begriff.

const fs = require('fs');
const path = require('path');

const RATE = 22050;
const OUT  = path.join(__dirname, 'test-voice.wav');

// Vokale unterscheiden sich in den Formanten — den Frequenzbereichen, die der
// Mundraum anhebt. Der Wechsel zwischen ihnen macht aus einem gleichförmigen
// Summen etwas, das nach Silben klingt statt nach Morsezeichen.
const VOWELS = [
  {f: [ 700, 1220], name:'a'},
  {f: [ 400, 2000], name:'e'},
  {f: [ 280, 2250], name:'i'},
  {f: [ 450,  800], name:'o'},
  {f: [ 320,  800], name:'u'}
];

const F0 = 115;            // Grundton, tiefe Sprechstimme
const HARMONICS = 26;

// Wie stark eine Frequenz von den Formanten angehoben wird. Zwei Resonanzen als
// Glockenkurven, je 120 Hz breit.
function formantGain(freq, formants){
  let g = 0;
  for(const F of formants) g += 1 / (1 + Math.pow((freq - F) / 120, 2));
  return g;
}

// Ein Sample des Summens: Oberwellen des Grundtons, gewichtet nach Formanten.
// Die 1/n-Dämpfung entspricht grob dem Spektrum einer Stimme; ohne sie klingt es
// nach Rechteckgenerator.
function voice(t, formants){
  let s = 0;
  for(let n = 1; n <= HARMONICS; n++){
    const freq = n * F0;
    if(freq > RATE / 2) break;              // über Nyquist gibt es nur Aliasing
    s += (formantGain(freq, formants) / n) * Math.sin(2 * Math.PI * freq * t);
  }
  return s;
}

// Weiche Flanken, sonst knackt es an jedem Silbenrand — und ein Knacks ist ein
// Pegelsprung, den die Silbenerkennung als eigene Silbe lesen würde.
function envelope(pos, dur, attack, release){
  if(pos < attack)         return 0.5 - 0.5 * Math.cos(Math.PI * pos / attack);
  if(pos > dur - release)  return 0.5 - 0.5 * Math.cos(Math.PI * (dur - pos) / release);
  return 1;
}

const samples = [];
const marks = [];          // Abschnittsgrenzen für die Selbstprüfung unten

const silence = sec => { for(let i = 0; i < Math.round(sec * RATE); i++) samples.push(0); };

function syllables(count, amp, rate){
  const dur = 1 / rate * 0.58, gap = 1 / rate * 0.42;
  for(let i = 0; i < count; i++){
    const vowel = VOWELS[i % VOWELS.length];
    const n = Math.round(dur * RATE);
    for(let j = 0; j < n; j++){
      const t = j / RATE;
      samples.push(amp * envelope(t, dur, 0.025, 0.045) * voice(t, vowel.f));
    }
    silence(gap);
  }
}

// Ein gehaltener Vokal: gleiche Lautstärke, nur mit leichtem Vibrato in der
// Tonhöhe. Genau darauf zielt die Erkennung — nicht auf die Höhe des Pegels,
// sondern auf seine Ruhe. Am Pegel darf sich also fast nichts tun.
function sustained(sec, amp){
  const n = Math.round(sec * RATE);
  for(let j = 0; j < n; j++){
    const t = j / RATE;
    const vib = 1 + 0.012 * Math.sin(2 * Math.PI * 5.2 * t);
    samples.push(amp * envelope(t, sec, 0.06, 0.12) * voice(t * vib, VOWELS[0].f));
  }
}

const section = (label, fn) => {
  const from = samples.length;
  fn();
  marks.push({label, from, to: samples.length});
};

silence(0.3);
section('leise Silben',  () => syllables(5, 0.30, 4.2));
silence(0.5);
section('laute Silben',  () => syllables(3, 0.85, 4.2));
silence(0.5);
section('gezogen',       () => sustained(1.6, 0.50));
silence(0.6);
section('leise Silben 2', () => syllables(6, 0.30, 4.2));
silence(0.4);

// ---- schreiben --------------------------------------------------------------

const data = Buffer.alloc(samples.length * 2);
samples.forEach((s, i) => {
  const clipped = Math.max(-1, Math.min(1, s));
  data.writeInt16LE(Math.round(clipped * 32767), i * 2);
});

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);          // Länge des fmt-Blocks
header.writeUInt16LE(1, 20);           // PCM, unkomprimiert
header.writeUInt16LE(1, 22);           // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);    // Bytes pro Sekunde
header.writeUInt16LE(2, 32);           // Bytes pro Rahmen
header.writeUInt16LE(16, 34);          // Bits pro Sample
header.write('data', 36);
header.writeUInt32LE(data.length, 40);

fs.writeFileSync(OUT, Buffer.concat([header, data]));

// ---- nachrechnen ------------------------------------------------------------
//
// Dieselbe Messung, die die App im Betrieb macht: RMS über ein Fenster von 1024
// Samples, daraus Mittel und Unruhe. Eine Testdatei, die nicht das enthält, was
// sie verspricht, wäre schlimmer als gar keine — man suchte den Fehler dann in
// der App.

function measure(from, to){
  const win = 1024, frames = [];
  for(let i = from; i + win <= to; i += win){
    let sq = 0;
    for(let j = 0; j < win; j++) sq += samples[i+j] * samples[i+j];
    frames.push(Math.sqrt(sq / win));
  }
  const avg = frames.reduce((a,b) => a+b, 0) / frames.length;
  const flux = frames.reduce((a,b) => a + Math.abs(b - avg), 0) / frames.length;
  return {avg, flux: flux / avg};      // relativ, wie in updateSustain()
}

const m = {};
for(const s of marks) m[s.label] = measure(s.from, s.to);

console.log(`${OUT}  (${(samples.length/RATE).toFixed(1)} s)\n`);
for(const s of marks){
  const r = m[s.label];
  console.log(`  ${s.label.padEnd(16)} Pegel ${r.avg.toFixed(3)}   Unruhe ${(r.flux*100).toFixed(0)} %`);
}

const checks = [
  ['laute Silben liegen deutlich über den leisen',
   m['laute Silben'].avg > m['leise Silben'].avg * 1.8],
  ['der gezogene Ton liegt ruhiger als gesprochene Silben',
   m['gezogen'].flux < m['leise Silben'].flux * 0.4],
  ['der gezogene Ton ist laut genug, um überhaupt als Reden zu gelten',
   m['gezogen'].avg > m['leise Silben'].avg]
];

let ok = true;
console.log('');
for(const [label, pass] of checks){
  console.log(`  ${pass ? 'ok  ' : 'FEHL'}  ${label}`);
  if(!pass) ok = false;
}
process.exit(ok ? 0 : 1);
