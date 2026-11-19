// Puffin Vice 3D — the road network: Vice Palms' streets as a graph of
// polylines instead of a grid. Seven avenues radiate from a plaza ring,
// three concentric ring roads (plaza / inner / outer) circle the centre,
// two diagonal avenues cut across blocks, and a curved boulevard follows
// the shoreline. Traffic, pedestrians, police spawns, building placement
// and the minimap all read this one structure.
//
// A segment is { pts, cum, len, kind, nodeA, nodeB }: a polyline with
// cumulative lengths. A node is { x, z, links: [{ seg, end }] } where end
// 0 is the segment's first point (s = 0) and end 1 its last (s = len).
// Segments that share an endpoint coordinate share a node, so the graph
// is connected wherever the streets visually meet.

import { RING_RADII, RADIAL_ANGLES, RADIAL_END, boulevardX, polar } from './config.js';

const EAST_RADIALS = [-15, 30];   // avenues that run out to the boulevard

function buildNetwork() {
  const nodes = [];
  const nodeByKey = new Map();
  const segments = [];

  const nodeAt = (x, z) => {
    const key = Math.round(x * 100) + ',' + Math.round(z * 100);
    let n = nodeByKey.get(key);
    if (!n) {
      n = { x, z, links: [] };
      nodeByKey.set(key, n);
      nodes.push(n);
    }
    return n;
  };

  const addSegment = (rawPts, kind, meta = {}) => {
    const pts = [];
    for (const p of rawPts) {
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.z - last.z) > 0.01) pts.push({ x: p.x, z: p.z });
    }
    if (pts.length < 2) return null;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    }
    const seg = {
      id: segments.length, pts, cum, len: cum[cum.length - 1], kind, ...meta,
      nodeA: nodeAt(pts[0].x, pts[0].z),
      nodeB: nodeAt(pts[pts.length - 1].x, pts[pts.length - 1].z),
    };
    seg.nodeA.links.push({ seg, end: 0 });
    seg.nodeB.links.push({ seg, end: 1 });
    segments.push(seg);
    return seg;
  };

  // The boulevard's vertices first: the two east avenues end exactly on
  // one of them, so those vertices become shared junction nodes.
  const blvdPts = [];
  for (let z = -200; z <= 200; z += 10) blvdPts.push({ x: boulevardX(z), z });
  const distToBlvd = (x, z) => {
    let best = Infinity;
    for (let i = 1; i < blvdPts.length; i++) {
      best = Math.min(best, pointSegDist(x, z, blvdPts[i - 1], blvdPts[i]));
    }
    return best;
  };
  const blvdJunctionIndex = new Map(); // radial angle -> vertex index
  for (const deg of EAST_RADIALS) {
    let r = RING_RADII[2];
    let p = polar(r, deg);
    while (r < 280 && distToBlvd(p.x, p.z) > 7) { r += 3; p = polar(r, deg); }
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < blvdPts.length; i++) {
      const d = Math.hypot(blvdPts[i].x - p.x, blvdPts[i].z - p.z);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    blvdJunctionIndex.set(deg, bestI);
  }

  // Ring roads: one arc segment between each pair of neighbouring avenues,
  // so every arc endpoint is a junction the avenues also touch.
  const sorted = [...RADIAL_ANGLES].sort((a, b) => a - b);
  for (const radius of RING_RADII) {
    for (let i = 0; i < sorted.length; i++) {
      const a0 = sorted[i];
      const a1 = sorted[(i + 1) % sorted.length] + (i === sorted.length - 1 ? 360 : 0);
      const pts = [];
      const steps = Math.max(2, Math.ceil((a1 - a0) / 5));
      for (let s = 0; s <= steps; s++) pts.push(polar(radius, a0 + ((a1 - a0) * s) / steps));
      addSegment(pts, 'ring', { radius });
    }
  }

  // Avenues: plaza ring -> inner ring -> outer ring -> end. Landward
  // avenues end at a roundabout; the two east avenues run on to the
  // boulevard junction vertex found above.
  for (const deg of RADIAL_ANGLES) {
    const stops = [RING_RADII[0], RING_RADII[1], RING_RADII[2]];
    for (let s = 0; s < stops.length - 1; s++) {
      addSegment([polar(stops[s], deg), polar(stops[s + 1], deg)], 'radial', { angle: deg });
    }
    if (blvdJunctionIndex.has(deg)) {
      const j = blvdPts[blvdJunctionIndex.get(deg)];
      const mid = polar((RING_RADII[2] + Math.hypot(j.x, j.z)) / 2, deg);
      addSegment([polar(RING_RADII[2], deg), mid, { x: j.x, z: j.z }], 'radial', { angle: deg });
    } else {
      addSegment([polar(RING_RADII[2], deg), polar(RADIAL_END, deg)], 'radial', { angle: deg });
    }
  }

  // The boulevard itself, split where the east avenues land on it.
  const splits = [...blvdJunctionIndex.values()].sort((a, b) => a - b);
  const cuts = [0, ...splits, blvdPts.length - 1];
  for (let i = 0; i < cuts.length - 1; i++) {
    addSegment(blvdPts.slice(cuts[i], cuts[i + 1] + 1), 'blvd', {});
  }

  // Two diagonal avenues cutting across blocks between ring junctions.
  addSegment([polar(RING_RADII[1], 80), polar(RING_RADII[2], 130)], 'diag', {});
  addSegment([polar(RING_RADII[2], -105), polar(RING_RADII[1], -160)], 'diag', {});

  // Dead ends (avenue roundabouts + the boulevard's two tips).
  const deadEnds = nodes.filter((n) => n.links.length === 1);

  return { segments, nodes, deadEnds };
}

