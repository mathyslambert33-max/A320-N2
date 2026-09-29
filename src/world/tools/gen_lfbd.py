#!/usr/bin/env python3
"""
Generate src/world/data/lfbd.ts: compact LFBD (Bordeaux-Merignac) airport data in local metres.

Run once; the generated TypeScript module is committed (the game never fetches anything at runtime).

Sources
  * X-Plane Scenery Gateway airport layout of LFBD (GPL v2), as shipped by FlightGear fgdata
    (gitlab.com/flightgear/fgdata, file Airports/apt.dat.ws3.gz): pavements (bezier outlines), painted
    lines, taxiway light lines, taxi signs, runways, PAPI / wig-wags, windsocks, stands (1300 records).
  * Overture Maps Foundation, release 2026-09-23.1 (ODbL; OpenStreetMap + Microsoft ML buildings):
    building footprints / heights / names, trees, tree rows and forests, roads.
    Read straight from the public S3 GeoParquet files with HTTP range requests (only the footers and the
    row groups intersecting the bbox are downloaded, ~0.7 GB of footers + ~20 MB of rows).

Local frame: origin = SCENARIO stand point (44.83095 N, -0.70438 E), x = east, y = north, metres
(equirectangular, error < 5 cm over the airport).

Usage (Python >= 3.10):
  python3 -m venv /tmp/lfbd-venv && /tmp/lfbd-venv/bin/pip install pyarrow shapely requests
  /tmp/lfbd-venv/bin/python src/world/tools/gen_lfbd.py [--apt /path/apt.dat.ws3.gz] [--cache /tmp/lfbd-cache]
"""
import argparse, base64, gzip, io, json, math, os, re, sys, time
from array import array
from concurrent.futures import ThreadPoolExecutor

import requests
import pyarrow.parquet as pq
import shapely
import shapely.wkb
import shapely.wkt
from shapely.geometry import Polygon, MultiPolygon, LineString, Point, box
from shapely.ops import transform, unary_union

LAT0, LON0 = 44.83095, -0.70438
KX = 111320.0 * math.cos(math.radians(LAT0))
KY = 111132.0
BBOX = (-0.76, -0.66, 44.80, 44.86)          # lon0, lon1, lat0, lat1 (Overture query)
NEAR = 3200.0                                 # m: detailed data radius (Int16 decimetres)
FAR = 9000.0                                  # m: forests (Int16 metres)
OVERTURE = 'https://overturemaps-us-west-2.s3.amazonaws.com/'
RELEASE = 'release/2026-09-23.1/'
APT_URL = 'https://gitlab.com/flightgear/fgdata/-/raw/next/Airports/apt.dat.ws3.gz'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'lfbd.ts')

S = requests.Session()


def loc(lon, lat):
    return ((lon - LON0) * KX, (lat - LAT0) * KY)


def tl(g):
    return transform(lambda x, y, z=None: ((x - LON0) * KX, (y - LAT0) * KY), g)


# ----------------------------------------------------------------------------------------------------------
# HTTP range file for pyarrow
class HttpFile(io.RawIOBase):
    def __init__(self, url, size):
        self.url, self.size, self.pos = url, size, 0

    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        if n == 0:
            return b''
        end = min(self.size, self.pos + n) - 1
        for attempt in range(4):
            try:
                r = S.get(self.url, headers={'Range': f'bytes={self.pos}-{end}'}, timeout=120)
                r.raise_for_status()
                break
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(2)
        self.pos += len(r.content)
        return r.content

    def readinto(self, b):
        d = self.read(len(b))
        b[:len(d)] = d
        return len(d)


def list_keys(prefix):
    keys, token = [], None
    while True:
        u = OVERTURE + '?list-type=2&prefix=' + prefix + ('&continuation-token=' + requests.utils.quote(token) if token else '')
        t = S.get(u, timeout=60).text
        keys += [(k, int(s)) for k, s in re.findall(r'<Key>([^<]+)</Key>.*?<Size>(\d+)</Size>', t)]
        m = re.search(r'<NextContinuationToken>([^<]+)</NextContinuationToken>', t)
        if not m:
            return keys
        token = m.group(1)


