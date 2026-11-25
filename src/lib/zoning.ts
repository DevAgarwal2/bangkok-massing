/**
 * Bangkok Comprehensive Plan B.E. 2556 (2013) — the plan still in force on
 * 2026-11-25 while the 4th revision sits in its 90-day public display.
 *
 * FAR = total floor area / plot area.
 * OSR = uncovered open space / total floor area (a ratio to GFA, not to land).
 *
 * Values transcribed from the Ministerial Regulation table published by BMA
 * (webportal.bangkok.go.th .../2556/1/06_cpd56.pdf) and cross-checked against
 * two secondary summaries.
 */
export type Zone = {
  code: string;
  group: 'residential' | 'commercial' | 'industrial' | 'rural' | 'institution';
  label: string;
  far: number;
  osr: number; // percent of GFA
  heightMax: number | null; // metres, where the plan sets one
  note?: string;
};

export const ZONES: Zone[] = [
  { code: 'ย.1', group: 'residential', label: 'Low-density residential, outer', far: 1, osr: 40, heightMax: 12 },
  { code: 'ย.2', group: 'residential', label: 'Low-density residential', far: 1.5, osr: 20, heightMax: 12 },
  { code: 'ย.3', group: 'residential', label: 'Low-density residential, inner suburb', far: 2.5, osr: 12.5, heightMax: null },
  { code: 'ย.4', group: 'residential', label: 'Low-density residential, near transit', far: 3, osr: 10, heightMax: null },
  { code: 'ย.5', group: 'residential', label: 'Medium-density residential', far: 4, osr: 7.5, heightMax: null },
  { code: 'ย.6', group: 'residential', label: 'Medium-density residential', far: 4.5, osr: 6.5, heightMax: null },
  { code: 'ย.7', group: 'residential', label: 'Medium-density residential', far: 5, osr: 6, heightMax: null },
  { code: 'ย.8', group: 'residential', label: 'High-density residential, inner city', far: 6, osr: 5, heightMax: null },
  { code: 'ย.9', group: 'residential', label: 'High-density residential, inner city', far: 7, osr: 4.5, heightMax: null },
  { code: 'ย.10', group: 'residential', label: 'High-density residential, inner city', far: 8, osr: 4, heightMax: null },
  { code: 'พ.1', group: 'commercial', label: 'Commercial, conservation area', far: 5, osr: 6, heightMax: null },
  { code: 'พ.2', group: 'commercial', label: 'Commercial, arts & culture', far: 6, osr: 5, heightMax: null },
  { code: 'พ.3', group: 'commercial', label: 'Commercial centre of the city', far: 7, osr: 4.5, heightMax: null },
  { code: 'พ.4', group: 'commercial', label: 'Secondary commercial centre', far: 8, osr: 4, heightMax: null },
  { code: 'พ.5', group: 'commercial', label: 'Primary commercial centre', far: 10, osr: 3, heightMax: null },
  { code: 'อ.1', group: 'industrial', label: 'Industry and warehouse', far: 2, osr: 15, heightMax: 12 },
  { code: 'อ.2', group: 'industrial', label: 'Industry and warehouse', far: 1.5, osr: 20, heightMax: 12 },
  { code: 'อ.3', group: 'industrial', label: 'Industry and warehouse', far: 1, osr: 40, heightMax: 12 },
  { code: 'ศ.1', group: 'institution', label: 'Institutional / government', far: 3, osr: 10, heightMax: null },
  { code: 'ศ.2', group: 'institution', label: 'Institutional / utility', far: 4, osr: 7.5, heightMax: null },
];

export const zoneOf = (code: string): Zone => ZONES.find((z) => z.code === code) ?? ZONES[12];

/**
 * Setbacks. The 2556 plan sets them explicitly only for zones with a height
 * cap (ย.1, ย.2: 2 m front and rear, 2 m side; 1 m side where the plot is
 * narrow). Everywhere else the constraint comes from the Building Control Act
 * and its ministerial regulations, which scale with building height and road
 * width. We model that with two documented approximations, both editable in
 * the UI so a user can see what a stricter rule would do.
 */
export type Setbacks = { front: number; side: number; rear: number };

export const setbacksFor = (height: number, roadW: number, planHint: boolean): Setbacks => {
  if (planHint) return { front: 2, side: 2, rear: 2 };
  // Commercial zones read at 3 m; the height-capped residential zones at 2 m.
  // Kept independent of the modelled height on purpose: a setback that chases
  // the height that chases the setback never settles.
  const side = 3;
  // Front: roughly a third of the right-of-way, never below 2 m and never above 8 m.
  const front = Math.min(8, Math.max(2, Math.round(roadW * 0.35 * 10) / 10));
  return { front, side, rear: side };
};

export type RuleRow = {
  key: string;
  label: string;
  value: string;
  detail: string;
  state: 'pass' | 'fail' | 'info';
};

export type RuleResult = {
  plotArea: number;
  maxGfa: number;
  minOpen: number;
  maxFootprintByOsr: number;
  envelopeArea: number;
  setbacks: Setbacks;
  zone: Zone;
  rows: RuleRow[];
};

export const computeRules = (
  plotArea: number,
  zone: Zone,
  roadW: number,
  envelopeArea: number,
  planHint: boolean,
  heightUsed: number | null,
): RuleResult => {
  const maxGfa = plotArea * zone.far;
  const minOpen = maxGfa * (zone.osr / 100);
  const maxFootprintByOsr = Math.max(0, plotArea - minOpen);
  const setbacks = setbacksFor(heightUsed ?? 30, roadW, planHint);

  const rows: RuleRow[] = [
    {
      key: 'far',
      label: 'Floor area ratio',
      value: `≤ ${zone.far.toFixed(1)} : 1`,
      detail: `${fmt(plotArea)} m² plot → ${fmt(maxGfa)} m² of floor area, all floors, all buildings`,
      state: 'info',
    },
    {
      key: 'osr',
      label: 'Open space ratio',
      value: `≥ ${zone.osr}%`,
      detail: `${fmt(minOpen)} m² must stay uncovered → footprint capped at ${fmt(maxFootprintByOsr)} m²`,
      state: 'info',
    },
    {
      key: 'setback',
      label: 'Setbacks',
      value: `${setbacks.front} / ${setbacks.side} m`,
      detail: `front ${setbacks.front} m from the ${roadW} m road, sides and rear ${setbacks.side} m`,
      state: 'info',
    },
    {
      key: 'height',
      label: 'Height',
      value: zone.heightMax ? `≤ ${zone.heightMax} m` : 'not capped by zone',
      detail: zone.heightMax
        ? 'the plan sets a hard height limit in this zone'
        : 'height emerges from FAR and the floor plate, not from a zone number',
      state: 'info',
    },
    {
      key: 'envelope',
      label: 'Buildable footprint',
      value: `${fmt(envelopeArea)} m²`,
      detail: `${((envelopeArea / plotArea) * 100).toFixed(0)}% of the plot survives setbacks`,
      state: 'info',
    },
  ];

  return { plotArea, maxGfa, minOpen, maxFootprintByOsr, envelopeArea, setbacks, zone, rows };
};

export const fmt = (n: number, d = 0): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
