# Erzeugt die Posen-Clips für den Troll.
#
# Aufruf (Blender muss nicht offen sein):
#   blender --background --python blender/troll-posen.py
# Oder im laufenden Blender:
#   exec(open(r"E:\myprojects\twitch\scripte\3dvtube\blender\troll-posen.py").read())
#
# Liest  blender/troll-quelle.glb   (Meshy-Figur, in Blender um Mundhöhle und
#                                    den Shape Key `mundOffen` ergänzt)
# Baut   ruhe · idle · arms         als NLA-Spuren
#        dazu jeden Clip aus den .fbx- und .glb-Dateien in sprites/
# Gibt   sprites/troll.glb          aus
#
# Warum eine eigene Quelldatei: Die Mundarbeit steckt nur im fertigen glb, eine
# .blend dazu gibt es nicht. Würde dieses Skript sprites/troll.glb lesen *und*
# schreiben, liefe die Textur bei jedem Lauf durch eine weitere Kompression.
# Die Quelle bleibt deshalb unangetastet.
#
# Warum die Drehachsen gerechnet und nicht eingetragen werden: Ein früheres
# Skript für eine VRoid-Figur hatte sie gemessen und als feste Buchstaben
# stehen — bei jenem Rig senkt `z` den Arm. Dieses Rig ist ein anderes, und an
# einem dritten wäre es wieder anders. Statt jedes Mal neu zu messen, wird die
# Achse hier gerechnet: Der Arm zeigt irgendwohin, „senken" heißt, dass die Hand
# nach unten wandert, und die Drehachse dafür ist das Kreuzprodukt aus
# Armrichtung und Weltunten. Links und rechts stimmt das Vorzeichen dadurch von
# selbst.
import bpy, json, math, os, glob, re
from mathutils import Vector, Quaternion

HIER   = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() \
         else r"E:\myprojects\twitch\scripte\3dvtube\blender"
WURZEL = os.path.dirname(HIER)
QUELLE  = os.path.join(HIER, "troll-quelle.glb")
SPRITES = os.path.join(WURZEL, "sprites")
AUS     = os.path.join(SPRITES, "troll.glb")
# 30 statt 24, seit Mixamo-Clips mitgebacken werden: Die kommen mit 30 Bildern je
# Sekunde, und würden sie hier auf 24 umgerechnet, liefen sie ein Viertel zu
# langsam. Die selbst gebauten Clips zählen ihre Länge aus FPS und bleiben
# dadurch gleich lang.
FPS     = 30

# --- Szene leeren und Figur laden --------------------------------------------
def viewport():
    """Ein 3D-Bereich als Zusammenhang für Import und Export.

    Im Hintergrund (blender --background) gibt es keinen, und dort laufen die
    Operatoren auch ohne. In der offenen Oberfläche dagegen sucht der
    glTF-Importeur `context.object` und bricht ohne diesen Bereich ab — mit
    einem Fehler, der nichts über die Ursache verrät."""
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

im_bereich(bpy.ops.wm.read_homefile, use_empty=True)
# Die Startdatei bringt eine Icosphere mit. In einer
# leeren Datei sollte sie nicht auftauchen, tut es aber — also wegräumen, sonst
# fährt eine Kugel im Export mit und die Kamera der App rahmt sie statt der Figur.
for name in ("Icosphere", "Cube", "Camera", "Light"):
    ob = bpy.data.objects.get(name)
    if ob:
        bpy.data.objects.remove(ob, do_unlink=True)

im_bereich(bpy.ops.import_scene.gltf, filepath=QUELLE)

arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
sc = bpy.context.scene
sc.render.fps = FPS

# Nach dem Import noch einmal: Der Importeur kann eine eigene Kamera anlegen.
for ob in list(bpy.data.objects):
    if ob.type in ('CAMERA', 'LIGHT'):
        bpy.data.objects.remove(ob, do_unlink=True)
if "Icosphere" in bpy.data.objects:
    bpy.data.objects.remove(bpy.data.objects["Icosphere"], do_unlink=True)

