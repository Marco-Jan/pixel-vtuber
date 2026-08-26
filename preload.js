const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Narrow, explicit bridge — the renderer gets exactly these calls and nothing else.
contextBridge.exposeInMainWorld('vtuber', {
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (data) => ipcRenderer.invoke('settings:save', data),
  listSprites: () => ipcRenderer.invoke('sprites:list'),
  spriteFolder: () => ipcRenderer.invoke('sprites:folder'),
  openSpriteFolder: () => ipcRenderer.invoke('sprites:openFolder'),
  // Figuren hinzufuegen: aussuchen und in den Ordner kopieren lassen.
  spriteChoose: () => ipcRenderer.invoke('sprites:choose'),
  spriteAdd: (pfade) => ipcRenderer.invoke('sprites:add', pfade),

  // Animationen aus Dateien. `animAdd` läuft ein bis zwei Minuten — solange
  // meldet `onAnimFortschritt`, woran Blender gerade ist.
  // Der Pfad einer abgelegten Datei. Bis Electron 31 stand er als `File.path`
  // im Renderer; seit 32 ist er dort entfernt und nur noch über `webUtils` zu
  // bekommen — und das gibt es ausschließlich hier im Preload. Ohne diesen
  // Umweg liefert ein Drop `undefined`, und zwar ohne Fehlermeldung: Es sieht
  // aus, als sei nichts passiert.
  filePath: (file) => {
    try{ return webUtils.getPathForFile(file); }catch(e){ return ''; }
  },
  version: () => ipcRenderer.invoke('app:version'),
  openHelp: () => ipcRenderer.invoke('help:open'),
  animStatus: () => ipcRenderer.invoke('anim:status'),
  animChoose: () => ipcRenderer.invoke('anim:choose'),
  animAdd: (pfade, modell) => ipcRenderer.invoke('anim:add', pfade, modell),
  onAnimFortschritt: (cb) => ipcRenderer.on('anim:fortschritt', (_e, text) => cb(text)),

  ttsStatus: (cloud) => ipcRenderer.invoke('tts:status', cloud),
  // Stimmen aus der Cloud: Anbieterliste, Schluessel setzen, Zwischenspeicher leeren.
  ttsAnbieter: () => ipcRenderer.invoke('tts:anbieter'),
  ttsSetKey: (key) => ipcRenderer.invoke('tts:setKey', key),
  ttsCacheLeeren: () => ipcRenderer.invoke('tts:cacheLeeren'),
  ttsFolder: () => ipcRenderer.invoke('tts:folder'),
  // Stimmen, die die App selbst holen kann, und das Holen.
  ttsCatalog: () => ipcRenderer.invoke('tts:catalog'),
  ttsDownload: (id) => ipcRenderer.invoke('tts:download', id),
  openTtsFolder: () => ipcRenderer.invoke('tts:openFolder'),
  // Eigene Aufnahmen: wie die Datei heißen muss, und den Ordner öffnen.
  recName: (text) => ipcRenderer.invoke('rec:name', text),
  openRecFolder: () => ipcRenderer.invoke('rec:openFolder'),
  // Liefert das fertige WAV als Bytes zurück. Der Renderer macht daraus ein Blob
  // und schickt es durch dieselbe Warteschlange wie eine gewählte Datei.
  ttsSynth: (text, voice, laenge, cloud) => ipcRenderer.invoke('tts:synth', text, voice, laenge, cloud),

  sttStatus: () => ipcRenderer.invoke('stt:status'),
  openSttFolder: () => ipcRenderer.invoke('stt:openFolder'),
  sttTranscribe: (wav, model, prompt) => ipcRenderer.invoke('stt:transcribe', wav, model, prompt),

  aiStatus: (cfg) => ipcRenderer.invoke('ai:status', cfg),
  // Nur schreiben. Zurück kommt der Schlüssel nie — der Renderer erfährt aus dem
  // Status lediglich, ob einer hinterlegt ist.
  aiSetKey: (key) => ipcRenderer.invoke('ai:setKey', key),
  aiOpenCanned: () => ipcRenderer.invoke('ai:openCanned'),
  // Die Charakterdatei: aussuchen, und nachsehen, was aus ihr wirklich hinausgeht.
  aiPickPersona: () => ipcRenderer.invoke('ai:pickPersona'),
  aiPersona: (file) => ipcRenderer.invoke('ai:persona', file),
  aiAsk: (req) => ipcRenderer.invoke('ai:ask', req),
  aiStop: () => ipcRenderer.invoke('ai:stop'),
  // Die Antwort kommt stückweise, nicht am Ende — nur so kann der erste Satz
  // schon gesprochen werden, während der Rest noch entsteht.
  onAiDelta: (cb) => ipcRenderer.on('ai:delta', (_e, text) => cb(text)),

  applyHotkeys: (map) => ipcRenderer.invoke('hotkeys:apply', map),
  onHotkey: (cb) => ipcRenderer.on('hotkey', (_e, action) => cb(action)),

  setAlwaysOnTop: (on) => ipcRenderer.invoke('window:setAlwaysOnTop', on),
  setClickThrough: (on) => ipcRenderer.invoke('window:setClickThrough', on),
  setHoverBar: (on) => ipcRenderer.invoke('window:setHoverBar', on),
  onHover: (cb) => ipcRenderer.on('hover', (_e, state) => cb(state)),
  setSize: (w, h) => ipcRenderer.invoke('window:setSize', w, h),
  getSize: () => ipcRenderer.invoke('window:getSize'),
  setTalkState: (on) => ipcRenderer.invoke('window:talkState', on),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close')
});
