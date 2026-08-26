// 3D-Figuren.
//
// Bewusst getrennt von app.js: Dies ist die einzige Datei, die three.js kennt,
// und die einzige, die gebündelt werden muss. app.js bleibt eine klassische
// Datei ohne Bauschritt — wer nur an Sprites, Chat oder Sprachausgabe arbeitet,
// muss nichts bauen.
//
// Nach außen wird eine schmale Schnittstelle gereicht (window.vtuber3d). Der
// Treiber in app.js kennt weiterhin nur `mouthLevel` und `eyesState`; was hier
// daraus wird — ein Morph Target, ein Knochen, später vielleicht etwas anderes —
// geht ihn nichts an. Genau diese Trennung macht 2D und 3D austauschbar.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Ein gemeinsamer WebGL-Renderer für alle 3D-Figuren. Einer je Figur wäre je ein
// eigener GPU-Kontext, und Browser geben davon nur eine Handvoll her.
let renderer = null;
let loader = null;
let texLoader = null;

// Augenzustände, die aus der Textur kommen statt aus dem Netz. Die Namen laufen
// durch dieselbe Liste wie echte Shape Keys, tauchen also im Panel-Dropdown auf
// und lassen sich dort als Augen-Key wählen — der Treiber merkt keinen
// Unterschied. Siehe zeigeAugen().
//
// Die Reihenfolge ist Vorrang: Sind beide gesetzt, gewinnt das geschlossene
// Auge. Sonst hinge das Bild davon ab, in welcher Reihenfolge app.js seine
// beiden setMorph-Aufrufe absetzt.
const AUGEN_TEXTUREN = [
  {name: 'augenZu (Textur)',  endung: '-blinzel.png'},
  {name: 'zwinkern (Textur)', endung: '-zwinkern.png'},
];

function ensureRenderer(){
  if(renderer) return renderer;
  renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
  renderer.setClearAlpha(0);
  // Das Bild wird nachher in den 2D-Canvas kopiert, deshalb kein eigenes
  // Element im Dokument — die Figuren sollen sich mit den Sprites in *einer*
  // Fläche stapeln können, sonst ließe sich die Ebene nicht durchhalten.
  loader = new GLTFLoader();
  texLoader = new THREE.TextureLoader();
  return renderer;
}

// Neben `foo.glb` dürfen `foo-blinzel.png` und `foo-zwinkern.png` liegen:
// dieselbe Textur, nur mit geschlossenen Lidern. Fehlt eine, bleibt der
// zugehörige Zustand einfach aus — deshalb ein stilles `null` je Datei statt
// einer Ausnahme, die das ganze Modell mitrisse.
// Andere Texturen auf dasselbe Modell legen.
//
// Neben `foo.glb` darf `foo.texturen.json` liegen — eine Zuordnung von
// Materialname auf Bilddatei im selben Ordner:
//
//   { "N00_000_00_Face_00_SKIN": "mein-gesicht.png" }
//
// Was nicht darin steht, bleibt wie im Modell; fehlt die Datei, ändert sich
// nichts. Ein VRoid-Charakter bringt fünfzehn getrennte Materialien mit (Haut,
// Gesicht, Augen, Haare, Oberteil, Hose …), deshalb je Material eine Datei und
// nicht eine fürs Ganze: So lässt sich die Kleidung tauschen, ohne die Augen
// mitzunehmen.
async function ladeTexturen(url){
  const karteUrl = url.replace(/\.glb$/i, '.texturen.json');
  if(karteUrl === url) return null;

  let karte;
  try{
    const antwort = await fetch(karteUrl);
    if(!antwort.ok) return null;
    karte = await antwort.json();
  }catch(e){
    return null;                     // keine Karte da, oder unlesbar — beides still
  }
  if(!karte || typeof karte !== 'object') return null;

  const ordner = url.replace(/[^/]*$/, '');
  const gefunden = new Map();
  await Promise.all(Object.entries(karte).map(([material, datei]) => new Promise(resolve => {
    if(typeof datei !== 'string' || !datei){ resolve(); return; }
    texLoader.load(ordner + encodeURIComponent(datei), t => {
      gefunden.set(material, t);
      resolve();
    }, undefined, () => {
      console.warn('[3D] Textur nicht ladbar:', datei, 'für Material', material);
      resolve();
    });
  })));
  return gefunden.size ? gefunden : null;
}

