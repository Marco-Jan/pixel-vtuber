# Animationen aus FBX- und glb-Dateien auf eine beliebige Figur backen.
#
# Aufruf:
#   blender --background --python blender/anim-import.py -- \
#           --quelle  <unberührte glb>   \
#           --ziel    <glb, die entsteht> \
#           --ordner  <Ordner mit den Animationsdateien>
#
# Der allgemeine Nachfolger von `troll-posen.py`. Jenes Skript war auf eine
# bestimmte Figur festgelegt: Es las eine feste Quelldatei, schrieb ein festes
# Ziel und baute Posen aus Winkeln, die an genau diesem Rig gemessen waren. Für
# eine fremde Figur funktionierte es nicht — und in einer ausgelieferten App ist
# genau das der Regelfall.
#
# Hier steckt keine Figur mehr im Code. Was gebraucht wird, kommt als Argument,
# und die einzige Annahme ist die, ohne die es nicht geht:
#
#   Die Animationsdatei muss dasselbe Skelett tragen wie die Figur.
#
# Das klingt streng, ist in der Praxis aber der Normalfall: Wer seine *fertige*
# glb bei Mixamo hochlädt, bekommt sein eigenes Skelett zurück — gleiche
# Knochennamen, gleiche Ruhepose. Dann lassen sich die Haltungen Bild für Bild
# übernehmen, ohne Umrechnung. Trägt eine Datei ein fremdes Skelett, bleibt die
# Schnittmenge der Knochennamen leer und sie wird übersprungen, statt Unsinn zu
# erzeugen.
#
# Was in der Quelldatei schon an Animationen steckt, bleibt erhalten: Importiert
# wird die Quelle mitsamt ihren Spuren, und die neuen kommen dazu. Deshalb braucht
# es hier keine Posen aus Code — wer eigene gebaut hat, hat sie in seiner Datei.
import bpy, json, math, os, glob, re, sys


def argument(name, vorgabe=None):
    """Argumente hinter dem `--` von Blender einsammeln."""
    argv = sys.argv
    if '--' in argv:
        argv = argv[argv.index('--') + 1:]
    else:
        argv = []
    if name in argv:
        i = argv.index(name)
        if i + 1 < len(argv):
            return argv[i + 1]
    return vorgabe


QUELLE = argument('--quelle')
ZIEL   = argument('--ziel')
ORDNER = argument('--ordner')
FPS    = int(argument('--fps', '30'))

if not QUELLE or not ZIEL or not ORDNER:
    print('<<<ERGEBNIS>>>')
    print(json.dumps({'ok': False, 'fehler': 'Aufruf braucht --quelle, --ziel und --ordner'}))
    print('<<<ENDE>>>')
    raise SystemExit(1)


def viewport():
    """Ein 3D-Bereich als Zusammenhang für Import und Export.

    Im Hintergrund gibt es keinen, und dort laufen die Operatoren auch ohne. In
    der offenen Oberfläche sucht der glTF-Importeur dagegen `context.object` und
    bricht ohne diesen Bereich ab — mit einem Fehler, der nichts über die Ursache
    verrät."""
    for win in bpy.context.window_manager.windows:
        for area in win.screen.areas:
            if area.type == 'VIEW_3D':
                return dict(window=win, screen=win.screen, area=area,
                            region=next(r for r in area.regions if r.type == 'WINDOW'))
    return None


def im_bereich(fn, **kw):
    v = viewport()
    if v:
        with bpy.context.temp_override(**v):
            return fn(**kw)
    return fn(**kw)


def leeren():
    im_bereich(bpy.ops.wm.read_homefile, use_empty=True)
    # Die Startdatei kann eine Icosphere und Kamera mitbringen. In einer leeren
    # Datei sollte das nicht auftauchen, tut es aber — und im Export führe eine
    # Kugel dazu, dass die Kamera der App sie statt der Figur rahmt.
    for name in ('Icosphere', 'Cube', 'Camera', 'Light'):
        ob = bpy.data.objects.get(name)
        if ob:
            bpy.data.objects.remove(ob, do_unlink=True)


