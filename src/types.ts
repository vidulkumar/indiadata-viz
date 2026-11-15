export type BoundaryLevel = 'district' | 'constituency' | 'assembly' | 'ward';

export type MetricKey =
  | 'population_density'
  | 'population'
  | 'literacy_rate'
  | 'sex_ratio'
  | 'green_cover_pct'
  | 'hospitals_count'
  | 'schools_count'
  | 'avg_circle_rate'
  | 'aqi_pm25';

export type AqiDisplayMode = 'stations' | 'blended' | 'both';

export type FocusHubKey =
  | 'current'
  | 'all'
  | 'dl-nct'
  | 'hr-fbd'
  | 'hr-ggn'
  | 'up-gbn'
  | 'up-gzb'
  | 'hr-snp'
  | 'hr-jjr';

export interface Region {
  id?: number;
  code: string;
  name: string;
  state: string;
  parent_region?: string;
  district_name?: string;
  pc_name?: string;
  ac_no?: number;
  ward_no?: string;
  ulb_name?: string;
  level: BoundaryLevel;
  area_sq_km?: number;
  population: number;
  population_density: number;
  density: number;
  literacy_rate: number;
  sex_ratio: number;
  green_cover_pct: number;
  hospitals_count: number;
  schools_count: number;
  avg_circle_rate: number;
  aqi_pm25: number | null;
  rep_name?: string | null;
  rep_role?: string | null;
  rep_party?: string | null;
  rep_term?: string | null;
  rep_votes?: number | null;
  rep_source_label?: string | null;
  rep_source_url?: string | null;
  rep_affidavit_url?: string | null;
  boundary_source_label?: string | null;
  boundary_source_url?: string | null;
  data_source_label?: string | null;
  data_source_url?: string | null;
  center?: [number, number];
  geojson?: Record<string, unknown> | null;
  customMetricValue?: number;
}

export interface Insight {
  id: number;
  slug?: string;
  region_code: string;
  title: string;
  summary: string;
  author: string;
  boundary_level?: BoundaryLevel;
  metric?: string;
  center_lng?: number;
  center_lat?: number;
  zoom?: number;
  layers_json?: unknown;
  views_count?: number;
  downloads_count?: number;
  created_at: string;
}

export interface AqiStation {
  station: string;
  city: string;
  state?: string;
  lat: number;
  lon: number;
  pm25: number;
  pm10: number;
  no2?: number;
  updated: string;
  date?: string;
}

export interface InfraPoint {
  id: string;
  name: string;
  category: 'Metro Interchange' | 'Government Hospital' | 'Private Hospital' | 'EV Hub';
  city: string;
  lat: number;
  lon: number;
  details: string;
}

export interface CustomLayer {
  id: string;
  slug?: string;
  name: string;
  type: 'point' | 'choropleth';
  boundaryLevel?: BoundaryLevel;
  category?: string;
  unit?: string;
  publisher?: string;
  sourceUrl?: string;
  license?: string;
  color: string;
  visible: boolean;
  opacity?: number;
  featureCount: number;
  metricLabel?: string;
  availableDates?: string[];
  activeDate?: string;
  compareDate?: string;
  showDelta?: boolean;
  choroplethByDate?: Record<string, Record<string, number>>;
  pointsByDate?: Record<string, Array<Record<string, unknown>>>;
  geojson: {
    type: 'FeatureCollection';
    features: Array<Record<string, unknown>>;
  };
  rawRows?: Array<Record<string, unknown>>;
}

export interface CommunityCatalogLayer {
  id: number;
  slug: string;
  name: string;
  layer_type: 'point' | 'choropleth';
  boundary_level: BoundaryLevel | null;
  category: string;
  metric_label: string;
  unit: string;
  publisher: string;
  source_url: string;
  license: string;
  color: string;
  feature_count: number;
  available_dates: string[];
  choropleth_by_date: Record<string, Record<string, number>>;
  points_by_date: Record<string, Array<Record<string, unknown>>>;
  created_at: string;
}

export interface MetricConfig {
  key: MetricKey;
  label: string;
  unit: string;
  stops: [number, string][];
}

// Scientific Viridis Teal-to-Amber 5-stop ramp
export const VIRIDIS_TEAL_AMBER: [string, string, string, string, string] = [
  '#0c3b4e',
  '#117864',
  '#2ecc71',
  '#f4d03f',
  '#f39c12',
];

