export type Pt = [number, number]; // [x (east, m), z (south, m)]
export type Poly = Pt[];

export const area = (p: Poly): number => {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, z1] = p[i];
    const [x2, z2] = p[(i + 1) % p.length];
    s += x1 * z2 - x2 * z1;
  }
  return Math.abs(s) / 2;
};

export const signedArea = (p: Poly): number => {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, z1] = p[i];
    const [x2, z2] = p[(i + 1) % p.length];
    s += x1 * z2 - x2 * z1;
  }
  return s / 2;
};

export const centroid = (p: Poly): Pt => {
  const a = signedArea(p);
  if (Math.abs(a) < 1e-9) return [p[0][0], p[0][1]];
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, z1] = p[i];
    const [x2, z2] = p[(i + 1) % p.length];
    const f = x1 * z2 - x2 * z1;
    cx += (x1 + x2) * f;
    cz += (z1 + z2) * f;
  }
  return [cx / (6 * a), cz / (6 * a)];
};

export const perimeter = (p: Poly): number => {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, z1] = p[i];
    const [x2, z2] = p[(i + 1) % p.length];
    s += Math.hypot(x2 - x1, z2 - z1);
  }
  return s;
};

/** Bounding-box short side, a fair proxy for how wide a floor plate can get. */
export const shortSide = (p: Poly): number => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of p) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  return Math.min(maxX - minX, maxZ - minZ);
};

export const pointInPoly = (x: number, z: number, p: Poly): boolean => {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i];
    const [xj, zj] = p[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

/** Scale a polygon about its centroid so its area becomes targetArea. */
export const scaleToArea = (p: Poly, targetArea: number): Poly => {
  const a = area(p);
  if (a <= 0) return p;
  const s = Math.sqrt(Math.max(targetArea, 0) / a);
  const [cx, cz] = centroid(p);
  return p.map(([x, z]) => [cx + (x - cx) * s, cz + (z - cz) * s] as Pt);
};

/** Uniform inset. Negative distances grow the polygon. */
export const inset = (p: Poly, d: number): Poly => offsetEdges(p, () => d);

export const offsetEdges = (poly: Poly, distOf: (i: number, p: Poly) => number): Poly => {
  const p = signedArea(poly) > 0 ? poly : [...poly].reverse();
  const n = p.length;
  const lines: { px: number; pz: number; dx: number; dz: number }[] = [];
  for (let i = 0; i < n; i++) {
    const [x1, z1] = p[i];
    const [x2, z2] = p[(i + 1) % n];
    let dx = x2 - x1;
    let dz = z2 - z1;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const d = distOf(i, p);
    // inward normal for a CCW ring in (x, z)
    const nx = -dz;
    const nz = dx;
    lines.push({ px: x1 + nx * d, pz: z1 + nz * d, dx, dz });
  }
  const out: Poly = [];
  for (let i = 0; i < n; i++) {
    const a = lines[(i - 1 + n) % n];
    const b = lines[i];
    const den = a.dx * b.dz - a.dz * b.dx;
    if (Math.abs(den) < 1e-7) {
      out.push([b.px, b.pz]);
      continue;
    }
    const t = ((b.px - a.px) * b.dz - (b.pz - a.pz) * b.dx) / den;
    out.push([a.px + a.dx * t, a.pz + a.dz * t]);
  }
  return out;
};

/** Does the ring self-intersect or collapse? Used to reject bad insets. */
export const isHealthy = (p: Poly): boolean => {
  if (p.length < 3) return false;
  if (!p.every(([x, z]) => Number.isFinite(x) && Number.isFinite(z))) return false;
  if (area(p) < 1) return false;
  for (let i = 0; i < p.length; i++) {
    const a1 = p[i];
    const a2 = p[(i + 1) % p.length];
    for (let j = i + 1; j < p.length; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === p.length - 1)) continue;
      const b1 = p[j];
      const b2 = p[(j + 1) % p.length];
      if (segIntersect(a1, a2, b1, b2)) return false;
    }
  }
  return true;
};

const segIntersect = (a: Pt, b: Pt, c: Pt, d: Pt): boolean => {
  const o = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(a, b, c);
  const d2 = o(a, b, d);
  const d3 = o(c, d, a);
  const d4 = o(c, d, b);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
};

