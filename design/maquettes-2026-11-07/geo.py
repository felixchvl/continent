"""Prépare les données vectorielles des maquettes Continent (projection Web Mercator, tuiles 512 px)."""
import json, math, sys, datetime as dt, os

BASE = sys.argv[1]  # dossier scratchpad
D = os.path.join(BASE, "data")
P = lambda x: dt.datetime.fromisoformat(x.replace("Z", "+00:00"))


class View:
    def __init__(self, lat, lon, zoom, w, h):
        self.w, self.h, self.ws = w, h, 512 * 2 ** zoom
        self.cx, self.cy = self._xy(lat, lon)

    def _xy(self, lat, lon):
        lat = max(min(lat, 85), -85)
        x = (lon + 180) / 360 * self.ws
        s = math.sin(math.radians(lat))
        y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * self.ws
        return x, y

    def px(self, lat, lon):
        x, y = self._xy(lat, lon)
        return x - self.cx + self.w / 2, y - self.cy + self.h / 2

    def inside(self, x, y, m=0):
        return -m <= x <= self.w + m and -m <= y <= self.h + m


def dp(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]; bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        n = math.hypot(dx, dy) or 1e-9
        best, bi = -1, -1
        for i in range(a + 1, b):
            x, y = pts[i]
            d = abs(dy * x - dx * y + bx * ay - by * ax) / n
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


def dp_ring(pts, tol):
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 4:
        return pts
    x0, y0 = pts[0]
    k = max(range(len(pts)), key=lambda i: (pts[i][0] - x0) ** 2 + (pts[i][1] - y0) ** 2)
    a = dp(pts[: k + 1], tol)
    b = dp(pts[k:] + [pts[0]], tol)
    return a[:-1] + b[:-1]


def fmt(v):
    s = f"{v:.1f}"
    s = s.rstrip("0").rstrip(".") if "." in s else s
    return "0" if s in ("-0", "") else s


def path(pts, close=False):
    if len(pts) < 2:
        return ""
    out = [f"M{fmt(pts[0][0])} {fmt(pts[0][1])}"]
    px, py = pts[0]
    for x, y in pts[1:]:
        rx, ry = round(x - px, 1), round(y - py, 1)
        if rx == 0 and ry == 0:
            continue
        out.append(f"l{fmt(rx)} {fmt(ry)}")
        px, py = px + rx, py + ry
    return "".join(out) + ("z" if close else "")


def clamp_ring(view, ring, m):
    pts = []
    for lon, lat in ring:
        x, y = view.px(lat, lon)
        x = min(max(x, -m), view.w + m); y = min(max(y, -m), view.h + m)
        if not pts or (abs(pts[-1][0] - x) > 1e-6 or abs(pts[-1][1] - y) > 1e-6):
            pts.append((x, y))
    return pts


def bbox_hits(view, coords, m):
    xs, ys = [], []
    for lon, lat in coords[:: max(1, len(coords) // 200)] + [coords[-1]]:
        x, y = view.px(lat, lon); xs.append(x); ys.append(y)
    return not (max(xs) < -m or min(xs) > view.w + m or max(ys) < -m or min(ys) > view.h + m)


def polys(view, gj, tol, m=40, minarea=2.0):
    ds = []
    for f in gj["features"]:
        g = f["geometry"]
        if not g:
            continue
        pp = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for poly in pp:
            for ring in poly[:1]:
                if not bbox_hits(view, ring, m):
                    continue
                pts = dp_ring(clamp_ring(view, ring, m), tol)
                if len(pts) < 3:
                    continue
                area = abs(sum(pts[i][0] * pts[i - 1][1] - pts[i - 1][0] * pts[i][1] for i in range(len(pts)))) / 2
                if area < minarea:
                    continue
                if all(not view.inside(x, y) for x, y in pts) and area < (view.w * view.h):
                    # entièrement hors champ (sauf grand polygone englobant)
                    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
                    if max(xs) < 0 or min(xs) > view.w or max(ys) < 0 or min(ys) > view.h:
                        continue
                ds.append(path(pts, True))
    return "".join(ds)


def lines(view, gj, tol, m=20):
    ds = []
    for f in gj["features"]:
        g = f["geometry"]
        if not g:
            continue
        ll = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]]
        for line in ll:
            pts = [view.px(lat, lon) for lon, lat in line]
            # découpe en morceaux visibles
            cur = []
            for p in pts:
                if view.inside(*p, m):
                    cur.append(p)
                else:
                    if len(cur) > 1:
                        ds.append(path(dp(cur, tol)))
                    cur = []
            if len(cur) > 1:
                ds.append(path(dp(cur, tol)))
    return "".join(ds)


