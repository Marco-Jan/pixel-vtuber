# Baut den Shape Key `mundOffen` für den Troll neu.
#
# Aufruf (Blender muss nicht offen sein):
#   blender --background --python blender/troll-mund.py
#   blender --background --python blender/troll-mund.py -- --bilder C:\irgendwo
#
# Wird ausserdem von troll-posen.py benutzt: Dort läuft `baue()` direkt nach dem
# Import, bevor die Clips entstehen. Der Key wird also bei jedem Bau frisch
# gerechnet.
#
# ---------------------------------------------------------------------------
#
# Warum überhaupt neu: Der Key in `troll-quelle.glb` verschob die halbe untere
# Gesichtshälfte geradlinig nach unten und hinten — 1832 Punkte von z 139,7 bis
# 151,4, also weit über die Lippenlinie hinaus. Im Bild sackte damit auch die
# Oberlippe ab, und quer über das Gesicht lag ein waagrechtes Brett. Der Mund
# ging nicht auf, das Gesicht rutschte auseinander.
#
# Ein Mund öffnet sich anders: Die Lippen lösen sich voneinander, die Unterlippe
# fällt weiter als die Oberlippe sich hebt, und in der Mitte geht er weiter auf
# als an den Mundwinkeln. Das Kinn bleibt dabei fast stehen — es fährt nur mit,
# wenn jemand gähnt, und gesprochen wird nicht mit dem Kiefer allein.
#
# Warum gerechnet statt in der Datei: Die Mundarbeit steckte bisher nur im
# fertigen glb, eine .blend dazu gibt es nicht — ändern hiess, die Binärdatei
# neu zu erzeugen und ihre Textur ein weiteres Mal durch die Kompression zu
# schicken. Jetzt sind es sieben Zahlen, an denen man dreht und den Bau erneut
# laufen lässt. `troll-quelle.glb` bleibt unangetastet.
#
# Warum die alte Maske übernommen wird: Welche Punkte zum Mund gehören, hat
# jemand einmal von Hand ausgesucht. Das ist Wissen, das im alten Key steckt und
# das man nicht zweimal raten muss. Neu ist nur, *wie* diese Punkte bewegt
# werden.
import bpy, os, sys, math
from mathutils import Vector

# --- Die sieben Zahlen -------------------------------------------------------
#
# Alle in den Koordinaten des Meshes `char1`, das von 0 bis 164 reicht. Die
# Lippenlinie liegt bei 147,2 — gemessen an der von Hand eingesetzten Mundhöhle,
# nicht geschätzt.
LIPPE  = 147.2   # die Trennlinie zwischen Ober- und Unterlippe
UNTEN  = 3.0     # so weit unter der Linie reicht die Bewegung
OBEN   = 1.8     # ... und so weit darüber
AUF_U  = 1.0     # so weit fällt die Unterlippe bei ganz offen
AUF_O  = 0.35    # so weit hebt sich die Oberlippe
HALB   = 9.5     # halbe Mundbreite; darüber hinaus bewegt sich nichts
VORN   = -2.0    # nur die Vorderseite des Kopfes, y kleiner als das

MESH = "char1"
KEY  = "mundOffen"