# --- Drehachsen ausrechnen ----------------------------------------------------
OBEN  = Vector((0, 0, 1))
UNTEN = Vector((0, 0, -1))
# Die Figur schaut nach -Y (gemessen am Hilfsknochen `headfront`).
VORN  = Vector((0, -1, 0))

def nach_lokal(name, welt):
    """Eine Weltachse in den Ruheraum des Knochens umrechnen.

    Dort wirkt `rotation_quaternion`, und weil dieser Raum mit dem Elternknochen
    mitwandert, bleibt die Achse auch dann richtig, wenn die Schulter schon
    gedreht ist — genau das braucht der Ellbogen."""
    b = arm.data.bones[name]
    m = (arm.matrix_world @ b.matrix_local).to_3x3().inverted()
    v = m @ Vector(welt)
    return v.normalized()

def armachsen(name):
    """Die drei Achsen eines Armknochens, aus seiner Lage gerechnet.

    ab senkt, av schwingt nach vorn, ax dreht den Arm um sich selbst. Die dritte
    braucht es für verschränkte Arme: Ein gebeugter Ellbogen allein schickt den
    Unterarm nach vorn. Quer über die Brust kommt er erst, wenn der Oberarm
    zusätzlich nach innen gedreht ist."""
    b = arm.data.bones[name]
    kopf    = arm.matrix_world @ b.head_local
    schwanz = arm.matrix_world @ b.tail_local
    d = (schwanz - kopf).normalized()
    ab = d.cross(UNTEN)                      # dreht die Hand nach unten
    if ab.length < 1e-6:                     # Arm hängt schon senkrecht
        ab = d.cross(VORN)
    ab.normalize()
    av = ab.cross(d).normalized()            # dreht den Arm nach vorn
    return nach_lokal(name, ab), nach_lokal(name, av), nach_lokal(name, d)

ARME = ["LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand"]
RUMPF = ["Hips", "Spine", "Spine01", "Spine02", "neck", "Head"]

ACHSE = {}
for n in ARME:
    if n in arm.data.bones:
        ab, av, ax = armachsen(n)
        # ax bekommt je Seite dasselbe Vorzeichen für „nach innen": Die
        # Armrichtung ist links und rechts gegenläufig, eine Drehung um sie
        # damit auch. Ohne die Spiegelung müsste man jede Pose zweimal
        # aufschreiben, einmal je Seite.
        if n.startswith("Right"):
            ax = -ax
        ACHSE[n] = {"ab": ab, "av": av, "ax": ax}
for n in RUMPF:
    if n in arm.data.bones:
        ACHSE[n] = {
            "nick":  nach_lokal(n, (1, 0, 0)),    # Kinn runter
            "neig":  nach_lokal(n, (0, 1, 0)),    # Kopf zur Schulter
            "dreh":  nach_lokal(n, (0, 0, 1)),    # nach links/rechts schauen
        }

BEWEGT = [n for n in ARME + RUMPF if n in arm.pose.bones]
for n in BEWEGT:
    arm.pose.bones[n].rotation_mode = 'QUATERNION'

def setz(name, **kw):
    """Knochen um die gemessenen Achsen drehen, immer von der Ruhelage aus.

    Winkel in Grad. Für Arme: ab = senken (+) / heben (−), av = vor (+).
    Für Rumpf und Kopf: nick, neig, dreh."""
    pb = arm.pose.bones.get(name)
    if not pb or name not in ACHSE:
        return
    q = Quaternion()
    for schluessel, grad in kw.items():
        achse = ACHSE[name].get(schluessel)
        if achse is None or not grad:
            continue
        q = q @ Quaternion(achse, math.radians(grad))
    pb.rotation_quaternion = q

