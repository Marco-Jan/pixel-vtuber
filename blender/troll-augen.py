# Erzeugt die Blinzel- und Zwinker-Texturen für den Troll.
#
# Aufruf:
#   blender --background --python blender/troll-augen.py
#   blender --background --python blender/troll-augen.py -- diagnose
#
# Liest  blender/troll-quelle.glb   (die eingebettete Haupttextur, 2048²)
# Gibt   sprites/troll-blinzel.png    — beide Augen zu
#        sprites/troll-zwinkern.png   — ein Auge zu
#
# Warum über die Textur und nicht über einen Shape Key: Diese Figur hat keine
# Lider zum Bewegen. Sie kommt aus Meshy, die Augen sind aufgemalt, und ein
# Shape Key würde nur die Iris verbeulen. Die App tauscht solche Texturen von
# selbst, sobald `troll-blinzel.png` neben `troll.glb` liegt — siehe
# AUGEN_TEXTUREN in renderer/three-view.js.
#
# Warum die Augen im *Raum* gesucht werden und nicht im Bild:
#
# Der naheliegende Weg wäre, im Atlas ein Rechteck über die Augen zu malen. Das
# geht hier nicht. Meshy zerschneidet das Netz in viele kleine UV-Inseln; die
# Ecken rund um ein Auge liegen über den halben Atlas verstreut (gemessen: u von
# 318 bis 2038). Im Atlas *sieht* man zwar Gesichter, aber es sind mehrere, und
# welches davon der sichtbare Kopf benutzt, sieht man ihnen nicht an. Eine
# frühere, von Hand gemalte Fassung lag deshalb größtenteils daneben: Sie
# unterschied sich vom Original an 1011 Pixeln, und am Bildschirm bewegten sich
# ganze 10 Pixel um 4 % Helligkeit — technisch kam der Tausch an, sichtbar war
# er nie.
#
# Hier wird stattdessen gefragt, welche *Flächen des Netzes* im Augenbereich
# liegen, und deren UV-Dreiecke werden in die Textur gerastert. Damit ist es
# egal, wie zerstückelt die Inseln sind.
import bpy, os, sys, struct, json
import numpy as np
from mathutils import Vector

HIER    = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() \
          else r"E:\myprojects\twitch\scripte\3dvtube\blender"
WURZEL  = os.path.dirname(HIER)
QUELLE  = os.path.join(HIER, "troll-quelle.glb")
SPRITES = os.path.join(WURZEL, "sprites")
DIAGNOSE = "diagnose" in sys.argv

# Gemessen an dieser Figur (Blender-Koordinaten, Z ist oben, die Figur schaut
# nach -Y). Gefunden, indem die Zone zuerst knallrot gefärbt und die Figur
# gerendert wurde — bei verstreuten UV-Inseln ist das der kürzeste Weg.
AUGE_Z    = (1.508, 1.540)      # Höhe der Lidspalte
AUGE_X    = (0.012, 0.052)      # Abstand von der Nasenmitte, je Seite
AUGE_Y    = -0.055              # nur die Vorderseite des Kopfes
WANGE_Z   = (1.488, 1.503)      # sauberes Hautstück darunter, für die Farbe
# Das dunkle Band im geschlossenen Auge. Bewusst breit und kräftig: Die Figur
# wird im Betrieb klein dargestellt, und die Grafikkarte mittelt bei kleiner
# Darstellung über benachbarte Texel. Eine feine Linie verschwindet dabei —
# gemessen blieben von einem 6 Texel schmalen Strich am Bildschirm 7 % Kontrast
# übrig, also nichts. Ein geschlossenes Auge muss hier lesbar sein, nicht
# anatomisch genau.
LIDLINIE  = (1.5165, 1.5275)
BREITER   = 4                   # so oft wird die Maske um einen Texel verbreitert

def haupttextur():
    """Die eingebettete Textur aus dem glb holen."""
    with open(QUELLE, 'rb') as f:
        roh = f.read()
    off, gj, bin_ = 12, None, None
    while off < len(roh):
        laenge, art = struct.unpack_from('<II', roh, off)
        if art == 0x4E4F534A:
            gj = json.loads(roh[off + 8:off + 8 + laenge])
        elif art == 0x004E4942:
            bin_ = roh[off + 8:off + 8 + laenge]
        off += 8 + laenge
    bv = gj["bufferViews"][gj["images"][0]["bufferView"]]
    start = bv.get("byteOffset", 0)
    ziel = os.path.join(bpy.app.tempdir, "troll-haupt.png")
    with open(ziel, 'wb') as f:
        f.write(bin_[start:start + bv["byteLength"]])
    return ziel

# --- Szene ---------------------------------------------------------------
if "char1" not in bpy.data.objects:
    bpy.ops.wm.read_homefile(use_empty=True)
    for name in ("Icosphere", "Cube", "Camera", "Light"):
        ob = bpy.data.objects.get(name)
        if ob:
            bpy.data.objects.remove(ob, do_unlink=True)
    bpy.ops.import_scene.gltf(filepath=QUELLE)

ob = bpy.data.objects["char1"]
me = ob.data
mw = ob.matrix_world
uvs = me.uv_layers.active.data

im = bpy.data.images.load(haupttextur())
W, H = im.size
basis = np.array(im.pixels[:]).reshape(H, W, 4)
print("Haupttextur:", W, "x", H)

