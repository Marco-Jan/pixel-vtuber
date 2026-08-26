// Erzeugt sprites/demo-figur.glb — die 3D-Testfigur.
//
//   node tools/make-demo-model.js
//
// Dieselbe Überlegung wie bei den Sprites und der Sprachdatei: Was zum Prüfen da
// ist, wird gebaut und nicht von Hand gepflegt. Und es prüft sich selbst — eine
// Testfigur, die nicht das enthält, was sie verspricht, ist schlimmer als keine,
// weil man den Fehler dann im Renderer sucht.
//
// Sie ist bewusst hässlich. Sie soll nicht schön aussehen, sondern beweisen, dass
// die Kette steht: Mund auf, Augen zu, Pose wechseln. Ein Blender-Charakter kommt
// später an dieselbe Stelle.

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'sprites', 'demo-figur.glb');

// ---- Geometrie --------------------------------------------------------------
//
// Alles in *einem* Netz mit Eckpunktfarben statt mehrerer Netze mit eigenen
// Materialien. Grund: Morph Targets werden je Teilnetz angelegt, ihre Stärke gilt
// aber für das ganze Netz — bei mehreren Teilnetzen müsste jedes dieselbe Anzahl
// Targets tragen, auch die, die sich gar nicht verformen.

const pos = [], nrm = [], col = [], idx = [];

function box(cx, cy, cz, w, h, d, color){
  const x = w/2, y = h/2, z = d/2;
  const faces = [
    // [Normale, vier Ecken gegen den Uhrzeigersinn]
    [[0,0,1],  [[-x,-y,z],[x,-y,z],[x,y,z],[-x,y,z]]],
    [[0,0,-1], [[x,-y,-z],[-x,-y,-z],[-x,y,-z],[x,y,-z]]],
    [[1,0,0],  [[x,-y,z],[x,-y,-z],[x,y,-z],[x,y,z]]],
    [[-1,0,0], [[-x,-y,-z],[-x,-y,z],[-x,y,z],[-x,y,-z]]],
    [[0,1,0],  [[-x,y,z],[x,y,z],[x,y,-z],[-x,y,-z]]],
    [[0,-1,0], [[-x,-y,-z],[x,-y,-z],[x,-y,z],[-x,-y,z]]]
  ];
  const start = pos.length / 3;
  for(const [n, corners] of faces){
    const base = pos.length / 3;
    for(const [px, py, pz] of corners){
      pos.push(cx + px, cy + py, cz + pz);
      nrm.push(...n);
      col.push(...color, 1);
    }
    idx.push(base, base+1, base+2, base, base+2, base+3);
  }
  return {from: start, to: pos.length / 3};   // Eckpunktbereich dieses Kastens
}

const SKIN  = [0.94, 0.78, 0.63];
const HAIR  = [0.35, 0.22, 0.15];
const DARK  = [0.10, 0.10, 0.12];
const SHIRT = [0.29, 0.34, 0.55];

const head  = box(0,  1.55, 0,    0.90, 1.05, 0.80, SKIN);
const hair  = box(0,  2.02, 0,    0.94, 0.30, 0.84, HAIR);
const eyeL  = box(-0.20, 1.68, 0.41, 0.16, 0.16, 0.04, DARK);
const eyeR  = box( 0.20, 1.68, 0.41, 0.16, 0.16, 0.04, DARK);
const mouth = box(0,  1.30, 0.41, 0.28, 0.06, 0.04, DARK);
const neck  = box(0,  0.98, 0,    0.26, 0.24, 0.26, SKIN);
const body  = box(0,  0.42, 0,    0.90, 0.90, 0.55, SHIRT);

// ---- Morph Targets ----------------------------------------------------------
//
// Als Verschiebung je Eckpunkt gegenüber der Grundstellung — so schreibt glTF
// sie vor. Die Namen sind die, die im Panel voreingestellt stehen; ein
// Blender-Charakter bringt eigene mit und wird dort zugeordnet.

const zero = () => new Array(pos.length).fill(0);

// „mundOffen": Der Mundkasten wird nach unten aufgezogen. Nur die untere Hälfte
// bewegt sich, sonst wandert der ganze Mund nach unten statt aufzugehen.
const mundOffen = zero();
for(let v = mouth.from; v < mouth.to; v++){
  if(pos[v*3+1] < 1.30) mundOffen[v*3+1] -= 0.16;
}