function pointSegDist(px, pz, a, b) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const l2 = abx * abx + abz * abz;
  let t = l2 > 0 ? ((px - a.x) * abx + (pz - a.z) * abz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (a.x + abx * t);
  const dz = pz - (a.z + abz * t);
  return Math.hypot(dx, dz);
}

export const NETWORK = buildNetwork();

// Point and travel tangent at arc distance s along a segment.
export function pointAt(seg, s) {
  const cs = Math.max(0, Math.min(seg.len, s));
  const cum = seg.cum;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < cs) i++;
  const span = cum[i] - cum[i - 1] || 1;
  const t = (cs - cum[i - 1]) / span;
  const a = seg.pts[i - 1];
  const b = seg.pts[i];
  const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    tx: (b.x - a.x) / tl,
    tz: (b.z - a.z) / tl,
  };
}

// The segment end a traveller leaves by when heading in direction dir
// (dir +1 travels toward s = len, i.e. nodeB; -1 toward nodeA).
export function exitNode(seg, dir) {
  return dir > 0 ? seg.nodeB : seg.nodeA;
}

// Nearest point on the whole network to (x, z): how far the point is from
// the nearest road centre line, and that road's tangent there.
export function distanceToRoad(x, z) {
  let best = Infinity;
  let btx = 1;
  let btz = 0;
  let bseg = null;
  for (const seg of NETWORK.segments) {
    for (let i = 1; i < seg.pts.length; i++) {
      const a = seg.pts[i - 1];
      const b = seg.pts[i];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const l2 = abx * abx + abz * abz;
      let t = l2 > 0 ? ((x - a.x) * abx + (z - a.z) * abz) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const dx = x - (a.x + abx * t);
      const dz = z - (a.z + abz * t);
      const d = Math.hypot(dx, dz);
      if (d < best) {
        best = d;
        const tl = Math.sqrt(l2) || 1;
        btx = abx / tl;
        btz = abz / tl;
        bseg = seg;
      }
    }
  }
  return { dist: best, tx: btx, tz: btz, seg: bseg, angle: Math.atan2(btx, btz) };
}

// A random point on a random road (length-weighted), for spawns.
export function randomRoadPoint(rng) {
  const segs = NETWORK.segments;
  let total = 0;
  for (const s of segs) total += s.len;
  let pick = rng.range(0, total);
  let seg = segs[segs.length - 1];
  for (const s of segs) {
    pick -= s.len;
    if (pick <= 0) { seg = s; break; }
  }
  const s = rng.range(0, seg.len);
  return { seg, s, ...pointAt(seg, s) };
}

// Find the avenue segment for an angle whose span covers radius r
// (used to pose traffic on a chosen avenue in the screenshot scenes).
export function radialSegmentAt(angleDeg, r) {
  for (const seg of NETWORK.segments) {
    if (seg.kind !== 'radial' || seg.angle !== angleDeg) continue;
    const a = seg.pts[0];
    const b = seg.pts[seg.pts.length - 1];
    const ra = Math.hypot(a.x, a.z);
    const rb = Math.hypot(b.x, b.z);
    if (r >= Math.min(ra, rb) - 0.5 && r <= Math.max(ra, rb) + 0.5) return seg;
  }
  return null;
}

// Arc distance along an avenue segment for a given radius (avenues are
// straight, so this is just the difference in radii along the segment).
export function radialSAt(seg, r) {
  const a = seg.pts[0];
  return Math.max(0, Math.min(seg.len, r - Math.hypot(a.x, a.z)));
}
