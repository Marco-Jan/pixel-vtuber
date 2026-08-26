const { app, BrowserWindow, dialog, ipcMain, globalShortcut, Menu, nativeImage,
        nativeTheme, safeStorage, screen, session, shell, Tray } = require('electron');
const path = require('path');
const fs = require('fs');

// Chromium hält ein Fenster an, sobald ein anderes es vollständig verdeckt: keine
// Frames mehr, gedrosselte Timer. Für eine gewöhnliche Anwendung ist das sinnvoll,
// für diese nicht — der Avatar hängt komplett an requestAnimationFrame, und
// „verdeckt" ist hier der Normalfall: ohne „Immer im Vordergrund" liegt er hinter
// dem Spiel, und OBS nimmt ihn trotzdem auf. Ohne diese Schalter fror er dabei
// ein, im Fenster wie in der Aufnahme.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

// Settings live next to the user's app data so a rebuild never wipes a calibration.
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
// Same reasoning for sprites the user adds: inside the app folder they would be
// unreachable in a packaged build and gone with the next update.
const USER_SPRITES = path.join(app.getPath('userData'), 'sprites');
// Dasselbe für die Sprachausgabe. Piper ist nichts, was diese App mitbringen
// könnte — die Programmdatei wiegt zusammen mit einer Stimme mehr als der ganze
// Rest, und welche Stimme jemand will, weiß nur er selbst. Also derselbe Weg wie
// bei den Sprites: ein Ordner neben den Einstellungen, in den man hineinlegt, was
// man hat, und die App sucht sich zusammen, was da ist.
const USER_PIPER = path.join(app.getPath('userData'), 'piper');
// Und fürs Zuhören dasselbe. whisper.cpp läuft hier bewusst auf der CPU: Gemessen
// braucht `base` rund eine Sekunde für drei Sekunden Zuruf, und das ist der Teil
// der Kette, der am wenigsten davon profitiert, sich mit dem Spiel um die
// Grafikkarte zu streiten.
const USER_WHISPER = path.join(app.getPath('userData'), 'whisper');
// Eigene Aufnahmen. Eine Synthese ist nie so gut wie eine echte Stimme, und für
// Sätze, die immer gleich kommen — Begrüßung, Standardsprüche —, ist es der
// kürzeste Weg zu etwas, das nicht nach Maschine klingt.
const USER_RECORD = path.join(app.getPath('userData'), 'aufnahmen');

let win = null;
let tray = null;
let hilfeFenster = null;   // die Anleitung, siehe help:open
let registeredShortcuts = [];

// Höhe der Bedienleiste in DIP — muss zu #toolbar in style.css passen.
const BAR_H = 28;
const HOVER_POLL_MS = 110;
let hoverTimer = null;
let hoverState = {inBar:false};   // Cursor steht im Leistenstreifen (ohne Stapelreihenfolge)
let passthrough = false;   // ob das Fenster gerade die Maus durchlässt

function readSettings(){
  try{
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  }catch(e){
    return {}; // first run, or a corrupted file we can safely start over from
  }
}

function writeSettings(data){
  try{
    fs.mkdirSync(path.dirname(SETTINGS_FILE), {recursive:true});
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  }catch(e){
    return false;
  }
}

function createWindow(){
  const saved = readSettings();
  const bounds = saved.windowBounds || {};
  const area = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width:  bounds.width  || 520,
    height: bounds.height || 780,
    x: bounds.x,
    y: bounds.y,
    // A transparent frameless window is what lets OBS pull the avatar with a real
    // alpha channel. The renderer paints a solid colour instead when the user
    // picks chroma-key mode, so both workflows use this same window.
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    alwaysOnTop: saved.alwaysOnTop !== false,
    skipTaskbar: false,
    title: 'Pixel VTuber',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Gegenstück zu den Schaltern ganz oben: auch ein unsichtbares oder nicht
      // fokussiertes Fenster behält volle Bildrate und ungedrosselte Timer.
      backgroundThrottling: false
    }
  });

  if(bounds.x === undefined){
    win.setPosition(Math.round(area.width - (bounds.width || 520) - 40), 60);
  }
  applyAlwaysOnTop();

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Debug aid: VTUBER_SHOT=<pfad> captures the window a few seconds after start
  // and quits. Used to verify rendering without a human looking at the screen.
  //
  // Die Konsole des Fensters wandert dabei nach stdout. Ohne das bleibt die
  // einzige Auskunft über ein geladenes Modell — Materialnamen, gefundene
  // Armknochen, nicht ladbare Texturen — im Fenster stehen, und ein Screenshot
  // beantwortet „warum bewegt sich nichts" nicht.
  if(process.env.VTUBER_SHOT){
    win.webContents.on('console-message', (_e, level, message) => {
      console.log('[fenster] ' + message);
    });
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try{
          const img = await win.webContents.capturePage();
          fs.writeFileSync(process.env.VTUBER_SHOT, img.toPNG());
        }catch(e){
          console.error('capture failed:', e.message);
        }
        app.quit();
      }, Number(process.env.VTUBER_SHOT_DELAY || 4000));
    });
  }

  const persistBounds = () => {
    if(!win || win.isDestroyed()) return;
    const s = readSettings();
    s.windowBounds = win.getBounds();
    writeSettings(s);
  };
  win.on('resize', persistBounds);
  win.on('move', () => {
    // Solange sich das Fenster bewegt, darf die Ueberwachung nichts umschalten.
    // `-webkit-app-region:drag` laesst Windows in eine eigene Bewegungsschleife
    // gehen; ein setIgnoreMouseEvents mittendrin bricht sie ab, und der Griff
    // rutscht nach dem ersten Ruck weg. Genau das passierte: pollHover vergleicht
    // die Maus mit Fenstergrenzen, die waehrend der Bewegung hinterherhinken,
    // haelt den Zeiger fuer entwischt und macht das Fenster wieder durchlaessig.
    ziehtBis = Date.now() + ZIEH_RUHE_MS;
    persistBounds();
  });
  win.on('closed', () => { stopHoverWatch(); win = null; });
}

// ---- Bedienleiste beim Überfahren -------------------------------------------
// Die Leiste soll erscheinen, wenn die Maus über dem Fenster liegt — genau das
// weiß ein durchlässiges Fenster aber nicht: es bekommt keine Mausereignisse.
// Der naheliegende Weg (setIgnoreMouseEvents mit forward:true) hängt einen
// systemweiten Maus-Hook ein, und der ist der Grund, warum der Cursor in Spielen
// mit Rohdaten-Eingabe über dem Avatar stotterte. Deshalb wird stattdessen die
// Cursorposition abgefragt: kein Hook, keine Ereigniskette, nur alle 110 ms ein
// Vergleich mit den Fenstergrenzen.
//
// Was dieser Vergleich allein *nicht* weiß, ist die Stapelreihenfolge: Ohne
// „Immer im Vordergrund" liegt der Avatar hinter anderen Fenstern, und Koordinaten
// innerhalb seiner Grenzen heißen dann noch lange nicht, dass die Maus über ihm
// liegt — sie liegt über dem Fenster davor. Genau das ging schief: die Leiste kam
// auch dann hoch (und in der OBS-Aufnahme mit).
//
// Deshalb entscheidet das hier nicht mehr, ob die Leiste sichtbar wird, sondern
// nur, ob das Fenster die Maus überhaupt annimmt — und zwar allein im Streifen
// ganz oben. Ob es dann wirklich obenauf liegt, beantwortet Windows von selbst:
// nur das oberste Fenster an dieser Stelle bekommt echte Mausereignisse. Erst so
// ein Ereignis blendet im Renderer die Leiste ein. Liegt etwas davor, kommt keins,
// und die Leiste bleibt weg.
//
// Überall außerhalb des Streifens bleibt das Fenster durchlässig — sonst würde
// der Avatar mitten im Spiel Klicks schlucken, sobald die Maus über ihn fährt.
function hoverEnabled(){
  return readSettings().hoverBar !== false;
}

function sendHover(){
  if(win && !win.isDestroyed()) win.webContents.send('hover', hoverState);
}

function setBarArmed(on){
  if(on === hoverState.inBar) return;
  hoverState = {inBar: !!on};
  win.setIgnoreMouseEvents(!on);
  sendHover();
}

// Bis wann die Ueberwachung stillhaelt, weil das Fenster gerade bewegt wird.
// Etwas Nachlauf, damit nicht die Pause zwischen zwei Rucklern schon wieder
// umschaltet.
let ziehtBis = 0;
const ZIEH_RUHE_MS = 400;

function pollHover(){
  // Waehrend und kurz nach einer Bewegung nichts anfassen - siehe win.on('move').
  if(Date.now() < ziehtBis) return;
  if(!win || win.isDestroyed()) return;
  if(win.isMinimized() || !win.isVisible()){
    setBarArmed(false);
    return;
  }

  let p, b;
  try{
    p = screen.getCursorScreenPoint();
    b = win.getBounds();
  }catch(e){ return; }

  setBarArmed(p.x >= b.x && p.x < b.x + b.width &&
              p.y >= b.y && p.y < b.y + BAR_H);
}

function startHoverWatch(){
  if(hoverTimer || !hoverEnabled()) return;
  hoverTimer = setInterval(pollHover, HOVER_POLL_MS);
}

function stopHoverWatch(){
  if(hoverTimer){ clearInterval(hoverTimer); hoverTimer = null; }
  if(hoverState.inBar){
    hoverState = {inBar:false};
    sendHover();   // Mausdurchlässigkeit regelt der Aufrufer
  }
}

// Mouse passthrough is all-or-nothing here, on purpose.
//
// Electron can keep a low-level mouse hook alive (setIgnoreMouseEvents with
// forward:true) so the renderer still sees move events while clicks pass
// through. That hook is exactly what a game with raw mouse input trips over:
// the cursor stutters or disappears entirely inside the overlay's rectangle.
// So it is never used — passthrough always hands the mouse back to the OS
// completely and the window becomes a picture the game never notices. The
// price is hover discovery, which is why the panel is hotkey-only.
//
// What this deliberately does NOT do is make the window non-focusable. That
// would guard against stealing focus from a fullscreen game, but a passthrough
// window cannot be clicked in the first place, so it only ever gets focus if the
// user picks it themselves. The cost was real: Electron pulls a non-focusable
// window out of the taskbar, so the app vanishes from the one place you would
// look for it while the panel is closed.
function setPassthrough(on){
  if(!win || win.isDestroyed()) return false;
  passthrough = !!on;
  win.setIgnoreMouseEvents(!!on);
  win.setSkipTaskbar(false);
  // Die Leiste wird nur gebraucht, solange das Fenster durchlässig ist; bei
  // offenem Panel sieht der Renderer die Maus ohnehin selbst.
  stopHoverWatch();
  if(on){
    applyAlwaysOnTop();
    startHoverWatch();
  }else{
    // Opening the panel means the user wants at the window, and it may be buried
    // under everything. Windows refuses SetForegroundWindow to a background
    // process, so focus() alone is not enough: topmost for as long as the panel
    // is open is what actually puts it in front. Closing the panel hands the
    // window back to the user's always-on-top setting.
    win.setAlwaysOnTop(true, 'screen-saver');
    win.show();
    win.moveTop();
    win.focus();
  }
  return !!on;
}

function applyAlwaysOnTop(){
  if(!win || win.isDestroyed()) return false;
  const on = readSettings().alwaysOnTop !== false;
  // 'screen-saver' keeps it above fullscreen games, where a plain always-on-top loses
  win.setAlwaysOnTop(on, on ? 'screen-saver' : 'normal');
  return on;
}

// ---- hotkeys ----------------------------------------------------------------
// Registered globally so a pose can be triggered while a game has focus.
// Any accelerator the OS refuses (already taken by another app) is reported back
// to the renderer instead of failing silently.
function applyShortcuts(map){
  registeredShortcuts.forEach(a => {
    try{ globalShortcut.unregister(a); }catch(e){}
  });
  registeredShortcuts = [];
  const failed = [];

  for(const [action, accelerator] of Object.entries(map || {})){
    if(!accelerator) continue;
    let ok = false;
    try{
      ok = globalShortcut.register(accelerator, () => {
        if(win && !win.isDestroyed()) win.webContents.send('hotkey', action);
      });
    }catch(e){ ok = false; }
    if(ok) registeredShortcuts.push(accelerator);
    else failed.push({action, accelerator});
  }
  return failed;
}