// Eine Textur ersetzen, ohne dass jemand Materialnamen kennen muss.
//
// Die Haupttextur ist die, an der die meisten Materialien hängen — beim
// VRoid-Charakter der Atlas (vierzehn von fünfzehn), beim Troll das einzige
// Material. Genau die tauscht das Panel-Feld. Für alles Feinere bleibt die
// Zuordnungsdatei.
async function setzeHauptTextur(model, url){
  const haupt = model.hauptTextur();
  if(!haupt) return;
  const neu = await new Promise(fertig => {
    texLoader.load(url, t => fertig(t), undefined, () => fertig(null));
  });
  if(!neu){
    console.warn('[3D] Textur nicht ladbar:', url);
    return;
  }
  const uebernehmen = t => {
    t.flipY = haupt.flipY;
    t.wrapS = haupt.wrapS;
    t.wrapT = haupt.wrapT;
    t.channel = haupt.channel;
    t.colorSpace = haupt.colorSpace;
    t.needsUpdate = true;
    return t;
  };
  const flick = ergaenzeAlpha(neu, haupt);
  const ziel = flick ? uebernehmen(new THREE.CanvasTexture(flick)) : uebernehmen(neu);
  for(const mat of model.materialien) if(mat.map === haupt) mat.map = ziel;
}

// Rettungsanker für den fehlenden Alphakanal.
//
// Die meisten Malprogramme werfen die Transparenz beim Speichern nach PNG
// wortlos weg. Am Modell fällt das sofort auf: Brauen, Lidstrich und
// Brillenglas sind reine Alpha-Flächen und werden zu Farbklötzen. Statt den
// Benutzer damit alleinzulassen, wird die Deckung aus der ersetzten Textur
// übernommen — die Bemalung bleibt seine, die Löcher kommen vom Modell.
//
// Gibt eine Leinwand zurück, wenn geflickt wurde, sonst null (dann ist
// entweder Alpha vorhanden oder die Pixel sind nicht lesbar).
function ergaenzeAlpha(neu, alt){
  try{
    const bild = neu.image, quelle = alt && alt.image;
    if(!bild || !quelle || !bild.width) return null;

    const c = document.createElement('canvas');
    c.width = bild.width; c.height = bild.height;
    const g = c.getContext('2d', {willReadFrequently: true});
    g.drawImage(bild, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height);
    for(let i = 3; i < d.data.length; i += 4){
      if(d.data[i] !== 255) return null;          // hat Alpha, alles gut
    }

    const c2 = document.createElement('canvas');
    c2.width = c.width; c2.height = c.height;
    const g2 = c2.getContext('2d', {willReadFrequently: true});
    // Auf die Größe der neuen Textur ziehen: Wer 2048 malt, wo das Modell 4096
    // mitbringt, soll trotzdem die richtigen Löcher bekommen.
    g2.drawImage(quelle, 0, 0, c.width, c.height);
    const q = g2.getImageData(0, 0, c.width, c.height);
    for(let i = 3; i < d.data.length; i += 4) d.data[i] = q.data[i];
    g.putImageData(d, 0, 0);
    console.info('[3D] Textur ohne Alphakanal — Deckung aus dem Modell übernommen.');
    return c;
  }catch(e){
    // Kann an den Zugriffsregeln für lokale Dateien scheitern. Dann lieber die
    // Textur unverändert nehmen als das Modell gar nicht zu zeigen.
    console.warn('[3D] Alphakanal nicht prüfbar:', e.message);
    return null;
  }
}

async function ladeAugen(url){
  const gefunden = new Map();
  if(!/\.glb$/i.test(url)) return gefunden;
  await Promise.all(AUGEN_TEXTUREN.map(a => new Promise(resolve => {
    texLoader.load(url.replace(/\.glb$/i, a.endung), t => {
      // Muss zur eingebetteten Textur passen, sonst steht das Gesicht kopf:
      // glTF liefert seine Bilder ungespiegelt, ein einzeln geladenes PNG nicht.
      t.flipY = false;
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      gefunden.set(a.name, t);
      resolve();
    }, undefined, () => resolve());
  })));
  return gefunden;
}

// Eine geladene Figur. Alles, was der Treiber später anfassen will, liegt hier
// schon aufgelöst bereit — Namen im Bild zu suchen wäre je Bild eine Suche über
// den ganzen Szenengraphen.
class Model {
  constructor(gltf, augen, texturen){
    this.gltf = gltf;
    this.scene = gltf.scene;
    this.mixer = gltf.animations.length ? new THREE.AnimationMixer(this.scene) : null;
    this.actions = new Map();
    for(const clip of gltf.animations){
      this.actions.set(clip.name, this.mixer.clipAction(clip));
    }

    // Morph Targets liegen je Mesh, ihre Namen aber im Dictionary daneben.
    // Eingesammelt wird beides, damit ein Name später ein Ziel trifft, egal in
    // welchem Mesh er steckt.
    this.morphs = new Map();          // Name -> [{mesh, index}, ...]
    this.scene.traverse(o => {
      const dict = o.morphTargetDictionary;
      if(!dict) return;
      for(const [name, index] of Object.entries(dict)){
        if(!this.morphs.has(name)) this.morphs.set(name, []);
        this.morphs.get(name).push({mesh: o, index});
      }
    });

    this.current = null;              // laufender Clip
    this.arme = findeArme(gltf);

    // Alle Materialien einsammeln, auch die ohne Textur — ein Material kann
    // über die Zuordnungsdatei erst eine bekommen.
    this.materialien = [];
    this.scene.traverse(o => {
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for(const mat of mats) if(!this.materialien.includes(mat)) this.materialien.push(mat);
    });

    if(texturen) this.tauscheTexturen(texturen);

    // Erst nach dem Tausch merken: Was das Blinzeln später wiederherstellt,
    // soll die ausgetauschte Textur sein, nicht die aus der Datei.
    this.haut = this.materialien.filter(m => m.map).map(m => ({mat: m, basis: m.map}));
    this.augenTex = augen || new Map();      // Name -> Textur
    this.augenAn = new Map();                // Name -> gesetzt?
    this.augenJetzt = null;                  // gerade gezeigte Textur
  }