def overture(theme_type, columns, cache):
    """Rows of an Overture type intersecting BBOX (cached as JSON)."""
    path = os.path.join(cache, theme_type.replace('/', '_') + '.json')
    if os.path.exists(path):
        return json.load(open(path))
    X0, X1, Y0, Y1 = BBOX
    keys = list_keys(RELEASE + theme_type + '/')

    def scan(ks):
        k, s = ks
        md = pq.ParquetFile(HttpFile(OVERTURE + k, s)).metadata
        idx = {md.schema.column(i).path: i for i in range(md.num_columns)}
        hits = []
        for g in range(md.num_row_groups):
            rg = md.row_group(g)
            st = [rg.column(idx['bbox.' + c]).statistics for c in ('xmin', 'xmax', 'ymin', 'ymax')]
            if any(x is None or not x.has_min_max for x in st):
                continue
            if st[0].min <= X1 and st[1].max >= X0 and st[2].min <= Y1 and st[3].max >= Y0:
                hits.append(g)
        return k, s, hits

    rows = []
    with ThreadPoolExecutor(12) as ex:
        for k, s, hits in ex.map(scan, keys):
            if not hits:
                continue
            pf = pq.ParquetFile(HttpFile(OVERTURE + k, s))
            use = [c for c in columns if c in pf.schema_arrow.names]
            for r in pf.read_row_groups(hits, columns=use + ['geometry', 'bbox']).to_pylist():
                b = r['bbox']
                if b['xmin'] <= X1 and b['xmax'] >= X0 and b['ymin'] <= Y1 and b['ymax'] >= Y0:
                    r['geometry'] = shapely.wkb.loads(r['geometry']).wkt
                    rows.append(r)
    json.dump(rows, open(path, 'w'), default=str)
    print(f'  {theme_type}: {len(rows)} rows', file=sys.stderr)
    return rows


# ----------------------------------------------------------------------------------------------------------
# apt.dat (X-Plane 1100/1200 format)
def load_apt(path, cache):
    sec = os.path.join(cache, 'LFBD.apt.dat')
    if os.path.exists(sec):
        return open(sec, encoding='latin-1').read().splitlines()
    if not path:
        path = os.path.join(cache, 'apt.dat.ws3.gz')
        if not os.path.exists(path):
            print('downloading apt.dat.ws3.gz (156 MB)...', file=sys.stderr)
            with S.get(APT_URL, stream=True, timeout=600) as r:
                r.raise_for_status()
                with open(path, 'wb') as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
    out, on = [], False
    with gzip.open(path, 'rt', encoding='latin-1') as f:
        for line in f:
            if line.startswith('1 ') or line.startswith('16 ') or line.startswith('17 '):
                if on:
                    break
                on = line.split()[4:5] == ['LFBD']
            if on:
                out.append(line.rstrip('\n'))
    open(sec, 'w', encoding='latin-1').write('\n'.join(out))
    return out