// A second instance is worse than a duplicate window: both write the same
// settings.json, both fight over the global hotkeys (only the first one gets
// them), and OBS matches windows by class and executable — so the capture can
// silently latch onto the wrong one and go black when that copy is closed.
// Hence: one instance only. The second one says so and steps aside.
function revealWindow(){
  if(!win || win.isDestroyed()) return;
  if(win.isMinimized()) win.restore();
  setPassthrough(false);                        // focusable, topmost, in front
  win.webContents.send('hotkey', 'panelShow');  // and with the panel open
}

// Der Panel-Hotkey ist nicht verlässlich: Control+Alt+P und Konsorten sind auf
// vielen Rechnern längst von Streaming-Tools belegt, und dann führt kein Weg
// mehr in ein geschlossenes Panel zurück. Das Tray-Symbol ist der Weg, den
// niemand anders wegnehmen kann.
function createTray(){
  let icon = nativeImage.createFromPath(path.join(__dirname, 'sprites', 'demo_open.png'));
  if(!icon.isEmpty()){
    const s = icon.getSize();
    // Nur den Kopf, sonst ist im 16-Pixel-Symbol nichts zu erkennen
    icon = icon.crop({x: Math.round(s.width * 0.18), y: Math.round(s.height * 0.08),
                      width: Math.round(s.width * 0.64), height: Math.round(s.width * 0.64)})
               .resize({width: 16, height: 16});
  }
  try{
    tray = new Tray(icon);
  }catch(e){
    return;   // ohne Symbol lieber weiterlaufen als gar nicht starten
  }
  tray.setToolTip('Pixel VTuber');
  tray.setContextMenu(Menu.buildFromTemplate([
    {label: 'Panel öffnen', click: revealWindow},
    {type: 'separator'},
    {label: 'Beenden', click: () => app.quit()}
  ]));
  tray.on('click', revealWindow);
}

// ===========================================================================
//  Sprachausgabe (Piper)
//
// Piper ist ein eigenständiges Programm: Text auf die Standardeingabe, WAV in
// eine Datei. Es läuft auf der CPU, was hier der ausschlaggebende Punkt ist —
// Spiel, OBS und später ein Sprachmodell teilen sich ohnehin schon eine Karte,
// und die Stimme ist das einzige Stück der Kette, das gar nicht erst mitbieten
// muss.
//
// Gestartet wird es im Hauptprozess, nicht im Renderer: Der zeichnet den Avatar
// und darf für nichts anhalten.
// ===========================================================================

const { execFile } = require('child_process');
const os = require('os');

// ---- Animationen aus Dateien übernehmen -------------------------------------
//
// Die App kann kein FBX — three.js lädt glTF. Umgerechnet wird deshalb in
// Blender, und zwar mit `blender/troll-posen.py`, das die Figur ohnehin baut.
// Von hier aus wird Blender nur gestartet und sein Fortschritt weitergereicht.
//
// Blender ist damit eine echte Voraussetzung für diesen Knopf. Fehlt es, sagt
// die App das — ein Knopf, der still nichts tut, wäre schlimmer als keiner.
// Ein gepacktes Programm liegt in einem Archiv (app.asar). Für Node ist das
// durchsichtig, für alles außerhalb nicht: Weder Blender noch der Browser können
// hineinsehen. Solche Dateien werden beim Bauen daneben ausgepackt
// (`asarUnpack`), und hier wird der Pfad dorthin umgebogen.
//
// Ohne das sind zwei Merkmale in der .exe tot, und zwar lautlos — im Betrieb aus
// dem Quelltext heraus funktioniert beides, weil es dort echte Dateien sind.
// Ohne regulären Ausdruck, und das mit Absicht: Der Trenner ist unter Windows
// ein Backslash, und der muss in einem Ausdruck doppelt geschrieben werden. Genau
// daran ist die erste Fassung gescheitert — die Zeichenklasse enthielt am Ende
// nur den Schrägstrich und traf keinen einzigen echten Pfad. Ein Vergleich auf
// die Zeichenkette hat diese Falle nicht.
function echterPfad(p){
  const s = String(p);
  const marke = 'app.asar' + path.sep;
  const i = s.indexOf(marke);
  return i < 0 ? s : s.slice(0, i) + 'app.asar.unpacked' + path.sep + s.slice(i + marke.length);
}

const IMPORT_SKRIPT = echterPfad(path.join(__dirname, 'blender', 'anim-import.py'));
// Unberührte Fassung je Figur. Der Grund: Beim Backen wird die glb neu
// geschrieben, und dabei läuft ihre Textur durch eine weitere Kompression. Nach
// dem fünften Import wäre sie sichtbar schlechter. Deshalb wird beim ersten Mal
// eine Kopie beiseitegelegt und danach immer *die* gelesen — das Ziel entsteht
// jedes Mal frisch aus ihr.
const MODELL_QUELLEN = path.join(app.getPath('userData'), 'modelle-original');

// Wo die gewählte Figur liegt. Sie kann im mitgelieferten Ordner stehen oder im
// Ordner des Nutzers; gesucht wird in derselben Reihenfolge wie bei sprites:list,
// dort gewinnt der Benutzerordner.
function findeModell(datei){
  const name = path.basename(String(datei || ''));
  if(!name) return null;
  for(const dir of [USER_SPRITES, path.join(__dirname, 'sprites')]){
    const p = path.join(dir, name);
    if(fs.existsSync(p)) return p;
  }
  return null;
}

// Die unberührte Fassung holen oder anlegen.
function quelleFuer(modellPfad){
  fs.mkdirSync(MODELL_QUELLEN, {recursive: true});
  const quelle = path.join(MODELL_QUELLEN, path.basename(modellPfad));
  if(!fs.existsSync(quelle)) fs.copyFileSync(modellPfad, quelle);
  return quelle;
}
let blenderPfad = null;      // gefundener Pfad, oder '' wenn erfolglos gesucht

function findeBlender(){
  if(blenderPfad !== null) return blenderPfad;

  const eigener = (readSettings().blenderPath || '').trim();
  if(eigener && fs.existsSync(eigener)) return (blenderPfad = eigener);

  // Der Reihe nach die üblichen Orte. Blender liegt nicht zwingend auf C: —
  // beim Autor dieses Projekts steckt es auf E:, und genau daran scheitert
  // jede Suche, die nur `%ProgramFiles%` kennt.
  const wurzeln = [];
  for(const v of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]){
    if(v) wurzeln.push(v);
  }
  for(const l of 'CDEFGH'){
    wurzeln.push(l + ':\\Program Files', l + ':\\Program Files (x86)');
  }
  const gesehen = new Set();
  const treffer = [];
  for(const w of wurzeln){
    const basis = path.join(w, 'Blender Foundation');
    if(gesehen.has(basis)) continue;
    gesehen.add(basis);
    let eintraege = [];
    try{ eintraege = fs.readdirSync(basis); }catch(e){ continue; }
    for(const e of eintraege){
      const exe = path.join(basis, e, 'blender.exe');
      if(fs.existsSync(exe)) treffer.push(exe);
    }
  }
  // Die höchste Version zuerst: Wer zwei installiert hat, meint die neuere.
  treffer.sort((a, b) => b.localeCompare(a, undefined, {numeric: true}));
  return (blenderPfad = treffer[0] || '');
}

function melde(text){
  if(win && !win.isDestroyed()) win.webContents.send('anim:fortschritt', text);
}

// `modell` ist der Dateiname der Figur, auf die gebacken wird — die, die im Panel
// gewählt ist. Ohne diese Angabe wäre der Import an eine bestimmte Figur
// gebunden, und für jeden anderen Nutzer wertlos.
async function animHinzufuegen(pfade, modell){
  const exe = findeBlender();
  if(!exe){
    return {ok: false, fehler: 'Blender nicht gefunden. Es rechnet die Animation um; '
      + 'ohne Blender geht dieser Weg nicht. Installiere es oder trage den Pfad zu '
      + 'blender.exe in der Einstellungsdatei unter "blenderPath" ein.'};
  }
  if(!fs.existsSync(IMPORT_SKRIPT)){
    return {ok: false, fehler: 'Das Umrechnungsskript fehlt: ' + IMPORT_SKRIPT};
  }

  const ziel = findeModell(modell);
  if(!ziel){
    return {ok: false, fehler: modell
      ? 'Die Figur „' + modell + '" ist nicht zu finden.'
      : 'Erst eine Figur wählen: Die Animation wird auf ein Modell gebacken, und '
        + 'welches, steht unter „Modell". Bei einer Pixelfigur gibt es nichts zu '
        + 'animieren.'};
  }

  // Die Animationsdateien in denselben Ordner wie die Figur — dort sucht das
  // Skript. Sie bleiben liegen: Sie sind die Quelle des Clips, nicht ein
  // Zwischenschritt, und beim nächsten Lauf wird von ihnen aus neu gebacken.
  const ordner = path.dirname(ziel);
  const kopiert = [];
  try{
    for(const p of pfade || []){
      if(!/\.(fbx|glb|gltf)$/i.test(p)) continue;
      const hin = path.join(ordner, path.basename(p));
      if(path.resolve(hin) !== path.resolve(p)) fs.copyFileSync(p, hin);
      kopiert.push(path.basename(p));
    }
  }catch(e){
    return {ok: false, fehler: 'Datei ließ sich nicht kopieren: ' + e.message};
  }
  if(!kopiert.length) return {ok: false, fehler: 'Keine .fbx-, .glb- oder .gltf-Datei dabei.'};

  let quelle;
  try{
    quelle = quelleFuer(ziel);
  }catch(e){
    return {ok: false, fehler: 'Konnte keine unberührte Fassung anlegen: ' + e.message};
  }

  melde('Blender rechnet …');
  return new Promise(fertig => {
    const kind = execFile(exe, ['--background', '--python', IMPORT_SKRIPT, '--',
                                '--quelle', quelle, '--ziel', ziel, '--ordner', ordner],
                          {maxBuffer: 16 * 1024 * 1024, windowsHide: true},
                          (fehler, stdout, stderr) => {
      const text = String(stdout || '') + String(stderr || '');
      // Das Skript druckt am Ende einen JSON-Block. Der ist die verlässliche
      // Auskunft darüber, was wirklich in der Datei gelandet ist — der
      // Rückgabewert von Blender sagt darüber nichts.
      const m = text.match(/<<<ERGEBNIS>>>([\s\S]*?)<<<ENDE>>>/);
      if(!m){
        fertig({ok: false, kopiert,
                fehler: 'Blender lief, meldete aber kein Ergebnis. Letzte Zeilen:\n'
                        + text.trim().split('\n').slice(-6).join('\n')});
        return;
      }
      let daten = null;
      try{ daten = JSON.parse(m[1]); }catch(e){}
      if(!daten){ fertig({ok: false, kopiert, fehler: 'Ergebnis unlesbar.'}); return; }
      if(daten.ok === false){ fertig({ok: false, kopiert, fehler: daten.fehler}); return; }
      fertig({ok: true, kopiert, clips: daten.animationen || [],
              ausFbx: daten.aus_dateien || [], uebersprungen: daten.uebersprungen || []});
    });
    // Fortschritt durchreichen: Das Skript nennt jede Quelldatei, die es
    // durchsucht. Bei ein bis zwei Minuten Laufzeit ist das der Unterschied
    // zwischen „arbeitet" und „hängt".
    if(kind.stdout){
      let rest = '';
      kind.stdout.on('data', d => {
        rest += d.toString();
        const zeilen = rest.split('\n');
        rest = zeilen.pop();
        for(const z of zeilen){
          if(/^durchsuche:/.test(z)) melde(z.trim());
          else if(/war belegt/.test(z)) melde(z.trim());
        }
      });
    }
  });
}

// Was im Piper-Ordner liegt, entscheidet der Benutzer — hier wird nur gesucht.
// `piper.exe` darf direkt darin liegen oder eine Ebene tiefer, weil die Archive
// von Piper einen eigenen Unterordner mitbringen und ihn niemand gern auflöst.
function findPiper(){
  const direct = path.join(USER_PIPER, 'piper.exe');
  if(fs.existsSync(direct)) return direct;
  let entries = [];
  try{ entries = fs.readdirSync(USER_PIPER, {withFileTypes:true}); }catch(e){ return null; }
  for(const e of entries){
    if(!e.isDirectory()) continue;
    const nested = path.join(USER_PIPER, e.name, 'piper.exe');
    if(fs.existsSync(nested)) return nested;
  }
  return null;
}