def decode(s, prec):
    f = 10 ** prec
    i = lat = lng = 0
    out = []
    while i < len(s):
        for which in (0, 1):
            shift = res = 0
            while True:
                b = ord(s[i]) - 63; i += 1
                res |= (b & 0x1F) << shift; shift += 5
                if b < 0x20:
                    break
            d = ~(res >> 1) if res & 1 else res >> 1
            if which == 0:
                lat += d
            else:
                lng += d
        out.append((lat / f, lng / f))
    return out


def along(pts, frac):
    """Point et cap à une fraction de la longueur d'une polyligne (coords écran)."""
    seg = [math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1)]
    L = sum(seg)
    if L == 0:
        return pts[0], 0.0, 0
    t = max(0, min(1, frac)) * L
    for i, s in enumerate(seg):
        if t <= s or i == len(seg) - 1:
            r = t / s if s else 0
            x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * r
            y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * r
            return (x, y), math.degrees(math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0])), i
        t -= s


def kind(mode):
    return {"HIGHSPEED_RAIL": "gv", "LONG_DISTANCE": "cl", "NIGHT_RAIL": "cl"}.get(mode)


def status(delay):
    if delay >= 15:
        return "r2"
    if delay >= 5:
        return "r1"
    return "ok"


def load(name):
    return json.load(open(os.path.join(D, name)))


now_doc = load("transitous_trips.json")
T = dt.datetime.fromisoformat(now_doc["fetched"])
active = [s for s in now_doc["segments"] if kind(s["mode"])]
network = load("transitous_network_3h.json")
renfe_vp = load("renfe_vp_ld.json")["entity"]
renfe_tu = {e["tripUpdate"]["trip"]["tripId"]: e["tripUpdate"].get("delay", 0) for e in load("renfe_tu_ld.json")["entity"]}

ne = {k: json.load(open(os.path.join(D, "ne", k + ".geojson"))) for k in
      ("ne_50m_land", "ne_50m_admin_0_boundary_lines_land", "ne_50m_lakes", "ne_10m_land", "ne_10m_admin_0_boundary_lines_land", "ne_10m_lakes")}

CITIES = [("Paris", 48.8566, 2.3522, 1), ("Londres", 51.5074, -0.1278, 1), ("Madrid", 40.4168, -3.7038, 1), ("Berlin", 52.52, 13.405, 1),
          ("Rome", 41.9028, 12.4964, 1), ("Vienne", 48.2082, 16.3738, 1), ("Bruxelles", 50.8503, 4.3517, 1), ("Amsterdam", 52.3676, 4.9041, 1),
          ("Berne", 46.948, 7.4474, 1), ("Prague", 50.0755, 14.4378, 1), ("Lisbonne", 38.7223, -9.1393, 1), ("Copenhague", 55.6761, 12.5683, 1),
          ("Lyon", 45.764, 4.8357, 2), ("Marseille", 43.2965, 5.3698, 2), ("Barcelone", 41.3874, 2.1686, 2), ("Milan", 45.4642, 9.19, 2),
          ("Francfort", 50.1109, 8.6821, 2), ("Munich", 48.1351, 11.582, 2), ("Hambourg", 53.5511, 9.9937, 2), ("Cologne", 50.9375, 6.9603, 2),
          ("Zurich", 47.3769, 8.5417, 2), ("Bordeaux", 44.8378, -0.5792, 2), ("Toulouse", 43.6047, 1.4442, 2), ("Turin", 45.0703, 7.6869, 2),
          ("Strasbourg", 48.5734, 7.7521, 2), ("Lille", 50.6292, 3.0573, 2), ("Nantes", 47.2184, -1.5536, 2), ("Valence", 39.4699, -0.3763, 2),
          ("Séville", 37.3891, -5.9845, 2), ("Bologne", 44.4949, 11.3426, 2), ("Florence", 43.7696, 11.2558, 2), ("Manchester", 53.4808, -2.2426, 2),
          ("Nice", 43.7102, 7.262, 2), ("Montpellier", 43.6108, 3.8767, 2), ("Rennes", 48.1173, -1.6778, 2), ("Dijon", 47.322, 5.0415, 2),
          ("Avignon", 43.9493, 4.8055, 2), ("Valence (Drôme)", 44.9334, 4.8924, 2), ("Mâcon", 46.3069, 4.8287, 2), ("Toulon", 43.1242, 5.928, 2),
          ("Genève", 46.2044, 6.1432, 2), ("Le Creusot", 46.8, 4.42, 3), ("Grenoble", 45.1885, 5.7245, 2), ("Saint-Étienne", 45.4397, 4.3872, 3),
          ("Orléans", 47.9029, 1.9093, 2), ("Tours", 47.3941, 0.6848, 2), ("Clermont-Ferrand", 45.7772, 3.087, 2), ("Limoges", 45.8336, 1.2611, 3),
          ("Poitiers", 46.5802, 0.3404, 3), ("Reims", 49.2583, 4.0317, 3), ("Metz", 49.1193, 6.1757, 3), ("Besançon", 47.2378, 6.0241, 3),
          ("Perpignan", 42.6887, 2.8948, 3), ("Pau", 43.2951, -0.3708, 3), ("Le Mans", 48.0061, 0.1996, 3), ("Cannes", 43.5528, 7.0174, 3)]


