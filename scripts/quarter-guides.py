# Dev tooling (not shipped): regenerates the diagonal camera guides in src/features/inspection/AngleGuide.tsx.
# Needs Python 3 with numpy and shapely. Run: python scripts/quarter-guides.py  -> guides.json (paste the paths).
"""Projects a simple 3D car model to 3/4 views and emits SVG path data for AngleGuide (400x300 box)."""
import json, math
import numpy as np
from shapely.geometry import Polygon, LineString
from shapely.ops import unary_union

# ---- model (metres): x forward, y left (+), z up -------------------------------------------
LOWER = [  # side profile of the lower body (x, z), from front bottom round the back
    (2.08, 0.24), (2.18, 0.40), (2.18, 0.58), (2.12, 0.70), (2.00, 0.77), (0.80, 0.96),
    (-1.75, 1.00), (-2.02, 0.98), (-2.14, 0.90), (-2.19, 0.70), (-2.12, 0.24),
]
LOWER_W = 0.88     # half width of the body sides
END_W = 0.78       # half width at the very ends (rounded corners in plan)
GREEN = [(0.80, 0.96), (0.02, 1.40), (-0.20, 1.44), (-1.00, 1.45), (-1.28, 1.40), (-1.78, 1.00)]  # greenhouse profile
GREEN_W_BOT, GREEN_W_TOP = 0.76, 0.62
WHEELS_X = [1.33, -1.30]
WHEEL_R, WHEEL_Y_OUT, WHEEL_Y_IN = 0.315, 0.84, 0.62


def lower_pts(side):
    out = []
    for x, z in LOWER:
        w = END_W if abs(x) > 2.1 else (LOWER_W + END_W) / 2 if abs(x) > 2.0 else LOWER_W
        out.append((x, side * w, z))
    return out


def green_w(z):
    t = max(0.0, min(1.0, (z - 0.96) / (1.44 - 0.96)))
    return GREEN_W_BOT + (GREEN_W_TOP - GREEN_W_BOT) * t


def green_pts(side):
    return [(x, side * green_w(z), z) for x, z in GREEN]


def circle3(cx, cy, cz, r, n=48):
    return [(cx + r * math.cos(a), cy, cz + r * math.sin(a)) for a in np.linspace(0, 2 * math.pi, n, endpoint=False)]


# ---- camera ----------------------------------------------------------------------------------
def camera(azimuth_deg, dist=8.5, height=1.55, target=(0.0, 0.0, 0.62)):
    a = math.radians(azimuth_deg)
    c = np.array([dist * math.cos(a), dist * math.sin(a), height])
    f = np.array(target) - c
    f /= np.linalg.norm(f)
    r = np.cross(f, [0, 0, 1])
    r /= np.linalg.norm(r)
    u = np.cross(r, f)

    def proj(p):
        d = np.array(p) - c
        zc = d @ f
        return (float((d @ r) / zc), float(-(d @ u) / zc))

    return proj


def polys_for(proj):
    polys = []
    for side in (1, -1):
        polys.append(Polygon([proj(p) for p in lower_pts(side)]))
        polys.append(Polygon([proj(p) for p in green_pts(side)]))
    for pts, closed in ((lower_pts, True), (green_pts, False)):
        L, R = pts(1), pts(-1)
        n = len(L)
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            polys.append(Polygon([proj(L[i]), proj(L[j]), proj(R[j]), proj(R[i])]))
    for wx in WHEELS_X:
        for side in (1, -1):
            a = circle3(wx, side * WHEEL_Y_OUT, WHEEL_R, WHEEL_R)
            b = circle3(wx, side * WHEEL_Y_IN, WHEEL_R, WHEEL_R)
            polys.append(Polygon([proj(p) for p in a]))
            polys.append(Polygon([proj(p) for p in b]))
            for i in range(len(a)):
                j = (i + 1) % len(a)
                polys.append(Polygon([proj(a[i]), proj(a[j]), proj(b[j]), proj(b[i])]))
    for side in (1, -1):  # door mirrors
        m = [(0.70, side * 0.86, 0.98), (0.58, side * 1.05, 1.00), (0.53, side * 1.05, 1.10), (0.66, side * 0.86, 1.12)]
        polys.append(Polygon([proj(p) for p in m]))
    return [p.buffer(0) for p in polys]