def ziele(name, richtung):
    """Knochen so drehen, dass er in die angegebene Weltrichtung zeigt.

    Der ehrlichere Weg für eine bestimmte Haltung. `setz` stapelt Drehungen, und
    jede spätere wirkt im Raum der früheren — bei drei Achsen hintereinander
    lässt sich nicht mehr vorhersagen, wo die Hand landet, man probiert. Hier
    sagt man stattdessen, wohin der Knochen zeigen soll, und die Drehung dorthin
    wird ausgerechnet.

    Muss von der Schulter zur Hand aufgerufen werden: Jeder Knochen richtet sich
    an seiner *aktuellen* Weltlage aus, und die hängt am Elternknochen."""
    pb = arm.pose.bones.get(name)
    if not pb:
        return
    bpy.context.view_layer.update()
    mw = arm.matrix_world
    ist = (mw.to_3x3() @ (pb.tail - pb.head)).normalized()
    soll = Vector(richtung).normalized()
    dq_welt = ist.rotation_difference(soll)
    # Die Weltdrehung in den Raum der Armatur bringen, denn `pb.matrix` liegt dort.
    qa = mw.to_quaternion()
    dq = qa.inverted() @ dq_welt @ qa

    m = pb.matrix.copy()
    kopf = m.translation.copy()
    m.translation = (0.0, 0.0, 0.0)
    m = dq.to_matrix().to_4x4() @ m
    m.translation = kopf
    pb.matrix = m
    bpy.context.view_layer.update()

def greife(ober, unter, ende, ziel, pol):
    """Zwei-Knochen-IK: Ober- und Unterarm so drehen, dass `ende` am Zielpunkt
    liegt. `pol` sagt, wohin der Ellbogen ausweicht.

    Der letzte Schritt weg vom Raten. Selbst mit `ziele` gibt man Richtungen an
    und rechnet im Kopf nach, wo die Hand dann landet — und landet daneben: Beim
    Verschränken steckte sie im Bauch, weil der Rumpf dieser Figur bei z=1,1
    ganze 0,37 tief ist und die Schulter bei y=+0,03 sitzt. Hier steht stattdessen
    der Zielpunkt, und der lässt sich gegen die gemessene Körperoberfläche prüfen.

    Gerechnet über den Kosinussatz: Schulter, Ellbogen und Hand bilden ein
    Dreieck mit zwei bekannten Seiten (den Gliedlängen) und der Entfernung zum
    Ziel als dritter.

    Die Längen kommen aus den Abständen der Gelenke, **nicht** aus `bone.length`.
    Gemessen an dieser Figur: `LeftArm` meldet Länge 15,87, der Arm ist aber
    0,159 lang — Faktor 100 daneben. glTF kennt keine Knochenlänge, der
    Importeur denkt sich eine aus. Für `ziele` ist das egal, dort zählt nur die
    Richtung; eine IK mit diesen Werten löst dagegen für einen Arm, der
    hundertmal zu lang ist, und klappt vollständig zusammen."""
    pb1 = arm.pose.bones.get(ober)
    pb2 = arm.pose.bones.get(unter)
    pb3 = arm.pose.bones.get(ende)
    if not pb1 or not pb2 or not pb3:
        return
    bpy.context.view_layer.update()
    mw = arm.matrix_world
    S  = mw @ pb1.head
    l1 = ((mw @ pb2.head) - S).length
    l2 = ((mw @ pb3.head) - (mw @ pb2.head)).length

    nach = Vector(ziel) - S
    d = nach.length
    if d < 1e-6:
        return
    # Ein Ziel außerhalb der Reichweite gibt es nicht — dann eben so weit wie
    # möglich, statt mit einem unlösbaren Dreieck abzubrechen.
    d = max(abs(l1 - l2) + 1e-4, min(d, l1 + l2 - 1e-4))
    richtung = nach.normalized()

    cos_a = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)
    a = math.acos(max(-1.0, min(1.0, cos_a)))

    n = richtung.cross(Vector(pol))
    if n.length < 1e-6:                      # Pol liegt auf der Geraden zum Ziel
        n = richtung.cross(Vector((0, 0, 1)))
    n.normalize()
    E = S + (Quaternion(n, a) @ richtung) * l1

    ziele(ober, E - S)
    ziele(unter, Vector(ziel) - E)

