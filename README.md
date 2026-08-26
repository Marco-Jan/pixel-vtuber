# Pixel VTuber

Sprite-basierter Pixelart-VTuber als eigenständige App. Augen und Mund werden als
Regionen aus verschiedenen Sprites zusammengesetzt, statt ganze Bilder zu tauschen.

## Starten

```
npm start
```

Beim ersten Start ist das Einstellungs-Panel offen. Schließt du es, merkt sich die
App das.

**Panel wieder öffnen:** Maus an den **oberen Rand** des Avatars bewegen — dort
erscheint eine Leiste mit *Menü* und *Programm beenden*, die verschwindet, sobald
die Maus weg ist. Liegt ein anderes Fenster über dem Avatar, bleibt sie weg. Diese
Leiste bleibt auch bei offenem Panel sichtbar und ist die einzige Stelle mit
*Beenden* — im Panelkopf stünde es neben dem Schließkreuz und läse sich dort wie
„Panel zu".
Alternativ `Strg+Alt+P` oder ein Klick auf das Symbol im Infobereich der Taskleiste.
Alle drei holen das Fenster gleichzeitig nach vorn.

Fenster verschieben: die Titelzeile „Pixel VTuber" im Panelkopf, oder der freie
Teil der Leiste oben. Die Titelzeile ist dazugekommen, weil der freie Teil nichts
taugte, sobald das Panel offen war: Es liegt über der rechten Hälfte der Leiste,
und bei einem schmalen Fenster blieb zwischen dem Beenden-Knopf und dem Panelrand
kein Pixel zum Anfassen übrig. Das Fenster ließ sich dann überhaupt nicht mehr
verschieben.

### Anleitung

Der Knopf **Anleitung** im Panelkopf öffnet `renderer/anleitung.html` im
Standardbrowser — eine Seite für Leute, die die App *benutzen* wollen, ohne
Materialnamen, Shape Keys und Dateipfade. Sie liegt als Datei bei, geht also
auch ohne Netz auf und wandert über `renderer/**/*` von selbst in die gebaute
.exe.

Kein eigenes Fenster mit Absicht: Sie soll neben der App stehen bleiben, während
man ihr folgt. Ein Electron-Fenster läge über dem Avatar und wäre genau dann im
Weg, wenn man das Beschriebene ausprobiert.

### Einfach oder erweitert

Der Knopf **⚙ Erweiterte Einstellungen** im Panelkopf blendet alles aus, was man
einmal einrichtet und danach nie wieder anfasst — Kalibrierung, Blinzelraten,
Bewegung, Lippenschwellen, die Zuordnung von Clips und Shape Keys, die technischen
Felder des Co-Moderators. Sichtbar bleibt, was man im Betrieb bedient.

Die Trennung steckt in der Auszeichnung des HTML (`class="adv"`) und wird über eine
einzige Regel geschaltet (`body.einfach .adv`). Ein neues Feld muss also nur
ausgezeichnet werden; es gibt keine Liste, die man zusätzlich pflegen müsste.

Es läuft immer nur **eine** Instanz. Startest du die App ein zweites Mal, sagt sie
das und holt stattdessen die vorhandene nach vorn — sonst streiten sich zwei Fenster
um Einstellungen und Hotkeys, und OBS nimmt womöglich das falsche auf.

## Die Maus gehört dem Spiel

Bei **geschlossenem** Panel lässt das Fenster die Maus durch: Klicks landen im
Spiel, nicht im Avatar. Kein Maus-Hook ist dabei im Spiel — ein Fenster, das Klicks
durchlässt und trotzdem noch Mausbewegungen mitlesen will (`setIgnoreMouseEvents`
mit `forward:true`), hängt dafür einen systemweiten Hook ein, und genau der bringt
Spiele mit eigenem Cursor durcheinander: Der Mauszeiger ruckelt oder verschwindet,
sobald er über dem Avatar liegt.

Die Leiste am oberen Rand geht deshalb einen anderen Weg, in zwei Stufen:

1. Der Hauptprozess fragt alle 110 ms die Cursorposition ab
   (`screen.getCursorScreenPoint`) und vergleicht sie mit den Fenstergrenzen — kein
   Hook, keine Ereigniskette. Steht der Cursor im obersten Streifen von 28 Pixeln,
   nimmt das Fenster **dort** die Maus an. Der gesamte Rest bleibt durchlässig,
   damit der Avatar im Spiel keine Klicks schluckt.
2. Koordinaten sagen aber nichts über die Stapelreihenfolge: Ohne „Immer im
   Vordergrund" liegt der Avatar hinter anderen Fenstern, und dann heißt „Cursor
   innerhalb der Grenzen" nur, dass die Maus über dem Fenster *davor* steht. Die
   Antwort liefert Windows von selbst — nur das oberste Fenster an dieser Stelle
   bekommt echte Mausereignisse. Erst ein ankommendes `mousemove` blendet die
   Leiste ein. Liegt etwas davor, kommt keins, und sie bleibt weg.

Wem selbst dieser Streifen zu viel ist, schaltet ihn unter *Bedienung & Hotkeys* ab
— dann bleibt das Fenster wie zuvor vollständig durchlässig, und zurück ins Panel
führen Hotkey und Tray-Symbol. Lässt sich der Hotkey nicht registrieren (anderes
Programm belegt ihn), sagt die App das im Panel; ist zusätzlich die Leiste
abgeschaltet, hält sie das Panel offen, statt sich auszusperren.

Was die App **nicht** tut: das Fenster unfokussierbar machen. Das würde zwar
verhindern, dass ein Vollbildspiel den Fokus verliert, aber Windows nimmt so ein
Fenster auch aus der Taskleiste — die App verschwindet dann aus genau der Leiste,
in der man sie sucht. Nötig ist es nicht: Ein mausdurchlässiges Fenster lässt sich
gar nicht anklicken, es bekommt den Fokus also nur, wenn du es selbst holst.

Ohne „Immer im Vordergrund" liegt der Avatar hinter jedem Fenster, das du davor
legst. Deshalb holt das Öffnen des Panels das Fenster nach vorn und hält es dort,
solange das Panel offen ist; beim Schließen gilt wieder deine Einstellung.

**Verdeckt heißt nicht eingefroren.** Chromium hält ein Fenster an, sobald ein
anderes es vollständig überdeckt — keine Frames mehr, gedrosselte Timer. Für diese
App wäre das fatal: Der Avatar hängt vollständig an `requestAnimationFrame`, und
verdeckt ist hier der Normalfall, weil OBS ihn auch dann noch aufnimmt. Gemessen
lief er verdeckt mit **0 Bildern in 3 Sekunden**. Deshalb schaltet `main.js` die
Drosselung ab (`disable-backgrounding-occluded-windows`,
`disable-renderer-backgrounding`, `disable-background-timer-throttling` sowie
`backgroundThrottling: false`); danach läuft er auch verdeckt in der Bildrate des
Monitors weiter.

Eine Grenze bleibt: Das Spiel muss im **randlosen Fenster** laufen. Im exklusiven
Vollbild lässt Windows überhaupt kein Overlay zu — dann ist der Avatar unsichtbar,
egal wie er eingestellt ist.

## Zwei Figuren

Die App zeichnet mehrere Figuren nebeneinander in dasselbe Fenster. Der gedachte
Fall: du als VTuber und ein Co-Moderator daneben. Der Schalter ganz oben im Panel
bestimmt, wer zu sehen ist — nur du, nur er, oder beide.

Die **Rolle** entscheidet, wovon der Mund einer Figur bewegt wird:

| Rolle | Mund folgt | spricht selbst |
|---|---|---|
| VTuber | deinem Mikrofon | nie |
| Co-Moderator | seiner eigenen Sprachausgabe | ja |

Sie folgt der **Position**: die erste Figur ist der VTuber, jede weitere der
Co-Moderator. Einstellbar ist sie nicht, und das ist eine Korrektur (17.08.2026).
Vorher gab es je Figur ein Feld „Stellt dar" — bei genau zwei Figuren und genau
zwei Rollen konnte man damit ausschließlich Widersprüche bauen, und beide sind in
der Praxis passiert: beide Figuren als Co-Moderator (dann zeigt „Nur Co-Mod" zwei
Figuren, weil die Auswahl korrekt zweimal dieselbe Antwort bekommt), und beide
über Kreuz (dann zeigt „Nur ich" die Figur namens „Co-Moderator"). Der Name ist
seither reine Beschriftung; gespeicherte Rollen werden beim Laden geradegezogen.

