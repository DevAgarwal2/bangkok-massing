import { area, centroid, perimeter, type Pt, type Poly } from './geom';
import type { Scheme } from './massing';
import type { RuleResult } from './zoning';

/**
 * An anatomy-style isometric figure: the buildable envelope drawn as a small
 * physical object on a plate, with a tick ruler, screws and a dial gauge that
 * reads FAR utilisation. Four-tone shading, painted back to front.
 */

const AZ = (45 * Math.PI) / 180;
const EL = (32 * Math.PI) / 180;

const TONE = {
  top: '#fffdf8',
  right: '#dfd1b6',
  left: '#bfae93',
  side: '#a8967a',
  ink: '#1f1d1a',
  plate: '#cabda3',
  plateEdge: '#b8a98d',
  ghost: '#b23a2b',
};

type V3 = [number, number, number];

const norm = (v: V3): V3 => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const camPos = norm([Math.cos(EL) * Math.cos(AZ), Math.sin(EL), Math.cos(EL) * Math.sin(AZ)]);
const fwd = norm([-camPos[0], -camPos[1], -camPos[2]]);
const right = norm(cross(fwd, [0, 1, 0]));
const camUp = norm(cross(right, fwd));

export const isoFigure = (plot: Poly, envelope: Poly | null, rules: RuleResult, scheme: Scheme): string => {
  const W = 392;
  const H = 292;
  const pts: Pt[] = [];

  const project = (x: number, y: number, z: number): Pt => {
    // world (x east, y up, z south) → screen
    const v: V3 = [x, y, z];
    return [dot(v, right), -dot(v, camUp)];
  };

  const [cx, cz] = centroid(plot);
  const all: Pt[] = [];
  const push = (x: number, y: number, z: number) => all.push(project(x - cx, y, z - cz));

  for (const [x, z] of plot) {
    push(x, 0, z);
    push(x, 1.2, z);
  }
  if (envelope) for (const [x, z] of envelope) { push(x, 0, z); push(x, scheme.height, z); }

  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const pad = 22;
  const k = Math.min(
    (W - pad * 2) / Math.max(1, Math.max(...xs) - Math.min(...xs)),
    (H - pad * 2 - 34) / Math.max(1, Math.max(...ys) - Math.min(...ys)),
  );
  const ox = W / 2 - ((Math.min(...xs) + Math.max(...xs)) / 2) * k;
  const oy = H / 2 + 8 - ((Math.min(...ys) + Math.max(...ys)) / 2) * k;
  const P = (x: number, y: number, z: number): Pt => {
    const [sx, sy] = project(x - cx, y, z - cz);
    return [sx * k + ox, sy * k + oy];
  };
  const path = (p: Pt[]) => p.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('') + 'Z';

  const faces: { d: string; fill: string; stroke: string; depth: number; sw: number }[] = [];

  const prism = (poly: Poly, y0: number, y1: number, fillTop: string, fillA: string, fillB: string) => {
    const n = poly.length;
    // side faces
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      const ex = b[0] - a[0];
      const ez = b[1] - a[1];
      const len = Math.hypot(ex, ez) || 1;
      const nx = -ez / len;
      const nz = ex / len;
      // outward normal of a CCW-in-screen ring; test against camera
      const facing = nx * camPos[0] + nz * camPos[2];
      if (facing <= 0.001) continue;
      const tone = facing > 0.55 ? fillA : fillB;
      const depth = (a[0] + b[0]) / 2 + (a[1] + b[1]) / 2;
      faces.push({
        d: path([P(a[0], y0, a[1]), P(b[0], y0, b[1]), P(b[0], y1, b[1]), P(a[0], y1, a[1])]),
        fill: tone,
        stroke: 'rgba(20,24,27,0.55)',
        depth: depth - 500,
        sw: 0.6,
      });
    }
    const avg = poly.reduce((s, p) => s + p[0] + p[1], 0) / n;
    faces.push({
      d: path(poly.map(([x, z]) => P(x, y1, z))),
      fill: fillTop,
      stroke: 'rgba(20,24,27,0.75)',
      depth: avg,
      sw: 0.8,
    });
  };

  // plate the plot sits on
  prism(plot, -1.4, 0, TONE.plate, TONE.plate, TONE.plateEdge);

  let envEdges = '';

  if (envelope) {
    prism(
      envelope,
      scheme.tiers[0]?.base ?? 0,
      Math.max(1.2, scheme.height * 0.995),
      'rgba(178,58,43,0.03)',
      'rgba(178,58,43,0.045)',
      'rgba(178,58,43,0.06)',
    );
    // crisp top edge so the envelope reads as a glass box
    const topPts = envelope.map(([x, z]) => P(x, Math.max(1.2, scheme.height * 0.995), z));
    const botPts = envelope.map(([x, z]) => P(x, 0, z));
    envEdges += `<path d="${path(topPts)}" fill="none" stroke="rgba(178,58,43,0.6)" stroke-width="0.8" stroke-dasharray="3 3"/>`;
    envEdges += `<path d="${path(botPts)}" fill="none" stroke="rgba(178,58,43,0.35)" stroke-width="0.7"/>`;
  }

  // massing, low tier first
  for (const t of scheme.tiers) {
    prism(t.poly, t.base, t.base + t.floors * (scheme.height / Math.max(1, scheme.floors)), TONE.top, TONE.right, TONE.left);
  }

  faces.sort((a, b) => b.depth - a.depth);
  let body = faces
    .map((f) => `<path d="${f.d}" fill="${f.fill}" stroke="${f.stroke}" stroke-width="${f.sw}" stroke-linejoin="round"/>`)
    .join('');
  body += envEdges;

  // floor lines on the tallest tier, drawn only where the face is visible
  const tall = scheme.tiers[scheme.tiers.length - 1];
  if (tall) {
    const fh = scheme.height / Math.max(1, scheme.floors);
    let lines = '';
    for (let f = 1; f < tall.floors; f++) {
      const y = tall.base + f * fh;
      const n = tall.poly.length;
      for (let i = 0; i < n; i++) {
        const a = tall.poly[i];
        const b = tall.poly[(i + 1) % n];
        const ex = b[0] - a[0];
        const ez = b[1] - a[1];
        const len = Math.hypot(ex, ez) || 1;
        const facing = (-ez / len) * camPos[0] + (ex / len) * camPos[2];
        if (facing <= 0.001) continue;
        const [p1, p2] = [P(a[0], y, a[1]), P(b[0], y, b[1])];
        lines += `<line x1="${p1[0].toFixed(1)}" y1="${p1[1].toFixed(1)}" x2="${p2[0].toFixed(1)}" y2="${p2[1].toFixed(1)}" stroke="rgba(20,24,27,${facing > 0.55 ? 0.22 : 0.3})" stroke-width="0.5"/>`;
      }
    }
    body += lines;
  }

  // plot outline, crisp
  const plotScreen = plot.map(([x, z]) => P(x, 0, z));
  body += `<path d="${path(plotScreen)}" fill="none" stroke="${TONE.ghost}" stroke-width="1.4" stroke-linejoin="round"/>`;
  for (const p of plotScreen) body += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.1" fill="${TONE.ghost}" stroke="#0d1012" stroke-width="0.8"/>`;

  // tick ruler along the longest plot edge, hanging off the plate
  const ruler = rulerOf(plot, P);
  // corner screws on the plate
  let screws = '';
  for (const p of plotScreen) {
    screws += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4.6" fill="none" stroke="rgba(31,29,26,0.18)" stroke-width="0.7"/>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}" class="iso" role="img" aria-label="Isometric diagram of the buildable envelope">
  <defs>
    <linearGradient id="figbg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f7f1e4"/><stop offset="1" stop-color="#eee6d4"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#figbg)"/>
  <g opacity="0.5">${grid(W, H)}</g>
  ${body}
  ${screws}
  ${ruler}
  ${dial(rules, scheme)}
  <text x="14" y="20" fill="#8b8478" font-family="ui-monospace, monospace" font-size="9" letter-spacing="1.4">FIG 1</text>
  <text x="52" y="20" fill="#1f1d1a" font-family="ui-monospace, monospace" font-size="9" letter-spacing="1.4">BUILDABLE ENVELOPE</text>
  <text x="14" y="${H - 12}" fill="#8b8478" font-family="ui-monospace, monospace" font-size="8" letter-spacing="0.8">PLOT ${Math.round(area(plot)).toLocaleString('en-US')} m² · PLATE ${Math.round(perimeter(plot))} m</text>
</svg>`;
};

const rulerOf = (plot: Poly, P: (x: number, y: number, z: number) => Pt): string => {
  let best = { i: 0, len: 0 };
  for (let i = 0; i < plot.length; i++) {
    const a = plot[i];
    const b = plot[(i + 1) % plot.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > best.len) best = { i, len };
  }
  const a = plot[best.i];
  const b = plot[(best.i + 1) % plot.length];
  const A = P(a[0], 0, a[1]);
  const B = P(b[0], 0, b[1]);
  const dx = B[0] - A[0];
  const dy = B[1] - A[1];
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L;
  const uy = dy / L;
  // push the ruler just outside the plate
  const [mx, mz] = [0, 0];
  const off = 13;
  const nx = uy;
  const ny = -ux;
  const s = Math.sign(nx * (mx - A[0]) + ny * (mz - A[1])) || 1;
  const ox = nx * off * s;
  const oy = ny * off * s;
  let ticks = '';
  const step = 2;
  for (let d = 0; d <= L; d += step) {
    const major = Math.round(d / step) % 5 === 0;
    const px = A[0] + ux * d + ox;
    const py = A[1] + uy * d + oy;
    ticks += `<line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${(px - uy * (major ? 5 : 2.6)).toFixed(1)}" y2="${(py + ux * (major ? 5 : 2.6)).toFixed(1)}" stroke="rgba(31,29,26,${major ? 0.55 : 0.28})" stroke-width="0.6"/>`;
  }
  return `<g>
    <line x1="${(A[0] + ox).toFixed(1)}" y1="${(A[1] + oy).toFixed(1)}" x2="${(B[0] + ox).toFixed(1)}" y2="${(B[1] + oy).toFixed(1)}" stroke="rgba(31,29,26,0.25)" stroke-width="0.6"/>
    ${ticks}
  </g>`;
};

