"""Vue 3D suivie de Continent : TGV provisoire sur la LGV Sud-Est (près de Montbard), au crépuscule.
Lancement : Blender -b -P scene3d.py -- <dossier blender> <largeur> <hauteur> <échantillons>
Unités : mètres. +Y = sens de marche (vers Paris), +X = droite, Z = haut."""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
DIR, W, H, SAMPLES = argv[0], int(argv[1]), int(argv[2]), int(argv[3])
GROUND = 1280 * 0.6570  # côté de l'image satellite en mètres (z16.3, lat 47.36)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ---------- matériaux ----------
def mat(name, color, rough=0.5, metal=0.0, emit=None, strength=0.0, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if coat and "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = coat
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = strength
    return m


M = {
    "body": mat("Caisse", (0.80, 0.82, 0.84), 0.28, 0.0, coat=0.6),
    "band": mat("Bandeau", (0.015, 0.06, 0.10), 0.25, coat=0.5),
    "accent": mat("Filet azur", (0.12, 0.55, 1.0), 0.3, emit=(0.12, 0.55, 1.0), strength=1.5),
    "glass": mat("Vitrage", (0.01, 0.015, 0.02), 0.05, 0.0, coat=1.0),
    "lit": mat("Fenêtre éclairée", (1.0, 0.75, 0.45), 0.4, emit=(1.0, 0.72, 0.42), strength=6.0),
    "skirt": mat("Jupe", (0.05, 0.06, 0.07), 0.6),
    "bogie": mat("Bogie", (0.02, 0.02, 0.025), 0.7, 0.3),
    "head": mat("Feux avant", (1, 1, 1), 0.2, emit=(1.0, 0.97, 0.9), strength=40.0),
    "tail": mat("Feux arrière", (1, 0.1, 0.05), 0.2, emit=(1.0, 0.05, 0.02), strength=20.0),
    "rail": mat("Rail", (0.55, 0.55, 0.57), 0.25, 1.0),
    "ballast": mat("Ballast", (0.11, 0.115, 0.12), 0.95),
    "sleeper": mat("Traverse", (0.22, 0.22, 0.23), 0.85),
    "pole": mat("Poteau", (0.30, 0.32, 0.34), 0.5, 0.6),
    "wire": mat("Caténaire", (0.25, 0.20, 0.15), 0.4, 1.0),
}


def mesh_obj(name, verts, faces, mats, mat_idx=None, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    for m in mats:
        me.materials.append(m)
    if mat_idx:
        for p, i in zip(me.polygons, mat_idx):
            p.material_index = i
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


class Builder:
    def __init__(self):
        self.v, self.f, self.mi = [], [], []

    def box(self, cx, cy, cz, sx, sy, sz, m=0, rot=0.0):
        c, s = math.cos(rot), math.sin(rot)
        base = len(self.v)
        for dz in (-sz / 2, sz / 2):
            for dx, dy in ((-sx / 2, -sy / 2), (sx / 2, -sy / 2), (sx / 2, sy / 2), (-sx / 2, sy / 2)):
                self.v.append((cx + dx * c - dy * s, cy + dx * s + dy * c, cz + dz))
        for q in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            self.f.append(tuple(base + i for i in q)); self.mi.append(m)

    def sweep(self, path, profile, m=0, closed=False):
        """Balaye un profil (x latéral, z) le long d'une polyligne 2D (x, y) au sol."""
        base = len(self.v)
        n = len(profile)
        for i, (x, y) in enumerate(path):
            a = path[max(i - 1, 0)]; b = path[min(i + 1, len(path) - 1)]
            dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1
            nx, ny = dy / L, -dx / L  # normale à droite
            for px, pz in profile:
                self.v.append((x + nx * px, y + ny * px, pz))
        segs = n if closed else n - 1
        for i in range(len(path) - 1):
            for j in range(segs):
                a = base + i * n + j; b = base + i * n + (j + 1) % n
                self.f.append((a, b, b + n, a + n)); self.mi.append(m)

    def build(self, name, mats, smooth=False):
        return mesh_obj(name, self.v, self.f, mats, self.mi, smooth)


def resample(pts, step):
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        d = math.dist(a, b); n = max(1, int(d / step))
        for i in range(1, n + 1):
            out.append((a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n))
    return out


def offset(pts, d):
    out = []
    for i, (x, y) in enumerate(pts):
        a = pts[max(i - 1, 0)]; b = pts[min(i + 1, len(pts) - 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1
        out.append((x + dy / L * d, y - dx / L * d))
    return out


# ---------- sol ----------
img = bpy.data.images.load(os.path.join(DIR, "ground_sat.jpg"))
gm = bpy.data.materials.new("Sol satellite"); gm.use_nodes = True
nt = gm.node_tree; bsdf = nt.nodes["Principled BSDF"]
tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img; tex.extension = "EXTEND"
hsv = nt.nodes.new("ShaderNodeHueSaturation"); hsv.inputs["Saturation"].default_value = 0.45; hsv.inputs["Value"].default_value = 0.85
mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.blend_type = "MULTIPLY"
mix.inputs["Factor"].default_value = 0.4; mix.inputs[7].default_value = (0.35, 0.55, 0.85, 1)
nt.links.new(tex.outputs["Color"], hsv.inputs["Color"])
nt.links.new(hsv.outputs["Color"], mix.inputs[6])
nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.95
FOG = (0.058, 0.048, 0.068)


def add_fog(m, near=120.0, far_d=520.0):
    """Brume de distance : mélange le shader avec une émission couleur de l'horizon."""
    t = m.node_tree; out = t.nodes["Material Output"]; sh = out.inputs["Surface"].links[0].from_socket
    cd = t.nodes.new("ShaderNodeCameraData")
    mr = t.nodes.new("ShaderNodeMapRange"); mr.inputs["From Min"].default_value = near; mr.inputs["From Max"].default_value = far_d
    mr.interpolation_type = "SMOOTHSTEP"
    em = t.nodes.new("ShaderNodeEmission"); em.inputs["Color"].default_value = (*FOG, 1); em.inputs["Strength"].default_value = 1.0
    ms = t.nodes.new("ShaderNodeMixShader")
    t.links.new(cd.outputs["View Distance"], mr.inputs["Value"]); t.links.new(mr.outputs["Result"], ms.inputs["Fac"])
    t.links.new(sh, ms.inputs[1]); t.links.new(em.outputs[0], ms.inputs[2]); t.links.new(ms.outputs[0], out.inputs["Surface"])


add_fog(gm)
for _k in ("ballast", "sleeper", "rail", "pole", "wire"):
    add_fog(M[_k], 180.0, 650.0)
bpy.ops.mesh.primitive_plane_add(size=GROUND, location=(0, 0, 0))
ground = bpy.context.active_object; ground.name = "Sol"; ground.data.materials.append(gm)
bpy.ops.mesh.primitive_plane_add(size=6000, location=(0, 0, -0.05))
far_m = mat("Lointain", (0.018, 0.032, 0.035), 1.0); add_fog(far_m, 60.0, 300.0)
far = bpy.context.active_object; far.name = "Horizon"; far.data.materials.append(far_m)

# ---------- voie ----------
tracks = json.load(open(os.path.join(DIR, "tracks.json")))
# reconstitue les deux voies : chaîne des morceaux par proximité des extrémités
def chain(pieces):
    pieces = [list(map(tuple, p)) for p in pieces]
    lines = []
    while pieces:
        cur = pieces.pop(0)
        changed = True
        while changed:
            changed = False
            for p in pieces:
                for a, b in ((cur[-1], p[0]), (cur[-1], p[-1]), (cur[0], p[-1]), (cur[0], p[0])):
                    if math.dist(a, b) < 0.5:
                        pieces.remove(p)
                        if a is cur[-1] and b is p[0]: cur = cur + p[1:]
                        elif a is cur[-1]: cur = cur + p[::-1][1:]
                        elif b is p[-1]: cur = p + cur[1:]
                        else: cur = p[::-1] + cur[1:]
                        changed = True
                        break
                if changed:
                    break
        lines.append(sorted(cur, key=lambda q: q[1]) if cur[0][1] > cur[-1][1] else cur)
    return lines

lines = [l for l in chain(tracks) if len(l) >= 2]
lines.sort(key=lambda l: min(abs(p[0]) for p in l))
center = [((a[0] + b[0]) / 2, a[1]) for a, b in zip(resample(lines[0], 4), resample(lines[0], 4))]
TRACK_A = resample(sorted(lines[0], key=lambda q: q[1]), 3.0)
TRACK_B = resample(sorted(lines[1], key=lambda q: q[1]), 3.0) if len(lines) > 1 else offset(TRACK_A, -4.5)
RAIL_TOP = 0.55

bal = Builder()
mid = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for a, b in zip(TRACK_A, TRACK_A)]
for tr in (TRACK_A, TRACK_B):
    bal.sweep(tr, [(-3.4, 0.0), (-2.0, 0.35), (2.0, 0.35), (3.4, 0.0)], 0)
bal.build("Ballast", [M["ballast"]])

sl = Builder(); rl = Builder()
for tr in (TRACK_A, TRACK_B):
    fine = resample(tr, 0.6)
    for i in range(1, len(fine) - 1):
        (x0, y0), (x1, y1) = fine[i - 1], fine[i + 1]
        sl.box(fine[i][0], fine[i][1], 0.40, 2.6, 0.26, 0.12, 0, rot=math.atan2(y1 - y0, x1 - x0) - math.pi / 2)
    for side in (-0.7175, 0.7175):
        rl.sweep(offset(tr, side), [(-0.04, 0.46), (-0.035, RAIL_TOP), (0.035, RAIL_TOP), (0.04, 0.46)], 0)
sl.build("Traverses", [M["sleeper"]])
rl.build("Rails", [M["rail"]])

# caténaires : poteaux tous les 63 m de part et d'autre, fils au-dessus de chaque voie
cat = Builder(); wires = Builder()
ys = [p[1] for p in TRACK_A]
for tr, side in ((TRACK_A, 1), (TRACK_B, -1)):
    outer = offset(tr, side * 3.6)
    k = 0
    for i in range(0, len(outer), 21):
        x, y = outer[i]
        cat.box(x, y, 3.9, 0.28, 0.28, 7.8, 0)
        tx, ty = tr[i]
        cat.box((x + tx) / 2, (y + ty) / 2, 7.2, abs(x - tx) + 0.4, 0.12, 0.12, 0)
    wires.sweep(tr, [(-0.012, 5.6), (0.012, 5.6), (0.012, 5.63), (-0.012, 5.63)], 0, closed=True)
    wires.sweep(tr, [(-0.012, 6.9), (0.012, 6.9), (0.012, 6.93), (-0.012, 6.93)], 0, closed=True)
cat.build("Poteaux", [M["pole"]]); wires.build("Caténaire", [M["wire"]])


# ---------- TGV provisoire (2 motrices + 8 remorques duplex) ----------
def section(w, zb, zt, n=20, sq=4.0):
    """Section arrondie (superellipse) : liste (x, z)."""
    pts = []
    cz, hz = (zb + zt) / 2, (zt - zb) / 2
    for i in range(n):
        a = 2 * math.pi * i / n
        c, s = math.cos(a), math.sin(a)
        x = (w / 2) * math.copysign(abs(c) ** (2 / sq), c)
        z = cz + hz * math.copysign(abs(s) ** (2 / sq), s)
        pts.append((x, z))
    return pts


def loft(name, stations, x0, mats_fn):
    """stations : [(y, largeur, z_bas, z_haut)] ; mats_fn(y, z) -> index matériau."""
    v, f, mi = [], [], []
    n = 20
    for y, w, zb, zt in stations:
        for x, z in section(w, zb, zt, n):
            v.append((x0 + x, y, z))
    for i in range(len(stations) - 1):
        for j in range(n):
            a = i * n + j; b = i * n + (j + 1) % n
            f.append((a, b, b + n, a + n))
            yy = (stations[i][0] + stations[i + 1][0]) / 2
            zz = (v[a][2] + v[b][2]) / 2
            xx = (v[a][0] + v[b][0]) / 2 - x0
            mi.append(mats_fn(yy, zz, xx))
    # bouchons
    f.append(tuple(range(n))[::-1]); mi.append(0)
    last = (len(stations) - 1) * n
    f.append(tuple(range(last, last + n))); mi.append(0)
    ob = mesh_obj(name, v, f, [M["body"], M["band"], M["glass"], M["skirt"], M["accent"]], mi, smooth=True)
    sub = ob.modifiers.new("Lissage", "SUBSURF"); sub.levels = 1; sub.render_levels = 2
    return ob


X0 = 0.0  # les véhicules sont construits dans leur repère local puis posés sur la voie
FRONT = 38.0
ZB = RAIL_TOP + 0.45


def track_at(yq):
    """Position x et angle de la voie A à l'ordonnée yq."""
    pts = TRACK_A
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if y0 <= yq <= y1:
            t = (yq - y0) / (y1 - y0) if y1 != y0 else 0
            return x0 + (x1 - x0) * t, math.atan2(-(x1 - x0), (y1 - y0))
    (x0, y0), (x1, y1) = pts[-2], pts[-1]
    return x1, math.atan2(-(x1 - x0), (y1 - y0))


def place(objs, y_center):
    x, ang = track_at(y_center)
    for o in objs:
        o.location = (x, y_center, 0)
        o.rotation_euler = (0, 0, ang)


def power_car(name, y_front, forward=True):
    s = 1 if forward else -1
    nose = [(0.0, 0.5, ZB + 0.55, ZB + 1.05), (0.6, 1.3, ZB + 0.2, ZB + 1.6), (1.6, 2.05, ZB + 0.05, ZB + 2.25),
            (3.0, 2.55, ZB, ZB + 2.95), (4.8, 2.82, ZB, ZB + 3.45), (6.8, 2.9, ZB, ZB + 3.65), (8.5, 2.9, ZB, ZB + 3.7),
            (20.5, 2.9, ZB, ZB + 3.7), (21.9, 2.8, ZB + 0.05, ZB + 3.55)]
    st = [(y_front - s * d, w, zb, zt) for d, w, zb, zt in nose]
    if not forward:
        st = st[::-1]

    def mf(y, z, x):
        d = (y_front - y) * s
        if 2.2 < d < 5.6 and z > ZB + 1.9:
            return 2  # pare-brise
        if z < ZB + 0.5:
            return 3
        if abs(z - (ZB + 1.25)) < 0.07 and d > 5:
            return 4  # filet azur
        if d > 6.5 and ZB + 2.2 < z < ZB + 2.9 and abs(x) > 1.2:
            return 1
        return 0
    return loft(name, st, X0, mf)


def trailer(name, y0, length):
    st = [(y0, 2.7, ZB + 0.1, ZB + 3.9), (y0 - 0.5, 2.9, ZB - 0.15, ZB + 4.2), (y0 - length + 0.5, 2.9, ZB - 0.15, ZB + 4.2), (y0 - length, 2.7, ZB + 0.1, ZB + 3.9)]

    def mf(y, z, x):
        if z < ZB + 0.25:
            return 3
        if abs(z - (ZB + 0.55)) < 0.06:
            return 4
        if (ZB + 0.8 < z < ZB + 1.6 or ZB + 2.55 < z < ZB + 3.3) and abs(x) > 1.2:
            return 1
        return 0
    return loft(name, st, X0, mf)


def bogies(name, ys):
    b = Builder()
    for yy in ys:
        b.box(0, yy, RAIL_TOP + 0.45, 2.3, 3.2, 0.7, 0)
    return b.build(name, [M["bogie"]])


# motrice avant : construite avec son nez en y = +11, centre en 0
L_P, L_T, GAP = 22.0, 18.7, 0.8
front_car = [power_car("Motrice avant", L_P / 2, True), bogies("Bogies motrice avant", [L_P / 2 - 3.5, -L_P / 2 + 4.0])]
fl = Builder()
for side in (-0.75, 0.75):
    fl.box(side, L_P / 2 - 0.55, ZB + 0.82, 0.32, 0.12, 0.14, 0)
front_car.append(fl.build("Feux avant", [M["head"]]))
place(front_car, FRONT - L_P / 2)

y_end = FRONT - L_P - GAP
for k in range(8):
    objs = [trailer(f"Remorque {k + 1}", L_T / 2, L_T)]
    win = Builder()
    for deck_z in (ZB + 1.2, ZB + 2.92):
        yy = L_T / 2 - 1.6
        while yy > -L_T / 2 + 1.6:
            for side in (-1, 1):
                win.box(side * 1.47, yy - 0.55, deck_z, 0.04, 1.15, 0.55, 0)
            yy -= 1.75
    objs.append(win.build(f"Fenêtres {k + 1}", [M["lit"]]))
    jb = Builder()
    jb.box(0, L_T / 2 + GAP / 2, RAIL_TOP + 0.45, 2.3, 3.2, 0.7, 0)
    jb.box(0, L_T / 2 + GAP / 2, ZB + 2.0, 2.3, 1.0, 3.6, 0)  # soufflet + bogie Jacobs
    objs.append(jb.build(f"Soufflet {k + 1}", [M["bogie"]]))
    place(objs, y_end - L_T / 2)
    y_end -= L_T + GAP

rear = [power_car("Motrice arrière", -L_P / 2, False), bogies("Bogies motrice arrière", [L_P / 2 - 4.0, -L_P / 2 + 3.5])]
tl = Builder()
for side in (-0.75, 0.75):
    tl.box(side, -L_P / 2 + 0.55, ZB + 0.82, 0.3, 0.12, 0.12, 0)
rear.append(tl.build("Feux arrière", [M["tail"]]))
pan = Builder()
pan.box(0, -2, ZB + 3.85, 1.6, 0.2, 0.08, 0)
pan.box(0, -2.8, ZB + 4.4, 0.08, 1.8, 0.08, 0)
rear.append(pan.build("Pantographe", [M["bogie"]]))
place(rear, y_end - L_P / 2)
REAR = y_end - L_P

# ---------- lumières ----------
world = bpy.data.worlds.new("Crépuscule"); scene.world = world; world.use_nodes = True
wn = world.node_tree.nodes; wl = world.node_tree.links
bg = wn["Background"]; bg.inputs["Strength"].default_value = 1.0
tc = wn.new("ShaderNodeTexCoord"); sep = wn.new("ShaderNodeSeparateXYZ"); ramp = wn.new("ShaderNodeValToRGB")
wl.new(tc.outputs["Generated"], sep.inputs[0]); wl.new(sep.outputs["Z"], ramp.inputs["Fac"])
ramp.color_ramp.elements[0].position = 0.0; ramp.color_ramp.elements[0].color = (0.066, 0.052, 0.07, 1)
ramp.color_ramp.elements[1].position = 0.07; ramp.color_ramp.elements[1].color = (0.012, 0.03, 0.07, 1)
wl.new(ramp.outputs["Color"], bg.inputs["Color"])
vol = wn.new("ShaderNodeVolumeScatter"); vol.inputs["Density"].default_value = 0.0008; vol.inputs["Color"].default_value = (0.55, 0.65, 0.85, 1)
if "Anisotropy" in vol.inputs:
    vol.inputs["Anisotropy"].default_value = 0.55
# volume désactivé (noircit la scène sous Eevee)
# soleil à l'azimut 239°, 2,5° au-dessus de l'horizon (relatif au sens de marche 349,6°)
rel = math.radians(239 - 349.63)
sun_dir = Vector((math.sin(rel), math.cos(rel), math.tan(math.radians(4))))
sd = bpy.data.lights.new("Soleil couchant", "SUN"); sd.energy = 5.0; sd.color = (1.0, 0.55, 0.30); sd.angle = math.radians(1.5)
so = bpy.data.objects.new("Soleil couchant", sd); scene.collection.objects.link(so)
so.rotation_euler = (-sun_dir).to_track_quat("-Z", "Y").to_euler()
sky = bpy.data.lights.new("Ciel", "SUN"); sky.energy = 0.35; sky.color = (0.45, 0.6, 1.0); sky.angle = math.radians(60)
sk = bpy.data.objects.new("Ciel", sky); scene.collection.objects.link(sk); sk.rotation_euler = (math.radians(20), math.radians(-15), 0)
# lueur des phares sur la voie
hl = bpy.data.lights.new("Phares", "SPOT"); hl.energy = 9000; hl.spot_size = math.radians(40); hl.color = (1, 0.95, 0.85)
XF = track_at(FRONT)[0]
ho = bpy.data.objects.new("Phares", hl); scene.collection.objects.link(ho); ho.location = (XF, FRONT + 0.2, ZB + 0.9)
ho.rotation_euler = (math.radians(80), 0, math.radians(180))

# ---------- caméra ----------
cam = bpy.data.cameras.new("Caméra suivie"); cam.lens = 30; cam.sensor_width = 36
co = bpy.data.objects.new("Caméra suivie", cam); scene.collection.objects.link(co); scene.camera = co
CAM = Vector((XF - 22, FRONT + 44, 19)); TGT = Vector((XF + 5, FRONT - 50, 0.5))
if len(argv) > 4:  # caméra personnalisée : cx cy cz tx ty tz (relatifs à l'avant du train)
    c = list(map(float, argv[4:10]))
    CAM = Vector((XF + c[0], FRONT + c[1], c[2])); TGT = Vector((XF + c[3], FRONT + c[4], c[5]))
co.location = CAM
co.rotation_euler = (TGT - CAM).to_track_quat("-Z", "Y").to_euler()
cam.dof.use_dof = True; cam.dof.focus_distance = (Vector((XF, FRONT - 10, 2.5)) - CAM).length; cam.dof.aperture_fstop = 4.0

# ---------- rendu ----------
for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
    try:
        scene.render.engine = eng
        break
    except TypeError:
        continue
ee = scene.eevee
for attr, val in (("volumetric_end", 900.0), ("volumetric_start", 0.5), ("volumetric_tile_size", "4"), ("taa_render_samples", SAMPLES), ("use_shadows", True), ("use_raytracing", True), ("use_gtao", True), ("use_bloom", True)):
    if hasattr(ee, attr):
        try:
            setattr(ee, attr, val)
        except Exception:
            pass
scene.render.resolution_x, scene.render.resolution_y = W, H
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = "AgX" if "AgX" in [i.identifier for i in scene.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
scene.view_settings.look = "None"
scene.view_settings.exposure = 0.75
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = os.path.join(DIR, f"render_{W}.png")
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(DIR, "continent_vue3d.blend"))
bpy.ops.render.render(write_still=True)
print("RENDU OK", scene.render.engine, scene.render.filepath)