def ruhe():
    for n in BEWEGT:
        arm.pose.bones[n].rotation_quaternion = Quaternion()
    bpy.context.view_layer.update()

def key(f, knochen=None):
    for n in (knochen or BEWEGT):
        arm.pose.bones[n].keyframe_insert('rotation_quaternion', frame=f)

# --- Clips bauen --------------------------------------------------------------
arm.animation_data_clear()
arm.animation_data_create()

def slot_anhaengen(streifen, akt):
    """Blender 5 hängt die Kurven an einen Slot unter der Action. Ein NLA-Streifen
    ohne zugewiesenen Slot spielt dann nichts ab. In 4.x gibt es das nicht."""
    slots = getattr(akt, "slots", None)
    if not slots:
        return
    if hasattr(streifen, "action_slot"):
        try:
            streifen.action_slot = slots[0]
        except Exception:
            pass

def clip(name, dauer, bild, knochen=None):
    """`knochen` grenzt ein, was der Clip beansprucht.

    Was nicht mitkeyframt wird, bleibt in der App unter der Kontrolle der Regler.
    Ohne diese Einschränkung schreibt jeder Clip alle Knochen fest — auch die,
    die er gar nicht bewegt — und der Regler „Arme senken" wirkt dann nur noch
    bei Figuren ganz ohne Animation."""
    akt = bpy.data.actions.new(name)
    arm.animation_data.action = akt
    for f in range(dauer + 1):
        bild(f / dauer)
        key(f, knochen)
    arm.animation_data.action = None
    spur = arm.animation_data.nla_tracks.new()
    spur.name = name
    streifen = spur.strips.new(name, 0, akt)
    slot_anhaengen(streifen, akt)

S = lambda t: math.sin(t * math.pi * 2)

# ruhe — nur Atmen im Rumpf, Arme bleiben frei.
#
# Die Arme werden mit Absicht nicht mitkeyframt: Sie stehen in der App unter dem
# Regler „Arme senken", und ein Clip, der sie beansprucht, überstimmt diesen
# Regler (die App setzt die Armhaltung *vor* dem Animationsmischer). Wer eine
# Figur mit ruhig hängenden Armen will, nimmt diesen Clip.
def ruhig(t):
    ruhe()
    setz('Spine02', nick=1.1 * S(t))
    setz('Spine01', nick=0.8 * S(t))
    setz('neck',    nick=-0.9 * S(t))
    setz('Head',    nick=-0.7 * S(t), dreh=1.4 * S(t * 0.5))
clip('ruhe', int(3.0 * FPS), ruhig, knochen=RUMPF)

# idle — Arme verschränkt. Die Standardpose der App heißt so, und das ist die
# Haltung, in der eine Figur am wenigsten nach Schaufensterpuppe aussieht.
#
# Über `ziele` gebaut statt über Winkel: Bei drei gestapelten Drehungen je Arm
# lässt sich nicht mehr vorhersagen, wo die Hand landet. Hier steht stattdessen,
# wohin jeder Knochen zeigen soll.
def idle(t):
    ruhe()
    a = S(t)
    # Erst der Rumpf, dann die Arme: Die Arme hängen am Rumpf, und andersherum
    # zöge das Atmen die eben ausgerichteten Unterarme wieder weg.
    setz('Spine02', nick=1.0 * a)
    setz('Spine01', nick=0.7 * a)
    setz('neck',    nick=-0.8 * a)
    setz('Head',    nick=-0.6 * a, dreh=1.2 * S(t * 0.5))

    # Oberarme hängen fast senkrecht, leicht nach vorn. Unterarme liegen quer
    # übereinander vor dem Bauch — der linke etwas höher, sonst durchdringen sie
    # sich. Die Figur schaut nach -Y, ihre linke Seite liegt bei +X.
    # Echtes Verschränken geht an dieser Figur nicht, und das ist keine Frage
    # der Winkel, sondern der Maße: Schulter zur Körpermitte 0,192, Unterarm nur
    # 0,159 — ein waagrechter Unterarm kommt gar nicht bis zur Mitte. Und der
    # Rumpf ist bei z=1,1 ganze 0,37 tief, die Schulter sitzt bei y=+0,03; die
    # Hand muss also 0,2 nach vorn, nur um überhaupt vor den Bauch zu kommen.
    # (Bei einem Menschen geht es, weil dort der Unterarm länger ist als der
    # Oberarm. Hier sind beide gleich lang.)
    #
    # Was geht und natürlich aussieht: Hände ruhen vorn auf dem Bauch, eine
    # etwas höher als die andere. Die Zielpunkte sind gegen die gemessene
    # Bauchfront gesetzt — bei z≈1,19 liegt sie bei y≈-0,165, bei z≈1,15 bei
    # y≈-0,178. Ein Stück davor, damit nichts eintaucht.
    e = 0.006 * a                       # Atmen: die Hände gehen minimal mit
    greife('LeftArm',  'LeftForeArm',  'LeftHand',
           (0.085, -0.20, 1.20 + e), (1.0, 0.55, -0.45))
    greife('RightArm', 'RightForeArm', 'RightHand',
           (-0.085, -0.235, 1.15 + e), (-1.0, 0.55, -0.45))
    # Hände in Verlängerung des Unterarms, leicht zur Mitte eingedreht.
    ziele('LeftHand',  (-0.80, -0.35, -0.49))
    ziele('RightHand', (0.80, -0.35, -0.49))