  // Namen für die Zuordnungsdatei. Ohne sie müsste man raten, wie die
  // Materialien im Modell heißen — deshalb stehen sie auch in der Konsole.
  materialNames(){ return this.materialien.map(m => m.name).filter(Boolean); }

  // Die Textur, an der die meisten Materialien hängen. Siehe setzeHauptTextur().
  hauptTextur(){
    const zahl = new Map();
    for(const m of this.materialien){
      if(m.map) zahl.set(m.map, (zahl.get(m.map) || 0) + 1);
    }
    let beste = null, meiste = 0;
    for(const [tex, n] of zahl) if(n > meiste){ beste = tex; meiste = n; }
    return beste;
  }

  tauscheTexturen(karte){
    // Ein Eintrag darf auf `*` enden und gilt dann für alle Materialien mit
    // diesem Präfix. Ohne das müsste man die vierzehn Namen eines Atlas
    // einzeln aufzählen, nur um ein einziges Bild zu tauschen — und genau das
    // wäre in einer Anleitung nicht mehr erklärbar.
    const genutzt = new Set();
    const passend = name => {
      if(karte.has(name)){ genutzt.add(name); return karte.get(name); }
      let beste = null, besterKey = null, laenge = -1;
      for(const k of karte.keys()){
        if(!k.endsWith('*')) continue;
        const p = k.slice(0, -1);
        // Längster Präfix gewinnt: So sticht ein genauer Eintrag den Sammel-
        // Eintrag, ohne dass die Reihenfolge in der Datei eine Rolle spielt.
        if(name.startsWith(p) && p.length > laenge){
          beste = karte.get(k); besterKey = k; laenge = p.length;
        }
      }
      if(besterKey) genutzt.add(besterKey);
      return beste;
    };

    for(const mat of this.materialien){
      const neu = passend(mat.name);
      if(!neu) continue;
      const alt = mat.map;
      if(alt){
        // Vom ersetzten Bild abschauen statt festzulegen: glTF liefert seine
        // Texturen ungespiegelt und mit eigener Wiederholung, ein einzeln
        // geladenes PNG bringt andere Vorgaben mit.
        neu.flipY = alt.flipY;
        neu.wrapS = alt.wrapS;
        neu.wrapT = alt.wrapT;
        neu.channel = alt.channel;
        neu.colorSpace = alt.colorSpace;
      }else{
        neu.flipY = false;
        neu.colorSpace = THREE.SRGBColorSpace;
        mat.needsUpdate = true;      // vorher texturlos: Shader muss neu gebaut werden
      }
      neu.needsUpdate = true;
      mat.map = neu;
    }

    // Erst am Ende melden, was ins Leere lief — vorher weiß man nicht, ob ein
    // Sammel-Eintrag nicht doch irgendwo gegriffen hat.
    for(const k of karte.keys()){
      if(!genutzt.has(k)){
        console.warn('[3D] Eintrag "' + k + '" trifft kein Material. Vorhanden:',
                     this.materialNames().join(', '));
      }
    }
  }

  morphNames(){
    const namen = [...this.morphs.keys()];
    // Nur bei genau einem texturierten Material. Der Augentausch ersetzt das
    // Bild aller Häute auf einmal; bei einem VRoid-Charakter mit fünfzehn
    // Materialien wäre das sicher falsch, und welches davon das Gesicht ist,
    // verrät der Dateiname nicht. Solche Modelle blinzeln über Shape Keys.
    if(this.haut.length === 1){
      for(const a of AUGEN_TEXTUREN) if(this.augenTex.has(a.name)) namen.push(a.name);
    }
    return namen;
  }
  clipNames(){ return [...this.actions.keys()]; }

  // Länge eines Clips in Millisekunden. Das Panel stellt die Dauer einer Geste
  // damit von selbst passend ein — sonst rät man, und eine Geste, die kürzer
  // gestellt ist als ihr Clip, bricht mitten in der Bewegung ab.
  clipDauer(name){
    const a = this.actions.get(name);
    return a ? Math.round(a.getClip().duration * 1000) : 0;
  }