def densify(pts, step):
    out = [pts[0]]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = max(1, int(math.hypot(x1 - x0, y1 - y0) / step))
        for i in range(1, n + 1):
            out.append((x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n))
    return out


def network_paths(view, tol, cell=2.5, minlen=4.0):
    """Tracés du réseau sans doublons : une grille de couverture écarte les tronçons déjà dessinés."""
    covered = set()
    res = {"gv": [], "cl": []}
    segs = sorted(network, key=lambda s: 0 if s["mode"] == "HIGHSPEED_RAIL" else 1)
    for s in segs:
        k = "gv" if s["mode"] == "HIGHSPEED_RAIL" else "cl"
        pts = [view.px(a, b) for a, b in decode(s["polyline"], 4)]
        if len(pts) < 2 or not any(view.inside(x, y, 10) for x, y in pts):
            continue
        # flux sans tracé réel : quelques points seulement sur une longue distance
        if len(pts) <= 3 and math.dist(pts[0], pts[-1]) > 40:
            continue
        pts = densify(pts, cell / 2)
        runs, cur = [], []
        for x, y in pts:
            c = (int(x // cell), int(y // cell))
            free = view.inside(x, y, 10) and not any((c[0] + i, c[1] + j) in covered for i in (-1, 0, 1) for j in (-1, 0, 1))
            if free:
                cur.append((x, y))
            else:
                if len(cur) > 1:
                    runs.append(cur)
                cur = []
        if len(cur) > 1:
            runs.append(cur)
        for r in runs:
            if math.dist(r[0], r[-1]) < minlen and len(r) < 4:
                continue
            for x, y in r:
                covered.add((int(x // cell), int(y // cell)))
            res[k].append(path(dp(r, tol)))
    return "".join(res["gv"]), "".join(res["cl"])


def renfe_types():
    t = {}
    for s in active:
        if "es-RENFE" in s["trips"][0]["tripId"]:
            num = "".join(ch for ch in (s["trips"][0].get("displayName") or "") if ch.isdigit())
            if num:
                t[num.zfill(5)] = kind(s["mode"])
    return t


def trains(view, margin=6):
    out = []
    rt = renfe_types()
    for s in active:
        tid = s["trips"][0]["tripId"]
        if "es-RENFE-Larga" in tid:
            continue  # remplacé par le GPS Renfe
        dep, arr = P(s["departure"]), P(s["arrival"])
        f = (T - dep) / (arr - dep) if arr > dep else 0
        pts = [view.px(a, b) for a, b in decode(s["polyline"], 3)]
        if len(pts) < 2:
            continue
        (x, y), hdg, _ = along(pts, f)
        if not view.inside(x, y, margin):
            continue
        delay = max(0, (dep - P(s["scheduledDeparture"])).total_seconds() / 60)
        out.append([round(x, 1), round(y, 1), round(hdg), kind(s["mode"]), status(delay), 0])
    seen = set()
    for e in renfe_vp:
        v = e["vehicle"]; p = v["position"]
        x, y = view.px(p["latitude"], p["longitude"])
        if not view.inside(x, y, margin) or (round(x), round(y)) in seen:
            continue  # unités jumelées : même position GPS
        seen.add((round(x), round(y)))
        tid = v["trip"]["tripId"]
        delay = max(0, renfe_tu.get(tid, 0) / 60)
        num = v["vehicle"].get("label", "")[:5]
        hdg = p.get("bearing")
        hdg = hdg - 90 if hdg is not None else renfe_heading(view, x, y, v.get("stopId"))
        out.append([round(x, 1), round(y, 1), round(hdg) if hdg is not None else None, rt.get(num, "gv"), status(delay), 1])
    return out


_renfe_cache = {}


def renfe_heading(view, x, y, next_stop):
    """Cap d'un train Renfe sans 'bearing' : direction de la voie la plus proche, orientée vers le prochain arrêt."""
    key = id(view)
    if key not in _renfe_cache:
        stops, segs = {}, []
        for s in network:
            for end in ("from", "to"):
                sid = s[end]["stopId"]
                if "RENFE" in sid:
                    stops[sid.rsplit("_", 1)[-1]] = view.px(s[end]["lat"], s[end]["lon"])
            if any("RENFE" in t["tripId"] for t in s["trips"]):
                pts = [view.px(a, b) for a, b in decode(s["polyline"], 4)]
                segs += list(zip(pts, pts[1:]))
        _renfe_cache[key] = (stops, segs)
    stops, segs = _renfe_cache[key]
    best, bd = None, 1e18
    for (ax, ay), (bx, by) in segs:
        dx, dy = bx - ax, by - ay
        L = dx * dx + dy * dy
        t = 0 if L == 0 else max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / L))
        d = (ax + t * dx - x) ** 2 + (ay + t * dy - y) ** 2
        if d < bd and L > 0:
            bd, best = d, (dx, dy)
    tgt = stops.get(str(next_stop)) if next_stop else None
    if best is None:
        return math.degrees(math.atan2(tgt[1] - y, tgt[0] - x)) if tgt else None
    dx, dy = best
    if tgt and (tgt[0] - x) * dx + (tgt[1] - y) * dy < 0:
        dx, dy = -dx, -dy
    return math.degrees(math.atan2(dy, dx))


def labels(view, maxrank, m=0):
    return [[n, round(x, 1), round(y, 1), r] for n, lat, lon, r in CITIES if r <= maxrank for x, y in [view.px(lat, lon)] if view.inside(x, y, m)]


def basemap(view, res, tol):
    return {"land": polys(view, ne[f"ne_{res}_land"], tol, minarea=3.0),
            "lakes": polys(view, ne[f"ne_{res}_lakes"], tol, minarea=6.0),
            "borders": lines(view, ne[f"ne_{res}_admin_0_boundary_lines_land"], tol)}


def trip_route(view, name):
    t = load(f"trip_{name}.json")
    leg = t["legs"][0]
    g = leg["legGeometry"]
    pts = [view.px(a, b) for a, b in decode(g["points"], g["precision"])]
    stops = [leg["from"]] + leg.get("intermediateStops", []) + [leg["to"]]
    # position actuelle : segment actif entre deux arrêts
    times = [(P(s.get("departure") or s.get("arrival")), P(s.get("arrival") or s.get("departure"))) for s in stops]
    spx = [view.px(s["lat"], s["lon"]) for s in stops]
    # index des arrêts sur la polyligne
    def nearest(p):
        return min(range(len(pts)), key=lambda i: (pts[i][0] - p[0]) ** 2 + (pts[i][1] - p[1]) ** 2)
    idx = [nearest(p) for p in spx]
    cur = None
    for i in range(len(stops) - 1):
        dep = times[i][1]; arr = times[i + 1][0]
        if dep <= T <= arr:
            f = (T - dep) / (arr - dep)
            sub = pts[idx[i]: idx[i + 1] + 1]
            (x, y), hdg, j = along(sub, f)
            cur = {"x": round(x, 1), "y": round(y, 1), "hdg": round(hdg), "seg": i, "split": idx[i] + j}
            # vitesse moyenne du segment
            km = sum(math.dist(a, b) for a, b in zip(sub, sub[1:]))
            break
    passed = pts[: cur["split"] + 1] + [(cur["x"], cur["y"])] if cur else pts
    rest = [(cur["x"], cur["y"])] + pts[cur["split"] + 1:] if cur else []
    return {"passed": path(dp(passed, 0.4)), "rest": path(dp(rest, 0.4)), "train": cur,
            "stops": [{"name": s["name"], "x": round(p[0], 1), "y": round(p[1], 1)} for s, p in zip(stops, spx)]}


out = {"fetched": now_doc["fetched"]}

# Écran 1 : Europe, bureau 1440×900
v1 = View(46.6, 1.75, 4.75, 1440, 900)
hs, ld = network_paths(v1, 0.8)
out["europe"] = {**basemap(v1, "50m", 0.7), "hs": hs, "ld": ld, "trains": trains(v1), "labels": labels(v1, 2)}

# Écran 2 : fiche train TGV 6176 Nice → Paris, carte à droite d'un panneau de 440 px
v2 = View(46.1, 2.69, 6.0, 1440, 900)
hs2, ld2 = network_paths(v2, 0.5)
out["detail"] = {**basemap(v2, "10m", 0.6), "hs": hs2, "ld": ld2, "trains": trains(v2), "labels": labels(v2, 3), "route": trip_route(v2, "6176")}

# Écran 4 : mobile 390×844, France
v4 = View(43.3, 2.6, 4.55, 390, 844)
hs4, ld4 = network_paths(v4, 0.8)
out["mobile"] = {**basemap(v4, "50m", 0.7), "hs": hs4, "ld": ld4, "trains": trains(v4), "labels": labels(v4, 2), "route": trip_route(v4, "8582")}

json.dump(out, open(os.path.join(D, "screens.json"), "w"), ensure_ascii=False)
for k in ("europe", "detail", "mobile"):
    s = out[k]
    print(k, {kk: (len(vv) if isinstance(vv, (str, list)) else "") for kk, vv in s.items() if kk != "route"}, "route" in s and s["route"]["train"])