// „augenZu": Beide Augen werden flachgedrückt — obere Kante runter, untere hoch.
const augenZu = zero();
for(const eye of [eyeL, eyeR]){
  for(let v = eye.from; v < eye.to; v++){
    const y = pos[v*3+1];
    augenZu[v*3+1] += (y > 1.68 ? -0.07 : 0.07);
  }
}

// ---- Puffer bauen -----------------------------------------------------------

const chunks = [];         // {name, data:Buffer, target?}
let offset = 0;
function put(name, arr, ctor){
  const data = Buffer.from(new ctor(arr).buffer);
  // glTF verlangt 4-Byte-Ausrichtung für Accessoren.
  while(offset % 4) { chunks.push({data: Buffer.alloc(1)}); offset++; }
  const at = offset;
  chunks.push({name, data});
  offset += data.length;
  return {at, len: data.length};
}

const minmax = arr => {
  const mn = [Infinity,Infinity,Infinity], mx = [-Infinity,-Infinity,-Infinity];
  for(let i = 0; i < arr.length; i += 3){
    for(let k = 0; k < 3; k++){
      mn[k] = Math.min(mn[k], arr[i+k]);
      mx[k] = Math.max(mx[k], arr[i+k]);
    }
  }
  return {mn, mx};
};

const vPos  = put('pos',  pos,  Float32Array);
const vNrm  = put('nrm',  nrm,  Float32Array);
const vCol  = put('col',  col,  Float32Array);
const vIdx  = put('idx',  idx,  Uint16Array);
const vM0   = put('m0',   mundOffen, Float32Array);
const vM1   = put('m1',   augenZu,   Float32Array);

// Animationen: zwei Clips auf dem Wurzelknoten. Ohne Skelett, weil ein Skelett
// hier nichts beweist, was eine Knotenanimation nicht auch beweist — und der
// Treiber ruft ohnehin nur Clips beim Namen.
const tRuhe = [0, 1.5, 3];
const ruheY = [0, 0, 0,  0, 0.045, 0,  0, 0, 0];             // leichtes Wippen
const tWink = [0, 0.25, 0.5, 0.75, 1];
const winkQ = [];                                            // Kippen um Z
for(const a of [0, 0.16, 0, -0.16, 0]){
  winkQ.push(0, 0, Math.sin(a/2), Math.cos(a/2));
}

const vTR = put('tr', tRuhe, Float32Array);
const vVR = put('vr', ruheY, Float32Array);
const vTW = put('tw', tWink, Float32Array);
const vVW = put('vw', winkQ, Float32Array);

const bin = Buffer.concat(chunks.map(c => c.data));

// ---- glTF-Gerüst ------------------------------------------------------------

const pmm = minmax(pos);
const acc = [];
const view = [];
const addView = (v, target) => {
  view.push(Object.assign({buffer: 0, byteOffset: v.at, byteLength: v.len},
                          target ? {target} : {}));
  return view.length - 1;
};
const addAcc = (v, type, comp, count, extra, target) => {
  acc.push(Object.assign({bufferView: addView(v, target), componentType: comp,
                          count, type}, extra || {}));
  return acc.length - 1;
};

const F = 5126, US = 5123;
const aPos = addAcc(vPos, 'VEC3', F, pos.length/3, {min: pmm.mn, max: pmm.mx}, 34962);
const aNrm = addAcc(vNrm, 'VEC3', F, nrm.length/3, null, 34962);
const aCol = addAcc(vCol, 'VEC4', F, col.length/4, null, 34962);
const aIdx = addAcc(vIdx, 'SCALAR', US, idx.length, null, 34963);
const mm0 = minmax(mundOffen), mm1 = minmax(augenZu);
const aM0 = addAcc(vM0, 'VEC3', F, pos.length/3, {min: mm0.mn, max: mm0.mx}, 34962);
const aM1 = addAcc(vM1, 'VEC3', F, pos.length/3, {min: mm1.mn, max: mm1.mx}, 34962);

const aTR = addAcc(vTR, 'SCALAR', F, tRuhe.length, {min:[Math.min(...tRuhe)], max:[Math.max(...tRuhe)]});
const aVR = addAcc(vVR, 'VEC3',   F, ruheY.length/3);
const aTW = addAcc(vTW, 'SCALAR', F, tWink.length, {min:[Math.min(...tWink)], max:[Math.max(...tWink)]});
const aVW = addAcc(vVW, 'VEC4',   F, winkQ.length/4);