export const METRIC_CONFIGS: Record<MetricKey, MetricConfig> = {
  population_density: {
    key: 'population_density',
    label: 'Population Density (/km²)',
    unit: '/km²',
    stops: [
      [600, VIRIDIS_TEAL_AMBER[0]],
      [2500, VIRIDIS_TEAL_AMBER[1]],
      [8500, VIRIDIS_TEAL_AMBER[2]],
      [18000, VIRIDIS_TEAL_AMBER[3]],
      [32000, VIRIDIS_TEAL_AMBER[4]],
    ],
  },
  population: {
    key: 'population',
    label: 'Total Population',
    unit: 'residents',
    stops: [
      [35000, VIRIDIS_TEAL_AMBER[0]],
      [180000, VIRIDIS_TEAL_AMBER[1]],
      [650000, VIRIDIS_TEAL_AMBER[2]],
      [2500000, VIRIDIS_TEAL_AMBER[3]],
      [12000000, VIRIDIS_TEAL_AMBER[4]],
    ],
  },
  literacy_rate: {
    key: 'literacy_rate',
    label: 'Literacy Rate (%)',
    unit: '%',
    stops: [
      [74, VIRIDIS_TEAL_AMBER[0]],
      [79, VIRIDIS_TEAL_AMBER[1]],
      [84, VIRIDIS_TEAL_AMBER[2]],
      [88, VIRIDIS_TEAL_AMBER[3]],
      [93, VIRIDIS_TEAL_AMBER[4]],
    ],
  },
  sex_ratio: {
    key: 'sex_ratio',
    label: 'Sex Ratio (per 1,000 M)',
    unit: 'F/1000M',
    stops: [
      [845, VIRIDIS_TEAL_AMBER[0]],
      [860, VIRIDIS_TEAL_AMBER[1]],
      [875, VIRIDIS_TEAL_AMBER[2]],
      [890, VIRIDIS_TEAL_AMBER[3]],
      [910, VIRIDIS_TEAL_AMBER[4]],
    ],
  },
  green_cover_pct: {
    key: 'green_cover_pct',
    label: 'Green Cover (%)',
    unit: '%',
    stops: [
      [10, VIRIDIS_TEAL_AMBER[0]],
      [14, VIRIDIS_TEAL_AMBER[1]],
      [19, VIRIDIS_TEAL_AMBER[2]],
      [25, VIRIDIS_TEAL_AMBER[3]],
      [32, VIRIDIS_TEAL_AMBER[4]],
    ],
  },
  hospitals_count: {
    key: 'hospitals_count',
    label: 'Hospitals & Clinics',
    unit: 'facilities',
    stops: [
      [2, VIRIDIS_TEAL_AMBER[0]],
      [8, VIRIDIS_TEAL_AMBER[1]],
      [18, VIRIDIS_TEAL_AMBER[2]],
      [35, VIRIDIS_TEAL_AMBER[3]],
      [80, VIRIDIS_TEAL_AMBER[4]],
    ],
  },
  schools_count: {
    key: 'schools_count',
    label: 'Schools (UDISE+)',
    unit: 'schools',
    stops: [
      [10, VIRIDIS_TEAL_AMBER[0]],
      [75, VIRIDIS_TEAL_AMBER[1]],
      [350, VIRIDIS_TEAL_AMBER[2]],
      [1200, VIRIDIS_TEAL_AMBER[3]],
      [4500, VIRIDIS_TEAL_AMBER[4]],
    ],
  },
  avg_circle_rate: {
    key: 'avg_circle_rate',
    label: 'Avg Circle Rate (₹/sq.ft)',
    unit: '₹/sq.ft',
    stops: [
      [5500, VIRIDIS_TEAL_AMBER[0]],
      [9500, VIRIDIS_TEAL_AMBER[1]],
      [14500, VIRIDIS_TEAL_AMBER[2]],
      [21000, VIRIDIS_TEAL_AMBER[3]],
      [28500, VIRIDIS_TEAL_AMBER[4]],
    ],
  },
  aqi_pm25: {
    key: 'aqi_pm25',
    label: 'Air Quality Index (PM2.5)',
    unit: 'µg/m³',
    stops: [
      [120, '#22c55e'],
      [180, '#84cc16'],
      [230, '#eab308'],
      [280, '#f97316'],
      [330, '#ef4444'],
    ],
  },
};

const ALIAS_MAP: Record<string, string> = {
  gurgaon: 'gurugram',
  'g b nagar': 'gautam buddha nagar noida',
  'gb nagar': 'gautam buddha nagar noida',
  'gautam budh nagar': 'gautam buddha nagar noida',
  'gautam buddha nagar': 'gautam buddha nagar noida',
  noida: 'gautam buddha nagar noida',
  delhi: 'nct of delhi',
  'new delhi district': 'nct of delhi',
  sonepat: 'sonipat',
  nerela: 'narela',
  rkpuram: 'r k puram',
  'rk puram': 'r k puram',
  seelampur: 'seelam pur',
  modinagar: 'modi nagar',
  sultanpurmajra: 'sultan pur majra',
  mangolpuri: 'mangol puri',
  ambedkarnagar: 'ambedkar nagar',
};

export function sanitizeText(input: unknown, maxLen = 200): string {
  const raw = String(input ?? '')
    .replace(/<[^>]*>/g, '') // Strip HTML/script tags
    .replace(/[\u0000-\u001F\u007F]/g, ' ') // Strip control chars
    .replace(/^[=+\-@\t\r]+/, '') // Strip CSV/Excel formula injection prefixes
    .trim();
  return raw.slice(0, maxLen);
}