Zwei Dinge im Panel hingen an derselben Verwechslung und sind mitgeändert: Die
beiden Knopfreihen oben sind beschriftet („Wer ist zu sehen?" gegen „Diese Figur
einstellen:"), und eine Figur, die die Ansicht gerade ausblendet, lässt sich nicht
mehr auswählen. Vorher war sie anklickbar und wirkungslos — Regler und Posenknöpfe
wirken auf die *bearbeitete* Figur, und wenn die ausgeblendet ist, passiert im Bild
nichts. Das sieht aus wie ein kaputtes Programm.

Dazu ein Startfehler, der lange unbemerkt blieb: `enabled` steht mit in der
Einstellungsdatei, ist aber nichts Eigenes — es folgt aus Ansicht und Rolle. Beim
Start wurde es geglaubt, statt neu gerechnet zu werden, und dann stand bei „Nur
Co-Mod" die ausgeblendete Figur im Panel. `applyShow()` läuft jetzt direkt nach
`mergeSettings()`.

Deshalb hat jede Tonquelle einen **eigenen Analysator**. Vorher lag eine
Auswertung am Analysator und die Quellen wechselten sich ab, mit einer Regel, wer
gerade „das Wort hat" — richtig, solange es eine Figur mit einem Mund gab. Mit zwei
Figuren ist es falsch: Du darfst reden, während er redet. Die Vorrangregel ist
ersatzlos entfallen, und mit ihr der Sonderfall „Mund steht beim Zuhören still" —
der Co-Mod hängt am Pegel seiner eigenen Stimme, und der ist still, solange er
nichts sagt.

Zur Figur gehören Sprites, Posen, Kalibrierung, Position, Größe, Spiegelung,
Blinzeln, Gestik und Atmen — zwei Figuren sollen ja gerade nicht gleich aussehen.
Gemeinsam bleiben Hintergrund, die Auswertung des Tons (Verstärkung, Schwellen,
Sprechtempo), Fenster, Zuhören und Chat.

Die Pose-Hotkeys tragen die Figur im Namen (`pose:<figur>:<pose>`): Zwei Figuren
dürfen eine Pose gleich nennen, und ohne die ID landete ein Tastendruck bei der
falschen — oder die zweite Belegung überschriebe stillschweigend die erste.

**Warum nicht zwei Instanzen der App?** Weil zwei Overlay-Fenster sich um
Vordergrund und Klick-Durchlass streiten würden, dazu zwei Tray-Symbole, zwei
Mikrofonzugriffe und Sprites doppelt einzurichten. In einem Fenster gibt es ein
Mikrofon, ein Whisper, einen Satz Hotkeys und eine OBS-Quelle.

Eine Einstellungsdatei aus der Zeit davor hat Sprites, Posen und Kalibrierung flach
oben liegen; die wird beim ersten Start zur ersten Figur. Wer die App eingerichtet
hat, findet sie unverändert vor.

## 3D-Figuren

Eine Figur ist wahlweise Pixelart oder ein **3D-Modell** — `.glb`, `.gltf` oder
`.vrm`. VRM ist im Inneren ebenfalls glTF, deshalb lädt derselbe Lader alle drei.
Nimm `.glb` oder `.vrm`: Dort stecken die Texturen in einer Datei. Bei `.gltf`
liegen sie oft daneben, und wer nur die eine Datei kopiert, bekommt eine graue
Figur. Der Treiber
merkt den Unterschied nicht: Er liefert weiterhin eine Mundstufe und einen
Augenzustand, und was daraus wird — ein Bildausschnitt oder ein Shape Key —
entscheidet sich erst beim Zeichnen. Genau diese Trennung war der Grund, das
Eigenleben und den Co-Moderator vor dem 3D-Teil zu bauen: Beides funktioniert
unverändert weiter.

| Zustand | 2D | 3D |
|---|---|---|
| Mundstufe 0/1/2 | drei Bildausschnitte | ein Shape Key auf 0 / 0,5 / 1 |
| Augen offen/zu/zwinkern | drei Bildausschnitte | ein Shape Key auf 0 / 1 |
| Pose | ein Sprite | ein Animationsclip, weich übergeblendet |

**Shape Keys werden zugeordnet, nicht geraten.** Kein Blender-Charakter nennt sie
gleich, deshalb füllen sich die Listen im Panel aus dem geladenen Modell. Ein
gespeicherter Name, den ein neues Modell nicht kennt, bleibt trotzdem wählbar —
sonst verlöre ein Dateitausch stillschweigend die Zuordnung.

Die Datei gehört in denselben Ordner wie die Sprites. Zwei Ordner wären zwei
Erklärungen für dieselbe Sache.

### Woher eine Figur nehmen

Es kommt auf **eine** Eigenschaft an: **Shape Keys für Mund und Augen.** Ohne sie
wird die Figur geladen und steht da, aber der Mund bewegt sich nicht. Daran
scheitern die meisten Modelle aus dem Netz — ein hübscher Scan hat Geometrie und
Textur, aber kein bewegliches Gesicht. Je nach Quelle heißt dasselbe *Shape Keys*,
*Blendshapes*, *Morph Targets*, *Visemes* oder *Perfect Sync*.

Wie sie **heißen**, ist egal; die Listen im Panel füllen sich aus der Datei.

| Quelle | Taugt |
|---|---|
| **VRoid Studio** | am sichersten — kostenlos, baut in einer halben Stunde eine VRM mit allen Shape Keys |
| **Booth.pm** | große Auswahl fertiger VRM, vieles kostenlos |
| **Ready Player Me** | schnell, im Browser; `?morphTargets=ARKit` an die Adresse hängen, sonst fehlt die Gesichtssteuerung |
| **Sketchfab** | selten — nach *Downloadable*, *glTF* und „blendshapes" filtern |
| **Mixamo** | nicht als *Figur* — liefert FBX ohne Gesichts-Morphs. Als Quelle für **Bewegungen** dagegen der Hauptweg, siehe *Posen und Gesten* |

Prüfen dauert zehn Sekunden: Datei in den Sprites-Ordner, *Dateien & Modelle neu
suchen*, Figur wählen. Unter der Modellauswahl steht „X Shape Keys, Y
Animationen". Steht dort 0 Shape Keys, taugt das Modell für uns nicht.

**0 Animationen sind dagegen kein Problem** — Atmen, Wiegen, Hüpfen, Umschauen und
die Handbewegung liegen alle außerhalb des Modells. Die **Posen** brauchen zwar
Clips, aber die lassen sich nachrüsten: Modell bei Mixamo hochladen, Bewegung
herunterladen, FBX ins Panel ziehen (siehe *Posen und Gesten*).

Bei fertigen Figuren die Nutzungsbedingungen ansehen: VRM tragen sie eingebettet
mit, und „kostenlos" heißt nicht immer „im Stream verwendbar".

### Haltung: T-Pose, Arme, Hände

Ein Modell ohne Animationen steht in seiner Bindepose, und die ist bei praktisch
jeder VRM die **T-Pose**. Drei Regler holen es da heraus, alle im 3D-Block:

| Regler | Was er tut |
|---|---|
| **Arme senken** | dreht die Oberarme herunter (voreingestellt 65°) |
| **Hände bewegen** | Schulter, Ellbogen und Handgelenk gehen leicht mit, beim Sprechen deutlicher |
| **Drehen** | die Figur wandert langsam um die Hochachse, sodass man die Seiten sieht |

**Gefunden** werden die Knochen zuerst über die genormte Knochenkarte einer VRM;
fehlt sie — ein Umweg durch Blender verliert sie, und Modelle aus Meshy oder
Mixamo hatten nie eine —, greifen Namensmuster wie `*UpperArm`, `LeftForeArm`
oder `forearm.L`. Was gefunden wurde, steht beim Laden in der Konsole.

**Gedreht** wird um eine Achse, die aus der Lage des Knochens *gerechnet* ist, nicht
um eine angenommene. Das war bis zum 17.08.2026 anders und schlicht falsch: Der
Code drehte fest um die lokale z-Achse. Bei der VRoid-Figur senkt die den Arm, bei
einem Meshy-Rig dreht dieselbe Achse ihn nur um sich selbst — sichtbar passiert
nichts, die Knochen sind gefunden, und der Regler wirkt kaputt. Es gibt keine
übliche Achse; jedes Programm legt sie anders.

Was an jedem Rig gleich ist, ist die Geometrie: Der Arm zeigt irgendwohin, und
„senken" heißt, dass die Hand nach unten wandert. Die Drehachse dafür ist das
Kreuzprodukt aus Armrichtung und Weltunten, umgerechnet in den Raum des
Elternknochens. Links und rechts stimmt das Vorzeichen dadurch von selbst — die
Armrichtungen sind gegenläufig —, und ein Vorzeichen je Seite ist entfallen.
Gedreht wird über Quaternionen statt Euler-Winkel, sonst hängt das Ergebnis an
der Reihenfolge der Achsen.

Gesetzt wird **vor** dem Animationsmischer: Bewegt ein Clip die Arme, überschreibt
er die Werte und die Animation behält recht. Nur wenn niemand die Arme animiert,
bleibt die Haltung stehen — so braucht es keine Sonderregel für Modelle mit
Animationen.

Die Handbewegung hängt am selben Pegel wie der Mund, jede Figur gestikuliert also
zu **ihrer eigenen** Stimme. Beide Seiten laufen gegenläufig und mit verschiedenen
Frequenzen; im Gleichtakt sähe es aus wie Turnen. Ellbogen und Handgelenk sind
kleiner und schneller als die Schulter, damit die Bewegung nach außen wandert.
Jeder Knochen rechnet von seiner Bindepose statt vom letzten Bild — sonst
schaukelt sich die Drehung über die Bilder auf.

### Warum ein Bauschritt dazugekommen ist

three.js gibt es nur noch als ES-Modul, und der glTF-Lader zieht es über einen
bloßen Modulnamen herein. Im Panel gilt `script-src 'self'` ohne `unsafe-inline`,
und eine Import-Map wäre ein Inline-Skript — also entweder die CSP aufweichen,
einen Hash pflegen oder bündeln. Gebündelt wird nur `renderer/three-view.js`, die
einzige Datei, die three.js überhaupt kennt; `app.js` bleibt ohne Bauschritt.

```
npm run build     # erzeugt renderer/three-bundle.js
```

`npm install` macht es mit (postinstall), `npm run dist` ebenfalls. Die gebündelte
Datei ist erzeugt und liegt deshalb nicht im Repo.

### Warum die 3D-Figur in den 2D-Canvas gezeichnet wird

Ein zweites Element obendrauf könnte die Ebene nicht einhalten — es läge immer vor
oder immer hinter allen Sprites. So teilen sich alle Figuren eine Fläche,
denselben Hintergrund und dieselbe Fensteraufnahme. Alle 3D-Figuren teilen sich
außerdem *einen* WebGL-Renderer; einer je Figur wäre je ein eigener GPU-Kontext,
und davon geben Browser nur eine Handvoll her.

Gespiegelt wird über die Kamera, nicht über das Modell: Ein negativ skaliertes
Modell dreht seine Normalen um, und dann steht die Beleuchtung auf dem Kopf.

Die Drehung beim Umschauen sitzt auf einer **Hülle** um das Modell, nicht auf dem
Modell selbst — sonst stritte sie mit Animationsclips, die dieselbe Drehung setzen.

### Warum `blob:` in der CSP steht

three.js packt Texturen, die *in* der Datei stecken, in ein Blob und lädt sie über
`ImageBitmapLoader`, also per `fetch`. Für den Browser zählt das als **Verbindung**,
nicht als Bild — es fällt unter `connect-src`, nicht unter `img-src`. Fehlt `blob:`
dort, kommt jede texturierte Figur schneeweiß an: richtige Gestalt, keine Farbe.
`img-src` deckt zusätzlich den Rückfallweg über ein Image-Element ab, den three.js
nimmt, wenn `createImageBitmap` fehlt.

### Testfigur

```
node tools/make-demo-model.js
```

Baut `sprites/demo-figur.glb` — bewusst hässlich. Sie soll nichts hermachen,
sondern beweisen, dass die Kette steht: zwei Shape Keys (`mundOffen`, `augenZu`),
zwei Animationen (`ruhe`, `winken`). Wie die Sprites und der Testton wird sie
erzeugt statt gepflegt und prüft sich selbst — unter anderem, dass `mundOffen`
wirklich nur den Mund anfasst und nicht das halbe Gesicht.

Sie hat einen blinden Fleck, den man kennen sollte: Sie ist **gefärbt statt
texturiert** und lädt kein einziges Bild. Der `blob:`-Fehler oben konnte an ihr
deshalb gar nicht auftreten und fiel erst bei einer echten VRM mit 27 Texturen
auf. Wer am 3D-Teil etwas ändert, prüft es besser zusätzlich an einem richtigen
Modell.

## Warum Regionen statt ganzer Bilder

Ein üblicher Satz von vier gezeichneten Sprites deckt nur 3 der 6 sinnvollen
Kombinationen ab — gemessen an dem Satz, mit dem die App entwickelt wurde:

|              | Mund zu         | Mund offen   | Mund weit           |
|--------------|-----------------|--------------|---------------------|
| Augen offen  | fehlt als Bild  | `avatar_open`| fehlt als Bild      |
| Augen zu     | `avatar_close`  | fehlt als Bild | `avatar_close_open` |

Weil alle Sprites dieselbe relative Rahmung haben (Inhalt 0,99 × 0,935, Oberkante
bei 0,063), lassen sich Augen- und Mundregion frei kombinieren. Aus 3 nutzbaren
Bildern werden so alle 6 Zustände.

Gemessen wurde das auch: ein Augenwechsel verändert exakt 2.717 Pixel, unabhängig
davon, in welchem Mundzustand er passiert — Augen und Mund sind vollständig
entkoppelt.

## Sprites

Zwei Quellen, beide erscheinen zusammen in den Dropdowns:

- `sprites/` im Projekt — was mitgeliefert wird. In einer gebauten .exe steckt das
  im Archiv und ist nicht mehr änderbar.
- `%APPDATA%/pixel-vtuber/sprites/` — der eigene Ordner. Den öffnet der Knopf
  *Sprite-Ordner öffnen* im Panel. Hier abgelegte PNGs überschreiben bei gleichem
  Namen die mitgelieferten und überleben jedes Update.

Welche Datei welche Rolle übernimmt, stellst du im Panel um. Neue Dateien erscheinen
nach einem Neustart in den Listen. Standard ist die mitgelieferte Testfigur
(`demo_*.png`).

Rollen sind nur noch die Überlagerungen — Augen offen, Augen zu, **Augen zwinkern**
und drei Mundstellungen. Welches Auge sich beim Zwinkern schließt, entscheidet dein
Sprite; fehlt die Rolle, blinzelt der Avatar stattdessen mit beiden Augen. Die Körper
stecken in den Posen.

## Posen und Gesten

Posen sind eine Liste im Panel, kein Code. Jede hat eine Quelle — bei einer
Pixelfigur ein Sprite, bei einem 3D-Modell einen **Animationsclip** —, einen Hotkey
und ein Verhalten:

- **bleibt stehen** — eine Grundhaltung wie „Arme verschränkt". Sie gilt, bis du eine
  andere wählst. Mindestens eine Pose muss so eingestellt sein.
- **läuft ab** — eine Geste wie Winken oder Herz. Hotkey drücken, und nach der
  eingestellten Dauer steht der Avatar wieder wie zuvor.

*Geste hinzufügen* legt eine weitere an; Sprite wählen, Hotkey vergeben, fertig. Jede
Pose hat eigene Kalibrierungsboxen — neu angelegte erben die der ersten Pose, was bei
gleicher Rahmung meist schon passt.

Die Automatik beim Reden wechselt zwischen der gehaltenen Pose und einer wählbaren
Geste hin und her (Vorgabe „Gestikulierend") und greift nur, solange diese nicht
ohnehin gehalten wird.

### Von selbst bewegen

Die Automatik gab es bisher nur **beim Reden** und nur mit **einer** festgelegten
Pose. Dazu kommt jetzt eine zweite, die greift, während niemand redet: Sie würfelt
aus allen Posen, bei denen *auch von selbst* angehakt ist. Eine feste zweite Pose
wäre nach zwei Minuten als Muster zu erkennen, und genau darum geht es dabei nicht.

Zwei Regler je Figur:

- **Wie oft** — Häufigkeit, nicht Abstand: ganz rechts heißt oft. Die Spanne ist
  90 bis 10 Sekunden, dazu ±40 % Streuung. Ohne die wäre es ein Metronom, und ein
  Avatar, dessen Winken man vorhersagen kann, wirkt sofort wie ein Skript.
- **Wie stark** — dieselbe Aufnahme zurückhaltender zeigen, ohne sie zweimal zu
  bauen.

Die Redegestik hat Vorrang: Wer spricht, gestikuliert zum eigenen Wort, und eine
zufällige Bewegung darf da nicht hineinplatzen. Läuft nichts und wird nichts
gesprochen, greift die Zufallsbewegung. Nach langem Reden wird die Pause nicht neu
gestartet, sondern nur kurz nachgesehen — sonst verschiebt sich die nächste
Bewegung immer weiter nach hinten, und nach dem Stream steht die Figur still.

**Warum die Stärke die Grundhaltung mitlaufen lässt:** Der Mischer verrechnet ein
fehlendes Gewicht gegen die **Bindepose**. Bei einem Meshy-Rig ist das „Arme
waagrecht" — eine halbe Geste sah deshalb aus wie eine halbe T-Pose, nicht wie
eine zurückhaltende Bewegung. Gemessen bei Stärke 5: Die Figur stand mit
ausgestreckten Armen da, schlechter als ohne Geste. Deshalb läuft der Clip der
Grundhaltung mit genau dem fehlenden Gewicht mit. Übrig bleibt die Figur in ihrer
normalen Haltung mit einer angedeuteten Bewegung darüber.

Preis dafür: Bei gemischten Gesten gibt es keinen weichen Übergang —
`setEffectiveWeight` beendet ein laufendes Überblenden. Bei voller Stärke wird es
gar nicht aufgerufen, dort bleibt der Übergang wie bisher.

Bei Pixelfiguren wirkt nur die Häufigkeit. Ein Bild lässt sich nicht halb zeigen.

### Bei 3D: eine Pose ohne Clip hält an

`Model.play()` startet einen Clip — und lange gab es kein Gegenstück. Eine Pose
ohne Clip rief `play()` gar nicht erst auf, also lief der vorherige weiter. Wer
eine Lauf-Animation gestartet hatte, bekam sie nicht mehr gestoppt: Es gab keine
Pose, die sie hätte beenden können.

`Model.stop()` blendet stattdessen aus, statt hart abzuschalten. Der Mischer
verrechnet ein Gewicht unter 1 gegen den Wert, den der Knochen beim Anbinden
hatte — ein Clip, der auf 0 ausblendet, führt die Figur damit von selbst in die
Bindepose zurück. Ein hartes Anhalten ließe sie mitten im Schritt einfrieren.

Ein Aus-Schalter ist damit eine Pose mit Clip `— keiner —`. Wer die Arme dabei
unter den Reglern behalten will, nimmt einen Clip, der nur den Rumpf beansprucht.

### Neue Bewegungen: FBX ins Panel ziehen

Unter *Posen & Gesten* liegt eine Ablegefläche. Datei darauf, und der Clip steht
danach zur Auswahl — ohne Kommandozeile und ohne Neustart. Dahinter:

1. Die Datei wird nach `sprites/` kopiert und bleibt dort — sie ist die **Quelle**,
   nicht ein Zwischenschritt.
2. Der Hauptprozess startet Blender im Hintergrund mit `blender/troll-posen.py`.
3. Dessen Fortschritt geht als IPC-Ereignis ins Panel; ein Lauf dauert je nach
   Anzahl der Quellen bis zu zwei Minuten, und ohne Meldung hält man das für
   einen Absturz.
4. Danach lädt die App alle 3D-Modelle neu ein.

**Warum Blender überhaupt:** three.js lädt glTF, kein FBX. Fehlt Blender, ist der
Knopf gesperrt und sagt warum — ein Knopf, der still nichts tut, wäre schlimmer
als keiner. Gesucht wird `Program Files\Blender Foundation\*` auf den Laufwerken
C bis H, notfalls setzt man `blenderPath` in der Einstellungsdatei.

**Warum ohne Retargeting:** Lädt man die *fertige* `.glb` bei Mixamo hoch, kommt
dasselbe Skelett zurück — gleiche Knochennamen, gleiche Ruhepose (gemessen 1e-5
Abweichung). Dann lassen sich die Haltungen Bild für Bild übernehmen. Lädt man ein
fremdes Modell hoch, kommt ein Mixamo-Skelett mit `mixamorig:`-Namen zurück, die
Schnittmenge der Knochennamen ist leer, und die Datei wird still übersprungen.

Die Hüftverschiebung wird verworfen: Eine stehende Figur soll stehen bleiben, der
Bildausschnitt ist einmal auf sie eingepasst. Dateien mit nur einem Bild sind keine
Animation, sondern eine Haltung — genau das liefert der Export eines blanken
Modells — und fallen heraus. Kollidiert ein Name (`ork_idle.fbx` ergäbe `idle`,
das das Skript selbst baut), bekommt der Clip den ganzen Dateinamen statt
übergangen zu werden.

### Zwei Fehler, die das jahrelang verhindert haben

**Posen einer 3D-Figur überlebten das Laden nicht.** `readAvatar()` filterte
`p => p && p.id && p.file` — eine 3D-Pose hat keine Datei, sondern einen Clip.
Nach jedem Neustart hatte die Figur *null* Posen, und kein Clip wurde je gespielt.
Pflicht ist jetzt nur noch die ID.

**Ein geladenes Modell wurde nie wieder von der Platte gelesen.** `ensureModel()`
merkt es sich am Dateinamen. Baut Blender die Datei zwischendurch neu, sah man
weiter den alten Stand — und „🔄 Dateien & Modelle neu suchen" half nicht, weil es
nur die im Panel gewählte Figur ansprach und die Datei ohnehin aus dem
Zwischenspeicher kam. Der Knopf liest jetzt alle 3D-Figuren neu und erzwingt das
über eine Wegwerf-Kennung an der Adresse.

### Testfigur

Damit die App auch ohne eigene Bilder etwas anzeigt, liegt eine schlichte Pixelfigur
bei — inklusive Zwinkern, Winken und Herz. Sie wird nicht von Hand gezeichnet,
sondern erzeugt:

```
node tools/make-demo-sprites.js
```

Das Skript baut die sieben PNGs und prüft anschließend selbst, was die
Regionen-Technik verlangt: dass sich Augen- und Mundvarianten *ausschließlich*
innerhalb ihrer Kalibrierungsbox unterscheiden. Läge auch nur ein Pixel daneben,
bliebe beim Blinzeln ein Rand stehen — und das sieht man sonst erst im Betrieb.
Beim Zwinkern muss die Hälfte der Pixel eines Blinzelns abweichen, weil nur ein Auge
zugeht; auch das rechnet das Skript nach.

In die gebaute .exe wandert allein, was auf `sprites/demo*` passt (`build.files` in
der `package.json`) — die sieben Pixelbilder und die 3D-Testfigur, beide von den
Skripten in `tools/` erzeugt. Eigene Avatare bleiben lokal und gehen nicht
ungefragt mit, wenn du die .exe weitergibst. Das ist nicht nur Rücksicht: Damit
enthält die Auslieferung **nichts Fremdes** — kein zugekauftes Modell, keine
Animationen von Mixamo, keine Piper-Stimme. Wer die App verkauft, gibt keine
fremde Lizenz weiter.

Das Muster hieß bis zum 17.08.2026 `sprites/demo_*.png` und traf damit
`demo-figur.glb` nicht — Bindestrich statt Unterstrich. Folge: In einer gebauten
.exe war die Modell-Auswahl leer, und die halbe App (Posen als Clips,
Animations-Import, Armregler) ließ sich gar nicht ausprobieren, bevor man sich
selbst ein Modell besorgt hatte.

**Wichtig beim Mischen:** nur Bilder mit gleicher relativer Rahmung, sonst sitzen
Augen und Mund daneben.

## Kalibrierung

Die Standardboxen wurden aus den Sprites gemessen (Augen x 0,343–0,553 /
y 0,215–0,319, Mund x 0,394–0,643 / y 0,338–0,483) und sollten passen. Falls doch
nicht:

1. Panel → Kalibrierung → **Augen** oder **Mund** wählen
2. Im Bild einen Rahmen ziehen; Pfeiltasten verschieben pixelweise (Shift = grob)
3. Über **Vorschau** einen Zustand festhalten und prüfen, ohne reden zu müssen
4. **Fertig** klicken

Jede Pose hat eigene Boxen. „Kalibrierung übernehmen" kopiert sie von Pose 1.

## Lip Sync einstellen

Die Lautstärke wird als RMS aus der Wellenform gemessen, nicht als Mittelwert über
die Frequenzbänder — letzteres verteilt die Energie über das ganze Spektrum bis
24 kHz, während Sprache unter ~4 kHz liegt, sodass die oberste Mundstufe praktisch
unerreichbar wäre.

Vorgehen:

1. Mikrofon starten
2. **Verstärkung** hochdrehen, bis der Balken beim normalen Reden etwa auf die
   Hälfte ausschlägt
3. **Schwelle offen** knapp über den Ruhepegel, **Schwelle weit** dorthin, wo du
   bei lauteren Stellen landest — die zwei Striche im Balken zeigen beide Schwellen
4. **Sprechtempo** nach Gefühl, siehe unten

Der Pegel steigt sofort und fällt langsam: das Abklingen überbrückt die Pausen
zwischen den Silben, ein geglättetes Ansteigen bräuchte hingegen niemand mehr —
seit die Mundstufe je Silbe einmal festgelegt wird, kann ein einzelner Ausreißer
kein Flackern mehr auslösen.

### Verzögerung

Abgetastet wird im selben `requestAnimationFrame` wie das Zeichnen, nicht in einer
eigenen Schleife — sonst reagierte der Mund auf den Pegel des vorigen Bildes.
Das Analysefenster bleibt bei 1024 Samples (gut 21 ms): kürzer würde den
Silbenanfang weniger mit der Stille davor verrechnen, aber bei einer Abtastung je
Bild (~17 ms) bekäme die App einen Teil des Tons nie zu sehen.

Was bleibt, liegt außerhalb der App: der Windows-Audiostack (10–30 ms), der
Compositor (16–33 ms) und vor allem OBS mit Fensteraufnahme und Encoder (30–60 ms).
Von Mikrofon bis Stream sind damit realistisch 60–120 ms zu erwarten.

### Silbentakt

Der Mund folgt nicht einfach der Lautstärke — täte er das, stünde er bei einem
langen Satz sekundenlang offen. Stattdessen läuft, solange geredet wird, ein
Silbentakt: auf, gleich wieder zu, auf. Die Lautstärke entscheidet dabei nur noch,
wie weit er aufgeht (halb oder weit), nicht mehr ob.

**Sprechtempo** steuert den Takt, von gut 3 bis gut 7 Silben pro Sekunde. Jede
Phase ist um ±30 % gestreut, und etwa jede fünfte Silbe wird auf knapp das Doppelte
gedehnt wie ein langer Vokal — ohne das sieht es nach Metronom aus.

**Gezogene Töne halten** setzt den Silbentakt aus, solange du ein Wort in die Länge
ziehst — der Mund bleibt dann offen, statt zu klappern. Erkannt wird das am
Rohpegel, nicht an der geglätteten Lautstärke: deren langsames Abklingen füllt
genau die Einbrüche zwischen den Silben auf, an denen man es sehen müsste. Und das
Merkmal ist nicht die Höhe des Pegels — beim Reden ist er genauso hoch —, sondern
seine Ruhe: ein gehaltener Vokal liegt konstant, normales Sprechen moduliert bei
jeder Silbe. Liegt der Pegel ruhig genug und lange genug (160–420 ms, je nach
Regler), gilt der Ton als gezogen.

Das ist eine Heuristik auf einer Lautstärkekurve, keine Spracherkennung, also hat
sie Grenzen: ein gleichmäßiges Summen, eine gesungene Note oder konstant laute
Hintergrundmusik hält den Mund genauso auf. Und wer sehr monoton spricht, löst sie
mit aus — bei Empfindlichkeit 50 ab etwa 20 % Restmodulation, bei 100 schon ab 30 %.
Deshalb färbt sich der Pegelbalken gelb, solange die Erkennung greift: einmal
normal reden und einmal ein Wort ziehen, dann sieht man sofort, wo der Regler
hingehört. 0 schaltet die Erkennung ab.

**Mindest-Haltezeit** ist die Untergrenze für jedes einzelne Mundbild. Sie
verhindert Zucken bei hohem Tempo, bremst aber auch: mehr als eine Phase je
Haltezeit geht nicht, bei 120 ms sind also höchstens ~4 Silben/s drin, egal wie
weit das Sprechtempo aufgedreht ist.

Eine angefangene Silbe läuft immer zu Ende, auch wenn der Ton mittendrin abreißt —
sonst bliebe der Mund am Satzende halb offen stehen.

## Wenn der Avatar selbst spricht

Der Mund folgt einem Pegel — woher der Ton kommt, ist der ganzen Mechanik dahinter
gleichgültig. Am Analysator hängt deshalb nicht das Mikrofon, sondern eine
austauschbare Quelle: dein Mikrofon, wenn du redest, oder abgespieltes Audio, wenn
der Avatar spricht. Silbentakt, gezogene Töne, Gestik und der Stoß beim Einsetzen
der Stimme rechnen in beiden Fällen identisch.

*Testdatei sprechen…* oben im Panel wählt eine Audiodatei aus und lässt den Avatar
sie mitsprechen. Denselben Weg nimmt später eine KI-Sprachausgabe, nur ohne
Dateiwähler davor; aus den Entwicklerwerkzeugen geht es direkt über
`vtuberSpeak('file:///…/satz.wav')`.

Es liegt immer nur **eine** Quelle am Analysator. Beide zugleich addierten ihre
Pegel — redest du, während der Avatar spricht, folgte sein Mund deiner Stimme statt
seiner eigenen. Wer spricht, hat Vorrang; das Mikrofon wird für die Dauer abgehängt,
nicht abgeschaltet, damit danach kein Gerät neu geöffnet und keine Freigabe neu
erfragt werden muss. Mehrere Ausgaben hintereinander werden angehängt statt
abgeschnitten: Eine Sprachausgabe liefert satzweise, und Satz zwei darf Satz eins
nicht mitten im Wort abwürgen.

**Verstärkung Ausgabe** ist eine eigene Zahl neben der des Mikrofons, denn beide
Quellen kommen mit völlig verschiedenen Pegeln — deine Stimme über deinen
Vorverstärker, eine Datei mit dem, was in ihr steht. Die Schwellen darunter gelten
für beide.

### Klangfarbe: aus einer menschlichen Stimme ein Monster machen

Piper-Stimmen sind alle menschlich; „Monster" gibt es dort nicht zu wählen. Es
entsteht erst durch Bearbeitung, und die passiert im Renderer — der Ton läuft
ohnehin durch Web Audio.

Die Kette hängt zwischen `voiceNode` und seinen zwei Ausgängen:

```
voiceEl → voiceNode → Kennlinie → Tiefenanhebung → Tiefpass → Modulation → Pegel
                                                                            ├→ Lautsprecher
                                                                            └→ Analysator
```

Der Analysator sitzt bewusst **hinter** der Kette: Der Mund soll zu dem passen,
was zu hören ist. Davor liefe er zum unbearbeiteten Ton, und bei tiefer,
langsamer Stimme wäre das sichtbar daneben.

Drei Bausteine machen die Arbeit:

| Baustein | Wozu |
|---|---|
| **Abspielgeschwindigkeit** | senkt die Tonhöhe. Braucht `preservesPitch = false` — Chromium behält sonst die Tonhöhe und ändert nur das Tempo, also genau das Gegenteil |
| **Amplitudenmodulation** | die Lautstärke schwankt einige Dutzend Mal je Sekunde. Der klassische Kreaturen-Trick: viel davon klingt nach Roboter, wenig nach Knurren in der Kehle |
| **Kennlinie und Tiefpass** | Rauheit und Körper. Die Kennlinie ist eine weiche Begrenzung, bei ±1 immer genau ±1, damit die Lautstärke nicht mit dem Effekt springt |

**Warum Piper dabei schneller sprechen muss:** Die Abspielgeschwindigkeit senkt
nicht nur die Tonhöhe, sie macht die Stimme auch schleppend. Deshalb geht
derselbe Faktor als `--length_scale` an Piper — beides hebt sich auf, übrig
bleibt die tiefere Stimme bei normalem Sprechtempo. Praktische Folge: Die
Tonhöhe ändert sich sofort, das Tempo erst beim nächsten Satz.

Die Werte in `STIMMFARBEN` sind maßvoll gehalten. Ein Co-Moderator, den man nicht
versteht, ist nutzlos, und Verständlichkeit ist das Erste, was hier leidet.

### Stimmen aus der Cloud

Piper klingt sauber, aber flach — es ist auf Tempo bei winzigen Modellen gebaut. Wer
eine Figur will, die wirklich lebt, kommt an einem Dienst kaum vorbei. **Bezahlt wird
nicht von dieser App**, sondern vom Benutzer mit seinem eigenen Schlüssel.

| Anbieter | Stärke | Schwäche |
|---|---|---|
| **ElevenLabs** | Figurenstimmen, eigene Klone, sehr gutes Deutsch, Modell für niedrige Latenz | teuerste Option |
| **Azure Speech** | um ein Vielfaches günstiger, sehr zuverlässig | feste Stimmen, klingt nach Nachrichtensprecher |

Schlüssel eintragen (bei Azure zusätzlich die Region), fertig: Die Stimmen des
Dienstes stehen danach **in derselben Liste wie die lokalen** — eigene geklonte
eingeschlossen. Es gibt nichts zu kopieren.

Beide liefern am Ende Audio, das die vorhandene Kette unverändert weiterverarbeitet:
Azure gibt RIFF, ElevenLabs MP3. Bei ElevenLabs wäre rohes PCM der kürzere Weg — kein
Dekodieren —, ist aber je nach Tarif gesperrt. Ein Format, das nur auf teuren Zugängen
funktioniert, ist für eine App, die jeder benutzen soll, das falsche.

**Auf dem kostenlosen Zugang von ElevenLabs sind Stimmen aus der Voice Library über
die Schnittstelle gesperrt** (`HTTP 402`). Die mitgelieferten Standardstimmen gehen.
Deshalb steht die Art hinter jedem Namen — `[Standard]`, `[Bibliothek]`, `[geklont]`.
Ohne diesen Zusatz wählt man blind und bekommt einen Fehler, der wie ein Defekt
aussieht.

Der API-Schlüssel braucht zwei Berechtigungen: **Text zu Sprache** (Zugriff) und
**Stimmen** (Gelesen). Mehr nicht — gerät er in fremde Hände, kann damit nur
gesprochen werden.

#### Zwischenspeicher und Rückfall

Jeder gesprochene Satz wird behalten, benannt nach Anbieter, Stimme und Text. Ein
Co-Moderator sagt dieselben Sätze oft; die jedes Mal neu zu bezahlen und darauf zu
warten wäre Geld und Zeit für ein Ergebnis, das schon dalag. Ab 500 Einträgen fliegen
die ältesten raus.

Antwortet der Dienst nicht — kein Netz, Guthaben leer, Schlüssel abgelaufen —, springt
**Piper ein**. Ein stummer Avatar mitten im Stream ist das schlechteste aller
Ergebnisse. Das Panel schreibt dann rot dazu, dass und warum ersetzt wurde: Ein
stummer Rückfall wäre schlimmer als gar keiner, weil man eine andere Stimme hört als
gewählt und den Fehler überall sucht, nur nicht dort, wo er sitzt.

**Damit geht Text ins Netz** — nur der Satz, der gesprochen werden soll, und nur an
den gewählten Dienst. Alles andere bleibt lokal: Mikrofon, Spracherkennung, die
Piper-Stimmen.

### Piper

Geschriebenen Text spricht der Avatar über [Piper](https://github.com/rhasspy/piper) —
ein eigenständiges Programm, das auf der **CPU** läuft. Das ist hier kein Nebenaspekt,
sondern der Grund für die Wahl: Spiel, OBS und später ein Sprachmodell teilen sich
ohnehin eine Grafikkarte, und die Stimme ist das einzige Stück der Kette, das gar
nicht erst mitbieten muss.

Hinein gehören in `%APPDATA%/pixel-vtuber/piper/`:

- `piper.exe` samt DLLs — das Archiv bringt einen eigenen Unterordner mit, der darf
  so bleiben
- mindestens eine Stimme, immer als **zwei** Dateien: `…onnx` und `…onnx.json`.
  Fehlt die zweite, startet Piper nicht — deshalb zählt eine Stimme erst als
  vorhanden, wenn beide da sind, statt wählbar in der Liste zu stehen und erst beim
  Sprechen zu scheitern.

Stimmen liegen unter `rhasspy/piper-voices` auf Hugging Face; mitgetestet ist
`de/de_DE/thorsten/medium`. Nach dem Hineinlegen einmal neu starten, dann sagt der
Status im Panel, was gefunden wurde.

Gestartet wird Piper im Hauptprozess, nicht im Renderer: Der zeichnet den Avatar und
darf für nichts anhalten. Der Text geht auf die Standardeingabe, das WAV in eine
temporäre Datei, die gelesen und gleich wieder gelöscht wird — der Weg über die
Standardausgabe liefert rohe Samples ohne Kopf, deren Abtastrate man sich erst aus
der `.json` der Stimme zusammensuchen müsste.

**Satzweise, nicht am Stück.** Ein ganzer Absatz braucht mehrere Sekunden, und so
lange soll niemand auf den ersten Ton warten. Also wird zerlegt und Satz für Satz
erzeugt: Der erste läuft schon, während der zweite noch entsteht. Abkürzungen wie
„z. B." gelten dabei nicht als Satzende, und was über 220 Zeichen hinausgeht, wird am
letzten Komma getrennt — ein Absatz ohne Punkt bliebe sonst ein einziges Stück.
Gemessen mit der Thorsten-Stimme: gut 0,25 s zum Laden des Modells, danach rund das
Achtzehnfache der Echtzeit. Für den ersten Satz sind das etwa 0,4 s bis zum Ton.

Dieselbe Warteschlange trägt später die Sätze, die ein Sprachmodell nach und nach
ausgibt; dann fällt nur der fertige Text am Anfang weg.

### Testdatei

```
node tools/make-test-voice.js
```

Baut `tools/test-voice.wav`. Eine beliebige MP3 täte es auch, aber sie sagt einem
nichts: Bleibt der Mund zu, weiß man nicht, ob die Verstärkung zu niedrig steht, die
Schwelle zu hoch liegt oder der Ton gar nicht erst ankommt. Diese Datei prüft je
Abschnitt genau eine Sache — leise Silben (Mund halb auf), laute Silben (weit auf),
ein gezogener Ton (Mund bleibt offen, Balken wird gelb), wieder leise Silben. Das
Skript rechnet anschließend mit derselben Messung nach, die auch die App benutzt, ob
die Abschnitte wirklich enthalten, was sie versprechen.

Gesprochen wird nichts, es ist ein Summen mit Silbenhüllkurve. Für die
Lippensynchronisation ist das kein Unterschied: Sie misst den Pegelverlauf und hat
von Sprache ohnehin keinen Begriff.

## Twitch-Chat

Der Chat kommt über den WebSocket-Server von [Streamer.bot](https://streamer.bot) —
kein OAuth, keine Token-Erneuerung, das erledigt Streamer.bot ohnehin schon. Die
Adresse muss zu *Servers/Clients → WebSocket Server* passen (Vorgabe
`ws://127.0.0.1:8080/`). Ist er noch nicht offen, versucht die App es von selbst
weiter — erst nach einer Sekunde, dann immer seltener bis 30 s, statt im
Sekundentakt zu klopfen.

Abonniert werden genau zwei Ereignisse:

```json
{"request":"Subscribe","events":{"Twitch":["ChatMessage","Cheer"]}}
```

**Er liest nicht den ganzen Chat.** Nur Nachrichten, die mit dem eingestellten
Kommando beginnen (Vorgabe `!ai`), kommen überhaupt bei ihm an; alles andere wird
verworfen, bevor irgendetwas gerechnet wird. Das ist keine Sparmaßnahme — ein Avatar,
der jede Zeile kommentiert, ist nach zehn Minuten unerträglich, und er hat nur einen
Mund.

Das Kommando muss am **Anfang** stehen. „sag mal !ai was" löst nichts aus; sonst
könnte jede beiläufige Erwähnung ihn losreden.

**Bits** sind der zweite Auslöser: Ab der eingestellten Menge bedankt er sich, mit dem
Text der Spende, falls einer dabei war. Die Untergrenze verhindert, dass ein einzelnes
Bit ihn losreden lässt.

### Die Sperre

Was während einer laufenden Antwort hereinkommt, wird **verworfen, nicht aufgestaut**
— dieselbe Regel wie beim Eigenleben. Sonst arbeitet er nach einer lebhaften Minute
eine Warteschlange ab, die längst niemanden mehr interessiert. Dasselbe gilt, solange
er spricht oder auf einen Zuruf hört. Der Status im Panel sagt jedes Mal, warum etwas
verworfen wurde.

### Fremder Text

Chat ist nicht dein Text. Zwei Vorkehrungen:

- Zeilenumbrüche werden zusammengezogen und die Länge bei 300 Zeichen gekappt. Eine
  Wand aus Zeichen kostet Zeit und ist der bequemste Weg, ein Sprachmodell von seinen
  Anweisungen abzubringen.
- Die Chat-Nachricht steht in Anführungszeichen, und direkt daneben steht, dass sie
  ein Zitat ist und keine Anweisung. Dieser Hinweis sitzt bewusst in der Nachricht und
  nicht im Systemtext: näher am Zitat, und er gilt auch dann, wenn du deinen Systemtext
  im Panel umgeschrieben hast.

Eine Garantie ist das nicht — ein hinreichend geschickt formulierter Chateintrag kann
ein Sprachmodell weiterhin aus der Rolle holen. Wer auf Nummer sicher gehen will, hält
das Kommando in einer Streamer.bot-Aktion für Abonnenten oder Moderatoren zurück; dort
sitzt die Rechteprüfung ohnehin schon.

### Eigenleben

Damit er nicht nur antwortet, sondern hin und wieder von selbst etwas sagt. Er
kommentiert dann eine Zeile, die im Chat stand — **nur das**. Ein Avatar, der aus
dem Nichts Sätze bildet, wirkt nicht lebendig, sondern zufällig; ist der Chat still,
ist er es auch.

Der schwierige Teil ist nicht der Anlass, sondern die Bremsen:

- **Die Ruhe ist der Auslöser**, nicht eine Bedingung obendrauf. Er meldet sich,
  wenn du eine Weile nichts gesagt hast — nicht zu einem Zufallszeitpunkt, der
  zusätzlich in eine Redepause fallen muss. Der Unterschied ist keine Feinheit:
  Nachgerechnet über vier simulierte Stunden kam die zweite Bauart auf **einen**
  Impuls, weil zwei unabhängige Bedingungen fast nie zusammentreffen.
- **Einmal je Redepause.** Sonst redete er in einer langen Stille am Stück weiter,
  sobald der Mindestabstand verstrichen ist.
- **Ein Stundenbudget** statt eines festen Takts, damit sich nach einer ruhigen
  Phase nichts aufstaut. Der Mindestabstand daraus ist gestreut — bei „4 je Stunde"
  läge sonst alle exakt 15 Minuten einer, und wer zweimal zusieht, hat den Takt
  heraus.
- **Verworfen statt aufgestaut**, wenn er ohnehin spricht, zuhört oder im Gespräch
  ist — dieselbe Regel wie bei Chat und Bits.

Nachgerechnet über vier Stunden, bei verschiedenen Sprechmustern (40 s reden /
25 s Pause bis 90 s / 25 s): 15–16 Impulse, nie mehr als das Budget je Stunde,
Abstände zwischen 9 und 29 Minuten, kein einziger vor Ablauf der Ruhezeit. Budget
auf 0 schaltet es ganz ab.

Vier bis sechs je Stunde wirken lebendig. Wer höher geht, merkt es erst nach
zwanzig Minuten Stream — und dann ist es zu spät.

### Ohne Stream testen

**Der Chat funktioniert auch offline.** Der Chatraum eines Kanals ist immer offen —
Streamer.bot muss mit deinem Twitch-Konto verbunden sein, senden musst du nicht. `!ai`
im eigenen Chat löst also jederzeit aus.

**Bits gehen so nicht:** Einem Kanal, der nicht sendet, spendet niemand, und sich
selbst spenden kann man auch nicht. Dafür gibt es im Panel *Chat simulieren* und *Bits
simulieren*. Beide schicken eine erfundene Nachricht durch **denselben** Weg, den eine
echte nimmt — samt Feldauswertung, Sperre und allem dahinter, nicht daran vorbei.
Läuft die Simulation durch, funktioniert alles außer der Verbindung selbst.

### Wenn nichts ausgelöst wird

Im Panel steht unter *Zuletzt empfangen* die rohe Nachricht von Streamer.bot. Kommt
dort etwas an, ohne dass er reagiert, heißen die Felder in deiner Fassung anders — der
Auswerter probiert mehrere bekannte Formen durch, aber nicht jede. Dann steht dort, wie
sie wirklich heißen.

## Zuruf

Taste drücken, Frage sagen — transkribiert wird lokal mit
[whisper.cpp](https://github.com/ggml-org/whisper.cpp), der Text geht als Frage an
den Co-Moderator, und der Avatar antwortet. Hinein gehören in
`%APPDATA%/pixel-vtuber/whisper/`: `whisper-cli.exe` samt DLLs (der `Release`-Ordner
aus dem Archiv darf so bleiben) und mindestens ein `ggml-*.bin`.

**Auf der CPU**, und das ist Absicht: Es ist der Teil der Kette, der am wenigsten
davon hat, sich mit dem Spiel um die Grafikkarte zu streiten. Gemessen auf einem
Ryzen 7 5700X mit acht Threads, für gut drei Sekunden Zuruf:

| Modell | Dauer | Ergebnis |
|---|---|---|
| `base` | **1,1 s** | „…kannst du mir kurz erklären, wie das hier funktioniert?" |
| `small` | 2,2 s | dasselbe, ohne das Komma |

Deshalb ist `base` die Vorgabe. Sechzehn Threads statt acht brachten nur noch 6 %,
bei acht physischen Kernen wenig überraschend. Der mitgelieferte `whisper-server`
wurde ausprobiert und verworfen: Er spart nur das Laden des Modells (rund 50 ms, der
Rest steckt im Rechnen) und kostet dafür einen Dienst, der laufen und beendet werden
muss.

Damit liegt die ganze Kette bei rund **zwei Sekunden vom Zuruf bis zum ersten Wort**
— 1,0 s Verstehen, 0,5 s bis zum ersten Satz, 0,4 s Sprechen.

### Zwei Betriebsarten

**Ein Zuruf je Tastendruck** (Vorgabe): drücken, Frage sagen, fertig. Eine Aufnahme,
eine Antwort.

**Dauerbetrieb:** Die Taste schaltet ein und wieder aus. Dazwischen hört er mit, und
jede Sprechpause schließt eine Äußerung ab — du kannst also mehrfach hintereinander
etwas sagen, ohne die Taste anzufassen.

Drei Dinge unterscheiden den Dauerbetrieb, und alle drei sind nötig, damit er
überhaupt taugt:

**Er schreibt nicht mit, während er selbst spricht.** Sonst hörte er sich aus den
Boxen selbst zu und beantwortete seine eigene Antwort — die Rückkopplung, an der
dauerhaftes Zuhören sonst scheitert. Ein Nachlauf von 400 ms fängt zusätzlich den Hall
im Raum ab.

**Der Mund bleibt in Betrieb.** Beim einzelnen Zuruf steht er still, weil du dann *ihn*
ansprichst und er nicht mitreden soll. Im Dauerbetrieb erzählst du deinem Publikum, und
er hört bloß nebenher mit — würde der Mund dabei stillstehen, wäre der VTuber weg.

**Das Weckwort** (Vorgabe „Hey Pixel") ist die Trennlinie zwischen dem, was deinem
Publikum gilt, und dem, was ihm gilt. Ohne das antwortet er auf jeden Satz, den du im
Stream sagst. Geprüft wird es am erkannten **Text**, nicht am Ton: kein zweites Modell,
keine Fehlauslösung durch Spielgeräusche, und es kostet nichts. Was vor dem Weckwort
steht, wird verworfen — „Also Leute, hey Pixel: sag mal was" wird zu „sag mal was".
Ein leeres Feld heißt: er antwortet auf alles.

Beim einzelnen Zuruf gilt das Weckwort nicht — du hast die Taste gedrückt, das ist
Ansprache genug.

**Ein Vorlauf von 350 ms** läuft im Dauerbetrieb ständig mit und wird der Aufnahme
vorangestellt. Ohne ihn fehlte der Wortanfang: Die Aufnahme begänne erst in dem Moment,
in dem der Pegel die Schwelle überschreitet, und genau davor sitzen die Laute, an denen
die Erkennung „was" von „das" unterscheidet.

Äußerungen unter 400 ms werden verworfen — ein Husten ist keine Frage.

### Warum die Aufnahme von selbst endet

Halten zum Reden wäre die naheliegendere Bedienung und ist nicht zu haben: Ein
systemweit registrierter Hotkey meldet unter Electron nur das *Drücken*, nie das
Loslassen. Ein Umschalter wäre die Alternative, aber einer, den man versehentlich
anlässt, nimmt den halben Stream auf.

Also endet die Aufnahme nach einer knappen Sekunde Ruhe. Dafür braucht es nichts
Neues: Der Pegel wird für den Lippensync ohnehin gemessen, und es gilt dieselbe
*Schwelle offen* wie für den Mund. Sagst du gar nichts, bricht sie nach vier Sekunden
ab, und nach fünfzehn Sekunden ist ohnehin Schluss.

Aufgenommen wird über einen zweiten Abgriff am schon offenen Mikrofon — kein zweites
Gerät, keine zweite Freigabe. Was dabei anfällt, wird von den 48 kHz des
Audiokontexts auf die 16 kHz gemittelt, die whisper.cpp erwartet; beim bloßen
Auslassen jedes dritten Werts klänge alles oberhalb von 8 kHz als tieferer Ton wieder
mit hinein, und dort liegen die Zischlaute, an denen die Erkennung Wörter
auseinanderhält.

Redest du dazwischen, während der Avatar noch spricht, bricht er ab und hört zu.

**Während er zuhört, bewegt er den Mund nicht** und gestikuliert auch nicht. Der
Pegel deiner Stimme liegt ja weiter an, und ohne diese Ausnahme spräche er mit,
während du ihm eine Frage stellst — er sähe aus, als redete er, dabei hört er zu.

### Wenn er schlecht versteht

Drei Stellschrauben, in dieser Reihenfolge:

1. **Die Wortliste im Panel.** Sie erzwingt nichts, macht die genannten Wörter aber
   wahrscheinlicher — genau das brauchen Eigennamen und Spieltitel. Gemessen an
   einem Satz: ohne Liste „Was denkst du über *pixelat* im Stream?", mit Liste
   „…über *Pixelart* im Stream?".
2. **Die letzte Aufnahme anhören.** Versteht er etwas falsch, ist die erste Frage,
   ob das Wort überhaupt verständlich in der Aufnahme steht. Sonst sucht man den
   Fehler im Modell, während in Wahrheit der Anfang fehlt oder zu früh geschnitten
   wurde.
3. **`small` statt `base`.** Kostet gut eine Sekunde und ist der letzte Schritt,
   nicht der erste.

Die Aufnahme wird vor der Erkennung auf Zimmerlautstärke gehoben (nur verstärkt, nie
gedämpft, Faktor gedeckelt). Der Lippensync kommt mit einem leisen Signal zurecht, er
multipliziert es ja selbst über *Verstärkung* — die Erkennung bekam bis dahin das
Rohsignal und damit bei einem zurückhaltend eingestellten Mikrofon ein Flüstern.
Zusätzlich unterdrückt `-sns` Tokens für Nicht-Sprache, damit Atmen und Tastaturklicken
nicht als erfundenes Wort im Text landen und als Frage weitergereicht werden.

## Co-Moderator

Eine Frage geht an ein lokales Sprachmodell über [Ollama](https://ollama.com), die
Antwort spricht der Avatar aus. Es geht nichts ins Netz, und außer Ollama selbst
läuft dafür kein weiterer Dienst.

Gefragt wird im Hauptprozess, nicht im Panel — so bleibt die Content-Security-Policy
dort eng, und der Renderer bleibt bei dem, was er kann: zeichnen.

**Die Antwort kommt stückweise**, und jedes fertige Satzende geht sofort weiter an
Piper. Wartete man das Ende der Antwort ab, stünde vor dem ersten Ton die volle
Erzeugungsdauer. Gemessen mit `gemma3:4b` auf einer RTX 5070:

| | warm |
|---|---|
| erstes Token | ~0,4 s |
| erster **Satz** fertig | 0,45–0,67 s |
| ganze Antwort | 0,6–0,8 s |

Plus rund 0,4 s für Piper macht **etwa eine Sekunde von der Frage bis zum ersten
Ton** — und zwar unabhängig davon, wie lang die Antwort insgesamt wird. Deshalb zeigt
der Status beide Zeiten getrennt: Wie lange es bis zum letzten Wort dauert, merkt
niemand, solange vorne nichts stockt.

**Kalt sieht es anders aus:** Der allererste Aufruf nach dem Start brauchte 54
Sekunden, weil Ollama das Modell erst in den Speicher der Grafikkarte lädt. Danach
bleibt es dort. Wer nebenher spielt, will genau das nicht — dann ist `keep_alive`
in Ollama das Mittel, das Modell im Leerlauf wieder freizugeben, und die Ladezeit
ist der Preis dafür.

**Wie er sich verhalten soll** steht als Text im Panel. Die Kürze darin ist keine
Höflichkeitsformel: Jeder Satz wird ausgesprochen, und dazwischenreden kann man dem
Avatar nicht. Zusätzlich ist die Länge hart begrenzt (`num_predict`), denn ein
Modell, das sich verplappert, redet hier nicht einfach zu viel — es blockiert den
Mund. Dass die Antwort vorgelesen wird, muss ebenfalls ausdrücklich drinstehen, sonst
kommen Aufzählungen, Sternchen und Emojis zurück, die die Sprachausgabe brav mitliest.

Eine neue Frage bricht die laufende ab. Zwei Antworten gleichzeitig hätten nur ein
Ziel — denselben Mund.

### Ohne Sprachmodell: vorgefertigte Antworten

Der Anbieter **Vorgefertigte Antworten** kommt ganz ohne KI aus. Der Co-Moderator
sucht in einer Liste nach Stichwörtern und antwortet mit einem vorbereiteten Satz.
Kein VRAM, keine Wartezeit, keine erfundenen Tatsachen — und man weiß vorher genau,
was er sagen kann. Für einen Stream ist das oft die passendere Wahl als ein Modell,
das kluge Sätze über Dinge bildet, die es nicht weiß.

Die Liste liegt in `antworten.json`:

```json
{ "wenn": ["hallo", "moin", "servus"],
  "dann": ["Hallo zusammen!", "Moin!", "Hey, schön dass ihr da seid."] }
```

Zwei Entscheidungen darin sind wichtiger, als sie aussehen:

**Gesucht wird nach Stichwörtern, nicht nach der genauen Frage.** Niemand tippt eine
Frage zweimal gleich, und die Spracherkennung schreibt sie ohnehin jedes Mal anders.
Groß-/Kleinschreibung und Satzzeichen fallen vorher weg, „Hallo!" trifft also
dasselbe wie „hallo".

**Je Eintrag stehen mehrere Antworten, aus denen zufällig gewählt wird.** Käme auf
dieselbe Frage immer derselbe Satz, hätte der Chat es nach dem zweiten Mal
durchschaut.

Geprüft wird von oben nach unten — was weiter oben steht, gewinnt. Deshalb stehen
enge Fälle zuerst und weite unten. Passt nichts, kommt eine der Ausweichantworten
aus `sonst`.

Der Knopf *Antwortliste bearbeiten* legt beim ersten Mal eine Kopie der
mitgelieferten Liste nach `%APPDATA%/pixel-vtuber/` und öffnet sie. Deine Fassung
gilt dann statt der mitgelieferten und überlebt jedes Update.

**Zwei Listen, nicht eine.** `antworten` beantwortet Fragen, `chat` liefert die
Kommentare fürs Eigenleben. Das ist kein Ordnungsprinzip, sondern nötig: Ein
Kommentar ist etwas anderes als eine Antwort — niemand hat ihn gefragt, er sagt von
sich aus etwas zu einer Zeile, die vorbeigelaufen ist. Die Frageliste würde dort
„Da muss ich passen" sagen, was auf einen Kommentar keinen Sinn ergibt.

In der Chat-Liste steht `{name}` für den Schreiber:

```json
{ "wenn": ["moin", "hallo", "bin da"],
  "dann": ["{name} ist dazugekommen.", "Willkommen, {name}."] }
```

Ohne den Platzhalter klänge jeder allgemeine Kommentar gleich, egal wer geschrieben
hat. Gesucht wird hier im **Chattext**, nicht in einer Frage.

Damit die vorgefertigten Antworten den Unterschied überhaupt kennen können, wird
die Art des Anlasses getrennt vom Text mitgeschickt — einem Sprachmodell steht sie
ohnehin im Text, aber eine Stichwortsuche kann sie ihm nicht ansehen.

### Drei Anbieter mit Sprachmodell

Wählbar im Panel, ohne Codeänderung:

| Anbieter | wofür | Schlüssel |
|---|---|---|
| **Ollama** | lokal, nichts geht ins Netz | nein |
| **OpenAI-kompatibel** | OpenAI, aber ebenso LM Studio, llama.cpp, KoboldCpp, Groq, OpenRouter | je nach Adresse |
| **Anthropic** | Claude, über das offizielle SDK | ja |

„OpenAI-kompatibel" ist der Sammelpfad: Diese Schnittstelle sprechen sehr viele
Anbieter, umgestellt wird über die **Adresse**. Ein lokaler Server dort braucht
keinen Schlüssel, deshalb wird der Kopf nur mitgeschickt, wenn einer hinterlegt ist.

Die Modelliste kommt bei allen drei vom Anbieter selbst, nicht aus einer gepflegten
Liste im Code. Ein Modellname, den die Liste nicht kennt, wird trotzdem übernommen —
manche Anbieter geben ihre Auswahl gar nicht heraus.

### Wer er ist: die Charakterdatei

Das Feld **Wie er sich verhalten soll** ist absichtlich fünf Zeilen hoch. Dort gehören
die Regeln hinein, die aus dem *Vorlesen* folgen — reiner Fließtext, keine
Aufzählungen, keine Sternchen. Das sind drei Sätze, und sie dürfen nicht
verlorengehen.

Wer die Figur *ist* — Herkunft, Tonfall, was sie nie sagt, wen sie wie behandelt —,
sind schnell zwei Seiten. Die schreibt man nicht in ein fünfzeiliges Feld. Dafür gibt
es die **Charakterdatei**: eine Markdown-Datei, die dort liegen darf, wo du sie
ohnehin pflegst. Sie kommt **zusätzlich** zum Feld darüber, nicht an seiner Stelle.

Gelesen wird sie bei **jeder Frage neu**. Eine Änderung wirkt also sofort, auch mitten
im Stream. Das Lesen selbst kostet nichts Messbares; der *Inhalt* kostet sehr wohl —
jedes Zeichen muss das Modell verarbeiten, bevor das erste Wort fällt. Deshalb zeigt
das Panel, wie viel hinausgeht, und färbt sich ab etwa acht Kilobyte.

Selten ist so eine Datei von der ersten bis zur letzten Zeile fürs Modell bestimmt —
Überschrift, Vorwort, eigene Notizen. Das alles mitzuschicken wäre nicht nur Ballast:
Das Modell liest es als Anweisung an sich. Ein Absatz wie „dieses Dokument hat zwei
Teile" lässt es nach einem zweiten Teil suchen, den es nie bekommt. Zwei Marker
grenzen deshalb ab, was wirklich hinausgeht:

```
Meine Notizen zur Figur …

<!-- start -->
Du bist Schörk, ein grantiger Ork-Opa …
<!-- ende -->

Zu erledigen: Begrüßung überarbeiten
```

Nur der Teil dazwischen geht ans Modell. Fehlt ein Marker, gilt die Datei ab ihrem
Anfang beziehungsweise bis zu ihrem Ende; fehlen beide, die ganze Datei. Es sind
HTML-Kommentare, weil die in gerendertem Markdown unsichtbar bleiben — deine Datei
sieht im Editor und auf GitHub aus wie vorher.

Der Knopf **Zeigen, was ans Modell geht** zeigt genau den Ausschnitt, der wirklich
gefragt wird — aus derselben Stelle im Code, die auch die Anfrage füllt. Eine Vorschau
aus zweiter Quelle weicht irgendwann ab, und dann sucht man den Fehler im Modell statt
in der Datei.

Ist die Datei beim Fragen nicht lesbar — umbenannt, Laufwerk weg —, antwortet er
trotzdem, nur ohne Charakter, und das Panel sagt es in Rot. Mitten im Stream ist ein
neutraler Satz besser als keiner.

### Höchstlänge und Nachdenken

**Höchstlänge** begrenzt, wie viel er am Stück sagt. Das ist keine Kostenbremse —
lokal kostet nichts —, sondern eine *Redezeitgrenze*: Jedes Stück Antwort wird
ausgesprochen, und dazwischenreden kann man ihm nicht. Ohne Grenze redet ein
gesprächiges Modell minutenlang weiter, während der Chat wartet. 300 sind zwei bis
drei Sätze mit Luft; ein knapper Charakter kommt mit 80 aus, bricht dann aber auch mal
mitten im Satz ab.

**Nachdenken zulassen** ist ab Werk **aus**. Denkmodelle — Qwen3, DeepSeek-R1 und
Verwandte — überlegen erst schriftlich. Das sieht man nicht, es zählt aber gegen die
Höchstlänge. Gemessen an Qwen3.5-9B in LM Studio: 1298 Zeichen Nachdenken, dann
Schluss wegen Länge — **kein einziges Wort Antwort**, nach 24 Sekunden. Abgeschaltet
kam das erste Wort nach 395 Millisekunden.

Von den Wegen, die dafür kursieren, wirkt genau einer: `reasoning_effort: 'none'`.
Weder `chat_template_kwargs` noch ein `/no_think` im Text ändern etwas — das eine wird
stillschweigend geschluckt, das andere halbiert es bestenfalls. Der Schalter geht nur
an *OpenAI-kompatibel*; wer ihn nicht kennt, ignoriert ihn.

Bleibt eine Antwort leer, meldet das Panel jetzt *warum*. Vorher stand dort „Antwort
fertig nach 24 s", während der Avatar stumm dastand — eine leere Antwort ist nie ein
Erfolg, und ein Erfolgshinweis darüber ist die teuerste Art, einen Fehler zu
verstecken.

### Wo der Schlüssel liegt

**Nicht** in der `settings.json`. Electron bringt mit `safeStorage` die
Verschlüsselung des Betriebssystems mit — unter Windows DPAPI, gebunden an dein
Benutzerkonto. Kopiert jemand die Datei auf einen anderen Rechner, ist sie dort
wertlos. Das kostet keine zusätzliche Abhängigkeit und ist der Unterschied zwischen
„Datei kopiert" und „Schlüssel gestohlen".

Seit den Cloud-Stimmen sind es **zwei** Schlüssel: einer fürs Sprachmodell
(`aikey.dat`), einer für die Sprachausgabe (`ttskey.dat`). Getrennt, weil es getrennte
Dienste sind — wer eine Stimme bei ElevenLabs holt, muss dort nicht auch sein Modell
laufen lassen. Beide gehen denselben Weg über DPAPI.

Zurückgelesen wird er nie — auch nicht ins Panel. Der Renderer erfährt aus dem Status
nur, *ob* einer hinterlegt ist; gebraucht wird er ausschließlich im Hauptprozess.

Bei Anthropic wird zusätzlich `stop_reason: "refusal"` abgefragt. Eine abgelehnte
Anfrage kommt als *erfolgreiche* Antwort mit leerem Inhalt zurück — ohne diese Prüfung
bliebe der Avatar wortlos stehen, und niemand wüsste warum.

### Neu suchen

Der Knopf **Modelle & Stimmen neu suchen** oben im Panel liest alles neu ein: Ollama-
Modelle, Piper-Stimmen, Whisper-Modelle. Ohne ihn findet die App frisch hineingelegte
Dateien und neu geladene Modelle erst beim nächsten Start.

## Gestik

Solange geredet wird, öffnet der Avatar von selbst die Hände, schließt sie gleich
wieder, pausiert kurz und fängt von vorn an — dieses Hin und Her ist es, was nach
Gestik beim Sprechen aussieht.

**Lebhaftigkeit** steuert das Tempo dieses Zyklus, von etwa 13 Gesten pro Minute
ganz links bis 50 ganz rechts; nebenbei verschiebt sich der Anteil, den die Hände
oben verbringen, von 30 auf 75 %. Abgeschaltet wird über das Häkchen darüber, nicht
über den Regler — auch ganz links wird noch gestikuliert.

Wichtig ist dabei die Rechenreihenfolge: erst steht die Zykluslänge fest, dann wird
sie in Geste und Pause aufgeteilt. Leitet man beide Phasen einzeln aus dem Regler
ab, verschiebt sich nur ihr Verhältnis, während die Zykluslänge fast gleich bleibt
— die Hände bewegen sich dann über den ganzen Reglerweg gleich oft, und der Regler
scheint nichts zu tun.

Grundmaß bleibt die Dauer der gewählten Pose, damit eine kurze Geste nicht in einem
langen Takt hängt. Beide Zeiten sind gestreut, damit kein Zyklus dem anderen
gleicht. Greift nur, solange „Arme verschränkt" gewählt ist — wählst du selbst eine
Pose oder drückst einen Hotkey, hat das Vorrang.

Der Posenwechsel blendet die Körper weich ineinander (**Übergang**, Standard
140 ms). Augen und Mund werden erst danach daraufgezeichnet und bleiben deshalb
während des Übergangs scharf.

## OBS

Empfohlen: **Hintergrund = Grün** (`#00FF00`, reines Grün für maximalen Abstand zu
Hauttönen), in OBS eine *Fensteraufnahme* auf „Pixel VTuber" plus
**Chroma-Key**-Filter. Das funktioniert unabhängig von OBS-Version und
Aufnahmemethode.

*Transparent* spart den Filter und hat sauberere Kanten an den Haaren, aber ob die
Transparenz durchkommt, hängt von der Aufnahmemethode ab — probier es aus, und geh
auf Grün zurück wenn der Hintergrund schwarz erscheint.

### Die Stimme auf einer eigenen Spur

Ab Werk endet der Sprachgraph auf `audioCtx.destination`, also auf dem
Standardgerät von Windows. In OBS liegt die Stimme damit im Desktop-Ton zwischen
Musik, Discord und Browser und ist dort nicht mehr herauszulösen.

**Ausgabegerät** (Reiter *Stimme*) hängt stattdessen ein eigenes Gerät hinter die
Klangfarbe. Der Umweg ist nötig, nicht bequem: Ein Ausgabegerät lässt sich nur an
einem Medienelement wählen (`setSinkId`), nicht am Ausgang eines `AudioContext`.
Also endet die Kette wahlweise in einem `MediaStreamAudioDestinationNode`, dessen
Stream ein verstecktes `<audio>` auf dem gewählten Gerät abspielt.

Dass diese Trennung überhaupt sauber ist, liegt an zwei Stellen weiter oben: Das
Mikrofon geht ausschließlich an seinen Analysator, und der Abgriff der
Spracherkennung hängt zwar am Ausgang, aber hinter einem Verstärker mit `gain 0`
(ein `ScriptProcessor` läuft nur, wenn sein Ausgang irgendwo ankommt). Hörbar
verlässt die App also genau eine Sache: die Stimme des Avatars.

**Mithören** ist ein zusätzlicher Zweig auf `audioCtx.destination`, kein Ersatz —
sonst hört man den eigenen Co-Moderator nicht mehr, sobald er sauber im Stream
landet. Der Analysator hängt weiterhin direkt an der Klangfarbe: Der Mund folgt
dem Graphen, nicht dem Gerät, und bleibt damit unabhängig davon, wohin der Ton
geht.

Fällt ein Gerät weg (Kabel abgezogen, Rechner gewechselt), schaltet die App
hörbar auf den Standard zurück **und schreibt es hin**. Der stille Rückfall wäre
der schlimmere Fehler: Man merkt ihn erst an der fertigen Aufnahme.

## Hotkeys

Systemweit, funktionieren auch während ein Spiel im Vordergrund ist:

- `Strg+Alt+1` — Pose: Arme verschränkt
- `Strg+Alt+2` — Pose: gestikulierend
- `Strg+Alt+P` — Panel ein/aus (die anderen Wege zurück: Leiste beim Überfahren, Tray-Symbol)
- `Strg+Alt+5` — Zwinkern
- Je Pose einer, eingestellt bei *Posen & Gesten* (Vorgabe: `Strg+Alt+1` bis `4`)

Im Panel änderbar: Feld anklicken, Kombination drücken. Belegt ein anderes Programm
die Kombination, meldet die App das direkt darunter.

## Einstellungen

Landen in `%APPDATA%/pixel-vtuber/settings.json` — ein Neubau der App wirft die
Kalibrierung also nicht weg.

## Versionen und Releases

Die Version steht an genau **einer** Stelle: `version` in der `package.json`. Von
dort holt sie sich alles Übrige — der Dateiname der .exe, die Angaben im
Explorer, und die Zeile im Panel neben dem Namen. Der Renderer fragt sie über
`app.getVersion()` ab, nicht aus einer zweiten Konstante: Zwei Zahlen, die man
von Hand gleich halten muss, sind irgendwann nicht mehr gleich — und dann meldet
jemand einen Fehler zu einer Fassung, die es nie gab.

### Wann welche Stelle steigt

Nach [SemVer](https://semver.org), auf diese App gelesen:

| | wann | Beispiel |
|---|---|---|
| **1.**0.0 | die App tut etwas grundlegend anders, oder eine Einstellung fällt weg | Sprites raus, nur noch 3D |
| 1.**1**.0 | etwas Neues, das vorher nicht ging | Stimmen aus der Cloud |
| 1.0.**1** | ein Fehler ist behoben, sonst nichts | das Fenster ließ sich nicht verschieben |

Im Zweifel die mittlere Stelle. Sie ist die einzige, die im Alltag oft steigt.

### Was beim Hochzählen nicht passieren darf

**`name` in der `package.json` bleibt `pixel-vtuber` — für immer.** Daran hängt
der Ordner `%APPDATA%\pixel-vtuber`, in dem Einstellungen, Stimmen, Sprites und
Whisper-Modelle liegen. Ein anderer Name heißt ein anderer Ordner heißt: Beim
nächsten Start steht die App da wie frisch installiert, und die alten Dateien
liegen unauffindbar daneben. `version` zu ändern ist dagegen völlig gefahrlos.

Neue Einstellungen brauchen ebenfalls nichts weiter: Beim Laden wird über die
Vorgaben gelaufen und nur übernommen, was in der Datei steht. Ein Schlüssel, den
es noch nicht gab, bekommt seinen Standard; einer, den es nicht mehr gibt, fällt
weg.

### Der Ablauf beim Veröffentlichen

Die Version steigt **mit dem Commit**, der sie verdient — nicht erst beim
Release. So lässt sich zu jedem Commit sagen, welche Fassung er ergibt, und die
Zeile im Panel stimmt in jedem Zwischenstand.

```
1. version in package.json hochzählen
2. git commit -m "..."          ← die Version steht in der Commit-Nachricht
3. git tag v1.1.0
4. git push && git push --tags
5. npm run dist && npm run dist:setup
6. beide .exe an den GitHub-Release hängen
```

Die Commit-Nachricht nennt die Version in der ersten Zeile, etwa:

```
1.1.0 — Stimmen aus der Cloud, Gesprächsverlauf, Posen bei Ereignissen
```

Der Grund ist praktisch: Meldet jemand einen Fehler zu „1.1.0“, findet man den
Stand mit `git log --oneline | grep 1.1.0` in einem Schritt, statt Tags und
Daten gegeneinander zu halten.

Nicht jeder Commit braucht eine neue Version. Zwischenstände, aufgeräumter Code,
eine Korrektur an der Anleitung — die laufen unter der Version, die gerade gilt.
Erhöht wird, sobald etwas herausgeht.

### Ein Release bauen

```
npm run dist         → dist/PixelVTuber-<version>-portable.exe
npm run dist:setup   → dist/PixelVTuber-<version>-setup.exe
```

Der Dateiname trägt die Version, es können also mehrere nebeneinander liegen.

Für GitHub:

1. `version` in der `package.json` hochzählen
2. committen, dann `git tag v<version>` und `git push --tags`
3. beide .exe-Dateien an den Release hängen
4. dazuschreiben, **was sich geändert hat** — in ganzen Sätzen, nicht als
   Commit-Liste. Wer aktualisiert, will wissen, ob es ihn betrifft

**Sag dazu, dass Windows warnt.** Die .exe ist nicht signiert, und SmartScreen
meldet sich bei jedem Download mit „Der Computer wurde durch Windows geschützt“ →
*Weitere Informationen* → *Trotzdem ausführen*. Das verschweigen zu wollen ist
der schlechtere Weg: Wer die Warnung unerwartet sieht, lädt nicht herunter. Wer
sie angekündigt bekommt, klickt durch.

## Als .exe bauen

```
npm run dist         → dist/PixelVTuber-1.0.0-portable.exe   (eine Datei, kein Setup)
npm run dist:setup   → dist/PixelVTuber-1.0.0-setup.exe      (Installer mit Verknüpfungen)
```

Beides enthält Electron, Sprites und alles Weitere — auf dem Zielrechner muss nichts
installiert sein. Rund 80 MB, das ist bei Electron normal.

Die .exe trägt Icon, Produktnamen, Hersteller, Version und Copyright — nachzusehen
über Rechtsklick → Eigenschaften → Details. Das Icon entsteht aus
`tools/make-icon.js` und liegt als `build/icon.png` und `build/icon.ico` im Repo;
wer es ändern will, ändert das 16×16-Raster im Skript und lässt es neu laufen.

**Die .exe ist nicht signiert.** Beim ersten Start meldet sich Windows SmartScreen
mit „Der Computer wurde geschützt" → *Weitere Informationen* → *Trotzdem
ausführen*. Das loszuwerden kostet ein Code-Signing-Zertifikat (dreistellig pro
Jahr); Icon und Metadaten helfen den Heuristiken, ersetzen die Signatur aber nicht.

**Wenn der Build beim Signier-Werkzeug abbricht.** Für Icon und Metadaten lädt
electron-builder das Paket `winCodeSign` und entpackt es. Darin liegen zwei
macOS-Symlinks, und Symlinks anzulegen erlaubt Windows nur mit Sonderrecht:

```
ERROR: Cannot create symbolic link ... darwin/10.12/lib/libcrypto.dylib
Dem Client fehlt ein erforderliches Recht.
```

Die `.dylib`-Dateien sind auf Windows nutzlos — sie lassen nur das Entpacken
scheitern, und damit fehlt `rcedit.exe`, das Icon und Metadaten in die .exe
schreibt. Zwei Wege heraus:

1. **Entwicklermodus einschalten** (Einstellungen → Update und Sicherheit → Für
   Entwickler). Danach darf dein Konto Symlinks anlegen und der Build läuft durch.
2. **Von Hand entpacken, ohne den macOS-Teil.** Im Cache
   `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign` liegt das
   heruntergeladene `.7z`. Entpacken nach `winCodeSign-2.6.0` daneben:

   ```
   node_modules/7zip-bin/win/x64/7za.exe x <archiv>.7z -o<cache>/winCodeSign-2.6.0 -xr!darwin
   ```

   Der Ordnername muss stimmen, sonst lädt electron-builder erneut.

Frühere Fassungen umgingen das mit `signAndEditExecutable: false` in der
package.json. Das überspringt den Schritt zwar, kostet aber genau das, worum es
geht: Ohne ihn bekommt die .exe weder Icon noch Produktnamen — eine namenlose
Binärdatei mit Electron-Standardsymbol, und so etwas stuft Windows erst recht als
verdächtig ein.

## Debug

`VTUBER_SHOT=pfad.png npm start` nimmt das Fenster nach ein paar Sekunden auf und
beendet die App — nützlich, um das Rendering ohne Blick auf den Bildschirm zu
prüfen. Verzögerung über `VTUBER_SHOT_DELAY` (ms).

### Änderungen über das Panel prüfen, nicht daran vorbei

Verlockend ist, einen Wert direkt in `settings.json` zu schreiben und dann ein Bild
zu vergleichen. Das prüft die **Wirkung** einer Einstellung und überspringt den
**Weg dorthin** — und genau dort saß ein Fehler, der vierundzwanzig Regler auf
einmal betraf: Beim Umbau auf zwei Figuren wurde die Reglerliste in `CONTROLS` und
`AV_CONTROLS` geteilt, die Schleife in `wireUi()` folgte aber nur der ersten. Kein
Regler der unteren Panelhälfte tat etwas, monatelang, weil jede Prüfung die
Verdrahtung umging.

Wer das nachstellt: `app.js` liegt in einer IIFE, an Interna kommt man also nicht
heran — als Blackbox über den `localStorage` gegenprüfen (ohne Preload nimmt die
App diesen Weg). **Vorher leeren und neu laden**, sonst findet der Lauf die Werte
des vorigen wieder und meldet Erfolg, ohne dass etwas passiert ist. Und immer
gegenprüfen, dass die Probe ohne die Korrektur auch wirklich durchfällt — ein
grüner Lauf, der immer grün ist, beweist nichts.

## Lizenz

Copyright © 2026 Baloou. Der vollständige Text steht in [LICENSE](LICENSE);
maßgeblich ist die deutsche Fassung.

Kurz, ohne Anspruch auf Vollständigkeit:

- **Benutzen darfst du sie uneingeschränkt** — auch im Stream, mit dem du Geld
  verdienst. Subs, Bits, Spenden, Werbung, Auftragsarbeiten: alles erlaubt. Was du
  mit der App erstellst, gehört dir.
- **Verändern und weitergeben** darfst du sie ebenfalls, solange die Weitergabe
  **kostenlos** bleibt, die Herkunft erkennbar ist, diese Lizenz mitgeht und
  Änderungen als solche gekennzeichnet sind.
- **Verkaufen darfst du sie nicht** — weder die App noch eine Abwandlung, weder
  einzeln noch als Teil eines kostenpflichtigen Angebots oder hinter einer
  Bezahlschranke.

**Das ist bewusst keine Open-Source-Lizenz.** Jede OSI-anerkannte Lizenz, auch die
GPL, erlaubt ausdrücklich den Verkauf — genau das soll hier nicht sein. Der
Quelltext ist offen einsehbar und veränderbar („source available"), aber das
Projekt nennt sich deshalb nicht Open Source.

Mitgelieferte Fremdbestandteile behalten ihre eigenen Lizenzen: Electron, Chromium
und Node.js (`LICENSE.electron.txt` und `LICENSES.chromium.html` im
Programmordner), three.js und das Anthropic-SDK (beide MIT).

## Altlast

`vtube.html` ist der frühere Webcam-Prototyp (MediaPipe-Gesichtstracking, schnitt
echte Augen und Mund ins Portrait). Wird von der App nicht mehr verwendet, bleibt
aber als Referenz liegen.