/** Safe inset: falls back to a uniform inset, then to a scale-down, then null. */
export const safeInset = (p: Poly, distOf: (i: number, p: Poly) => number, minD: number): Poly | null => {
  const tries = [
    () => offsetEdges(p, distOf),
    () => inset(p, minD),
    () => scaleToArea(p, area(p) * 0.55),
  ];
  for (const t of tries) {
    const r = t();
    if (isHealthy(r)) return r;
  }
  return null;
};

export const nearestRoad = <T extends { p: Pt[]; name?: string | null; kind?: string }>(
  roads: T[],
  at: Pt,
): { road: T; dist: number; index: number } | null => {
  let best: { road: T; dist: number; index: number } | null = null;
  for (const road of roads) {
    for (let i = 0; i < road.p.length - 1; i++) {
      const d = distToSegment(at, road.p[i], road.p[i + 1]);
      if (!best || d < best.dist) best = { road, dist: d, index: i };
    }
  }
  return best;
};

export const distToSegment = (p: Pt, a: Pt, b: Pt): number => {
  const vx = b[0] - a[0];
  const vz = b[1] - a[1];
  const wx = p[0] - a[0];
  const wz = p[1] - a[1];
  const L2 = vx * vx + vz * vz;
  const t = L2 ? Math.max(0, Math.min(1, (wx * vx + wz * vz) / L2)) : 0;
  return Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vz * t));
};

export const roadWidth = (kind?: string): number => {
  switch (kind) {
    case 'motorway':
    case 'trunk':
    case 'primary': return 22;
    case 'secondary': return 16;
    case 'tertiary': return 12;
    case 'residential': return 8;
    case 'service': return 6;
    case 'footway':
    case 'path':
    case 'steps': return 3;
    default: return 6;
  }
};

/** Convex hull (monotone chain). */
export const hull = (p: Poly): Poly => {
  const pts = [...p].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const crossZ = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Poly = [];
  for (const q of pts) {
    while (lower.length >= 2 && crossZ(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Poly = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const q = pts[i];
    while (upper.length >= 2 && crossZ(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
};

/**
 * Minimum-area bounding rectangle, rotating calipers over the hull.
 * A structural grid wants a rectangle, so tower plates come from this shape.
 */
export const minAreaRect = (poly: Poly): Poly => {
  const h = hull(poly);
  let best = { a: 0, rect: poly };
  for (let i = 0; i < h.length; i++) {
    const a = h[i];
    const b = h[(i + 1) % h.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const ca = Math.cos(-ang);
    const sa = Math.sin(-ang);
    const rot = h.map(([x, z]) => [x * ca - z * sa, x * sa + z * ca] as Pt);
    const xs = rot.map((q) => q[0]);
    const zs = rot.map((q) => q[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const d = Math.max(...zs) - Math.min(...zs);
    if (w * d > best.a) {
      const ca2 = Math.cos(ang);
      const sa2 = Math.sin(ang);
      const x0 = Math.min(...xs);
      const z0 = Math.min(...zs);
      const corners: Poly = [
        [x0, z0],
        [x0 + w, z0],
        [x0 + w, z0 + d],
        [x0, z0 + d],
      ];
      best = {
        a: w * d,
        rect: corners.map(([x, z]) => [x * ca2 - z * sa2, x * sa2 + z * ca2] as Pt),
      };
    }
  }
  return best.rect;
};

/** A rectangular floor plate of a given area, centred in the polygon. */
export const rectPlate = (poly: Poly, targetArea: number): Poly => {
  const r = minAreaRect(poly);
  return scaleToArea(r, targetArea);
};

/** Scale about the centroid by a factor. */
export const scaled = (p: Poly, f: number): Poly => {
  const [cx, cz] = centroid(p);
  return p.map(([x, z]) => [cx + (x - cx) * f, cz + (z - cz) * f] as Pt);
};

/** Grow a ring outward by d metres, falling back to a proportional scale. */
export const grow = (p: Poly, d: number): Poly => {
  const r = inset(p, -d);
  if (isHealthy(r)) return r;
  return scaled(p, 1 + (2 * d) / Math.max(1, Math.sqrt(area(p))));
};
