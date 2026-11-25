import { area, rectPlate, scaleToArea, type Poly } from './geom';
import type { RuleResult } from './zoning';

export type Tier = { poly: Poly; floors: number; base: number; role: string };
export type Check = { label: string; state: 'pass' | 'fail' | 'warn'; detail: string };
export type Scheme = {
  id: string;
  name: string;
  blurb: string;
  tiers: Tier[];
  gfa: number;
  far: number;
  height: number;
  footprint: number;
  checks: Check[];
  floors: number;
};

export type Program = 'condo' | 'office' | 'hotel' | 'mixed';

export const PROGRAMS: Record<Program, { label: string; floorH: number; podiumH: number; podiumFloors: number; note: string }> = {
  condo: { label: 'Condominium', floorH: 3.2, podiumH: 4.5, podiumFloors: 2, note: '2-storey podium of parking and amenities' },
  office: { label: 'Office', floorH: 4.2, podiumH: 5.0, podiumFloors: 3, note: '3-storey podium, deeper floor-to-floor' },
  hotel: { label: 'Hotel', floorH: 3.4, podiumH: 4.6, podiumFloors: 3, note: 'podium carries lobby, F&B and ballroom' },
  mixed: { label: 'Mixed use', floorH: 3.8, podiumH: 5.2, podiumFloors: 3, note: 'retail base under a residential tower' },
};

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export const buildSchemes = (env: Poly, rules: RuleResult, program: Program, targetPct = 0.96): Scheme[] => {
  const prog = PROGRAMS[program];
  const envArea = area(env);
  const targetGfa = rules.maxGfa * targetPct;
  const out: Scheme[] = [];

  // A — tower on podium
  {
    const podiumFloors = prog.podiumFloors;
    const podium = scaleToArea(env, envArea * 0.82);
    const tower = rectPlate(env, envArea * 0.36);
    const podiumGfa = area(podium) * podiumFloors;
    const rest = Math.max(targetGfa - podiumGfa, 0);
    const towerFloors = Math.max(1, Math.ceil(rest / area(tower)));
    const tiers: Tier[] = [
      { poly: podium, floors: podiumFloors, base: 0, role: 'Podium' },
      { poly: tower, floors: towerFloors, base: podiumFloors * prog.floorH, role: 'Tower' },
    ];
    out.push(finish('tower', 'Tower on podium', `${prog.note}, slender tower above`, tiers, rules, prog.floorH, envArea, targetGfa));
  }

  // B — stepped terraces (the Bangkok condo silhouette)
  {
    const ratios = [1, 0.72, 0.47];
    const plates = ratios.map((r) => scaleToArea(env, envArea * r * 0.92));
    const plateAreas = plates.map((p) => area(p));
    // Give the base most of the floors, then even out so the GFA lands on target.
    const shares = [0.42, 0.34, 0.24];
    const floors = shares.map((s, i) => Math.max(1, Math.round((targetGfa * s) / plateAreas[i])));
    // a tier can never carry more floors than the tier below it
    for (let i = 1; i < floors.length; i++) floors[i] = Math.min(floors[i], floors[i - 1]);
    let gfa = sum(floors.map((f, i) => f * plateAreas[i]));
    let guard = 0;
    // add whole floors without ever exceeding the entitlement
    while (gfa < targetGfa - 1e-6 && guard++ < 400) {
      let bestI = -1;
      let bestGain = Infinity;
      for (let k = 0; k < floors.length; k++) {
        if (k > 0 && floors[k] >= floors[k - 1]) continue;
        const plate = plateAreas[k];
        if (gfa + plate <= targetGfa + 1e-6 && plate < bestGain) {
          bestGain = plate;
          bestI = k;
        }
      }
      if (bestI < 0) break;
      floors[bestI] += 1;
      gfa += plateAreas[bestI];
    }
    let base = 0;
    const tiers: Tier[] = plates.map((p, idx) => {
      const t = { poly: p, floors: floors[idx], base, role: idx === 0 ? 'Base' : `Terrace ${idx}` };
      base += floors[idx] * prog.floorH + 0.4;
      return t;
    });
    out.push(finish('terraced', 'Stepped terraces', 'floor plate steps back as it rises; more corner units, less sheer wall', tiers, rules, prog.floorH, envArea, targetGfa));
  }

  return out;
};

const finish = (
  id: string,
  name: string,
  blurb: string,
  tiers: Tier[],
  rules: RuleResult,
  floorH: number,
  envArea: number,
  targetGfa: number,
): Scheme => {
  const gfa = sum(tiers.map((t) => area(t.poly) * t.floors));
  const top = Math.max(...tiers.map((t) => t.base + t.floors * floorH));
  const footprint = Math.max(...tiers.map((t) => area(t.poly)));
  const far = gfa / rules.plotArea;
  const heightCap = rules.zone.heightMax;

  const checks: Check[] = [
    {
      label: 'Floor area within entitlement',
      state: gfa <= rules.maxGfa + 1 ? 'pass' : 'fail',
      detail: `${fmt(gfa)} m² proposed vs ${fmt(rules.maxGfa)} m² allowed at FAR ${rules.zone.far}`,
    },
    {
      label: 'Open space kept',
      state: footprint <= rules.maxFootprintByOsr + 1 ? 'pass' : 'fail',
      detail: `largest plate ${fmt(footprint)} m² vs ${fmt(rules.maxFootprintByOsr)} m² cap from OSR ${rules.zone.osr}%`,
    },
    {
      label: 'Inside setback envelope',
      state: envArea > 0 && footprint < envArea ? 'pass' : 'fail',
      detail: `plate sits ${fmt(Math.max(0, envArea - footprint))} m² inside the buildable line`,
    },
    {
      label: 'Height',
      state: heightCap ? (top <= heightCap ? 'pass' : 'fail') : 'pass',
      detail: heightCap ? `${top.toFixed(0)} m vs ${heightCap} m zone cap` : `${top.toFixed(0)} m — no zone height cap, FAR is the binding limit`,
    },
    {
      label: 'Floor areas add up',
      state: 'pass',
      detail: tiers.map((t) => `${t.floors}×${fmt(area(t.poly))}`).join(' + ') + ` = ${fmt(gfa)} m²`,
    },
  ];

  if (Math.abs(gfa - targetGfa) / Math.max(targetGfa, 1) > 0.12) {
    checks.push({
      label: 'Plate efficiency',
      state: 'warn',
      detail: `rounding to whole floors lands ${((gfa / targetGfa - 1) * 100).toFixed(0)}% off the ${fmt(targetGfa)} m² target`,
    });
  }

  return {
    id,
    name,
    blurb,
    tiers,
    gfa,
    far,
    height: top,
    footprint,
    checks,
    floors: sum(tiers.map((t) => t.floors)),
  };
};

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export const schemeSummary = (s: Scheme) => `${s.floors} floors · ${fmt(s.gfa)} m² · FAR ${s.far.toFixed(2)}`;