def sanft(t):
    """0 bis 1 mit weichen Enden. Ohne das hätte die Bewegung einen Knick an der
    Stelle, wo sie einsetzt — und den sieht man als Kante im Gesicht."""
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def baue(obj=None, still=False):
    """Rechnet `mundOffen` neu. Gibt die Zahl der bewegten Punkte zurück.

    `obj` ist das Mesh mit dem Key; ohne Angabe wird `char1` gesucht. Fehlt der
    Key, passiert nichts — dann ist die Quelldatei eine andere als erwartet, und
    ein stillschweigend halb gebauter Mund wäre schlimmer als keiner."""
    o = obj or bpy.data.objects.get(MESH)
    if not o or o.type != 'MESH' or not o.data.shape_keys:
        if not still:
            print("[mund] kein Mesh %r mit Shape Keys — übersprungen" % MESH)
        return 0

    sk = o.data.shape_keys
    if KEY not in sk.key_blocks:
        if not still:
            print("[mund] Shape Key %r fehlt — übersprungen" % KEY)
        return 0

    me    = o.data
    basis = sk.key_blocks[0]
    key   = sk.key_blocks[KEY]

    # Die Mundregion aus dem vorhandenen Key übernehmen: Was sich dort bewegt,
    # gehört zum Mund. Wer sie ausgesucht hat, hat das Gesicht dabei angesehen.
    maske = [i for i in range(len(me.vertices))
             if (key.data[i].co - basis.data[i].co).length > 1e-5]
    if not maske:
        if not still:
            print("[mund] der vorhandene Key bewegt nichts — übersprungen")
        return 0

    n = 0
    for i in maske:
        p  = basis.data[i].co.copy()
        dz = p.z - LIPPE

        # Linsenform: in der Mitte am weitesten, zu den Mundwinkeln auslaufend.
        # Eine über die Breite gleiche Gewichtung ergab einen rechteckigen
        # Schlitz — der sah aus wie ein Briefkasten, nicht wie ein Mund.
        t = min(1.0, abs(p.x) / HALB)
        w_seite = sanft(1.0 - t * t)
        # Nur vorn. Ohne das wandern Wangen und Hals mit.
        w_vorn = sanft((VORN - p.y) / 3.0)

        if dz <= 0.0:
            w   = sanft((UNTEN + dz) / UNTEN) * w_seite * w_vorn
            weg = Vector((0.0, 0.0, -AUF_U * w))
        else:
            w   = sanft((OBEN - dz) / OBEN) * w_seite * w_vorn
            weg = Vector((0.0, 0.0, AUF_O * w))

        # Auch die unbewegten ausdrücklich setzen: Der alte Key hat sie
        # verschoben, und was hier nicht zurückgesetzt wird, bleibt verschoben.
        key.data[i].co = p + weg
        if weg.length > 1e-5:
            n += 1

    key.value = 0.0
    if not still:
        laengen = sorted((key.data[i].co - basis.data[i].co).length for i in maske)
        laengen = [d for d in laengen if d > 1e-5]
        print("[mund] %d von %d Maskenpunkten bewegt, max %.2f, median %.2f"
              % (n, len(maske), laengen[-1], laengen[len(laengen) // 2]))
    return n


# --- eigenständig ------------------------------------------------------------
#
# Lädt die Quelle, rechnet den Key und zeigt auf Wunsch drei Bilder: zu, halb,
# auf. Genau die drei Stufen, die die App benutzt — mehr gibt es nicht zu sehen.
if __name__ == "__main__":
    HIER   = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() \
             else r"E:\myprojects\twitch\scripte\3dvtube\blender"
    QUELLE = os.path.join(HIER, "troll-quelle.glb")

    bilder = None
    if "--bilder" in sys.argv:
        bilder = sys.argv[sys.argv.index("--bilder") + 1]

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=QUELLE)
    for name in ("Icosphere", "Cube"):
        if name in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)

    baue()

    if bilder:
        os.makedirs(bilder, exist_ok=True)
        char = bpy.data.objects[MESH]
        key  = char.data.shape_keys.key_blocks[KEY]

        sc = bpy.context.scene
        sc.render.engine = 'BLENDER_WORKBENCH'
        sc.render.resolution_x, sc.render.resolution_y = 620, 470
        sc.display.shading.light = 'STUDIO'
        sc.display.shading.color_type = 'TEXTURE'
        sc.world = bpy.data.worlds.new("W")
        sc.world.color = (0.05, 0.05, 0.06)

        # Kamera aus der Mundregion selbst, nicht aus festen Zahlen: Wer an
        # LIPPE dreht, soll den Mund weiter im Bild haben.
        M    = char.matrix_world
        mund = [M @ v.co for v in char.data.vertices
                if LIPPE - UNTEN - 1 < v.co.z < LIPPE + OBEN + 1 and abs(v.co.x) < HALB]
        mx = sum(p.x for p in mund) / len(mund)
        mz = sum(p.z for p in mund) / len(mund)
        breite = max(p.x for p in mund) - min(p.x for p in mund)

        cd = bpy.data.cameras.new("C")
        cd.lens, cd.clip_start, cd.clip_end = 50, 0.001, 100
        cam = bpy.data.objects.new("C", cd)
        sc.collection.objects.link(cam)
        sc.camera = cam
        cam.location = Vector((mx, min(p.y for p in mund) - breite * 2.0, mz))
        cam.rotation_euler = (math.radians(90), 0, 0)

        for wert, name in ((0.0, "mund-zu"), (0.5, "mund-halb"), (1.0, "mund-auf")):
            key.value = wert
            sc.render.filepath = os.path.join(bilder, name)
            bpy.ops.render.render(write_still=True)
        key.value = 0.0
        print("[mund] Bilder in", bilder)