const gltf = {
  asset: {version: '2.0', generator: 'pixel-vtuber make-demo-model.js'},
  scene: 0,
  scenes: [{nodes: [0]}],
  nodes: [{name: 'Figur', mesh: 0}],
  meshes: [{
    name: 'Figur',
    primitives: [{
      attributes: {POSITION: aPos, NORMAL: aNrm, COLOR_0: aCol},
      indices: aIdx,
      material: 0,
      targets: [{POSITION: aM0}, {POSITION: aM1}]
    }],
    weights: [0, 0],
    // Woher three.js die Namen der Morph Targets liest.
    extras: {targetNames: ['mundOffen', 'augenZu']}
  }],
  materials: [{
    name: 'Figur',
    pbrMetallicRoughness: {baseColorFactor: [1,1,1,1], metallicFactor: 0, roughnessFactor: 0.9}
  }],
  animations: [
    {name: 'ruhe', samplers: [{input: aTR, output: aVR, interpolation: 'LINEAR'}],
     channels: [{sampler: 0, target: {node: 0, path: 'translation'}}]},
    {name: 'winken', samplers: [{input: aTW, output: aVW, interpolation: 'LINEAR'}],
     channels: [{sampler: 0, target: {node: 0, path: 'rotation'}}]}
  ],
  accessors: acc,
  bufferViews: view,
  buffers: [{byteLength: bin.length}]
};

// ---- GLB schreiben ----------------------------------------------------------

const pad = (buf, to, fill) => {
  const rest = buf.length % 4;
  if(!rest) return buf;
  return Buffer.concat([buf, Buffer.alloc(4 - rest, fill)]);
};

const jsonBuf = pad(Buffer.from(JSON.stringify(gltf), 'utf8'), 4, 0x20);  // Leerzeichen
const binBuf  = pad(bin, 4, 0);

const header = Buffer.alloc(12);
header.write('glTF', 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);

const chunkHead = (len, type) => {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(len, 0);
  b.write(type, 4);
  return b;
};

fs.writeFileSync(OUT, Buffer.concat([
  header,
  chunkHead(jsonBuf.length, 'JSON'), jsonBuf,
  chunkHead(binBuf.length, 'BIN\0'), binBuf
]));

// ---- nachrechnen ------------------------------------------------------------

const size = fs.statSync(OUT).size;
console.log(`${OUT}  (${(size/1024).toFixed(1)} kB)\n`);
console.log(`  Eckpunkte     ${pos.length/3}`);
console.log(`  Dreiecke      ${idx.length/3}`);
console.log(`  Morph Targets ${gltf.meshes[0].extras.targetNames.join(', ')}`);
console.log(`  Animationen   ${gltf.animations.map(a => a.name).join(', ')}\n`);

const checks = [
  ['die Datei beginnt mit der glTF-Kennung',
   fs.readFileSync(OUT).toString('ascii', 0, 4) === 'glTF'],
  ['die im Kopf vermerkte Länge stimmt mit der Datei überein',
   fs.readFileSync(OUT).readUInt32LE(8) === size],
  ['„mundOffen" verschiebt tatsächlich Eckpunkte',
   mundOffen.some(v => v !== 0)],
  ['„augenZu" verschiebt tatsächlich Eckpunkte',
   augenZu.some(v => v !== 0)],
  ['„mundOffen" rührt nur den Mund an, nicht das ganze Gesicht',
   mundOffen.every((v, i) => v === 0 || (Math.floor(i/3) >= mouth.from && Math.floor(i/3) < mouth.to))],
  ['„augenZu" rührt nur die Augen an',
   augenZu.every((v, i) => v === 0 || [eyeL, eyeR].some(e => {
     const p = Math.floor(i/3); return p >= e.from && p < e.to; }))],
  ['jeder Index zeigt auf einen vorhandenen Eckpunkt',
   idx.every(i => i >= 0 && i < pos.length/3)],
  ['alle Puffersichten liegen innerhalb des Puffers',
   view.every(v => v.byteOffset + v.byteLength <= bin.length)]
];

let ok = true;
for(const [label, pass] of checks){
  console.log(`  ${pass ? 'ok  ' : 'FEHL'}  ${label}`);
  if(!pass) ok = false;
}
process.exit(ok ? 0 : 1);
