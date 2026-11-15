export type BoundaryLevel = 'district' | 'constituency' | 'ward';

export type MetricKey =
  | 'literacy_rate'
  | 'density'
  | 'population'
  | 'aqi_pm25'
  | 'hospitals_count'
  | 'sex_ratio'
  | 'green_cover_pct'
  | 'schools_count'
  | 'avg_circle_rate';

export interface Region {
  id?: number;
  code: string;
  name: string;
  state: string;
  level: BoundaryLevel;
  population: number;
  density: number;
  literacy_rate: number;
  aqi_pm25: number | null;
  hospitals_count: number;
  sex_ratio: number;
  green_cover_pct: number;
  schools_count: number;
  avg_circle_rate: number;
  geojson?: Record<string, unknown> | null;
  customMetricValue?: number;
}

export interface Insight {
  id: number;
  region_code: string;
  title: string;
  summary: string;
  author: string;
  metric?: string;
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
}

export interface InfraPoint {
  id: string;
  name: string;
  category: 'Metro Station' | 'Government Hospital' | 'Private Hospital' | 'EV Hub';
  city: string;
  lat: number;
  lon: number;
  details: string;
}

export interface CustomLayer {
  id: string;
  name: string;
  type: 'point' | 'choropleth';
  color: string;
  visible: boolean;
  featureCount: number;
  geojson: {
    type: 'FeatureCollection';
    features: Array<Record<string, unknown>>;
  };
  metricLabel?: string;
  rawRows?: Array<Record<string, unknown>>;
}

export interface MetricConfig {
  key: MetricKey;
  label: string;
  unit: string;
  stops: [number, string][];
}

export const METRIC_CONFIGS: Record<MetricKey, MetricConfig> = {
  literacy_rate: {
    key: 'literacy_rate',
    label: 'Literacy Rate (%)',
    unit: '%',
    stops: [
      [75, '#064e3b'],
      [84, '#10b981'],
      [93, '#fbbf24'],
    ],
  },
  density: {
    key: 'density',
    label: 'Population Density (/km²)',
    unit: '/km²',
    stops: [
      [800, '#064e3b'],
      [6000, '#10b981'],
      [20000, '#fbbf24'],
    ],
  },
  population: {
    key: 'population',
    label: 'Total Population',
    unit: '',
    stops: [
      [50000, '#064e3b'],
      [1800000, '#10b981'],
      [12000000, '#fbbf24'],
    ],
  },
  aqi_pm25: {
    key: 'aqi_pm25',
    label: 'Air Quality Index (PM2.5)',
    unit: 'µg/m³',
    stops: [
      [150, '#22c55e'],
      [230, '#eab308'],
      [310, '#ef4444'],
    ],
  },
  hospitals_count: {
    key: 'hospitals_count',
    label: 'Hospitals & Clinics',
    unit: 'facilities',
    stops: [
      [5, '#1e3a8a'],
      [30, '#38bdf8'],
      [85, '#fbbf24'],
    ],
  },
  sex_ratio: {
    key: 'sex_ratio',
    label: 'Sex Ratio (per 1,000 M)',
    unit: 'females/1000M',
    stops: [
      [850, '#312e81'],
      [872, '#818cf8'],
      [895, '#34d399'],
    ],
  },
  green_cover_pct: {
    key: 'green_cover_pct',
    label: 'Green Cover (%)',
    unit: '%',
    stops: [
      [10, '#451a03'],
      [18, '#16a34a'],
      [32, '#4ade80'],
    ],
  },
  schools_count: {
    key: 'schools_count',
    label: 'Schools (UDISE+)',
    unit: 'schools',
    stops: [
      [25, '#1e293b'],
      [1000, '#0ea5e9'],
      [5000, '#34d399'],
    ],
  },
  avg_circle_rate: {
    key: 'avg_circle_rate',
    label: 'Avg Property Circle Rate',
    unit: '₹/sq.ft',
    stops: [
      [5000, '#1e1b4b'],
      [14000, '#a855f7'],
      [25000, '#f43f5e'],
    ],
  },
};

const ALIAS_MAP: Record<string, string> = {
  gurgaon: 'gurugram',
  'g b nagar': 'gautam buddha nagar noida',
  'gb nagar': 'gautam buddha nagar noida',
  'gautam budh nagar': 'gautam buddha nagar noida',
  noida: 'gautam buddha nagar noida',
  delhi: 'nct of delhi',
  'new delhi': 'nct of delhi',
  sonepat: 'sonipat',
};

export function normalizeAreaString(str: string): string {
  const cleaned = str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return ALIAS_MAP[cleaned] || cleaned;
}

export function fuzzyMatchRegion(inputName: string, regions: Region[]): Region | null {
  if (!inputName) return null;
  const norm = normalizeAreaString(inputName);

  // 1. Direct or alias match
  for (const r of regions) {
    const rNorm = normalizeAreaString(r.name);
    const cNorm = normalizeAreaString(r.code);
    if (rNorm === norm || cNorm === norm || rNorm.includes(norm) || norm.includes(rNorm)) {
      return r;
    }
  }

  // 2. Token overlap match (e.g. "Ward-144" -> "Ward 144 - Hauz Khas")
  const inputTokens = norm.split(' ').filter((t) => t.length > 1);
  let bestMatch: Region | null = null;
  let bestScore = 0;

  for (const r of regions) {
    const rNorm = normalizeAreaString(r.name);
    let hits = 0;
    for (const tok of inputTokens) {
      if (rNorm.includes(tok)) hits++;
    }
    const score = inputTokens.length > 0 ? hits / inputTokens.length : 0;
    if (score > bestScore && score >= 0.5) {
      bestScore = score;
      bestMatch = r;
    }
  }

  return bestMatch;
}