clip('idle', int(3.0 * FPS), idle)

# arms — gestikulierend. Hier gehören die Arme dem Clip.
def arms(t):
    ruhe()
    a, b = S(t), S(t * 1.37 + 0.4)
    # Der Ellbogen beugt über `av` (nach vorn), nicht über `ab` (nach oben) —
    # sonst stehen die Unterarme senkrecht und die Figur jubelt, statt zu reden.
    setz('LeftArm',      ab=14 + 4 * a,   av=16 + 5 * b)
    setz('LeftForeArm',  av=58 + 11 * b,  ab=-6)
    setz('LeftHand',     av=10 * b)
    setz('RightArm',     ab=14 + 4 * b,   av=16 + 5 * a)
    setz('RightForeArm', av=58 + 11 * a,  ab=-6)
    setz('RightHand',    av=10 * a)
    setz('Spine01', nick=1.0 * a, dreh=1.6 * a)
    setz('Head',    nick=-0.8 * a, dreh=-2.2 * a)
clip('arms', int(3.0 * FPS), arms)

# Ein von Hand gerechnetes Winken stand hier einmal (17.08.2026, wieder
# entfernt). Es lief, sah aber neben einer aufgenommenen Bewegung steif aus:
# Zwei überlagerte Sinuskurven ergeben ein Metronom, keinen Menschen. Seit klar
# ist, dass Mixamo-Clips ohne Retargeting auf dieses Rig passen, ist Winken kein
# Rechenproblem mehr, sondern ein Download. Der Clip heißt jetzt `waving` und
# kommt aus `sprites/AI-troll_Waving.fbx`.

# --- Clips aus FBX-Dateien übernehmen ----------------------------------------
#
# Legt jemand eine Mixamo-Datei in den Sprite-Ordner, wird sie hier mit
# eingebacken. Der Name des Clips kommt aus dem Dateinamen hinter dem letzten
# Unterstrich: `AI-troll_Waving.fbx` wird zu `waving`.
#
# Retargeting braucht es nicht, und das ist kein Glück, sondern eine Bedingung:
# Wer die *fertige* troll.glb bei Mixamo hochlädt, bekommt sein eigenes Skelett
# zurück — gleiche Knochennamen, gleiche Ruhepose (gemessen: 0,00001 Abweichung).
# Dann lassen sich die Posen Bild für Bild direkt übernehmen. Lädt jemand ein
# anderes Modell hoch, kommt ein Mixamo-Skelett zurück (`mixamorig:` vor jedem
# Namen), und dann greift hier nichts — die Namen passen zu nichts.
#
# Die Hüftverschiebung wird bewusst *nicht* übernommen. Eine stehende Figur soll
# stehen bleiben; ein Clip, der sie versetzt, verschöbe sie im Bild, und der
# Ausschnitt ist einmal auf die Figur eingepasst.
# Namen, die nichts über den Inhalt sagen. Steht so einer am Ende, wird der
# Dateiname genommen — `Armature|mixamo.com|Layer0` hilft keinem weiter.
NICHTSSAGEND = {"layer0", "baselayer", "mixamo_com", "clip0", "action", "armature"}
# Namen, die nicht aus einer Quelldatei kommen dürfen. Die ersten drei baut das
# Skript selbst; `wave` steht hier, obwohl es das nicht mehr tut — die alten
# FBX-Exporte tragen das entfernte Handwinken noch in sich, und ohne diesen
# Eintrag käme es bei jedem Lauf zurück.
EIGENE = {"ruhe", "idle", "arms", "wave"}