def lines_for(view, proj):
    """Visible feature lines: the near side (car's left, +y) plus the visible end."""
    s = 1
    L = []
    win = [(0.66, 1.00), (-0.04, 1.36), (-1.08, 1.38), (-1.62, 1.02)]
    L.append([(x, s * (green_w(z) + 0.005), z) for x, z in win] + [(win[0][0], s * (green_w(win[0][1]) + 0.005), win[0][1])])
    L.append([(-0.48, s * green_w(1.01), 1.01), (-0.46, s * green_w(1.37), 1.37)])  # B pillar
    L.append([(0.86, s * LOWER_W, 0.93), (0.90, s * LOWER_W, 0.42), (0.98, s * LOWER_W, 0.30)])  # front door edge
    L.append([(-0.48, s * LOWER_W, 0.99), (-0.48, s * LOWER_W, 0.30)])  # door split
    L.append([(0.98, s * LOWER_W, 0.28), (-0.96, s * LOWER_W, 0.28)])  # sill
    for wx in WHEELS_X:  # wheel arches
        L.append([(wx + 0.42 * math.cos(a), s * LOWER_W, 0.31 + 0.42 * math.sin(a)) for a in np.linspace(0.08, math.pi - 0.08, 20)])
    if view == 'quarterFront':
        L.append([(0.78, 0.70, 0.97), (0.0, 0.60, 1.40), (0.0, -0.60, 1.40), (0.78, -0.70, 0.97), (0.78, 0.70, 0.97)])  # windscreen
        L.append([(2.04, 0.83, 0.76), (2.04, -0.83, 0.76)])  # hood edge
        for side in (1, -1):  # headlights
            L.append([(2.16, side * 0.44, 0.67), (2.10, side * 0.80, 0.69), (2.08, side * 0.84, 0.58), (2.15, side * 0.46, 0.57), (2.16, side * 0.44, 0.67)])
        L.append([(2.19, 0.32, 0.58), (2.19, -0.32, 0.58), (2.20, -0.28, 0.44), (2.20, 0.28, 0.44), (2.19, 0.32, 0.58)])  # grille
        L.append([(2.18, 0.60, 0.33), (2.18, -0.60, 0.33)])  # lower intake line
    else:
        L.append([(-1.72, 0.70, 1.02), (-1.10, 0.58, 1.40), (-1.10, -0.58, 1.40), (-1.72, -0.70, 1.02), (-1.72, 0.70, 1.02)])  # rear window
        L.append([(-2.08, 0.83, 0.96), (-2.08, -0.83, 0.96)])  # boot edge
        for side in (1, -1):  # tail lights
            L.append([(-2.16, side * 0.50, 0.90), (-2.11, side * 0.84, 0.90), (-2.14, side * 0.86, 0.76), (-2.18, side * 0.52, 0.79), (-2.16, side * 0.50, 0.90)])
        L.append([(-2.19, 0.26, 0.72), (-2.19, -0.26, 0.72), (-2.19, -0.26, 0.58), (-2.19, 0.26, 0.58), (-2.19, 0.26, 0.72)])  # plate
        L.append([(-2.17, 0.80, 0.46), (-2.17, -0.80, 0.46)])  # bumper line
    return [[proj(p) for p in line] for line in L]


def wheels_for(proj):
    out = []
    for wx in WHEELS_X:
        out.append([proj(p) for p in circle3(wx, WHEEL_Y_OUT + 0.01, WHEEL_R, WHEEL_R, 40)])
        out.append([proj(p) for p in circle3(wx, WHEEL_Y_OUT + 0.012, WHEEL_R, WHEEL_R * 0.56, 32)])
    return out


def fmt(v):
    s = '%.1f' % v
    return s[:-2] if s.endswith('.0') else s


def path_poly(pts, close=True):
    return 'M' + 'L'.join(f'{fmt(x)} {fmt(y)}' for x, y in pts) + ('Z' if close else '')


def build(view, az, ground_y=236, max_w=340, max_h=178, box_w=400):
    proj = camera(az)
    sil = unary_union(polys_for(proj))
    if sil.geom_type != 'Polygon':
        sil = max(sil.geoms, key=lambda g: g.area)
    minx, miny, maxx, maxy = sil.bounds
    s = min(max_w / (maxx - minx), max_h / (maxy - miny))
    ox = (box_w - (maxx - minx) * s) / 2 - minx * s
    oy = ground_y - maxy * s
    T = lambda p: (p[0] * s + ox, p[1] * s + oy)
    outline = Polygon([T(p) for p in list(sil.exterior.coords)[:-1]]).simplify(0.5, preserve_topology=True)
    det = []
    for ln in lines_for(view, proj):
        pts = [T(p) for p in ln]
        closed = ln[0] == ln[-1]
        coords = list(LineString(pts).simplify(0.35).coords)
        det.append(path_poly(coords[:-1] if closed else coords, close=closed))
    wh = []
    for w in wheels_for(proj):
        poly = Polygon([T(p) for p in w]).simplify(0.25)
        wh.append(path_poly(list(poly.exterior.coords)[:-1]))
    return {'outline': path_poly(list(outline.exterior.coords)[:-1]), 'detail': ''.join(det), 'wheels': ''.join(wh)}


if __name__ == '__main__':
    res = {'quarterFront': build('quarterFront', 45), 'quarterRear': build('quarterRear', 135)}
    json.dump(res, open('guides.json', 'w'), indent=1)
    for k, v in res.items():
        print(k, len(v['outline']), len(v['detail']), len(v['wheels']))