export function sanitizeUrl(input: unknown): string {
  const s = String(input ?? '').trim();
  if (/^https?:\/\/[^\s<>"]+$/i.test(s)) return s;
  return 'https://data.gov.in';
}

export function isValidIndiaCoord(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= 6 && lat <= 38 && lon >= 68 && lon <= 98;
}

export function normalizeAreaString(str: string): string {
  const stripped = String(str || '')
    .toLowerCase()
    .replace(/\((sc|st|w|gen)\)/gi, ' ')
    .replace(/\b(ac|pc|mcd|mcg|mcf|gmc|ulb|constituency|district)\b/gi, ' ')
    .replace(/\./g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (ALIAS_MAP[stripped]) return ALIAS_MAP[stripped];
  const noSpace = stripped.replace(/\s+/g, '');
  if (ALIAS_MAP[noSpace]) return ALIAS_MAP[noSpace];
  return stripped;
}

export function fuzzyMatchRegion(
  inputName: string,
  regions: Region[],
  stateOrCityHint?: string
): Region | null {
  if (!inputName) return null;
  const norm = normalizeAreaString(inputName);
  if (!norm) return null;
  const noSpaceNorm = norm.replace(/\s+/g, '');
  const hintNorm = stateOrCityHint ? normalizeAreaString(stateOrCityHint) : '';

  const candidates = hintNorm
    ? regions.filter(
        (r) =>
          normalizeAreaString(r.state).includes(hintNorm) ||
          normalizeAreaString(r.parent_region || '').includes(hintNorm) ||
          normalizeAreaString(r.district_name || '').includes(hintNorm)
      )
    : regions;

  const pool = candidates.length > 0 ? candidates : regions;

  // 1. Exact normalized name or code match
  for (const r of pool) {
    const rNorm = normalizeAreaString(r.name);
    const rNoSpace = rNorm.replace(/\s+/g, '');
    const cNorm = normalizeAreaString(r.code);
    if (rNorm === norm || rNoSpace === noSpaceNorm || cNorm === norm) {
      return r;
    }
  }

  // 2. Ward number pattern match (e.g. "Ward 80" or "Delhi Ward 80")
  const wardMatch = norm.match(/\bward\s*(\d+[a-z]?)\b/i);
  if (wardMatch) {
    const targetNo = wardMatch[1].toLowerCase();
    for (const r of pool) {
      if (String(r.ward_no || '').toLowerCase() === targetNo) return r;
    }
  }

  // 3. Substring / token overlap match
  for (const r of pool) {
    const rNorm = normalizeAreaString(r.name);
    if (norm.length >= 4 && (rNorm.includes(norm) || norm.includes(rNorm))) {
      return r;
    }
  }

  const inputTokens = norm.split(' ').filter((t) => t.length > 1);
  let bestMatch: Region | null = null;
  let bestScore = 0;

  for (const r of pool) {
    const rNorm = normalizeAreaString(r.name);
    let hits = 0;
    for (const tok of inputTokens) {
      if (rNorm.includes(tok)) hits++;
    }
    const score = inputTokens.length > 0 ? hits / inputTokens.length : 0;
    if (score > bestScore && score >= 0.6) {
      bestScore = score;
      bestMatch = r;
    }
  }

  return bestMatch;
}

export function detectBestBoundaryLevel(
  areaNames: string[],
  allRegions: Region[],
  stateHints?: string[]
): {
  bestLevel: BoundaryLevel;
  scoresByLevel: Record<BoundaryLevel, { matched: number; total: number }>;
  unmatchedByLevel: Record<BoundaryLevel, string[]>;
} {
  const levels: BoundaryLevel[] = ['district', 'constituency', 'assembly', 'ward'];
  const scoresByLevel: Record<BoundaryLevel, { matched: number; total: number }> = {
    district: { matched: 0, total: areaNames.length },
    constituency: { matched: 0, total: areaNames.length },
    assembly: { matched: 0, total: areaNames.length },
    ward: { matched: 0, total: areaNames.length },
  };
  const unmatchedByLevel: Record<BoundaryLevel, string[]> = {
    district: [],
    constituency: [],
    assembly: [],
    ward: [],
  };

  let bestLevel: BoundaryLevel = 'district';
  let bestCount = -1;

  for (const lvl of levels) {
    const tierRegions = allRegions.filter((r) => r.level === lvl);
    let matched = 0;
    const unmatched: string[] = [];

    areaNames.forEach((raw, idx) => {
      const m = fuzzyMatchRegion(raw, tierRegions, stateHints?.[idx]);
      if (m) matched++;
      else if (raw.trim() && unmatched.length < 12) unmatched.push(raw.trim());
    });

    scoresByLevel[lvl] = { matched, total: areaNames.length };
    unmatchedByLevel[lvl] = unmatched;

    if (matched > bestCount) {
      bestCount = matched;
      bestLevel = lvl;
    }
  }

  return { bestLevel, scoresByLevel, unmatchedByLevel };
}