def saeubern(s):
    """Ein Name, mit dem sich später bequem arbeiten lässt.

    Kleinschreibung, und alles außer Buchstaben und Ziffern wird zum
    Unterstrich: `Orc Idle` ergibt `orc_idle` statt `orc idle`. Ein Leerzeichen
    im Clipnamen ist nichts, was bricht — man tippt es nur ständig falsch, und
    in der Einstellungsdatei liest es sich wie ein Fehler.

    Das `.001` am Ende schneidet Blenders Importzähler weg. Ohne das käme
    `arms.001` als neuer Clip durch, obwohl es genau der ist, den dieses Skript
    eben selbst gebaut hat — die Quelldateien stammen aus der fertigen glb und
    bringen deren Clips mit zurück."""
    s = re.sub(r"\.\d{3}$", "", str(s).strip().lower())
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")

def sauberer_name(aktion, pfad):
    teil = saeubern(aktion.name.split("|")[-1])
    if not teil or teil in NICHTSSAGEND:
        teil = saeubern(os.path.splitext(os.path.basename(pfad))[0].split("_")[-1])
    return teil

def clips_aus_datei(pfad, schon_da):
    """Alle brauchbaren Animationen einer Datei auf den Troll backen.

    Funktioniert für FBX (Mixamo) und glb (die Meshy-Rohexporte) gleichermaßen,
    weil beide dasselbe Skelett tragen: gleiche Knochennamen, gleiche Ruhepose.
    Deshalb genügt es, die Haltung Bild für Bild zu übernehmen — kein
    Retargeting. Trägt eine Datei ein *anderes* Skelett, bleibt die Schnittmenge
    der Knochennamen leer und sie wird still übersprungen."""
    vorher_obj = set(bpy.data.objects)
    vorher_akt = set(bpy.data.actions)
    lader = (bpy.ops.import_scene.fbx if pfad.lower().endswith(".fbx")
             else bpy.ops.import_scene.gltf)
    try:
        im_bereich(lader, filepath=pfad)
    except Exception as e:
        print("   nicht ladbar:", e)
        return []
    neu_obj = [o for o in bpy.data.objects if o not in vorher_obj]
    neu_akt = [a for a in bpy.data.actions if a not in vorher_akt]
    quelle = next((o for o in neu_obj if o.type == 'ARMATURE'), None)

    raus = []
    if quelle:
        teilen = [b.name for b in arm.data.bones if quelle.pose.bones.get(b.name)]
        for n in teilen:
            arm.pose.bones[n].rotation_mode = 'QUATERNION'
        quelle.animation_data_create()

        for akt in neu_akt:
            if akt.name.startswith("Key|"):     # Shape-Key-Spur, keine Haltung
                continue

            # Trägt die Aktion selbst einen unserer Namen, ist sie einer unserer
            # Clips, der aus der fertigen glb zurückkommt — die wird verworfen.
            # Das ist etwas anderes als ein *neuer* Clip, dessen Name zufällig
            # kollidiert, und deshalb zwei getrennte Prüfungen.
            if saeubern(akt.name.split("|")[-1]) in EIGENE:
                continue

            # Länge zuerst prüfen, dann benennen: Ein einzelnes Bild ist keine
            # Animation, sondern eine Haltung — genau das liefert der Export
            # eines blanken Modells. Andersherum vergibt der Umbenenner unten
            # Namen für Clips, die gleich darauf verworfen werden, und die
            # Meldungen darüber sind schlicht irreführend.
            a0, a1 = int(round(akt.frame_range[0])), int(round(akt.frame_range[1]))
            if a1 - a0 < 2 or not teilen:
                continue

            name = sauberer_name(akt, pfad)
            if not name:
                continue
            # Name schon belegt: `ork_idle.fbx` ergäbe `idle`, und das baut das
            # Skript selbst. Statt die Datei stillschweigend zu übergehen — man
            # legt sie ja hinein, weil man sie *will* — bekommt sie den ganzen
            # Dateinamen als Clipnamen. Nichts wird überschrieben, nichts fällt
            # aus, und im Panel stehen beide zur Wahl.
            if name in schon_da:
                stamm = re.sub(r"[^a-z0-9_-]+", "",
                               os.path.splitext(os.path.basename(pfad))[0].lower())
                stamm = stamm or name
                kandidat, n = stamm, 2
                while kandidat in schon_da:
                    kandidat = stamm + str(n)
                    n += 1
                print("   Name '%s' war belegt, Clip heisst '%s'" % (name, kandidat))
                name = kandidat

            quelle.animation_data.action = akt
            # Blender 5 hängt die Kurven an einen Slot; ohne Zuweisung bleibt die
            # Aktion stumm und man bäckt die Ruhepose ab.
            slots = getattr(akt, "slots", None)
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
                key(i, teilen)
            arm.animation_data.action = None
            spur = arm.animation_data.nla_tracks.new()
            spur.name = name
            slot_anhaengen(spur.strips.new(name, 0, ziel_akt), ziel_akt)
            schon_da.add(name)
            raus.append({"clip": name, "bilder": a1 - a0 + 1, "knochen": len(teilen)})

    sc.frame_set(0)
    for o in neu_obj:
        try:
            bpy.data.objects.remove(o, do_unlink=True)
        except Exception:
            pass
    return raus