  setMorph(name, value){
    if(this.augenTex.has(name)){
      this.augenAn.set(name, value >= 0.5);
      return this.zeigeAugen();
    }
    const targets = this.morphs.get(name);
    if(!targets) return false;
    for(const t of targets){
      if(t.mesh.morphTargetInfluences) t.mesh.morphTargetInfluences[t.index] = value;
    }
    return true;
  }

  // Blinzeln und Zwinkern über die Textur statt über Geometrie.
  //
  // Bei einem gescannten oder KI-erzeugten Kopf gibt es keine Lider zum
  // Bewegen — die Augen sind aufgemalt, und ein Shape Key würde nur die
  // Iris verbeulen. Was es dagegen gibt, ist ein Foto. Also wird das Foto
  // getauscht: mehrere Fassungen derselben Textur.
  //
  // Der Vergleich mit `augenJetzt` ist nicht Sparsamkeit, sondern nötig:
  // apply3d läuft je Bild und setzt beide Zustände, das wären sonst 120
  // Materialwechsel je Sekunde für nichts.
  zeigeAugen(){
    let tex = null;
    for(const a of AUGEN_TEXTUREN){
      if(this.augenAn.get(a.name)){ tex = this.augenTex.get(a.name) || null; break; }
    }
    if(tex === this.augenJetzt) return true;
    this.augenJetzt = tex;
    for(const h of this.haut) h.mat.map = tex || h.basis;
    return true;
  }

  // Weich überblenden statt umschalten — dieselbe Absicht wie beim Posenwechsel
  // der Sprites, nur dass three.js es hier von selbst kann.
  play(name, fadeMs, kraft, grundName){
    const next = this.actions.get(name);
    // Einmal je unbekanntem Namen melden. Ein Clipname, den das Modell nicht
    // kennt, sieht im Bild genauso aus wie eine Pose ohne Clip: Es passiert
    // nichts. Ohne diese Zeile sucht man den Fehler in der Animation.
    if(!next){
      this.gemeldet = this.gemeldet || new Set();
      if(!this.gemeldet.has(name)){
        this.gemeldet.add(name);
        console.warn('[3D] Clip "' + name + '" gibt es nicht. Vorhanden:',
                     this.clipNames().join(', ') || '(keine)');
      }
      return;
    }
    // Stärke: Ein Gewicht unter 1 zeigt die Bewegung zurückhaltender, ohne dass
    // man sie zweimal bauen muss.
    //
    // Der Haken dabei, und er ist der Grund für den ganzen Aufwand hier: Der
    // Mischer verrechnet ein fehlendes Gewicht gegen die *Bindepose*. Bei diesem
    // Rig ist das „Arme waagrecht" — eine halbe Geste sah deshalb aus wie eine
    // halbe T-Pose, nicht wie eine zurückhaltende Bewegung. Deshalb läuft die
    // Grundhaltung mit, und zwar mit genau dem fehlenden Gewicht. Was übrig
    // bleibt, ist die Figur in ihrer normalen Haltung mit einer angedeuteten
    // Bewegung darüber — und das war gemeint.
    const stark = (typeof kraft === 'number' && isFinite(kraft))
                ? Math.max(0.05, Math.min(1, kraft)) : 1;
    const grund = grundName ? this.actions.get(grundName) : null;
    const mischen = !!grund && grund !== next && stark < 0.99;

    if(next !== this.current){
      const fade = Math.max(0, fadeMs || 0) / 1000;
      next.reset().fadeIn(fade).play();
      // Die Grundhaltung nicht wegblenden, wenn sie gleich als Untermalung
      // gebraucht wird.
      if(this.current && !(mischen && this.current === grund)){
        this.current.fadeOut(fade);
      }
      this.current = next;
    }

    if(mischen){
      // Gewichte ausdrücklich setzen. `setEffectiveWeight` beendet dabei ein
      // laufendes Überblenden — bei gemischten Gesten gibt es deshalb keinen
      // weichen Übergang. Bei voller Stärke wird es gar nicht aufgerufen, dort
      // bleibt das Überblenden wie bisher.
      next.setEffectiveWeight(stark);
      if(!grund.isRunning()) grund.reset().play();
      grund.setEffectiveWeight(1 - stark);
      this.grund = grund;
    }else{
      if(next.getEffectiveWeight() < 0.99) next.setEffectiveWeight(1);
      if(this.grund && this.grund !== next){
        this.grund.stop();
        this.grund = null;
      }
    }
  }