const dial = (rules: RuleResult, scheme: Scheme): string => {
  const cx = 330;
  const cy = 208;
  const r = 24;
  const util = Math.min(1.35, scheme.far / rules.zone.far);
  const a0 = Math.PI * 1.15;
  const a1 = Math.PI * 2.85;
  const ang = a0 + (a1 - a0) * Math.min(1, util / 1.15);
  const nx = cx + Math.cos(ang) * (r - 6);
  const ny = cy + Math.sin(ang) * (r - 6);
  let ticks = '';
  for (let i = 0; i <= 10; i++) {
    const t = a0 + ((a1 - a0) * i) / 10;
    const major = i % 5 === 0;
    ticks += `<line x1="${(cx + Math.cos(t) * (r - 2)).toFixed(1)}" y1="${(cy + Math.sin(t) * (r - 2)).toFixed(1)}" x2="${(cx + Math.cos(t) * (r - (major ? 7 : 4.5))).toFixed(1)}" y2="${(cy + Math.sin(t) * (r - (major ? 7 : 4.5))).toFixed(1)}" stroke="rgba(236,229,215,${major ? 0.55 : 0.24})" stroke-width="0.7"/>`;
  }
  const arcEnd = a0 + (a1 - a0) * Math.min(1, util / 1.15);
  const large = arcEnd - a0 > Math.PI ? 1 : 0;
  return `<g>
    <circle cx="${cx}" cy="${cy}" r="${r + 5}" fill="rgba(255,253,248,0.92)" stroke="rgba(31,29,26,0.16)" stroke-width="0.8"/>
    <path d="M${cx + Math.cos(a0) * (r - 9)},${cy + Math.sin(a0) * (r - 9)} A${r - 9},${r - 9} 0 ${large} 1 ${cx + Math.cos(arcEnd) * (r - 9)},${cy + Math.sin(arcEnd) * (r - 9)}" fill="none" stroke="${util > 1 ? '#b02f1e' : '#b23a2b'}" stroke-width="2" stroke-linecap="round" opacity="0.85"/>
    ${ticks}
    <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="#1f1d1a" stroke-width="1.4" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="2.2" fill="#1f1d1a"/>
    <text x="${cx}" y="${cy + 15}" text-anchor="middle" fill="#8b8478" font-family="ui-monospace, monospace" font-size="6" letter-spacing="0.6">FAR</text>
    <text x="${cx}" y="${cy + 30}" text-anchor="middle" fill="#1f1d1a" font-family="ui-monospace, monospace" font-size="8.5">${scheme.far.toFixed(2)}</text>
  </g>`;
};

const grid = (W: number, H: number): string => {
  let s = '';
  for (let x = 0; x < W; x += 16) s += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="rgba(31,29,26,0.045)" stroke-width="0.5"/>`;
  for (let y = 0; y < H; y += 16) s += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="rgba(31,29,26,0.045)" stroke-width="0.5"/>`;
  return s;
};

export const isoPlaceholder = (): string => `<svg viewBox="0 0 392 268"><rect width="392" height="268" fill="#0d1012"/></svg>`;