// Eine Stimme besteht aus zwei Dateien: dem Modell und einer .json daneben.
// Fehlt die zweite, startet Piper nicht — deshalb gilt eine Stimme nur dann als
// vorhanden, wenn beide da sind. Sonst stünde sie wählbar in der Liste und
// scheiterte erst beim Sprechen.
// Kennung einer Stimme. Der senkrechte Strich taugt als Trenner, weil Windows ihn
// in Pfaden verbietet — eine Kennung lässt sich also nie versehentlich zerlegen.
//   p|<Pfad zur .onnx>|<Sprecher-Nummer>   ein Piper-Modell
//   w|<Name>                               eine Windows-Stimme
//
// Ältere Einstellungen enthalten hier den blanken Pfad. Der wird als Piper mit
// Sprecher 0 gelesen, damit niemand nach dem Update ohne Stimme dasteht.
function leseStimmId(id){
  const s = String(id || '');
  if(s.startsWith('w|')) return {quelle: 'windows', name: s.slice(2)};
  if(s.startsWith('c|')){
    const teile = s.split('|');
    return {quelle: 'cloud', anbieter: teile[1], stimme: teile.slice(2).join('|')};
  }
  if(s.startsWith('p|')){
    const teile = s.split('|');
    return {quelle: 'piper', file: teile[1], speaker: parseInt(teile[2], 10) || 0};
  }
  return s ? {quelle: 'piper', file: s, speaker: 0} : null;
}

// Windows-Stimmen einmal erfragen und behalten. Die Liste ändert sich zur
// Laufzeit nicht — der Aufruf kostet aber rund eine Sekunde, und PowerShell zu
// starten ist der teure Teil daran.
//
// Diese Sekunde lief früher *synchron* im Hauptprozess: Beim ersten Blick in
// den Stimmen-Reiter stand das ganze Fenster still, Avatar inbegriffen. Deshalb
// wird die Liste jetzt beim Start nebenher geholt, und wenn das Panel fragt,
// liegt sie längst da. Der synchrone Weg bleibt als Rückfall — für den Fall,
// dass jemand schneller klickt, als PowerShell startet.
const WIN_STIMMEN_ARGS = ['-NoProfile', '-NonInteractive', '-Command',
  'Add-Type -AssemblyName System.Speech; ' +
  '(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() ' +
  '| ForEach-Object { $_.VoiceInfo.Name }'];
const WIN_STIMMEN_OPT = {timeout: 15000, windowsHide: true, encoding: 'utf8'};

const zerlegeStimmen = raus =>
  String(raus).split(/\r?\n/).map(s => s.trim()).filter(Boolean);

let windowsStimmen = null;

// Nebenher holen, ohne auf das Ergebnis zu warten.
function waermeStimmen(){
  if(windowsStimmen || process.platform !== 'win32') return;
  execFile('powershell.exe', WIN_STIMMEN_ARGS, WIN_STIMMEN_OPT, (fehler, raus) => {
    // Kein Grund für eine Fehlermeldung: Dann gibt es eben keine
    // Windows-Stimmen, und Piper bleibt der Weg.
    if(!windowsStimmen) windowsStimmen = fehler ? [] : zerlegeStimmen(raus);
  });
}

function listWindowsVoices(){
  if(windowsStimmen) return windowsStimmen;
  windowsStimmen = [];
  if(process.platform !== 'win32') return windowsStimmen;
  try{
    windowsStimmen = zerlegeStimmen(
      require('child_process').execFileSync('powershell.exe', WIN_STIMMEN_ARGS, WIN_STIMMEN_OPT));
  }catch(e){
    // siehe oben
  }
  return windowsStimmen;
}

function listVoices(){
  const found = [];

  // Piper-Modelle. Ein Modell kann mehrere Sprecher enthalten — die
  // Gefühlslagen von `thorsten_emotional` etwa stecken alle in *einer* Datei.
  // Ohne diese Auflösung nutzt die App davon genau eine und die anderen sieben
  // liegen ungenutzt auf der Platte.
  const scan = dir => {
    let entries = [];
    try{ entries = fs.readdirSync(dir, {withFileTypes:true}); }catch(e){ return; }
    for(const e of entries){
      const full = path.join(dir, e.name);
      if(e.isDirectory()){ scan(full); continue; }
      if(!e.name.endsWith('.onnx') || !fs.existsSync(full + '.json')) continue;

      const basis = e.name.replace(/\.onnx$/, '');
      let karte = null, anzahl = 1;
      try{
        const j = JSON.parse(fs.readFileSync(full + '.json', 'utf8'));
        anzahl = Number(j.num_speakers) || 1;
        karte = j.speaker_id_map || null;
      }catch(err){ /* unlesbare .json: dann eben ein Sprecher */ }

      if(anzahl <= 1){
        found.push({id: 'p|' + full + '|0', label: basis, quelle: 'piper'});
        continue;
      }
      // Namen aus der Karte, sonst durchnummerieren.
      const namen = new Array(anzahl).fill(null);
      if(karte) for(const [name, nr] of Object.entries(karte)){
        if(nr >= 0 && nr < anzahl) namen[nr] = name;
      }
      for(let n = 0; n < anzahl; n++){
        found.push({
          id: 'p|' + full + '|' + n,
          label: basis + ' — ' + (namen[n] || ('Sprecher ' + n)),
          quelle: 'piper'
        });
      }
    }
  };
  scan(USER_PIPER);
  found.sort((a, b) => a.label.localeCompare(b.label));

  // Windows-Stimmen hinten anhängen. Sie sind weniger gut als Piper, aber sie
  // sind *da* — ein frisch installierter Nutzer hat damit sofort Ton, statt
  // erst 60 MB herunterladen zu müssen, um überhaupt etwas zu hören.
  for(const name of listWindowsVoices()){
    found.push({id: 'w|' + name, label: name + ' (Windows)', quelle: 'windows'});
  }
  return found;
}

// Stimmen, die die App selbst holen kann.
//
// Der Grund für diese Liste: Bisher musste man Piper-Stimmen bei Hugging Face
// finden, zwei Dateien je Stimme herunterladen und in den richtigen Ordner
// legen. Das ist der Schritt, an dem ein normaler Nutzer aussteigt — und ohne
// Stimme bleibt der halbe Co-Moderator stumm.
//
// Kuratiert statt vollständig: geprüfte deutsche Stimmen mit Größe und einem
// Satz dazu, wofür sie taugt. Wer mehr will, legt weiter von Hand ab.
const STIMM_KATALOG = [
  {id:'thorsten-medium',           pfad:'thorsten/medium',           mb:63,
   name:'Thorsten (mittel)',       hinweis:'guter Allrounder, männlich'},
  {id:'thorsten-high',             pfad:'thorsten/high',             mb:109,
   name:'Thorsten (hoch)',         hinweis:'beste Qualität — hält die Klangfarben besser aus'},
  {id:'thorsten_emotional-medium', pfad:'thorsten_emotional/medium', mb:73,
   name:'Thorsten mit Gefühlen',   hinweis:'acht Stimmungen in einer Datei: wütend, betrunken, flüsternd …'},
  {id:'karlsson-low',              pfad:'karlsson/low',              mb:60,
   name:'Karlsson',                hinweis:'tiefer Mann — die beste Grundlage für Monster'},
  {id:'pavoque-low',               pfad:'pavoque/low',               mb:60,
   name:'Pavoque',                 hinweis:'männlich, ausdrucksstark'},
  {id:'kerstin-low',               pfad:'kerstin/low',               mb:60,
   name:'Kerstin',                 hinweis:'weiblich'},
  {id:'ramona-low',                pfad:'ramona/low',                mb:60,
   name:'Ramona',                  hinweis:'weiblich'},
  {id:'eva_k-x_low',               pfad:'eva_k/x_low',               mb:20,
   name:'Eva K.',                  hinweis:'weiblich, sehr kleine Datei'},
  {id:'mls-medium',                pfad:'mls/medium',                mb:73,
   name:'MLS (viele Sprecher)',    hinweis:'mehrere deutsche Stimmen in einer Datei'},
];
const STIMM_BASIS = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE';

function stimmKatalog(){
  return STIMM_KATALOG.map(s => ({
    ...s,
    da: fs.existsSync(path.join(USER_PIPER, 'de_DE-' + s.id + '.onnx'))
  }));
}

function ladeStimme(id){
  const eintrag = STIMM_KATALOG.find(s => s.id === id);
  if(!eintrag) return Promise.reject(new Error('Unbekannte Stimme: ' + id));
  const datei = 'de_DE-' + eintrag.id;
  fs.mkdirSync(USER_PIPER, {recursive: true});

  const hol = (endung) => new Promise((fertig, schief) => {
    const ziel = path.join(USER_PIPER, datei + endung);
    if(fs.existsSync(ziel)){ fertig(false); return; }
    // Erst in eine Nebendatei, dann umbenennen: Ein abgebrochener Download darf
    // keine halbe .onnx hinterlassen, die die App als Stimme anbietet.
    const roh = ziel + '.teil';
    const strom = fs.createWriteStream(roh);
    const url = STIMM_BASIS + '/' + eintrag.pfad + '/' + datei + endung;
    const anfrage = require('https').get(url, res => {
      if(res.statusCode >= 300 && res.statusCode < 400 && res.headers.location){
        res.resume();
        require('https').get(res.headers.location, r2 => r2.pipe(strom)).on('error', schief);
        return;
      }
      if(res.statusCode !== 200){
        res.resume();
        schief(new Error('HTTP ' + res.statusCode + ' für ' + datei + endung));
        return;
      }
      res.pipe(strom);
    });
    anfrage.on('error', schief);
    strom.on('finish', () => {
      try{ fs.renameSync(roh, ziel); fertig(true); }
      catch(e){ schief(e); }
    });
    strom.on('error', schief);
  });

  return hol('.onnx.json').then(() => hol('.onnx')).then(() => {
    return {ok: true, name: eintrag.name};
  }).catch(e => {
    for(const endung of ['.onnx', '.onnx.json']){
      try{ fs.unlinkSync(path.join(USER_PIPER, datei + endung + '.teil')); }catch(x){}
    }
    return {ok: false, fehler: e.message};
  });
}

// ===========================================================================
//  Stimmen aus der Cloud
//
// Piper klingt sauber, aber flach - es ist auf Tempo bei winzigen Modellen
// gebaut. Wer eine Figur will, die wirklich lebt, kommt an einem Dienst kaum
// vorbei. Bezahlt wird dabei nicht von dieser App, sondern vom Benutzer mit
// seinem eigenen Schluessel; die App bleibt kostenlos und speichert ihn
// verschluesselt daneben, genau wie den fuers Sprachmodell.
//
// Zwei Anbieter, weil sie verschiedene Fragen beantworten: ElevenLabs kann
// Figurenstimmen und eigene Klone, Azure ist um ein Vielfaches guenstiger und
// sehr zuverlaessig, klingt dafuer nach Nachrichtensprecher.
//
// Beide liefern am Ende ein WAV, damit dahinter nichts anders laufen muss als
// bei Piper: Azure kann RIFF direkt, ElevenLabs gibt rohes PCM, dem hier der
// 44-Byte-Kopf vorangestellt wird. Kein Umrechnen, kein zusaetzliches Paket.
// ===========================================================================

const CLOUD = {
  elevenlabs: {name: 'ElevenLabs', braucht: 'Schluessel'},
  azure:      {name: 'Azure Speech', braucht: 'Schluessel und Region'}
};

// Rohes PCM bekommt einen WAV-Kopf. 44 Bytes, fest verdrahtet: 16 Bit, Mono.
function wavKopf(pcm, rate){
  const k = Buffer.alloc(44);
  k.write('RIFF', 0);
  k.writeUInt32LE(36 + pcm.length, 4);
  k.write('WAVEfmt ', 8);
  k.writeUInt32LE(16, 16);          // Laenge des fmt-Blocks
  k.writeUInt16LE(1, 20);           // 1 = unkomprimiertes PCM
  k.writeUInt16LE(1, 22);           // Mono
  k.writeUInt32LE(rate, 24);
  k.writeUInt32LE(rate * 2, 28);    // Bytes je Sekunde
  k.writeUInt16LE(2, 32);           // Bytes je Rahmen
  k.writeUInt16LE(16, 34);          // Bit je Wert
  k.write('data', 36);
  k.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([k, pcm]);
}

// ---- ElevenLabs -----------------------------------------------------------

const XI = 'https://api.elevenlabs.io/v1';
const XI_RATE = 24000;