  // Alles anhalten und zur Bindepose zurück.
  //
  // Das Gegenstück zu play(), und es hat lange gefehlt: Eine Pose ohne Clip rief
  // play() gar nicht erst auf, also lief der vorherige Clip einfach weiter. Wer
  // eine Lauf-Animation gestartet hatte, bekam sie nicht mehr gestoppt — es gab
  // keine Pose, die sie beendet hätte.
  //
  // Ausgeblendet statt hart abgeschaltet: Der Mischer verrechnet ein Gewicht
  // unter 1 gegen den Wert, den der Knochen beim Anbinden hatte. Ein Clip, der
  // auf 0 ausblendet, führt die Figur damit von selbst in die Bindepose zurück —
  // ein `stop()` würde sie in der letzten Haltung stehen lassen.
  stop(fadeMs){
    const fade = Math.max(0, fadeMs || 0) / 1000;
    if(this.grund){ this.grund.fadeOut(fade); this.grund = null; }
    if(!this.current) return;
    this.current.fadeOut(fade);
    this.current = null;
  }
}

const api = {
  available: true,

  // `frisch` hängt eine Wegwerf-Kennung an die Adresse. Nötig, weil eine Datei,
  // die eben noch geladen wurde, aus dem Zwischenspeicher käme — und genau das
  // wäre falsch, wenn Blender sie zwischendurch neu geschrieben hat. Die Kennung
  // geht nur an den Lader; alles, was Namen ableitet (Augentexturen, die
  // Zuordnungsdatei), rechnet weiter mit der sauberen Adresse.
  async load(url, textur, frisch){
    ensureRenderer();
    const gltf = await loader.loadAsync(
      frisch ? url + (url.includes('?') ? '&' : '?') + 'frisch=' + Date.now() : url);
    const [augen, texturen] = await Promise.all([ladeAugen(url), ladeTexturen(url)]);
    const model = new Model(gltf, augen, texturen);
    // Panel-Feld sticht die Zuordnungsdatei: Wer im Panel etwas auswählt, soll
    // das auch sehen, ohne erst eine JSON zu suchen.
    if(textur) await setzeHauptTextur(model, url.replace(/[^/]*$/, '') + encodeURIComponent(textur));
    // Einmal je Modell in die Konsole: Ohne diese Namen kann niemand eine
    // Zuordnungsdatei schreiben.
    const datei = url.replace(/^.*\//, '');
    console.info('[3D] Materialien in ' + datei + ':', model.materialNames().join(', '));
    console.info('[3D] Animationen in ' + datei + ':', model.clipNames().join(', ') || '(keine)');
    return model;
  },

  // Zeichnet eine Figur in das übergebene Rechteck des 2D-Canvas.
  //
  // Der Umweg über `drawImage` statt eines eigenen Fensters ist Absicht: So
  // liegen 2D- und 3D-Figuren in derselben Fläche, halten dieselbe Ebene ein und
  // teilen sich Hintergrund und Fensteraufnahme. Ein zweiter Canvas obendrauf
  // könnte das nicht — er läge immer davor oder immer dahinter.
  draw(model, ctx, rect, dt, opts){
    if(!renderer || !model) return;

    const w = Math.max(1, Math.round(rect.w));
    const h = Math.max(1, Math.round(rect.h));
    if(renderer.domElement.width !== w || renderer.domElement.height !== h){
      renderer.setSize(w, h, false);
    }

    // Reihenfolge zählt: erst die Armhaltung setzen, dann den Mischer laufen
    // lassen — so gewinnt eine Animation, falls es eine gibt. Siehe arme().
    arme(model, opts);
    if(model.mixer) model.mixer.update(dt);
    turn(model, opts);

    const cam = model.camera || (model.camera = makeCamera(model));
    // Nur bei tatsächlicher Änderung neu rechnen. Das Seitenverhältnis ändert
    // sich beim Ziehen am Fenster, nicht sechzigmal je Sekunde — die Matrix
    // trotzdem jedes Bild neu aufzustellen war Arbeit für ein Ergebnis, das
    // schon dastand.
    const aspect = w / h;
    if(cam.aspect !== aspect){
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }

    // Spiegeln über die Kamera statt über das Modell: Ein negativ skaliertes
    // Modell dreht seine Normalen um, und dann steht die Beleuchtung auf dem
    // Kopf.
    cam.scale.x = opts && opts.mirror ? -1 : 1;

    renderer.render(model.stage || (model.stage = makeStage(model)), cam);
    ctx.drawImage(renderer.domElement, rect.x, rect.y, rect.w, rect.h);
  }
};

// Kamera auf die Figur einpassen, damit man nicht für jedes Modell von Hand
// Werte suchen muss. Blender-Charaktere kommen in sehr verschiedenen Größen —
// mancher ist zwei Einheiten hoch, mancher zweihundert.
function makeCamera(model){
  const box = new THREE.Box3().setFromObject(model.scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const cam = new THREE.PerspectiveCamera(35, 1, 0.01, Math.max(100, size.length() * 10));

  // Etwas weiter weg als knapp: Beim Reden und Atmen bewegt sich die Figur, und
  // ein zu enger Ausschnitt schneidet dann den Kopf an.
  const dist = (size.y * 1.25) / (2 * Math.tan((cam.fov * Math.PI / 180) / 2));
  cam.position.set(center.x, center.y, center.z + dist);
  cam.lookAt(center);
  return cam;
}

// Ein langsames Wandern um die Hochachse, damit die Figur nicht wie festgeschraubt
// von vorn steht. Zwei Sinuskurven mit unrunden Frequenzen statt einer: Eine
// einzelne wäre ein Metronom, das man nach zwei Minuten sieht — die Summe hat eine
// Wiederholdauer von Stunden und wirkt deshalb wie ein Umschauen.
//
// Die Drehung sitzt auf einer Hülle um das Modell, nicht auf dem Modell selbst.
// Sonst stritte sie mit den Animationsclips, die genau dieselbe Drehung setzen.
function turn(model, opts){
  const amp = (opts && opts.turn) || 0;
  if(!model.pivot) return;
  if(!amp){ model.pivot.rotation.set(0, 0, 0); return; }

  const t = performance.now() / 1000;
  const wander = Math.sin(t * 0.23) * 0.62 + Math.sin(t * 0.37 + 1.3) * 0.38;
  model.pivot.rotation.y = amp * wander;
  // Ein Kopf, der sich dreht, neigt sich leicht mit. Sehr wenig — sichtbar wird
  // es erst, wenn man es weglässt.
  model.pivot.rotation.z = amp * 0.12 * Math.sin(t * 0.19 + 2.1);
}

// Sucht die beiden Oberarmknochen über die Knochenkarte, die eine VRM-Datei
// mitbringt. Über den Namen zu suchen wäre Glückssache — jedes Programm nennt
// sie anders. Die Karte dagegen ist genormt, deshalb findet das hier die Arme
// in jeder VRM, nicht nur in einer bestimmten.
const ARMTEILE = ['leftUpperArm', 'leftLowerArm', 'leftHand',
                  'rightUpperArm', 'rightLowerArm', 'rightHand'];

// Rückfallebene, wenn keine VRM-Karte da ist.
//
// Nötig geworden, weil ein Umweg durch Blender die VRM-Erweiterung verliert:
// Wer eine VRM importiert, Posen anlegt und als glTF ausgibt, bekommt ein
// Modell ohne Knochenkarte zurück. Und Modelle aus Meshy oder Mixamo hatten
// nie eine. Genormt sind die Namen nicht, aber die Muster sind es beinahe:
//
//   VRoid   J_Bip_L_UpperArm   J_Bip_L_LowerArm   J_Bip_L_Hand
//   Mixamo  mixamorig:LeftArm  LeftForeArm        LeftHand
//   Blender upper_arm.L        forearm.L          hand.L
function armeUeberNamen(gltf){
  const teil = s => {
    // Finger zuerst aussortieren, sonst gilt jeder Daumen als Hand.
    if(/finger|thumb|index|middle|ring|little|pinky/.test(s)) return null;
    if(/hand|wrist/.test(s)) return 'Hand';
    if(/forearm|fore_arm|lowerarm|lower_arm|elbow/.test(s)) return 'LowerArm';
    // Die Schulter sitzt vor dem Oberarm und enthält kein „arm" — sie darf
    // ihn trotzdem nicht verdrängen, falls sie doch mal so heißt.
    if(/shoulder|clavicle/.test(s)) return null;
    if(/arm/.test(s)) return 'UpperArm';
    return null;
  };
  const seite = s => {
    if(s.includes('left'))  return 'left';
    if(s.includes('right')) return 'right';
    if(/(^|[_.\-])l([_.\-]|\d|$)/.test(s)) return 'left';
    if(/(^|[_.\-])r([_.\-]|\d|$)/.test(s)) return 'right';
    return null;
  };

  const treffer = {};
  gltf.scene.traverse(o => {
    if(!o.name) return;
    const s = o.name.toLowerCase();
    const t = teil(s);
    if(!t) return;
    const w = seite(s);
    if(!w) return;
    // Der erste Treffer gewinnt. Ein Skelett läuft von der Wurzel nach außen,
    // also kommt der echte Oberarm vor jedem Twist- oder Hilfsknochen, der
    // darunter hängt und genauso heißt.
    const k = w + t;
    if(!treffer[k]) treffer[k] = o;
  });
  return treffer;
}

function findeArme(gltf){
  const json = gltf.parser && gltf.parser.json;
  const knoten = {};

  // Erst die VRM-Karte: Sie ist genormt und damit die verlässliche Quelle.
  const ext = (json && json.extensions) || {};
  const idx = {};
  if(ext.VRMC_vrm && ext.VRMC_vrm.humanoid){          // VRM 1.0
    const hb = ext.VRMC_vrm.humanoid.humanBones || {};
    for(const k of ARMTEILE) if(hb[k]) idx[k] = hb[k].node;
  }else if(ext.VRM && ext.VRM.humanoid){              // VRM 0.x, andere Form
    for(const b of ext.VRM.humanoid.humanBones || []){
      if(ARMTEILE.includes(b.bone)) idx[b.bone] = b.node;
    }
  }
  for(const k of ARMTEILE){
    const n = (json && idx[k] != null) ? json.nodes[idx[k]] : null;
    if(n && n.name) knoten[k] = gltf.scene.getObjectByName(n.name);
  }

  // Fehlt sie, über die Namen gehen — und zwar nur für das, was noch fehlt:
  // eine halbe VRM-Karte bleibt besser als geratene Namen.
  if(!knoten.leftUpperArm || !knoten.rightUpperArm){
    const nachName = armeUeberNamen(gltf);
    for(const k of ARMTEILE) if(!knoten[k] && nachName[k]) knoten[k] = nachName[k];
  }

  // In die Konsole, was gefunden wurde. Ohne diese Zeile endet die Suche nach
  // „warum wirkt der Regler nicht" bei einem Screenshot, auf dem sich nichts
  // rührt — und das sieht bei nicht gefundenen Knochen genauso aus wie bei
  // gefundenen, die um die falsche Achse gedreht werden.
  console.info('[3D] Armknochen:', ARMTEILE.map(k => k + '=' + (knoten[k] ? knoten[k].name : '—')).join(' '));

  // Ohne Oberarme geht gar nichts; Unterarm und Hand sind Zugabe. Manche
  // Modelle führen nicht alle sechs, und dann soll wenigstens das Senken wirken.
  if(!knoten.leftUpperArm || !knoten.rightUpperArm){
    console.warn('[3D] Keine Oberarme gefunden — „Arme senken" und „Hände bewegen" bleiben wirkungslos.');
    return null;
  }

  const holen = k => knoten[k] || null;
  // Ausgangsdrehung je Knochen merken, damit alles von der Bindepose aus rechnet
  // und nicht von der Stellung des letzten Bildes — sonst schaukelt es sich auf.
  const glied = (o, u, h) => {
    if(!o) return null;
    const merk = (k, kind) => k ? achsen(k, kind) : null;
    return {ober: merk(o, u), unter: merk(u, h), hand: merk(h, null)};
  };
  const links  = glied(holen('leftUpperArm'),  holen('leftLowerArm'),  holen('leftHand'));
  const rechts = glied(holen('rightUpperArm'), holen('rightLowerArm'), holen('rightHand'));
  if(!links || !rechts) return null;
  return {links, rechts};
}

// Die beiden Achsen, um die sich ein Armknochen sinnvoll drehen lässt —
// ausgerechnet aus seiner Lage im Raum statt angenommen.
//
// Der Grund für den Aufwand: Es gibt keine übliche Achse. Bei der VRoid-Figur
// senkt die lokale z-Achse den Arm, beim Troll aus Meshy dreht dieselbe Achse
// ihn nur um sich selbst — sichtbar passiert nichts, und der Regler wirkt kaputt,
// obwohl die Knochen gefunden wurden. Jedes Programm legt die Knochenachsen
// anders, und ein Umweg durch Blender legt sie noch einmal neu.
//
// Was dagegen an jedem Rig gleich ist, ist die Geometrie: Der Arm zeigt irgendwo
// hin, und „senken" heißt, dass die Hand nach unten wandert. Die Drehachse dafür
// ist das Kreuzprodukt aus Armrichtung und Weltunten — und die stimmt dann für
// beide Seiten von selbst, weil die Armrichtung links und rechts gegenläufig ist.
// Deshalb braucht es hier auch kein Vorzeichen je Seite mehr.
const V_UNTEN = new THREE.Vector3(0, -1, 0);
const V_VORN  = new THREE.Vector3(0, 0, 1);

function achsen(k, kind){
  // Weltlage der Bindepose. Zum Ladezeitpunkt läuft noch keine Animation, die
  // Knochen stehen also so, wie das Modell sie mitbringt.
  k.updateWorldMatrix(true, false);
  const hier = new THREE.Vector3(), dort = new THREE.Vector3();
  k.getWorldPosition(hier);

  // Wohin der Knochen zeigt: zum nächsten Gelenk. Fehlt das — die Hand hat kein
  // Kind, das uns gehört —, tut es das erste beste Kind, und sonst die Richtung,
  // aus der der Knochen selbst kommt.
  let ziel = kind;
  if(!ziel && k.children.length) ziel = k.children[0];
  const d = new THREE.Vector3();
  if(ziel){
    ziel.updateWorldMatrix(true, false);
    ziel.getWorldPosition(dort);
    d.subVectors(dort, hier);
  }
  if(d.lengthSq() < 1e-12 && k.parent){
    k.parent.getWorldPosition(dort);
    d.subVectors(hier, dort);
  }
  if(d.lengthSq() < 1e-12) d.set(1, 0, 0);      // aufgeben und irgendwas nehmen
  d.normalize();

  // Senken: Arm in Richtung Weltunten drehen.
  const ab = new THREE.Vector3().crossVectors(d, V_UNTEN);
  // Hängt der Arm schon senkrecht, ist dieses Kreuzprodukt null. Dann gibt es
  // kein „weiter senken", und die Achse wird stattdessen so gewählt, dass die
  // Zugabe-Bewegung wenigstens nach vorn und hinten geht.
  if(ab.lengthSq() < 1e-6) ab.crossVectors(d, V_VORN);
  if(ab.lengthSq() < 1e-6) ab.set(0, 0, 1);
  ab.normalize();

  // Vor und zurück: senkrecht auf Arm und Senkachse.
  const av = new THREE.Vector3().crossVectors(ab, d).normalize();

  // Beides in den Raum des Elternknochens, denn dort wirkt `k.quaternion`.
  const eltern = new THREE.Quaternion();
  if(k.parent) k.parent.getWorldQuaternion(eltern);
  eltern.invert();
  ab.applyQuaternion(eltern).normalize();
  av.applyQuaternion(eltern).normalize();

  return {k, q0: k.quaternion.clone(), ab, av};
}

// Arme aus der T-Pose herunterdrehen.
//
// Wird *vor* dem Animationsmischer aufgerufen, und zwar mit Absicht: Bewegt ein
// Clip die Oberarme, überschreibt er diesen Wert und die Animation behält recht.
// Nur wenn niemand die Arme animiert — der Regelfall bei einer VRM ohne Clips —
// bleibt die gesenkte Haltung stehen. Deshalb braucht es keine Sonderbehandlung
// für Modelle mit Animationen.
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

// Einen Knochen um seine beiden gemessenen Achsen drehen, immer von der
// Bindepose aus. Die Drehung wird *vor* die Ausgangsdrehung gesetzt, weil die
// Achsen im Raum des Elternknochens liegen — dort, wo `quaternion` wirkt.
function dreh(g, ab, av){
  if(!g) return;
  _qa.setFromAxisAngle(g.ab, ab);
  if(av){
    _qb.setFromAxisAngle(g.av, av);
    _qa.multiply(_qb);
  }
  g.k.quaternion.copy(_qa).multiply(g.q0);
}

function arme(model, opts){
  const a = model.arme;
  if(!a) return;
  const grad = Math.PI / 180;
  const senken = (opts && opts.arms || 0) * grad;
  const amp    = (opts && opts.hands || 0) * grad;
  // Beim Reden lebhafter. Wer spricht, hält die Hände nicht still — und
  // umgekehrt verrät völlige Ruhe beim Sprechen sofort die Puppe.
  const laut = 1 + 1.6 * Math.min(1, opts && opts.speaking || 0);
  const t = performance.now() / 1000;

  // Beide Seiten laufen mit leicht verschiedenen Frequenzen. Gleichlauf sähe aus
  // wie Turnen, nicht wie Dastehen. Ein Vorzeichen je Seite braucht es nicht
  // mehr: Die Achsen sind aus der Armrichtung gerechnet und zeigen links und
  // rechts schon gegenläufig — siehe achsen().
  const seite = (g, f1, f2, ph) => {
    if(!g) return;
    const s = amp * laut;
    dreh(g.ober, senken + s * Math.sin(t * f1 + ph),
                          s * 0.7 * Math.sin(t * f2 + ph * 1.7));
    // Ellbogen und Handgelenk kleiner und schneller — die Bewegung wandert nach
    // außen, wie bei einem Arm, der von der Schulter her angestoßen wird.
    dreh(g.unter, s * 0.5 * Math.sin(t * f1 * 1.4 + ph + 0.9), 0);
    dreh(g.hand,  0, s * 0.8 * Math.sin(t * f2 * 1.9 + ph + 2.2));
  };

  seite(a.links,  0.31, 0.47, 0.0);
  seite(a.rechts, 0.27, 0.41, 1.9);
}

function makeStage(model){
  const stage = new THREE.Scene();
  // Hülle statt Modell: siehe turn()
  model.pivot = new THREE.Group();
  model.pivot.add(model.scene);
  stage.add(model.pivot);
  // Zwei Lichter reichen und sind vorhersagbar: eines von vorn, damit das
  // Gesicht lesbar ist, und ein weiches von überall, damit die Schattenseite
  // nicht schwarz absäuft. Mehr wäre Geschmack und gehört ins Modell.
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(0.4, 0.8, 1);
  stage.add(key);
  stage.add(new THREE.AmbientLight(0xffffff, 1.1));
  return stage;
}

window.vtuber3d = api;