def lade(pfad):
    lader = (bpy.ops.import_scene.fbx if pfad.lower().endswith('.fbx')
             else bpy.ops.import_scene.gltf)
    im_bereich(lader, filepath=pfad)


leeren()
lade(QUELLE)

arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
if arm is None:
    print('<<<ERGEBNIS>>>')
    print(json.dumps({'ok': False, 'fehler':
        'Die Figur hat kein Skelett. Ohne Skelett gibt es nichts zu animieren.'}))
    print('<<<ENDE>>>')
    raise SystemExit(1)

sc = bpy.context.scene
sc.render.fps = FPS

for ob in list(bpy.data.objects):
    if ob.type in ('CAMERA', 'LIGHT'):
        bpy.data.objects.remove(ob, do_unlink=True)

# Was die Quelle schon mitbringt, behalten und die Namen merken — ein neuer Clip
# darf einen vorhandenen nicht überschreiben.
if arm.animation_data is None:
    arm.animation_data_create()
vorhanden = set()
for spur in list(arm.animation_data.nla_tracks):
    if spur.name:
        vorhanden.add(spur.name.lower())

# Namen, die nichts über den Inhalt sagen. Steht so einer am Ende, wird der
# Dateiname genommen — `Armature|mixamo.com|Layer0` hilft keinem weiter.
NICHTSSAGEND = {'layer0', 'baselayer', 'mixamo_com', 'clip0', 'action', 'armature'}


def saeubern(s):
    """Ein Name, mit dem sich später bequem arbeiten lässt.

    Kleinschreibung, und alles außer Buchstaben und Ziffern wird zum Unterstrich:
    `Orc Idle` ergibt `orc_idle` statt `orc idle`. Ein Leerzeichen im Clipnamen
    bricht nichts, man tippt es nur ständig falsch.

    Das `.001` am Ende schneidet Blenders Importzähler weg. Ohne das käme ein
    Clip, den die Quelle schon enthält, als `wave.001` ein zweites Mal durch."""
    s = re.sub(r'\.\d{3}$', '', str(s).strip().lower())
    return re.sub(r'[^a-z0-9]+', '_', s).strip('_')


def sauberer_name(aktion, pfad):
    teil = saeubern(aktion.name.split('|')[-1])
    if not teil or teil in NICHTSSAGEND:
        teil = saeubern(os.path.splitext(os.path.basename(pfad))[0].split('_')[-1])
    return teil


def slot_anhaengen(streifen, akt):
    """Blender 5 hängt die Kurven an einen Slot unter der Action. Ein NLA-Streifen
    ohne zugewiesenen Slot spielt dann nichts ab. In 4.x gibt es das nicht."""
    slots = getattr(akt, 'slots', None)
    if not slots:
        return
    if hasattr(streifen, 'action_slot'):
        try:
            streifen.action_slot = slots[0]
        except Exception:
            pass