async function xiStimmen(key){
  const res = await fetch(XI + '/voices',
    {headers: {'xi-api-key': key}, signal: AbortSignal.timeout(10000)});
  if(!res.ok) throw new Error('ElevenLabs: HTTP ' + res.status);
  const d = await res.json();
  // Eigene geklonte Stimmen stehen in derselben Liste - deshalb wird sie
  // geholt statt fest einprogrammiert.
  // Die Art steht dabei, weil sie ueber Erfolg und Misserfolg entscheidet:
  // Stimmen aus der Bibliothek sind auf dem kostenlosen Zugang ueber die
  // Schnittstelle gesperrt (HTTP 402), die mitgelieferten nicht. Ohne diesen
  // Zusatz waehlt man blind und bekommt einen Fehler, der wie ein Defekt
  // aussieht.
  const art = {premade: 'Standard', cloned: 'geklont', generated: 'entworfen',
               professional: 'professionell'};
  return (d.voices || []).map(v => {
    const k = String(v.category || '');
    return {id: v.voice_id, kategorie: k,
            name: v.name + (art[k] ? ' [' + art[k] + ']' : k ? ' [Bibliothek]' : '')};
  });
}

// MP3 statt rohem PCM. PCM waere der kuerzere Weg - kein Dekodieren, kein Kopf
// zum Anbauen -, ist bei ElevenLabs aber je nach Tarif gesperrt. Ein Format,
// das nur auf teuren Zugaengen funktioniert, ist fuer eine App, die jeder
// benutzen soll, das falsche. MP3 geht ueberall, und das Dekodieren macht der
// Browser ohnehin nebenbei.
async function xiSprich(key, stimme, text){
  // Das schnelle Modell, nicht das schoenste: Bei einem Co-Moderator zaehlt die
  // Zeit bis zum ersten Wort. `flash` kann Deutsch und antwortet in einem
  // Bruchteil der Zeit, die das grosse Modell braucht.
  const res = await fetch(XI + '/text-to-speech/' + encodeURIComponent(stimme)
                        + '?output_format=mp3_44100_128', {
    method: 'POST',
    headers: {'xi-api-key': key, 'Content-Type': 'application/json'},
    body: JSON.stringify({text, model_id: 'eleven_flash_v2_5'}),
    signal: AbortSignal.timeout(30000)
  });
  if(!res.ok){
    const warum = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error('ElevenLabs: HTTP ' + res.status + (warum ? ' - ' + warum : ''));
  }
  return {daten: Buffer.from(await res.arrayBuffer()), mime: 'audio/mpeg'};
}

// ---- Azure Speech ---------------------------------------------------------

const azBasis = region => 'https://' + String(region || '').trim().toLowerCase()
                        + '.tts.speech.microsoft.com/cognitiveservices';

async function azStimmen(key, region){
  if(!region) throw new Error('Azure braucht eine Region, etwa westeurope');
  const res = await fetch(azBasis(region) + '/voices/list',
    {headers: {'Ocp-Apim-Subscription-Key': key}, signal: AbortSignal.timeout(10000)});
  if(!res.ok) throw new Error('Azure: HTTP ' + res.status);
  const d = await res.json();
  // Nur Deutsch. Die volle Liste hat ueber vierhundert Eintraege, und eine
  // Auswahl, durch die man scrollen muss, ist keine Auswahl.
  return d.filter(v => String(v.Locale || '').startsWith('de-'))
          .map(v => ({id: v.ShortName,
                      name: v.LocalName + ' (' + v.Locale + ')',
                      kategorie: v.VoiceType || ''}));
}

// Fremder Text geht in XML. Ohne Maskierung zerlegt ein Anfuehrungszeichen aus
// dem Chat die Anfrage - und der Avatar bliebe stumm, ohne dass jemand wuesste
// warum.
const xmlSicher = t => String(t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

async function azSprich(key, region, stimme, text){
  const sprache = (String(stimme).match(/^([a-z]{2}-[A-Z]{2})/) || [])[1] || 'de-DE';
  const ssml = '<speak version="1.0" xml:lang="' + sprache + '">'
             + '<voice name="' + xmlSicher(stimme) + '">' + xmlSicher(text)
             + '</voice></speak>';
  const res = await fetch(azBasis(region) + '/v1', {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/ssml+xml',
      // RIFF: fertiges WAV, kein Kopf zum Anbauen.
      'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm',
      'User-Agent': 'PixelVTuber'
    },
    body: ssml,
    signal: AbortSignal.timeout(30000)
  });
  if(!res.ok){
    const warum = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error('Azure: HTTP ' + res.status + (warum ? ' - ' + warum : ''));
  }
  return {daten: Buffer.from(await res.arrayBuffer()), mime: 'audio/wav'};
}

// Einmal geholt, behalten. Ein Co-Moderator sagt dieselben Saetze oft - jede
// Begruessung, jedes 'Da muss ich passen'. Die jedes Mal neu zu bezahlen und
// darauf zu warten waere Geld und Zeit fuer ein Ergebnis, das schon dalag.
//
// Der Schluessel ist der Text samt Stimme; aendert sich eines von beidem, ist
// es ein anderer Eintrag. Aufgeraeumt wird ab einer Obergrenze, aelteste
// zuerst - sonst waechst der Ordner still vor sich hin.
const CLOUD_CACHE = path.join(app.getPath('userData'), 'stimm-cache');
const CLOUD_CACHE_MAX = 500;

const cacheName = (anbieter, stimme, text) =>
  require('crypto').createHash('sha1')
    .update(anbieter + '|' + stimme + '|' + text).digest('hex') + '.wav';

function cacheLies(name){
  try{ return fs.readFileSync(path.join(CLOUD_CACHE, name)); }catch(e){ return null; }
}

function cacheSchreib(name, daten){
  try{
    fs.mkdirSync(CLOUD_CACHE, {recursive: true});
    fs.writeFileSync(path.join(CLOUD_CACHE, name), daten);
    const alle = fs.readdirSync(CLOUD_CACHE);
    if(alle.length <= CLOUD_CACHE_MAX) return;
    alle.map(f => ({f, t: fs.statSync(path.join(CLOUD_CACHE, f)).mtimeMs}))
        .sort((x, y) => x.t - y.t)
        .slice(0, alle.length - CLOUD_CACHE_MAX)
        .forEach(e => { try{ fs.unlinkSync(path.join(CLOUD_CACHE, e.f)); }catch(x){} });
  }catch(e){ /* ohne Zwischenspeicher geht es auch, nur langsamer */ }
}

// Die Stimmenliste des Dienstes. Gemerkt, solange sich Anbieter und Region
// nicht aendern: Sie bei jedem Blick ins Panel neu zu holen kostet eine
// Netzrunde fuer eine Liste, die sich fast nie aendert.
let cloudMerk = {schluessel: null, stimmen: [], fehler: null};

async function cloudStimmen(cfg){
  const anbieter = cfg && cfg.anbieter;
  if(!anbieter || !CLOUD[anbieter]) return {stimmen: [], fehler: null};
  const key = loadKey('tts');
  if(!key) return {stimmen: [], fehler: 'Kein Schluessel hinterlegt'};

  const merk = anbieter + '|' + (cfg.region || '') + '|' + key.slice(-6);
  if(cloudMerk.schluessel === merk) return cloudMerk;

  try{
    const stimmen = anbieter === 'azure' ? await azStimmen(key, cfg.region)
                                         : await xiStimmen(key);
    cloudMerk = {schluessel: merk, stimmen, fehler: null};
  }catch(err){
    cloudMerk = {schluessel: merk, stimmen: [],
                 fehler: String(err && err.message ? err.message : err)};
  }
  return cloudMerk;
}

async function ttsStatus(cloud){
  const piper = findPiper();
  const voices = listVoices();
  // Bereit heißt: mindestens eine Stimme lässt sich wirklich sprechen. Eine
  // Windows-Stimme braucht dazu kein Piper — vorher hing `ready` daran und ein
  // Nutzer ohne Piper hatte keinen Ton, obwohl Windows welche mitbringt.
  const wolke = await cloudStimmen(cloud);
  for(const v of wolke.stimmen){
    voices.push({id: 'c|' + cloud.anbieter + '|' + v.id,
                 label: v.name + ' (' + CLOUD[cloud.anbieter].name + ')',
                 quelle: 'cloud'});
  }

  // Eine Cloud-Stimme braucht kein Piper - und eine Windows-Stimme auch nicht.
  const nutzbar = voices.filter(v => v.quelle !== 'piper' || !!piper);
  return {
    piper,
    voices,
    folder: USER_PIPER,
    nutzbar: nutzbar.length,
    ready: nutzbar.length > 0,
    cloudFehler: wolke.fehler,
    cloudAnzahl: wolke.stimmen.length,
    cloudSchluessel: hasKey('tts')
  };
}

// `laenge` ist Pipers `length_scale`: kleiner heißt schneller gesprochen.
//
// Gebraucht wird das für die Klangfarben der Stimme. Tiefer klingt sie, indem der
// Renderer sie langsamer abspielt — dabei wird sie aber auch schleppend. Lässt
// man Piper im selben Maß schneller sprechen, hebt sich das auf: tiefe Stimme,
// normales Sprechtempo.
// Eine Windows-Stimme in eine WAV-Datei sprechen.
//
// Derselbe Vertrag wie bei Piper — heraus kommen die Bytes eines fertigen WAV.
// Deshalb passt es ohne Sonderfall in die Kette: Der Ton läuft durch denselben
// Analysator (der Mund bewegt sich mit) und durch dieselbe Klangfarbe.
//
// `laenge` ist Pipers Maß, kleiner heißt schneller. SAPI kennt stattdessen
// `Rate` von -10 bis 10, also umrechnen statt weiterreichen.
function synthWindows(name, text, laenge){
  const out = path.join(os.tmpdir(),
    `vtuber-sapi-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2,8)}.wav`);
  const l = Number(laenge);
  const rate = (isFinite(l) && l > 0.2) ? Math.max(-10, Math.min(10, Math.round((1 / l - 1) * 10))) : 0;
  // Über eine Datei und nicht über die Standardausgabe: PowerShell würde Bytes
  // durch die Textkodierung schicken und das WAV dabei zerstören.
  const skript =
    'Add-Type -AssemblyName System.Speech; ' +
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
    '$s.SelectVoice([Console]::In.ReadLine()); ' +
    '$s.Rate = ' + rate + '; ' +
    '$s.SetOutputToWaveFile([Console]::In.ReadLine()); ' +
    '$s.Speak([Console]::In.ReadLine()); $s.Dispose()';
  return new Promise((resolve, reject) => {
    const kind = require('child_process').execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', skript],
      {timeout: 30000, windowsHide: true}, fehler => {
        if(fehler && !fs.existsSync(out)){
          reject(new Error('Windows-Sprachausgabe fehlgeschlagen: ' + fehler.message));
          return;
        }
        try{
          resolve({wav: fs.readFileSync(out), eigen: false});
        }catch(e){
          reject(new Error('WAV nicht lesbar: ' + e.message));
        }finally{
          try{ fs.unlinkSync(out); }catch(e){}
        }
      });
    // Name, Zielpfad und Text über die Standardeingabe: So kann kein
    // Anführungszeichen im Text die Kommandozeile zerlegen.
    kind.stdin.end(name + '\n' + out + '\n' + String(text).replace(/[\r\n]+/g, ' ') + '\n');
  });
}