def maske_fuer(test):
    """Texel einsammeln, deren Fläche im Raum den Test besteht.

    Gerastert wird über baryzentrische Koordinaten, mit einem Hauch Toleranz
    (-0.02): Ohne die bleiben zwischen benachbarten Dreiecken einzelne Texel
    frei, und die stehen später als helle Pünktchen im geschlossenen Auge."""
    m = np.zeros((H, W), dtype=bool)
    flaechen = 0
    for poly in me.polygons:
        ecken = [(mw @ me.vertices[me.loops[li].vertex_index].co)
                 for li in poly.loop_indices]
        mitte = sum(ecken, Vector()) / len(ecken)
        if not test(mitte):
            continue
        flaechen += 1
        pts = np.array([[uvs[li].uv[0] * W, uvs[li].uv[1] * H]
                        for li in poly.loop_indices])
        x0, y0 = np.floor(pts.min(axis=0)).astype(int) - 1
        x1, y1 = np.ceil(pts.max(axis=0)).astype(int) + 1
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(W - 1, x1), min(H - 1, y1)
        if x1 <= x0 or y1 <= y0:
            continue
        # Die Ecken selbst immer belegen. Rund um die Iris sitzen die Dreiecke so
        # dicht, dass ihre UV-Abbildung kleiner als ein Texel wird — dann liegt
        # kein einziger Pixelmittelpunkt darin, der Test unten trifft nichts, und
        # die Iris bleibt als Ring stehen, obwohl ringsum alles bemalt ist.
        for p in pts:
            m[min(H - 1, max(0, int(p[1]))), min(W - 1, max(0, int(p[0])))] = True

        yy, xx = np.mgrid[y0:y1 + 1, x0:x1 + 1]
        for i in range(1, len(pts) - 1):          # Dreiecksfächer
            a, b, c = pts[0], pts[i], pts[i + 1]
            d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(d) < 1e-9:
                continue
            l1 = ((b[1] - c[1]) * (xx - c[0]) + (c[0] - b[0]) * (yy - c[1])) / d
            l2 = ((c[1] - a[1]) * (xx - c[0]) + (a[0] - c[0]) * (yy - c[1])) / d
            l3 = 1 - l1 - l2
            m[y0:y1 + 1, x0:x1 + 1] |= (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02)

    # Mehrfach verbreitern. Schließt die Nadelstiche zwischen benachbarten
    # Inseln und deckt deren Ränder mit ab. Mit nur einem Texel blieb die Iris
    # als dunkler Ring stehen: Rundherum war alles bemalt, die dichten Dreiecke
    # auf dem Augapfel selbst fielen aber durch. Ein paar Texel zu viel Haut
    # fallen nicht auf — eine durchscheinende Iris im geschlossenen Auge schon.
    for _ in range(BREITER):
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            m |= np.roll(np.roll(m, dy, axis=0), dx, axis=1)
    return m, flaechen

def auge(p, seite):
    if p.y > AUGE_Y or not (AUGE_Z[0] <= p.z <= AUGE_Z[1]):
        return False
    x = p.x * seite
    return AUGE_X[0] <= x <= AUGE_X[1]

def lid(p, seite):
    return auge(p, seite) and LIDLINIE[0] <= p.z <= LIDLINIE[1]

wange = lambda p: (p.y <= AUGE_Y and WANGE_Z[0] <= p.z <= WANGE_Z[1]
                   and abs(p.x) <= AUGE_X[1])

m_wange, n_w = maske_fuer(wange)
if m_wange.sum() < 20:
    raise SystemExit("Kein Hautstueck unter den Augen gefunden — WANGE_Z pruefen.")
hautfarbe = np.median(basis[m_wange][:, :3], axis=0)
print("Hautfarbe aus %d Texeln (%d Flaechen): %s"
      % (int(m_wange.sum()), n_w, np.round(hautfarbe, 3)))

def zumalen(px, seiten):
    for seite in seiten:
        m, n = maske_fuer(lambda p, s=seite: auge(p, s))
        if DIAGNOSE:
            px[m, 0], px[m, 1], px[m, 2] = 1.0, 0.0, 0.0
        else:
            # Etwas Originalstruktur stehen lassen, sonst steht ein glatter
            # Fleck im Gesicht, wo alles andere Poren und Falten hat.
            alt = px[m][:, :3]
            grau = alt.mean(axis=1, keepdims=True)
            px[m, :3] = hautfarbe * (0.82 + 0.18 * grau / max(1e-6, float(grau.mean())))
            ml, _ = maske_fuer(lambda p, s=seite: lid(p, s))
            px[ml, :3] *= 0.28
        print("  Seite %+d: %d Flaechen, %d Texel" % (seite, n, int(m.sum())))

def schreibe(name, px):
    neu = bpy.data.images.new(name, W, H, alpha=True)
    neu.pixels = px.reshape(-1).tolist()
    neu.filepath_raw = os.path.join(SPRITES, name)
    neu.file_format = 'PNG'
    neu.save()
    d = np.abs(px[:, :, :3] - basis[:, :, :3]).max(axis=2)
    print("%s: %d Texel geaendert, groesster Unterschied %.2f"
          % (name, int((d > 0.02).sum()), float(d.max())))

print("beide Augen:")
blinzel = basis.copy()
zumalen(blinzel, (1, -1))
schreibe("troll-blinzel.png", blinzel)

print("ein Auge:")
zwinkern = basis.copy()
zumalen(zwinkern, (-1,))
schreibe("troll-zwinkern.png", zwinkern)