def bez(p0, c0, c1, p1):
    L = math.dist(p0, c0) + math.dist(c0, c1) + math.dist(c1, p1)
    n = max(2, min(24, int(L / 2.0)))
    pts = []
    for i in range(1, n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
        pts.append((a * p0[0] + b * c0[0] + c * c1[0] + d * p1[0], a * p0[1] + b * c0[1] + c * c1[1] + d * p1[1]))
    return pts


def parse_apt(lines):
    feats, cur, ring = [], None, []
    res = dict(stands=[], signs=[], lights21=[], rwys=[], windsocks=[], tower=None, boundary=None)

    def flush(closed):
        nonlocal ring
        if cur is not None and ring:
            cur['rings'].append({'nodes': ring, 'closed': closed})
        ring = []

    for raw in lines:
        p = raw.split()
        if not p:
            continue
        c = p[0]
        if c in ('110', '120', '130'):
            if ring:
                flush(False)
            cur = {'kind': c, 'hdr': p[1:], 'rings': []}
            feats.append(cur)
        elif c in ('111', '112', '113', '114', '115', '116'):
            x, y = loc(float(p[2]), float(p[1]))
            if c in ('112', '114', '116'):
                bx, by = loc(float(p[4]), float(p[3]))
                rest = p[5:]
            else:
                bx = by = None
                rest = p[3:]
            ring.append({'p': (x, y), 'b': (bx, by) if bx is not None else None, 'attr': [int(v) for v in rest]})
            if c in ('113', '114'):
                flush(True)
            elif c in ('115', '116'):
                flush(False)
        elif c == '1300':
            x, y = loc(float(p[2]), float(p[1]))
            res['stands'].append({'name': ' '.join(p[6:]), 'x': x, 'y': y, 'hdg': float(p[3]), 'kind': p[4]})
        elif c == '1301':
            res['stands'][-1]['size'] = p[1]
        elif c == '20':
            x, y = loc(float(p[2]), float(p[1]))
            res['signs'].append([round(x, 1), round(y, 1), round(float(p[3]), 1), int(p[5]), ' '.join(p[6:])])
        elif c == '21':
            x, y = loc(float(p[2]), float(p[1]))
            res['lights21'].append([round(x, 1), round(y, 1), int(p[3]), round(float(p[4]), 1)])
        elif c == '19':
            x, y = loc(float(p[2]), float(p[1]))
            res['windsocks'].append([round(x, 1), round(y, 1)])
        elif c == '14':
            x, y = loc(float(p[2]), float(p[1]))
            res['tower'] = [round(x, 1), round(y, 1)]
        elif c == '100':
            def end(e):
                x, y = loc(float(e[2]), float(e[1]))
                return {'id': e[0], 'x': round(x, 2), 'y': round(y, 2), 'displ': float(e[3]), 'blast': float(e[4]),
                        'mark': int(e[5]), 'appl': int(e[6]), 'tdz': int(e[7]), 'reil': int(e[8])}
            res['rwys'].append({'w': float(p[1]), 'surf': int(p[2]), 'shoulder': int(p[3]), 'cl': int(p[5]),
                                'edge': int(p[6]), 'ends': [end(p[8:17]), end(p[17:26])]})
    if ring:
        flush(False)
    res['feats'] = feats
    return res


def ring_segments(r):
    """Expand a ring into per-segment point lists: [(attrs, [p0, ..., p1])]."""
    nodes = r['nodes']
    N = len(nodes)
    segs = N if r['closed'] else N - 1
    out = []
    for i in range(segs):
        a, b = nodes[i], nodes[(i + 1) % N]
        p0, p1 = a['p'], b['p']
        if a['b'] is None and b['b'] is None:
            pts = [p0, p1]
        else:
            c0 = a['b'] if a['b'] is not None else p0
            c1 = (2 * p1[0] - b['b'][0], 2 * p1[1] - b['b'][1]) if b['b'] is not None else p1
            pts = [p0] + bez(p0, c0, c1, p1)
        out.append((a['attr'], pts))
    return out


def ring_points(r):
    pts = []
    for _, seg in ring_segments(r):
        pts.extend(seg if not pts else seg[1:])
    if r['closed'] and len(pts) > 2 and math.dist(pts[0], pts[-1]) < 1e-3:
        pts.pop()
    return pts


# ----------------------------------------------------------------------------------------------------------
class Stream:
    """Int16 stream (little endian) encoded as base64."""

    def __init__(self, unit):
        self.unit, self.a = unit, array('h')

    def i(self, v):
        v = int(round(v))
        assert -32768 <= v <= 32767, v
        self.a.append(v)

    def xy(self, pts):
        for x, y in pts:
            self.i(x / self.unit)
            self.i(y / self.unit)

    def b64(self):
        a = array('h', self.a)
        if sys.byteorder != 'little':
            a.byteswap()
        return base64.b64encode(a.tobytes()).decode()


def rings_of(g):
    if g.is_empty:
        return []
    if g.geom_type == 'Polygon':
        return [g]
    if g.geom_type in ('MultiPolygon', 'GeometryCollection'):
        return [q for q in g.geoms if q.geom_type == 'Polygon']
    return []


def clean_ring(coords):
    pts = list(coords)
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return pts


# Building classes (runtime materials): keep in sync with src/world/airport/buildings.ts
B_GENERIC, B_HOUSE, B_APART, B_INDUS, B_HANGAR, B_OFFICE, B_TERMINAL, B_PIER, B_TOWER, B_PARKING, B_CANOPY, B_SERVICE = range(12)

SPECIAL_HEIGHT = {  # metres, by OSM name (surveyed from photos / typical)
    'Hall B': 15.0, 'Terminal Billi': 9.5, 'Satellite 3': 7.0, 'Bâtiment Servitude': 8.0,
    'CRNA-SO': 12.0, 'CESNAC': 12.0,
}


def building_class(b, area):
    cls, sub, nm = (b.get('class') or ''), (b.get('subtype') or ''), ((b.get('names') or {}) or {}).get('primary') or ''
    if nm.startswith('Hall') or 'Terminal' in nm or nm.startswith('Satellite'):
        return B_TERMINAL
    if 'Tour de contr' in nm:
        return B_TOWER
    if cls == 'hangar' or 'hangar' in nm.lower():
        return B_HANGAR
    if cls in ('roof', 'carport') or sub == 'outbuilding' and cls == 'roof':
        return B_CANOPY
    if cls == 'parking':
        return B_PARKING
    if cls in ('house', 'detached', 'semidetached_house', 'bungalow', 'garage', 'garages', 'shed') or (sub == 'residential' and area < 250):
        return B_HOUSE
    if cls in ('apartments', 'residential', 'dormitory') or sub == 'residential':
        return B_APART
    if cls in ('industrial', 'warehouse', 'manufacture', 'factory') or sub == 'industrial':
        return B_HANGAR if area > 4000 else B_INDUS
    if cls in ('office', 'commercial', 'retail', 'supermarket', 'hotel', 'school', 'hospital', 'civic', 'public', 'government') or sub in ('commercial', 'civic', 'education', 'medical'):
        return B_OFFICE
    if cls in ('service', 'transformer_tower', 'technical') or sub == 'service':
        return B_SERVICE
    if area < 150:
        return B_HOUSE
    if area > 5000:
        return B_HANGAR
    return B_GENERIC


def building_height(b, cls, area, gx, gy):
    nm = ((b.get('names') or {}) or {}).get('primary') or ''
    if nm in SPECIAL_HEIGHT:
        return SPECIAL_HEIGHT[nm]
    if b.get('height'):
        return float(b['height'])
    if b.get('num_floors'):
        return b['num_floors'] * 3.3 + 1.2
    # deterministic pseudo-random variation from the position
    r = (math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453) % 1.0
    if cls == B_HOUSE:
        return 5.5 + 2.5 * r if area > 60 else 3.0
    if cls == B_APART:
        return 9.0 + 9.0 * r
    if cls == B_HANGAR:
        return 12.0 + min(10.0, area / 1500.0) + 3 * r
    if cls == B_INDUS:
        return 7.0 + 4 * r
    if cls == B_OFFICE:
        return 8.0 + 6 * r
    if cls == B_CANOPY:
        return 4.5
    if cls == B_PARKING:
        return 7.0
    if cls == B_SERVICE:
        return 4.0 + 2 * r
    return 6.0 + 4 * r


# ----------------------------------------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apt', default=None)
    ap.add_argument('--cache', default='/tmp/lfbd-cache')
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)

    apt = parse_apt(load_apt(args.apt, args.cache))

    # --- pavements & painted lines & light lines (X-Plane) ---
    pave, marks, llines = Stream(0.1), Stream(0.1), Stream(0.1)
    npave = nmark = nlight = 0
    for f in apt['feats']:
        if f['kind'] == '110':
            surf = int(f['hdr'][0])
            if surf == 15:  # transparent
                continue
            rings = [ring_points(r) for r in f['rings'] if r['closed']]
            rings = [r for r in rings if len(r) >= 3]
            if not rings:
                continue
            # simplify
            poly = Polygon(rings[0], rings[1:]).buffer(0)
            for q in rings_of(poly.simplify(0.15)):
                rr = [clean_ring(q.exterior.coords)] + [clean_ring(h.coords) for h in q.interiors]
                pave.i(1 if surf in (1, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38) else 2)
                pave.i(len(rr))
                for r in rr:
                    pave.i(len(r))
                for r in rr:
                    pave.xy(r)
                npave += 1
        if f['kind'] in ('110', '120'):
            for r in f['rings']:
                # group consecutive segments with the same painted type / light type
                for want, stream in (('paint', marks), ('light', llines)):
                    run_t, run = None, []

                    def emit():
                        nonlocal nmark, nlight
                        if run_t is not None and len(run) >= 2:
                            simp = list(LineString(run).simplify(0.05).coords)
                            stream.i(run_t)
                            stream.i(len(simp))
                            stream.xy(simp)
                            if want == 'paint':
                                nmark += 1
                            else:
                                nlight += 1

                    for attrs, pts in ring_segments(r):
                        t = next((a for a in attrs if (a < 100) == (want == 'paint') and a > 0), None)
                        if t != run_t:
                            emit()
                            run_t, run = t, list(pts)
                        else:
                            run.extend(pts[1:])
                    emit()

    # --- Overture ---
    bcols = ['id', 'names', 'height', 'num_floors', 'class', 'subtype', 'roof_shape', 'is_underground', 'level']
    B = overture('theme=buildings/type=building', bcols, args.cache)
    L = overture('theme=base/type=land', ['id', 'subtype', 'class', 'names'], args.cache)
    R = overture('theme=transportation/type=segment', ['id', 'subtype', 'class', 'subclass', 'road_flags', 'names'], args.cache)

    # --- buildings ---
    bld = Stream(0.1)
    names = {}
    nb = 0
    hallA_pier_cut = None
    for b in B:
        if b.get('is_underground'):
            continue
        g = tl(shapely.wkt.loads(b['geometry']))
        if not g.is_valid:
            g = g.buffer(0)
        c = g.centroid
        if math.hypot(c.x, c.y) > NEAR or g.area < 12:
            continue
        nm = ((b.get('names') or {}) or {}).get('primary') or ''
        parts = [(g, None)]
        if nm == 'Hall A':
            # Split the pier (jetee, 2 levels, gates B1-B9 + stand 14) from the main Hall A building.
            p0 = (1.6, -65.6); d = (0.7095, 0.7047); n = (0.7047, -0.7095)
            def fa(a, m):
                return (p0[0] + a * d[0] + m * n[0], p0[1] + a * d[1] + m * n[1])
            cut = Polygon([fa(-140, -40), fa(29.0, -40), fa(29.0, 3), fa(-140, 3)])
            parts = [(g.intersection(cut), 'pier'), (g.difference(cut), 'main')]
        for gg, tag in parts:
            for q in rings_of(gg.simplify(0.4 if math.hypot(c.x, c.y) < 800 else 1.0)):
                if q.area < 12:
                    continue
                area = q.area
                cls = building_class(b, area)
                h = building_height(b, cls, area, q.centroid.x, q.centroid.y)
                if tag == 'pier':
                    cls, h = B_PIER, 10.6
                elif tag == 'main':
                    cls, h = B_TERMINAL, 13.5
                rr = [clean_ring(q.exterior.coords)] + [clean_ring(hh.coords) for hh in q.interiors if Polygon(hh).area > 4]
                bld.i(h * 10)
                bld.i(cls)
                bld.i(len(rr))
                for r in rr:
                    bld.i(len(r))
                for r in rr:
                    bld.xy(r)
                if nm and (cls in (B_TERMINAL, B_PIER, B_TOWER) or tag):
                    names[nb] = nm + (' (' + tag + ')' if tag else '')
                nb += 1

    # --- trees & forests ---
    trees, forests = Stream(0.1), Stream(1.0)
    nt = nf = 0
    for r in L:
        g = tl(shapely.wkt.loads(r['geometry']))
        cls = r.get('class')
        if cls == 'tree' and g.geom_type == 'Point':
            if math.hypot(g.x, g.y) < NEAR:
                trees.i(g.x * 10); trees.i(g.y * 10); nt += 1
        elif cls == 'tree_row':
            for ln in ([g] if g.geom_type == 'LineString' else getattr(g, 'geoms', [])):
                if ln.geom_type != 'LineString' or ln.centroid.distance(Point(0, 0)) > NEAR:
                    continue
                k = max(1, int(ln.length / 7.0))
                for i in range(k + 1):
                    p = ln.interpolate(i / k, normalized=True)
                    trees.i(p.x * 10); trees.i(p.y * 10); nt += 1
        elif cls in ('forest', 'wood', 'scrub'):
            for q in rings_of(g):
                if q.centroid.distance(Point(0, 0)) > FAR or q.area < 2000:
                    continue
                s = q.simplify(4.0)
                for qq in rings_of(s):
                    rr = [clean_ring(qq.exterior.coords)] + [clean_ring(h.coords) for h in qq.interiors if Polygon(h).area > 400]
                    forests.i(1 if cls == 'scrub' else 0)
                    forests.i(len(rr))
                    for rg in rr:
                        forests.i(len(rg))
                    for rg in rr:
                        forests.xy(rg)
                    nf += 1

    # --- roads ---
    RCLS = {'motorway': 1, 'trunk': 2, 'primary': 2, 'secondary': 3, 'tertiary': 4, 'residential': 5, 'unclassified': 5,
            'living_street': 5, 'service': 6, 'track': 7}
    roads = Stream(0.1)
    nr = 0
    for r in R:
        if r.get('subtype') != 'road':
            continue
        k = RCLS.get(r.get('class'))
        if not k:
            continue
        if r.get('class') == 'service' and r.get('subclass') in ('parking_aisle', 'driveway'):
            k = 8
        flags = json.dumps(r.get('road_flags') or '')
        if 'is_tunnel' in flags:
            continue
        g = tl(shapely.wkt.loads(r['geometry']))
        for ln in ([g] if g.geom_type == 'LineString' else getattr(g, 'geoms', [])):
            if ln.geom_type != 'LineString' or ln.distance(Point(0, 0)) > NEAR:
                continue
            pts = list(ln.simplify(0.5).coords)
            if any(abs(x) > 3270 or abs(y) > 3270 for x, y in pts):
                continue
            roads.i(k)
            roads.i(len(pts))
            roads.xy(pts)
            nr += 1

    # --- stands ---
    stands = [[s['name'], round(s['x'], 1), round(s['y'], 1), round(s['hdg'], 1), s.get('size', 'C')] for s in apt['stands']]
    rwys = [{'w': r['w'], 'cl': r['cl'], 'edge': r['edge'], 'ends': r['ends']} for r in apt['rwys']]

    now = time.strftime('%Y-%m-%d')
    ts = f"""/* eslint-disable */
// AUTO-GENERATED by src/world/tools/gen_lfbd.py on {now}. Do not edit by hand.
// Sources: X-Plane Scenery Gateway LFBD layout (GPL, via FlightGear fgdata apt.dat.ws3) and
// Overture Maps 2026-09-23.1 (ODbL: OpenStreetMap contributors, Microsoft ML buildings).
// Local frame: origin {LAT0} N {LON0} E, x = east, y = north, metres. Streams are base64 Int16 (little endian).

export const ORIGIN = {{ lat: {LAT0}, lon: {LON0} }};

/** Runways: width (m), centreline / edge light flags, ends with threshold position (m), displaced threshold and
 *  blast pad lengths (m), marking type, approach lighting, TDZ lights and REIL codes (X-Plane apt.dat 100). */
export const RUNWAYS = {json.dumps(rwys)} as const;

/** Pavements (decimetres): repeated [surface 1 asphalt / 2 concrete, nRings, len x nRings, (x, y) x sum(len)]. */
export const PAVEMENTS = '{pave.b64()}';

/** Painted lines (decimetres): repeated [X-Plane line type, n, (x, y) x n]. */
export const MARKINGS = '{marks.b64()}';

/** Taxiway light lines (decimetres): repeated [X-Plane light type (101 green centre, 102 blue edge, 103 amber hold,
 *  104 runway guard), n, (x, y) x n]. */
export const LIGHT_LINES = '{llines.b64()}';

/** Buildings (decimetres): repeated [height dm, class, nRings, len x nRings, (x, y) x sum(len)]. Classes:
 *  0 generic, 1 house, 2 apartments, 3 industrial, 4 hangar, 5 office, 6 terminal, 7 terminal pier, 8 tower,
 *  9 parking garage, 10 canopy, 11 service. */
export const BUILDINGS = '{bld.b64()}';
export const BUILDING_NAMES: Record<number, string> = {json.dumps(names, ensure_ascii=False)};

/** Individual trees and tree rows (decimetres): repeated [x, y]. */
export const TREES = '{trees.b64()}';

/** Forests (metres): repeated [kind 0 forest / 1 scrub, nRings, len x nRings, (x, y) x sum(len)]. */
export const FORESTS = '{forests.b64()}';

/** Roads (decimetres): repeated [class 1 motorway, 2 primary, 3 secondary, 4 tertiary, 5 residential, 6 service,
 *  7 track, 8 parking aisle, n, (x, y) x n]. */
export const ROADS = '{roads.b64()}';

/** Taxi signs [x, y, heading, size, X-Plane sign text]. */
export const SIGNS: [number, number, number, number, string][] = {json.dumps(apt['signs'])};

/** Light fixtures [x, y, type (2 PAPI-4L, 6 runway guard wig-wag), heading] (X-Plane 21). */
export const FIXTURES: [number, number, number, number][] = {json.dumps(apt['lights21'])};

/** Stands (X-Plane 1300) [name, x, y, heading true, ICAO size]. */
export const STANDS: [string, number, number, number, string][] = {json.dumps(stands)};

export const WINDSOCKS: [number, number][] = {json.dumps(apt['windsocks'])};
export const TOWER_VIEW: [number, number] = {json.dumps(apt['tower'])};
"""
    open(OUT, 'w', encoding='utf-8').write(ts)
    print(f'wrote {OUT}: {len(ts) / 1024:.0f} KB; pavements {npave}, markings {nmark}, light lines {nlight}, '
          f'buildings {nb}, trees {nt}, forests {nf}, roads {nr}', file=sys.stderr)


if __name__ == '__main__':
    main()