// Der Dateiname *ist* der Satz, auf Buchstaben und Ziffern eingekocht:
//   „Moin!"                 -> moin.wav
//   „Da muss ich passen."   -> da_muss_ich_passen.wav
//
// Bewusst ohne Zuordnungsdatei: Eine zweite Datei, die man pflegen muss, ist
// genau der Schritt, den niemand macht. So sieht man am Namen, wozu die Aufnahme
// gehört, und das Panel schreibt einem den erwarteten Namen hin.
function tonName(text){
  return String(text || '')
    .toLowerCase()
    .replace(/[äöüß]/g, m => ({'ä':'ae','ö':'oe','ü':'ue','ß':'ss'}[m]))
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function eigeneAufnahme(text){
  const name = tonName(text);
  if(!name) return null;
  for(const endung of ['.wav', '.mp3', '.ogg']){
    const p = path.join(USER_RECORD, name + endung);
    if(fs.existsSync(p)) return p;
  }
  return null;
}

// Der Weg ueber den Dienst. Faellt er aus - kein Netz, Guthaben leer, Schluessel
// abgelaufen -, wird nicht geschwiegen, sondern auf Piper zurueckgefallen. Ein
// stummer Avatar mitten im Stream ist das schlechteste aller Ergebnisse, und
// eine flach klingende Antwort ist immer noch eine Antwort.
async function synthCloud(wahl, text, laenge, cloud){
  // Azure legt WAV ab, ElevenLabs MP3 - also unter beiden Endungen nachsehen.
  // Nur nach .wav zu suchen hiesse: Der Zwischenspeicher fuellt sich brav und
  // trifft nie, und jeder Satz kostet erneut Guthaben.
  const basis = cacheName(wahl.anbieter, wahl.stimme, text);
  for(const [endung, mime] of [['.wav', 'audio/wav'], ['.mp3', 'audio/mpeg']]){
    const daten = cacheLies(basis.replace(/\.wav$/, endung));
    if(daten) return {wav: daten, eigen: false, ausCache: true, mime};
  }

  const key = loadKey('tts');
  try{
    if(!key) throw new Error('Kein Schluessel fuer die Sprachausgabe hinterlegt');
    const r = wahl.anbieter === 'azure'
      ? await azSprich(key, cloud && cloud.region, wahl.stimme, text)
      : await xiSprich(key, wahl.stimme, text);
    const datei = basis.replace(/\.wav$/, r.mime === 'audio/mpeg' ? '.mp3' : '.wav');
    cacheSchreib(datei, r.daten);
    return {wav: r.daten, eigen: false, mime: r.mime};
  }catch(err){
    const grund = String(err && err.message ? err.message : err);
    // Der Rueckfall braucht eine Piper-Stimme, die es auch gibt. Ohne eine
    // bleibt nur, den Fehler durchzureichen.
    const ersatz = listVoices().find(v => v.quelle === 'piper');
    if(!ersatz || !findPiper()) throw new Error(grund);
    const r = await synth(text, ersatz.id, laenge);
    return Object.assign({}, r, {ersatzFuer: grund});
  }
}

function synth(text, voice, laenge, cloud){
  const clean = String(text || '').trim();
  if(!clean) throw new Error('Kein Text');

  // Zuerst nachsehen, ob es den Satz schon als Aufnahme gibt. Das gilt für jeden
  // Weg — auch für das, was ein Sprachmodell erfindet, falls es zufällig genau
  // diesen Satz sagt.
  const eigen = eigeneAufnahme(clean);
  if(eigen) return Promise.resolve({wav: fs.readFileSync(eigen), eigen: true});

  const wahl = leseStimmId(voice) || leseStimmId((listVoices()[0] || {}).id);
  if(!wahl) throw new Error('Keine Stimme gefunden');
  if(wahl.quelle === 'windows') return synthWindows(wahl.name, clean, laenge);

  if(wahl.quelle === 'cloud') return synthCloud(wahl, clean, laenge, cloud);

  const piper = findPiper();
  if(!piper) throw new Error('piper.exe nicht gefunden — liegt sie im Piper-Ordner?');
  if(!wahl.file || !fs.existsSync(wahl.file)){
    throw new Error('Die gewählte Stimme liegt nicht mehr im Piper-Ordner');
  }
  const model = {file: wahl.file};
  const speaker = wahl.speaker;

  // Über eine Datei statt über die Standardausgabe: Piper schreibt dorthin ein
  // fertiges WAV samt Kopf. Der Weg über die Standardausgabe liefert rohe
  // Samples ohne Kopf, deren Abtastrate man sich erst aus der .json der Stimme
  // zusammensuchen müsste — mehr Kopplung für nichts.
  const out = path.join(os.tmpdir(),
    `vtuber-tts-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2,8)}.wav`);

  return new Promise((resolve, reject) => {
    const args = ['--model', model.file, '--output_file', out];
    // Mehrsprecher-Modelle: ohne das käme immer nur der erste Sprecher, und die
    // acht Gefühlslagen von `thorsten_emotional` lägen ungenutzt in der Datei.
    if(speaker > 0) args.push('--speaker', String(speaker));
    // Nur weiterreichen, was plausibel ist: Ein Tippfehler in der
    // Einstellungsdatei soll Piper nicht mit einem absurden Wert füttern.
    const l = Number(laenge);
    if(isFinite(l) && l >= 0.4 && l <= 2.5 && Math.abs(l - 1) > 0.01){
      args.push('--length_scale', String(l));
    }
    const child = execFile(piper, args,
      {timeout: 30000, windowsHide: true},
      err => {
        let data = null;
        try{ data = fs.readFileSync(out); }catch(e){}
        try{ fs.unlinkSync(out); }catch(e){}

        // Der Fehlercode allein sagt nichts. Piper schreibt seine eigentliche
        // Begründung — fehlendes espeak-ng-data, unpassendes Modell — auf die
        // Fehlerausgabe, und die ist hier das Einzige, womit jemand etwas
        // anfangen kann.
        if(err && !data){
          const why = (err.stderr || '').trim().split('\n').slice(-3).join(' ');
          reject(new Error(why || err.message));
          return;
        }
        if(!data || data.length <= 44){
          reject(new Error('Piper hat kein Audio geliefert'));
          return;
        }
        // Einheitliche Form für alle Wege: `wav` plus die Auskunft, ob es eine
        // eigene Aufnahme war. Der Renderer schaltet daran die Klangfarbe aus.
        resolve({wav: data, eigen: false});
      });

    child.stdin.on('error', () => {});   // bricht Piper früh ab, ist die Pipe schon zu
    child.stdin.end(clean, 'utf8');
  });
}

// ===========================================================================
//  Zuhören (whisper.cpp)
//
// Gemessen auf acht Threads, für gut drei Sekunden Zuruf: `base` 1,1 s,
// `small` 2,2 s — bei gleichem Ergebnis. Deshalb ist `base` die Vorgabe; für
// kurze zugerufene Fragen ist das kein Kompromiss, sondern die ganze Differenz
// zwischen einer Antwort, die kommt, und einer, auf die man wartet.
//
// Der mitgelieferte `whisper-server` wurde ausprobiert und verworfen: Er spart
// nur das Laden des Modells (rund 50 ms, der Rest steckt im Rechnen) und kostet
// dafür einen Dienst, der laufen, überwacht und beendet werden muss.
// ===========================================================================

const STT_THREADS = 8;   // acht physische Kerne; 16 brachte nur noch 6 % (2077 statt 2209 ms)

function findWhisper(){
  for(const rel of ['whisper-cli.exe', path.join('Release', 'whisper-cli.exe')]){
    const full = path.join(USER_WHISPER, rel);
    if(fs.existsSync(full)) return full;
  }
  // Wie bei Piper: Das Archiv darf seinen eigenen Unterordner behalten.
  let entries = [];
  try{ entries = fs.readdirSync(USER_WHISPER, {withFileTypes:true}); }catch(e){ return null; }
  for(const e of entries){
    if(!e.isDirectory()) continue;
    for(const rel of ['whisper-cli.exe', path.join('Release', 'whisper-cli.exe')]){
      const full = path.join(USER_WHISPER, e.name, rel);
      if(fs.existsSync(full)) return full;
    }
  }
  return null;
}

function listSttModels(){
  const found = [];
  const scan = dir => {
    let entries = [];
    try{ entries = fs.readdirSync(dir, {withFileTypes:true}); }catch(e){ return; }
    for(const e of entries){
      const full = path.join(dir, e.name);
      if(e.isDirectory()) scan(full);
      else if(/^ggml-.*\.bin$/i.test(e.name)){
        found.push({file: full, label: e.name.replace(/^ggml-|\.bin$/gi, '')});
      }
    }
  };
  scan(USER_WHISPER);
  return found.sort((a, b) => a.label.localeCompare(b.label));
}

function sttStatus(){
  const cli = findWhisper();
  const models = listSttModels();
  return {cli, models, folder: USER_WHISPER, ready: !!cli && models.length > 0};
}

// `wav` sind die Bytes einer fertigen 16-kHz-Mono-Datei; der Renderer baut sie
// aus dem Mikrofonsignal, das für den Lippensync ohnehin schon anliegt.
function transcribe(wav, model, prompt){
  const cli = findWhisper();
  if(!cli) throw new Error('whisper-cli.exe nicht gefunden — liegt sie im Whisper-Ordner?');

  const models = listSttModels();
  const chosen = models.find(m => m.file === model)
              || models.find(m => /base/i.test(m.label))
              || models[0];
  if(!chosen) throw new Error('Kein Whisper-Modell gefunden (ggml-*.bin)');

  const file = path.join(os.tmpdir(),
    `vtuber-stt-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2,8)}.wav`);
  fs.writeFileSync(file, Buffer.from(wav));

  // `-sns` unterdrückt Tokens für Nicht-Sprache — Atmen, Klicken, Tastatur. Ohne
  // das landet so etwas gern als „(Räuspern)" oder erfundenes Wort im Text und
  // geht als Frage an das Sprachmodell.
  //
  // `--prompt` erzwingt nichts, es macht die genannten Wörter nur wahrscheinlicher.
  // Genau das brauchen Eigennamen und Fachbegriffe, die eine allgemeine Erkennung
  // nicht erwartet.
  const args = ['-m', chosen.file, '-f', file, '-l', 'de', '-nt', '-np', '-sns',
                '-t', String(STT_THREADS)];
  if(prompt && String(prompt).trim()) args.push('--prompt', String(prompt).trim());

  return new Promise((resolve, reject) => {
    execFile(cli, args,
      {timeout: 60000, windowsHide: true, maxBuffer: 4 * 1024 * 1024},
      (err, stdout, stderr) => {
        try{ fs.unlinkSync(file); }catch(e){}
        if(err){
          const why = String(stderr || '').trim().split('\n').slice(-2).join(' ');
          reject(new Error(why || err.message));
          return;
        }
        // `-nt` lässt die Zeitstempel weg, aber die Ladezeilen der Backends
        // stehen weiterhin davor. Übrig bleibt der gesprochene Text.
        const text = String(stdout || '')
          .split('\n')
          .filter(l => l.trim() && !/^(load_backend|read_audio_data|whisper_|main:|system_|ggml_)/.test(l.trim()))
          .join(' ')
          .replace(/\s+/g, ' ')
          .replace(/\[.*?\]/g, '')       // „[BLANK_AUDIO]" und Ähnliches
          .trim();
        resolve(text);
      });
  });
}

// ===========================================================================
//  Sprachmodell (Ollama)
//
// Läuft als eigener Dienst auf 127.0.0.1:11434 und wird hier nur gefragt. Die
// Antwort kommt Stück für Stück zurück, und genau darauf kommt es an: Wartete
// man das Ende ab, stünde vor dem ersten Ton die volle Erzeugungsdauer. So geht
// der erste fertige Satz schon an die Sprachausgabe, während der Rest entsteht.
//
// Auch das läuft im Hauptprozess — nicht weil es den Renderer sonst blockierte,
// sondern damit die Content-Security-Policy im Panel eng bleiben kann und der
// Renderer bei dem bleibt, was er kann: zeichnen.
// ===========================================================================

// Die Adresse ist einstellbar, nicht fest verdrahtet. 127.0.0.1 ist der
// Normalfall, aber nicht der einzige: Wer sein Sprachmodell auf einer zweiten
// Maschine laufen laesst - damit sich Spiel und Modell nicht um dieselbe
// Grafikkarte streiten -, zeigt hier auf deren Adresse im Heimnetz. Und ein
// geaenderter Port kommt oefter vor, als man denkt.
const OLLAMA_STD = 'http://127.0.0.1:11434';
const ollamaBasis = url => String(url || OLLAMA_STD).trim().replace(/\/+$/, '') || OLLAMA_STD;

// Der Schlüssel liegt bewusst *nicht* in der settings.json. Electron bringt mit
// safeStorage die Verschlüsselung des Betriebssystems mit — unter Windows DPAPI,
// gebunden an dein Benutzerkonto. Das kostet keine Zeile Abhängigkeit und macht
// den Unterschied zwischen „Datei kopiert" und „Schlüssel gestohlen".
//
// Er wird auch nie an den Renderer zurückgegeben. Der erfährt nur, *ob* einer
// hinterlegt ist; gebraucht wird er ohnehin nur hier.
// Es gibt inzwischen zwei Schluessel: einen fuers Sprachmodell, einen fuer die
// Sprachausgabe in der Cloud. Getrennt, weil es getrennte Dienste sind - wer
// die Stimme bei ElevenLabs holt, muss dort nicht auch sein Modell laufen
// lassen. Der Dateiname des ersten bleibt, wie er war: Wer schon einen
// Schluessel hinterlegt hat, soll ihn nach dem Update noch haben.
const KEY_FILES = {
  ai:  path.join(app.getPath('userData'), 'aikey.dat'),
  tts: path.join(app.getPath('userData'), 'ttskey.dat')
};

const keyFile = zweck => KEY_FILES[zweck] || KEY_FILES.ai;

function saveKey(zweck, plain){
  const datei = keyFile(zweck);
  if(!plain){
    try{ fs.unlinkSync(datei); }catch(e){}
    return {stored: false};
  }
  if(!safeStorage.isEncryptionAvailable()){
    return {stored: false, error: 'Verschlüsselung steht auf diesem System nicht bereit'};
  }
  fs.writeFileSync(datei, safeStorage.encryptString(String(plain)));
  return {stored: true};
}

function loadKey(zweck){
  try{
    return safeStorage.decryptString(fs.readFileSync(keyFile(zweck)));
  }catch(e){ return null; }
}

const hasKey = zweck => fs.existsSync(keyFile(zweck));

// ---- Zeilenweise durch einen Datenstrom ------------------------------------
//
// Alle drei Anbieter schicken ihre Antwort in Zeilen: Ollama als JSON je Zeile,
// die OpenAI-Schnittstelle als `data: {...}`. Ein Netzwerkpaket endet aber nicht
// zwangsläufig auf einem Zeilenumbruch, deshalb bleibt der angebrochene Rest
// jeweils bis zum nächsten Durchlauf liegen.
async function eachLine(body, onLine){
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let rest = '';
  while(true){
    const {done, value} = await reader.read();
    if(done) break;
    rest += decoder.decode(value, {stream: true});
    const lines = rest.split('\n');
    rest = lines.pop();
    for(const line of lines){
      const t = line.trim();
      if(t) onLine(t);
    }
  }
  if(rest.trim()) onLine(rest.trim());
}

// Die Nachrichtenliste samt Verlauf.
//
// Der Verlauf ist das, was zuletzt gesprochen wurde - ohne ihn steht jede Frage
// fuer sich allein und Folgefragen gehen ins Leere. Er kommt aus dem Renderer
// und wird hier gebaut, damit alle drei Anbieter dieselbe Liste bekommen.
//
// Beschnitten wird trotzdem: Der Renderer haelt sich an seine Grenze, aber diese
// Funktion ist die Stelle, die es garantiert. Eine kaputte oder alte Einstellung
// darf keinen Prompt aufblaehen, auf den man dann sekundenlang wartet.
const VERLAUF_MAX_WECHSEL = 8;
const VERLAUF_MAX_ZEICHEN = 400;   // je Zeile - eine Textwand kostet Zeit

function baueNachrichten(system, prompt, verlauf){
  const raus = system ? [{role: 'system', content: system}] : [];

  const kurz = t => {
    const s = String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
    return s.length > VERLAUF_MAX_ZEICHEN ? s.slice(0, VERLAUF_MAX_ZEICHEN) + ' …' : s;
  };

  const liste = Array.isArray(verlauf) ? verlauf.slice(-VERLAUF_MAX_WECHSEL) : [];
  for(const w of liste){
    if(!w) continue;
    const f = kurz(w.frage), a = kurz(w.antwort);
    // Nur vollstaendige Wechsel. Eine Frage ohne Antwort haette das Modell
    // schon einmal unbeantwortet gesehen - und faengt an, das nachzumachen.
    if(!f || !a) continue;
    raus.push({role: 'user', content: f});
    raus.push({role: 'assistant', content: a});
  }

  raus.push({role: 'user', content: prompt});
  return raus;
}

// ---- Ollama ----------------------------------------------------------------

async function ollamaModels(url){
  const res = await fetch(ollamaBasis(url) + '/api/tags', {signal: AbortSignal.timeout(3000)});
  if(!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return (data.models || []).map(m => m.name).sort();
}

async function askOllama({model, system, prompt, url, maxTokens, verlauf, signal, send}){
  const res = await fetch(ollamaBasis(url) + '/api/chat', {
    method: 'POST', signal,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      model, stream: true,
      messages: baueNachrichten(system, prompt, verlauf),
      options: {num_predict: maxTokens, temperature: 0.8}
    })
  });
  if(!res.ok) throw new Error('Ollama: HTTP ' + res.status + ' — Modell vorhanden?');

  let full = '', schluss = null;
  await eachLine(res.body, line => {
    let msg;
    try{ msg = JSON.parse(line); }catch(e){ return; }
    if(msg.done_reason) schluss = msg.done_reason;
    const delta = msg.message && msg.message.content ? msg.message.content : '';
    if(delta){ full += delta; send(delta); }
  });

  // Auch hier gilt: Ein Abbruch wegen Länge, bevor das erste Wort steht, ist
  // kein leeres Ergebnis, sondern eine zu enge Grenze. Ohne diese Zeile meldet
  // das Panel „fertig" und der Avatar steht stumm da.
  if(!full && schluss === 'length'){
    throw new Error('Die Höchstlänge war vor dem ersten Wort aufgebraucht — setz sie höher.');
  }
  return full;
}