def clips_aus_datei(pfad):
    """Alle brauchbaren Animationen einer Datei auf die Figur backen."""
    vorher_obj = set(bpy.data.objects)
    vorher_akt = set(bpy.data.actions)
    try:
        lade(pfad)
    except Exception as e:
        return [], str(e)

    neu_obj = [o for o in bpy.data.objects if o not in vorher_obj]
    neu_akt = [a for a in bpy.data.actions if a not in vorher_akt]
    quelle = next((o for o in neu_obj if o.type == 'ARMATURE'), None)

    raus = []
    grund = None
    if quelle is None:
        grund = 'kein Skelett in der Datei'
    else:
        teilen = [b.name for b in arm.data.bones if quelle.pose.bones.get(b.name)]
        if not teilen:
            grund = 'anderes Skelett — kein Knochenname passt zu dieser Figur'
        else:
            for n in teilen:
                arm.pose.bones[n].rotation_mode = 'QUATERNION'
            quelle.animation_data_create()

            for akt in neu_akt:
                if akt.name.startswith('Key|'):     # Shape-Key-Spur, keine Haltung
                    continue
                a0, a1 = int(round(akt.frame_range[0])), int(round(akt.frame_range[1]))
                # Ein einzelnes Bild ist keine Animation, sondern eine Haltung —
                # genau das liefert der Export eines blanken Modells.
                if a1 - a0 < 2:
                    continue

                name = sauberer_name(akt, pfad)
                if not name:
                    continue
                if name in vorhanden:
                    # Schon da. Das ist der Regelfall bei einer Datei, die aus
                    # dieser Figur gemacht wurde: Sie bringt deren Clips mit
                    # zurück. Überschreiben wäre falsch, durchnummerieren
                    # ergäbe Dubletten.
                    continue

                quelle.animation_data.action = akt
                slots = getattr(akt, 'slots', None)
                if slots:
                    try:
                        quelle.animation_data.action_slot = slots[0]
                    except Exception:
                        pass

                ziel_akt = bpy.data.actions.new(name)
                arm.animation_data.action = ziel_akt
                for i, f in enumerate(range(a0, a1 + 1)):
                    sc.frame_set(f)
                    for n in teilen:
                        arm.pose.bones[n].matrix_basis = quelle.pose.bones[n].matrix_basis.copy()
                        # Keine Hüftverschiebung: Eine stehende Figur soll stehen
                        # bleiben, der Bildausschnitt ist einmal auf sie eingepasst.
                        arm.pose.bones[n].location = (0.0, 0.0, 0.0)
                        arm.pose.bones[n].keyframe_insert('rotation_quaternion', frame=i)
                arm.animation_data.action = None
                spur = arm.animation_data.nla_tracks.new()
                spur.name = name
                slot_anhaengen(spur.strips.new(name, 0, ziel_akt), ziel_akt)
                vorhanden.add(name)
                raus.append({'clip': name, 'bilder': a1 - a0 + 1, 'knochen': len(teilen)})

    sc.frame_set(0)
    for o in neu_obj:
        try:
            bpy.data.objects.remove(o, do_unlink=True)
        except Exception:
            pass
    return raus, grund


# Alle Animationsdateien im Ordner, außer Quelle und Ziel selbst.
tabu = {os.path.abspath(QUELLE).lower(), os.path.abspath(ZIEL).lower()}
quellen = sorted(glob.glob(os.path.join(ORDNER, '*.fbx')) +
                 glob.glob(os.path.join(ORDNER, '*.glb')) +
                 glob.glob(os.path.join(ORDNER, '*.gltf')))
quellen = [p for p in quellen if os.path.abspath(p).lower() not in tabu]

uebernommen = []
uebersprungen = []
for pfad in quellen:
    print('durchsuche:', os.path.basename(pfad))
    r, grund = clips_aus_datei(pfad)
    uebernommen += r
    if r:
        print('   ->', ', '.join(x['clip'] for x in r))
    else:
        uebersprungen.append({'datei': os.path.basename(pfad),
                              'grund': grund or 'nichts Brauchbares'})
        print('   -> übersprungen:', grund or 'nichts Brauchbares')

# Alles in Ruhelage, damit die Ausgangshaltung nicht die letzte Pose des letzten
# Clips ist.
for pb in arm.pose.bones:
    if pb.rotation_mode == 'QUATERNION':
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
    pb.location = (0.0, 0.0, 0.0)

os.makedirs(os.path.dirname(os.path.abspath(ZIEL)), exist_ok=True)
im_bereich(bpy.ops.export_scene.gltf, filepath=ZIEL, export_format='GLB',
           export_animation_mode='NLA_TRACKS',
           export_morph=True, export_skins=True,
           export_animations=True, export_cameras=False, export_lights=False)

# Nachsehen, was wirklich in der Datei steht — der Rückgabewert von Blender sagt
# darüber nichts.
import struct
with open(ZIEL, 'rb') as f:
    roh = f.read()
jl = struct.unpack_from('<I', roh, 12)[0]
gj = json.loads(roh[20:20 + jl])
print('<<<ERGEBNIS>>>')
print(json.dumps({
    'ok': True,
    'datei': ZIEL,
    'mb': round(len(roh) / 1e6, 1),
    'animationen': [a.get('name') for a in gj.get('animations', [])],
    'shapekeys': [n for m in gj.get('meshes', [])
                  for n in ((m.get('extras') or {}).get('targetNames') or [])],
    'aus_dateien': uebernommen,
    'uebersprungen': uebersprungen,
}, indent=1))
print('<<<ENDE>>>')