# Quellen: alles im Sprite-Ordner außer der Datei, die hier entsteht.
uebernommen = []
schon_da = set(EIGENE)
quellen = [p for p in sorted(glob.glob(os.path.join(SPRITES, "*.fbx")) +
                             glob.glob(os.path.join(SPRITES, "*.glb")))
           if os.path.abspath(p) != os.path.abspath(AUS)]
for pfad in quellen:
    print("durchsuche:", os.path.basename(pfad))
    r = clips_aus_datei(pfad, schon_da)
    uebernommen += r
    print("   ->", ", ".join(x["clip"] for x in r) if r else "nichts Brauchbares")

ruhe()

# --- Ausgeben -----------------------------------------------------------------
im_bereich(bpy.ops.export_scene.gltf, filepath=AUS, export_format='GLB',
           export_animation_mode='NLA_TRACKS',
           export_morph=True, export_skins=True,
           export_animations=True, export_cameras=False,
           export_lights=False)

# --- Nachsehen, was wirklich in der Datei steht -------------------------------
import struct
with open(AUS, 'rb') as f:
    roh = f.read()
jl = struct.unpack_from('<I', roh, 12)[0]
gj = json.loads(roh[20:20 + jl])
print("<<<ERGEBNIS>>>")
print(json.dumps({
    "datei": AUS,
    "mb": round(len(roh) / 1e6, 1),
    "animationen": [a.get('name') for a in gj.get('animations', [])],
    "shapekeys": [n for m in gj.get('meshes', [])
                  for n in ((m.get('extras') or {}).get('targetNames') or [])],
    "meshes": [m.get('name') for m in gj.get('meshes', [])],
    "bewegte_knochen": len(BEWEGT),
    "aus_fbx": uebernommen,
}, indent=1))
print("<<<ENDE>>>")