// ---- OpenAI-kompatibel -----------------------------------------------------
//
// Eine Schnittstelle, viele Anbieter: OpenAI selbst, aber ebenso LM Studio,
// llama.cpp, KoboldCpp, Groq oder OpenRouter. Umgestellt wird über die Adresse,
// nicht über Code. Lokale Server brauchen keinen Schlüssel — deshalb ist der
// Kopf nur dann dabei, wenn einer hinterlegt ist.
function openAiHeaders(){
  const key = loadKey('ai');
  return Object.assign({'Content-Type': 'application/json'},
                       key ? {Authorization: 'Bearer ' + key} : {});
}

const openAiBase = url => String(url || 'https://api.openai.com/v1').replace(/\/+$/, '');

async function openAiModels(url){
  const res = await fetch(openAiBase(url) + '/models',
                          {headers: openAiHeaders(), signal: AbortSignal.timeout(8000)});
  if(!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return (data.data || []).map(m => m.id).sort();
}

async function askOpenAi({model, system, prompt, url, maxTokens, thinking, verlauf, signal, send}){
  const res = await fetch(openAiBase(url) + '/chat/completions', {
    method: 'POST', signal,
    headers: openAiHeaders(),
    body: JSON.stringify({
      model, stream: true, max_tokens: maxTokens,
      // Denkmodelle schreiben ihre Überlegung in einen eigenen Kanal, den hier
      // niemand liest — sie zählt aber gegen `max_tokens`. Gemessen an Qwen3.5
      // in LM Studio: 1298 Zeichen Nachdenken, dann Schluss wegen Länge, kein
      // einziges Wort Antwort. Mit dem Schalter kommt das erste Wort nach
      // 395 ms statt gar nicht.
      //
      // Von den Wegen, die dafür kursieren, wirkt nur dieser: Weder
      // `chat_template_kwargs` noch ein `/no_think` im Text ändern etwas — das
      // eine wird stillschweigend geschluckt, das andere halbiert es bestenfalls.
      //
      // Nicht fest verdrahtet, weil hinter dieser Schnittstelle auch OpenAI
      // selbst, Groq und OpenRouter stecken: Ein unbekanntes Feld kann dort ein
      // `400` auslösen. Deshalb ein Häkchen im Panel.
      ...(thinking ? {} : {reasoning_effort: 'none'}),
      messages: baueNachrichten(system, prompt, verlauf)
    })
  });
  if(!res.ok){
    const why = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error('HTTP ' + res.status + (why ? ' — ' + why : ''));
  }

  let full = '', schluss = null, gedacht = 0;
  await eachLine(res.body, line => {
    if(!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if(payload === '[DONE]') return;
    let msg;
    try{ msg = JSON.parse(payload); }catch(e){ return; }
    const choice = msg.choices && msg.choices[0];
    if(!choice) return;
    if(choice.finish_reason) schluss = choice.finish_reason;
    const delta = choice.delta && choice.delta.content ? choice.delta.content : '';
    if(delta){ full += delta; send(delta); }
    // Nur mitzählen, nicht weiterreichen: Das Nachdenken soll niemand hören.
    // Gebraucht wird es für die Auskunft unten — ohne sie sieht ein Abbruch aus
    // wie eine leere Antwort, und man sucht den Fehler bei der Figur.
    const denk = choice.delta && choice.delta.reasoning_content;
    if(denk) gedacht += String(denk).length;
  });

  if(!full && schluss === 'length'){
    throw new Error(gedacht
      ? 'Die Höchstlänge war vor dem ersten Wort aufgebraucht: Das Modell hat '
        + gedacht + ' Zeichen lang nachgedacht. Häkchen „Nachdenken zulassen" aus '
        + '— oder die Höchstlänge hoch.'
      : 'Die Höchstlänge war vor dem ersten Wort aufgebraucht — setz sie höher.');
  }
  return full;
}

// ---- Anthropic -------------------------------------------------------------

function anthropicClient(){
  const key = loadKey('ai');
  if(!key) throw new Error('Kein API-Schlüssel hinterlegt');
  const mod = require('@anthropic-ai/sdk');
  const Anthropic = mod.default || mod;
  return new Anthropic({apiKey: key});
}

async function anthropicModels(){
  const out = [];
  for await (const m of anthropicClient().models.list()) out.push(m.id);
  return out.sort();
}

async function askAnthropic({model, system, prompt, maxTokens, verlauf, signal, send}){
  let full = '';
  const stream = anthropicClient().messages.stream({
    model,
    max_tokens: maxTokens,
    ...(system ? {system} : {}),
    // Anthropic nimmt `system` getrennt - deshalb hier ohne, der Verlauf bleibt.
    messages: baueNachrichten('', prompt, verlauf),
    // Zwei kurze Sätze in den Stream zu sprechen ist keine Denkaufgabe, und
    // Nachdenken kostet genau das, worauf es hier ankommt: die Sekunden bis zum
    // ersten Ton. Abgeschaltet wird es trotzdem nicht — auf den aktuellen
    // Modellen bringt das Ausschalten eigene Fehlerbilder mit (ausgeplauderte
    // interne Marken im Antworttext), während ein niedriger Aufwand denselben
    // Zeitgewinn ohne diese Nebenwirkungen bringt.
    thinking: {type: 'adaptive'},
    output_config: {effort: 'low'}
  }, {signal});

  stream.on('text', delta => { full += delta; send(delta); });

  const message = await stream.finalMessage();
  // Eine Ablehnung kommt als *erfolgreiche* Antwort mit leerem Inhalt zurück.
  // Ohne diese Abfrage bliebe der Avatar wortlos stehen, und niemand wüsste
  // warum.
  if(!full && message.stop_reason === 'max_tokens'){
    throw new Error('Die Höchstlänge war vor dem ersten Wort aufgebraucht — setz sie höher.');
  }
  if(message.stop_reason === 'refusal'){
    const why = message.stop_details && message.stop_details.category;
    throw new Error('Die Anfrage wurde abgelehnt' + (why ? ' (' + why + ')' : ''));
  }
  return full;
}

// ---- Vorgefertigte Antworten -----------------------------------------------
//
// Der Co-Moderator ohne Sprachmodell. Klingt nach Rückschritt, ist aber für
// vieles die bessere Wahl: kein VRAM, keine Wartezeit, keine erfundenen
// Tatsachen — und man weiß vorher genau, was er sagen kann.
//
// Gesucht wird nach Stichwörtern statt nach exakten Fragen: Niemand tippt eine
// Frage zweimal gleich, und eine Erkennung schreibt sie ohnehin jedes Mal
// anders.
const CANNED_FILE = 'antworten.json';

function cannedPaths(){
  return [
    path.join(app.getPath('userData'), CANNED_FILE),   // eigene, überschreibt die mitgelieferte
    path.join(__dirname, CANNED_FILE)          // mitgeliefert
  ];
}

function loadCanned(){
  for(const p of cannedPaths()){
    try{
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      if(Array.isArray(data.antworten)) return {data, from: p};
    }catch(e){}
  }
  return null;
}

const pickOne = list => Array.isArray(list) && list.length
  ? list[Math.floor(Math.random() * list.length)] : '';

// Kleingeschrieben und ohne Satzzeichen, damit „Hallo!" und „hallo" dasselbe
// treffen. Die Stichwörter genauso, sonst müsste man sie perfekt tippen.
const normText = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')
                               .replace(/\s+/g, ' ').trim();

// Von oben nach unten: Was weiter oben steht, gewinnt. So kann man enge Fälle
// vor weite setzen, ohne eine Rangfolge zu erfinden.
function matchList(list, text){
  if(!Array.isArray(list)) return '';
  const q = normText(text);
  for(const entry of list){
    const keys = Array.isArray(entry.wenn) ? entry.wenn : [entry.wenn];
    if(keys.some(k => k && q.includes(normText(k)))){
      const a = pickOne(entry.dann);
      if(a) return a;
    }
  }
  return '';
}

function cannedAnswer(prompt, meta){
  const found = loadCanned();
  if(!found) throw new Error('Keine antworten.json gefunden');
  const d = found.data;
  const kind = meta && meta.kind;

  // Ein Kommentar zum Chat ist etwas anderes als eine Antwort auf eine Frage:
  // Niemand hat ihn etwas gefragt, er sagt von sich aus etwas zu einer Zeile,
  // die vorbeigelaufen ist. Deshalb eine eigene Liste — die Frageliste würde
  // hier „Da muss ich passen" sagen, was auf einen Kommentar nicht passt.
  if(kind === 'chat'){
    const said = (meta && meta.text) || '';
    const who  = (meta && meta.who)  || 'jemand';
    const line = matchList(d.chat, said) || pickOne(d.chat_sonst);
    // {name} steht für den Schreiber. Ohne das klängen die allgemeinen
    // Kommentare bei jedem Mal gleich, egal wer etwas geschrieben hat.
    return String(line || '').replace(/\{name\}/g, who) || '';
  }

  return matchList(d.antworten, prompt)
      || pickOne(d.sonst)
      || 'Dazu habe ich nichts.';
}

// ---- Charakterdatei --------------------------------------------------------
//
// Das Feld im Panel ist fünf Zeilen hoch, und das ist richtig so: Dort stehen die
// Regeln, die aus der Sprachausgabe folgen — reiner Fließtext, keine Sternchen,
// keine Aufzählungen. Wer die Figur *ist*, ist etwas anderes und braucht Platz,
// Gliederung und einen Editor. Deshalb darf daneben eine Markdown-Datei liegen,
// die bei jeder Frage frisch gelesen wird. Frisch, weil eine Änderung sonst erst
// nach einem Neustart wirkte — mitten im Stream ist das der Unterschied zwischen
// „kurz nachschärfen" und „gar nicht erst versuchen".
//
// Frisch lesen kostet dabei nichts, was zählt: Ein paar Kilobyte von der Platte
// sind gegen die Zeit bis zum ersten gesprochenen Wort nicht messbar.
//
// Eine solche Datei ist aber selten von der ersten bis zur letzten Zeile für das
// Modell bestimmt. Sie hat eine Überschrift, ein Vorwort, vielleicht Notizen für
// den, der sie pflegt. Zwei Marker grenzen deshalb ab, was wirklich hinausgeht;
// fehlen sie, gilt die ganze Datei. Als HTML-Kommentar, weil der in gerendertem
// Markdown unsichtbar bleibt — die Datei sieht überall unverändert aus.
const PERSONA_START = '<!-- start -->';
const PERSONA_END   = '<!-- ende -->';

// Ab hier wird gewarnt. Nicht abgeschnitten: Einen Charakter mitten im Satz zu
// kappen richtet mehr Schaden an als ein langer Prompt, und was zu viel ist,
// weiß nur der, der die Datei geschrieben hat.
const PERSONA_WARN = 8000;

// Harte Obergrenze und erlaubte Endungen — dieselben, die auch der Dateiwähler
// anbietet. Warnen reicht hier nicht: Anders als bei der Länge geht es nicht um
// Geschmack, sondern darum, dass diese Datei bei jeder Frage gelesen wird.
const PERSONA_MAX = 1024 * 1024;
const PERSONA_ENDUNGEN = ['.md', '.txt'];

// Gibt immer dasselbe Objekt zurück — für die echte Anfrage wie für die Vorschau
// im Panel. Genau darum steht es in *einer* Funktion: Eine Vorschau, die ihren
// Text aus einer zweiten Codestelle holt, weicht früher oder später von dem ab,
// was tatsächlich gefragt wird, und dann sucht man den Fehler im Modell.
function personaText(file){
  const leer = {text: '', zeichen: 0, von: 0, bis: 0, zeilen: 0, datei: file || ''};
  if(!file) return leer;

  let roh;
  try{
    // Der Renderer nennt einen Pfad, der Hauptprozess liest ihn — also die
    // Stelle, an der ein Tippfehler oder ein durchgereichter Unsinn teuer wird.
    // Das ist hier keine Vertrauensgrenze (der Renderer ist eigener Code hinter
    // enger CSP), sondern Schutz vor dem, was wirklich passiert: eine
    // versehentlich gewählte Videodatei, ein Ordner, ein Netzlaufwerk.
    const st = fs.statSync(file);
    if(!st.isFile()) throw new Error('ist keine Datei');
    // Gelesen wird bei *jeder* Frage. Ein Gigabyte an dieser Stelle hielte den
    // Hauptprozess an, und zwar mitten im Stream.
    if(st.size > PERSONA_MAX) {
      throw new Error('ist zu groß: ' + Math.round(st.size/1024) + ' kB, erlaubt sind '
                    + (PERSONA_MAX/1024) + ' kB');
    }
    if(!PERSONA_ENDUNGEN.includes(path.extname(file).toLowerCase())){
      throw new Error('braucht die Endung ' + PERSONA_ENDUNGEN.join(' oder '));
    }
    roh = fs.readFileSync(file, 'utf8');
  }catch(e){
    // Umbenannt, verschoben, Laufwerk weg. Kein Grund, die Antwort zu verweigern
    // — ohne Charakter zu reden ist im Stream immer noch besser als zu schweigen.
    // Sichtbar wird es trotzdem: Der Fehler geht ans Panel.
    // Der häufigste Fall verdient den klarsten Satz: verschoben, umbenannt,
    // Laufwerk nicht da. „ENOENT … stat" beantwortet dieselbe Frage, nur schlechter.
    const grund = e && e.code === 'ENOENT' ? 'nicht gefunden'
                : e && e.message ? e.message : String(e);
    return Object.assign({}, leer, {fehler: 'Charakterdatei ' + grund + ': ' + file});
  }

  // Zeilenweise, damit sich am Ende sagen lässt, *welche* Zeilen hinausgehen.
  // „2,1 KB" allein beantwortet die Frage nicht, ob der Ausschnitt der richtige
  // ist; „Zeile 15 bis 43" beantwortet sie.
  const alle = roh.split(/\r?\n/);
  const findeMarke = marke => alle.findIndex(z => z.trim().toLowerCase() === marke);

  const s = findeMarke(PERSONA_START);
  const e = findeMarke(PERSONA_END);
  const von = s < 0 ? 0 : s + 1;                       // die Marke selbst nicht mit
  const bis = e < 0 || e < von ? alle.length : e;      // ein Ende vor dem Anfang zählt nicht

  const text = alle.slice(von, bis).join('\n').trim();
  return {
    text,
    zeichen: text.length,
    von: von + 1, bis,             // fürs Panel: bei 1 gezählt, wie in jedem Editor
    zeilen: alle.length,
    datei: file,
    lang: text.length > PERSONA_WARN
  };
}

// Das kurze Feld bleibt oben. Was aus der Sprachausgabe folgt, soll nicht
// verlorengehen, nur weil jemand seine Charakterdatei umschreibt — sonst kommen
// Aufzählungen und Sternchen zurück, die die Stimme brav mitliest.
function buildSystem(system, personaFile){
  const p = personaText(personaFile).text;
  return [String(system || '').trim(), p].filter(Boolean).join('\n\n');
}

// ---- gemeinsame Fassade ----------------------------------------------------

// Wie viel er höchstens sagen darf. Das ist keine Kostenbremse — lokal kostet
// nichts —, sondern eine Redezeitgrenze: Jedes Token wird ausgesprochen, und
// dazwischenreden kann man ihm nicht. Ohne Grenze redet ein gesprächiges Modell
// minutenlang weiter, während der Chat wartet.
//
// Einstellbar im Panel, weil die richtige Zahl von Modell und Figur abhängt und
// niemand sie vorher weiß: 300 sind zwei bis drei Sätze mit Luft, ein knapper
// Charakter kommt mit 80 aus. Die Grenzen hier fangen nur das Sinnlose ab —
// unter 20 bleibt kein ganzer Satz übrig, über 2000 redet er, bis jemand STOP
// drückt.
const AI_MAX_TOKENS = 300;
const AI_TOKENS_MIN = 20;
const AI_TOKENS_MAX = 2000;

const tokenGrenze = n => {
  n = Math.round(Number(n));
  if(!Number.isFinite(n) || n <= 0) return AI_MAX_TOKENS;
  return Math.min(AI_TOKENS_MAX, Math.max(AI_TOKENS_MIN, n));
};

async function aiStatus(cfg){
  const backend = (cfg && cfg.backend) || 'ollama';
  try{
    if(backend === 'canned'){
      const found = loadCanned();
      if(!found) return {ok:false, backend, models:[], error:'antworten.json nicht gefunden'};
      const n = found.data.antworten.length;
      return {ok:true, backend, models:[], needsKey:false, canned:n,
              info: n + ' Regeln aus ' + found.from};
    }
    if(backend === 'ollama')    return {ok: true, backend, models: await ollamaModels(cfg && cfg.url), needsKey: false};
    if(backend === 'anthropic') return {ok: true, backend, models: hasKey('ai') ? await anthropicModels() : [],
                                        needsKey: !hasKey('ai'), hasKey: hasKey('ai')};
    return {ok: true, backend, models: await openAiModels(cfg && cfg.url), needsKey: false, hasKey: hasKey('ai')};
  }catch(err){
    return {
      ok: false, backend, models: [], hasKey: hasKey('ai'),
      error: backend === 'ollama' ? 'Ollama antwortet nicht auf ' + ollamaBasis(cfg && cfg.url)
                                  : String(err && err.message ? err.message : err)
    };
  }
}

let aiAbort = null;

async function aiAsk(sender, req){
  // Eine neue Frage bricht die alte ab. Zwei Antworten gleichzeitig hätten nur
  // ein Ziel — denselben Mund.
  if(aiAbort) aiAbort.abort();
  aiAbort = new AbortController();
  const signal = aiAbort.signal;

  const send = delta => { if(!sender.isDestroyed()) sender.send('ai:delta', delta); };
  // Der Systemtext wird hier zusammengesetzt, nicht im Renderer: So bekommen
  // Ollama, die OpenAI-Schnittstelle und Anthropic garantiert denselben, statt
  // dass er an drei Stellen entsteht und an zweien altert.
  const args = Object.assign({}, req, {
    system: buildSystem(req.system, req.personaFile),
    maxTokens: tokenGrenze(req.maxTokens), thinking: !!req.thinking, signal, send
  });

  try{
    if(req.backend === 'canned'){
      // Ohne Modell gibt es nichts zu streamen — der Satz steht sofort fest.
      const text = cannedAnswer(req.prompt, req.meta);
      send(text);
      return text;
    }
    // Eine leere Antwort ist nie ein Erfolg. Die Anbieter melden oben, *warum*
    // sie leer blieb, wenn sie es wissen; hier bleibt der Fall übrig, in dem es
    // niemand sagt. Ohne diese Zeile stünde im Panel „Antwort fertig nach 23 s",
    // während der Avatar stumm dasteht — die teuerste Art, einen Fehler zu
    // verstecken.
    const text = req.backend === 'anthropic' ? await askAnthropic(args)
               : req.backend === 'openai'    ? await askOpenAi(args)
               :                               await askOllama(args);
    if(!text.trim()) throw new Error('Das Modell hat nichts zurückgegeben.');
    return text;
  }finally{
    if(aiAbort && aiAbort.signal === signal) aiAbort = null;
  }
}

function startApp(){
  try{ fs.mkdirSync(USER_SPRITES, {recursive: true}); }catch(e){}
  try{ fs.mkdirSync(USER_PIPER, {recursive: true}); }catch(e){}
  try{ fs.mkdirSync(USER_WHISPER, {recursive: true}); }catch(e){}

  // Nebenher, nicht davor: Der Start des Fensters wartet auf nichts.
  waermeStimmen();

  // The app's only use of a device is the microphone for lip sync. Grant that,
  // refuse everything else rather than leaving the default wide open.
  const darf = permission => permission === 'media' || permission === 'audioCapture';

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(darf(permission));
  });
  // Der zweite, synchrone Weg. Nicht jede Abfrage geht über den Handler darüber —
  // manche Prüfungen laufen ohne Rückfrage und bekamen bisher die Vorgabe, also
  // ein Ja. Ein Riegel, der nur eine von zwei Türen abschließt, ist keiner.
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => darf(permission));

  // Ein Link im Panel führt nach draußen — der gehört in den Browser. Ohne das
  // öffnete Electron ihn in einem eigenen Fenster: eine Webseite mitten in einer
  // App, die nichts als einen Avatar zeichnen soll, ohne Adresszeile und ohne Weg
  // zurück. Aus demselben Grund darf auch das Panel selbst nicht wegnavigieren.
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({url}) => {
      if(/^https?:/.test(url)) shell.openExternal(url);
      return {action: 'deny'};
    });
    contents.on('will-navigate', (event, url) => {
      if(url !== contents.getURL()) event.preventDefault();
    });
  });

  createWindow();
  createTray();

  ipcMain.handle('settings:load', () => readSettings());
  // Merge rather than replace: window bounds and the always-on-top state are
  // written by the main process and are not part of what the renderer sends
  // back, so a plain overwrite would drop them on every settings change.
  ipcMain.handle('settings:save', (_e, data) =>
    writeSettings(Object.assign(readSettings(), data)));

  // Let the renderer discover what is actually there instead of hardcoding a
  // list — dropping a new PNG in should be enough to use it. Two sources:
  // the sprites shipped with the app, and a folder next to the settings that
  // the user can actually write to. In a packaged build the first one lives
  // inside the asar archive, so without the second one the bundled demo figure
  // could never be replaced.
  ipcMain.handle('sprites:list', () => {
    const seen = new Map();   // Dateiname -> URL, Benutzerordner gewinnt
    const add = (dir, toUrl) => {
      let files = [];
      try{ files = fs.readdirSync(dir); }catch(e){ return; }
      for(const f of files){
        // .glb/.gltf gehören in denselben Ordner: Eine Figur ist eine Figur,
        // ob als Bild oder als Modell — zwei Ordner wären zwei Erklärungen.
        if(/\.(png|webp|gif|glb|gltf|vrm)$/i.test(f)) seen.set(f, toUrl(f));
      }
    };
    add(path.join(__dirname, 'sprites'), f => '../sprites/' + encodeURIComponent(f));
    add(USER_SPRITES, f => 'file:///' + path.join(USER_SPRITES, f).replace(/\\/g, '/')
                                            .split('/').map(encodeURIComponent).join('/'));
    return [...seen.entries()]
      .map(([file, url]) => ({file, url}))
      .sort((a, b) => a.file.localeCompare(b.file));
  });

  ipcMain.handle('sprites:folder', () => USER_SPRITES);
  ipcMain.handle('sprites:openFolder', () => shell.openPath(USER_SPRITES));

  // Die Anleitung geht in einem eigenen Fenster auf, nicht im Browser.
  //
  // Vorher war es der Standardbrowser, aus einem richtigen Grund: Sie soll neben
  // der App stehen bleiben, während man ihr folgt. Der Preis war aber hoch — auf
  // manchen Rechnern öffnet eine lokale HTML-Datei gar nichts, auf anderen einen
  // Editor, und ein Nutzer, der zum ersten Mal auf 'Anleitung' klickt und nichts
  // passieren sieht, kommt nicht wieder.
  //
  // Der ursprüngliche Einwand bleibt trotzdem gültig, deshalb ist dieses Fenster
  // ausdrücklich *kein* Overlay: gewöhnlicher Rahmen, nicht im Vordergrund, und es
  // legt sich neben den Avatar statt darüber. Wer es zuklappt, verliert nichts;
  // wer erneut klickt, bekommt das vorhandene nach vorn statt eines zweiten.
  // Die Version kommt aus `app.getVersion()`, nicht aus einer zweiten Stelle im
  // Renderer: Zwei Zahlen, die man von Hand gleich halten muss, sind irgendwann
  // nicht mehr gleich - und dann meldet jemand einen Fehler zu einer Fassung,
  // die es nie gab.
  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('help:open', () => {
    const datei = echterPfad(path.join(__dirname, 'renderer', 'anleitung.html'));
    if(!fs.existsSync(datei)) return false;

    if(hilfeFenster && !hilfeFenster.isDestroyed()){
      if(hilfeFenster.isMinimized()) hilfeFenster.restore();
      hilfeFenster.focus();
      return true;
    }

    // Neben die App, wenn dort Platz ist — sonst überlässt man dem Betriebssystem
    // die Wahl. Ein Fenster halb außerhalb des Bildschirms wäre schlimmer als
    // eines an unerwarteter Stelle.
    const flaeche = screen.getPrimaryDisplay().workArea;
    const breite = Math.min(920, Math.max(560, flaeche.width - 80));
    const hoehe  = Math.min(1000, flaeche.height - 60);
    let x, y;
    try{
      const b = win.getBounds();
      const links = b.x - breite - 20;
      const rechts = b.x + b.width + 20;
      if(links >= flaeche.x) x = links;
      else if(rechts + breite <= flaeche.x + flaeche.width) x = rechts;
      y = Math.max(flaeche.y, Math.min(b.y, flaeche.y + flaeche.height - hoehe));
    }catch(e){}

    hilfeFenster = new BrowserWindow({
      width: breite, height: hoehe,
      ...(x === undefined ? {} : {x, y}),
      title: 'Pixel VTuber — Anleitung',
      // Die Anleitung folgt dem Systemthema. Eine fest helle Fensterfarbe
      // blitzt auf einem dunklen System kurz weiss auf, bevor die Seite steht.
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#14161b' : '#f2f3f6',
      autoHideMenuBar: true,
      // Kein alwaysOnTop: Die Anleitung soll man lesen können, während man das
      // Beschriebene ausprobiert — nicht dabei im Weg stehen.
      alwaysOnTop: false,
      webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false}
    });
    hilfeFenster.setMenuBarVisibility(false);
    hilfeFenster.loadFile(datei);
    hilfeFenster.on('closed', () => { hilfeFenster = null; });
    return true;
  });

  ipcMain.handle('anim:status', () => ({pfad: findeBlender()}));
  ipcMain.handle('anim:choose', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Animation hinzufügen',
      properties: ['openFile', 'multiSelections'],
      filters: [{name: 'Animationen', extensions: ['fbx', 'glb', 'gltf']}]
    });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('anim:add', (_e, pfade, modell) => animHinzufuegen(pfade, modell));

  ipcMain.handle('tts:status', (_e, cloud) => ttsStatus(cloud));
  ipcMain.handle('tts:folder', () => USER_PIPER);
  ipcMain.handle('tts:catalog', () => stimmKatalog());
  ipcMain.handle('tts:download', (_e, id) => ladeStimme(id));
  ipcMain.handle('tts:openFolder', () => shell.openPath(USER_PIPER));
  ipcMain.handle('rec:openFolder', () => {
    fs.mkdirSync(USER_RECORD, {recursive: true});
    return shell.openPath(USER_RECORD);
  });
  // Wie die Aufnahme heißen muss, damit sie für diesen Satz genommen wird — und
  // ob sie schon da ist. Ohne diese Auskunft wäre die Benennung Ratearbeit.
  ipcMain.handle('rec:name', (_e, text) => {
    const name = tonName(text);
    return {name: name ? name + '.wav' : '', da: !!eigeneAufnahme(text), ordner: USER_RECORD};
  });
  ipcMain.handle('ai:openCanned', () => {
    // Beim ersten Mal die mitgelieferte Liste hinüberkopieren, damit man eine
    // Vorlage zum Ändern hat statt einer leeren Datei.
    const own = path.join(app.getPath('userData'), CANNED_FILE);
    if(!fs.existsSync(own)){
      try{ fs.copyFileSync(path.join(__dirname, CANNED_FILE), own); }catch(e){}
    }
    return shell.openPath(own);
  });
  ipcMain.handle('tts:synth', (_e, text, voice, laenge, cloud) => synth(text, voice, laenge, cloud));
  // Setzen und Loeschen, nie Lesen - wie beim Schluessel fuers Sprachmodell.
  ipcMain.handle('tts:setKey', (_e, key) => {
    cloudMerk = {schluessel: null, stimmen: [], fehler: null};   // Liste neu holen
    return saveKey('tts', key);
  });
  ipcMain.handle('tts:anbieter', () => Object.entries(CLOUD)
    .map(([id, a]) => ({id, name: a.name, braucht: a.braucht})));
  ipcMain.handle('tts:cacheLeeren', () => {
    let n = 0;
    try{
      for(const f of fs.readdirSync(CLOUD_CACHE)){
        fs.unlinkSync(path.join(CLOUD_CACHE, f)); n++;
      }
    }catch(e){}
    return n;
  });

  ipcMain.handle('stt:status', () => sttStatus());
  ipcMain.handle('stt:folder', () => USER_WHISPER);
  ipcMain.handle('stt:openFolder', () => shell.openPath(USER_WHISPER));
  ipcMain.handle('stt:transcribe', (_e, wav, model, prompt) => transcribe(wav, model, prompt));

  ipcMain.handle('ai:status', (_e, cfg) => aiStatus(cfg));
  // Setzen und Löschen, nie Lesen: Der Renderer bekommt den Schlüssel nicht
  // zurück, er erfährt aus dem Status nur, ob einer hinterlegt ist.
  ipcMain.handle('ai:setKey', (_e, key) => saveKey('ai', key));
  ipcMain.handle('ai:ask', (e, req) => aiAsk(e.sender, req));
  ipcMain.handle('ai:stop', () => { if(aiAbort) aiAbort.abort(); aiAbort = null; });

  // Die Charakterdatei aussuchen. Ein Pfad zum Eintippen wäre hier die schlechtere
  // Bedienung: Man tippt ihn einmal falsch und sucht den Fehler danach im Modell.
  ipcMain.handle('ai:pickPersona', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Charakterdatei wählen',
      properties: ['openFile'],
      filters: [{name: 'Text', extensions: ['md', 'txt']}]
    });
    return r.canceled ? '' : r.filePaths[0];
  });
  // Fürs Panel: derselbe Text, den auch die echte Anfrage bekäme — samt Länge,
  // Zeilenbereich und Fehler, falls die Datei nicht mehr da ist.
  ipcMain.handle('ai:persona', (_e, file) => personaText(file));

  ipcMain.handle('hotkeys:apply', (_e, map) => applyShortcuts(map));

  ipcMain.handle('window:setAlwaysOnTop', (_e, on) => {
    if(!win) return false;
    const s = readSettings();
    s.alwaysOnTop = !!on;
    writeSettings(s);
    return applyAlwaysOnTop();
  });

  // Click-through: lets the avatar sit over other windows without touching the
  // mouse at all. See setPassthrough for why there is no half measure.
  ipcMain.handle('window:setClickThrough', (_e, on) => setPassthrough(on));

  ipcMain.handle('window:setHoverBar', (_e, on) => {
    const s = readSettings();
    s.hoverBar = !!on;
    writeSettings(s);
    if(!win || win.isDestroyed()) return !!on;
    stopHoverWatch();
    // Nur bei geschlossenem Panel: bei offenem Panel muss das Fenster klickbar
    // bleiben, egal was mit der Leiste passiert.
    if(!passthrough) return !!on;
    if(on) startHoverWatch();
    else   win.setIgnoreMouseEvents(true);   // auch wenn die Maus gerade oben steht
    return !!on;
  });

  ipcMain.handle('window:setSize', (_e, w, h) => {
    if(!win) return false;
    win.setSize(Math.round(w), Math.round(h));
    return true;
  });

  ipcMain.handle('window:getSize', () => (win ? win.getSize() : [0,0]));

  // Ein offenes Gespräch anzeigen, ohne dabei ins Bild zu geraten. Alles im
  // Fenster landet in der OBS-Fensteraufnahme, und der Fenstertitel ist genau
  // das, woran OBS die Quelle festmacht — beides scheidet aus. Bleibt das
  // Symbol im Infobereich der Taskleiste, das außerhalb der Aufnahme liegt.
  ipcMain.handle('window:talkState', (_e, on) => {
    if(tray && !tray.isDestroyed()){
      tray.setToolTip(on ? 'Pixel VTuber — Gespräch offen, er hört ohne Weckwort zu'
                         : 'Pixel VTuber');
    }
    return true;
  });
  ipcMain.handle('window:close', () => { if(win) win.close(); });
  ipcMain.handle('window:minimize', () => { if(win) win.minimize(); });

  app.on('activate', () => {
    if(BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

if(app.requestSingleInstanceLock()){
  // Someone started the app again — most likely because the running copy was
  // invisible (panel closed, not in the taskbar). Show them the one they have.
  app.on('second-instance', revealWindow);
  app.whenReady().then(startApp);
}else{
  app.whenReady().then(() => {
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'Pixel VTuber läuft bereits',
      message: 'Pixel VTuber läuft schon.',
      detail: 'Es kann immer nur eine Instanz laufen — sonst streiten sich zwei ' +
              'Fenster um Einstellungen und Hotkeys, und OBS nimmt womöglich das ' +
              'falsche auf.\n\nDas vorhandene Fenster wurde nach vorn geholt und ' +
              'das Panel geöffnet. Zurück ins Panel kommst du auch über die Leiste, ' +
              'die beim Überfahren mit der Maus oben am Avatar erscheint, oder mit ' +
              'Strg+Alt+P.',
      buttons: ['OK']
    });
    app.quit();
  });
}

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if(process.platform !== 'darwin') app.quit(); });
