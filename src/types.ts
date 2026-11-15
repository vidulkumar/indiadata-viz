export type BoundaryLevel = 'district' | 'constituency' | 'assembly' | 'ward';

export type LayerCategory =
  | 'environment'
  | 'water'
  | 'health'
  | 'transport'
  | 'education'
  | 'safety'
  | 'demographics'
  | 'infrastructure'
  | 'uploaded';

export type MetricKey =
  | 'green_cover_pct'
  | 'aqi_pm25'
  | 'groundwater_extraction_pct'
  | 'groundwater_depth_m'
  | 'clean_fuel_pct'
  | 'piped_water_pct'
  | 'stunting_pct'
  | 'hospital_beds_per_10k'
  | 'pupil_teacher_ratio'
  | 'crime_rate_per_lakh'
  | 'population_density'
  | 'literacy_rate'
  | 'sex_ratio';

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
  population?: number;
  population_density: number;
  density: number;
  literacy_rate: number;
  sex_ratio: number;
  green_cover_pct: number;
  isfr_benchmark_region?: string;
  aqi_pm25: number | null;
  pm25_ugm3?: number | null;
  pm10_ugm3?: number | null;
  no2_ugm3?: number | null;
  cpcb_station_name?: string | null;
  // CGWB Groundwater Metrics
  groundwater_extraction_pct?: number;
  groundwater_depth_m?: number;
  cgwb_category?: string;
  cgwb_source_label?: string | null;
  cgwb_source_url?: string | null;
  // NFHS-5 & Jal Jeevan Household / Health Metrics
  clean_fuel_pct?: number;
  piped_water_pct?: number;
  stunting_pct?: number;
  nfhs_source_label?: string | null;
  nfhs_source_url?: string | null;
  // UDISE+ Education Metric
  pupil_teacher_ratio?: number;
  udise_source_label?: string | null;
  udise_source_url?: string | null;
  // NCRB Public Safety Metric
  crime_rate_per_lakh?: number;
  ncrb_source_label?: string | null;
  ncrb_source_url?: string | null;
  // MoHFW Healthcare Infrastructure Metric
  hospital_beds_per_10k?: number;
  health_source_label?: string | null;
  health_source_url?: string | null;
  // Elected Representative & Provenance
  rep_name?: string | null;
  rep_role?: string | null;
  rep_party?: string | null;
  rep_term?: string | null;
  rep_votes?: number | null;
  rep_source_label?: string | null;
  rep_source_url?: string | null;
  rep_affidavit_url?: string | null;
  green_source_label?: string | null;
  green_source_url?: string | null;
  pollution_source_label?: string | null;
  pollution_source_url?: string | null;
  census_source_label?: string | null;
  census_source_url?: string | null;
  boundary_source_label?: string | null;
  boundary_source_url?: string | null;
  data_source_label?: string | null;
  data_source_url?: string | null;
  center?: [number, number];
  geojson?: Record<string, unknown> | null;
  customMetricValue?: number;
  [key: string]: unknown;
}

export interface Insight {
  id: number;
  slug?: string;
  region_code: string;
  region_name?: string;
  title: string;
  summary: string;
  category?: string;
  metric_name?: string;
  metric_value?: number;
  metric_unit?: string;
  source_label?: string;
  source_url?: string;
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
  aqi: number;
  pm25: number;
  pm10: number;
  no2?: number;
  updated: string;
  date?: string;
  sourceLabel: string;
  sourceUrl: string;
}

export interface VerifiedPointFeature {
  id: string;
  name: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
  primaryMetricLabel: string;
  primaryMetricValue: number | string;
  primaryMetricUnit: string;
  secondaryMetricLabel?: string;
  secondaryMetricValue?: number | string;
  secondaryMetricUnit?: string;
  statusBadge?: string;
  agency: string;
  sourceLabel: string;
  sourceUrl: string;
  dataGovUrl?: string;
  color?: string;
}

export interface VerifiedLineCorridor {
  id: string;
  name: string;
  code: string;
  color: string;
  operator: string;
  routeLengthKm: number;
  stationsCount: number;
  dailyRidershipEst?: string;
  terminalEndpoints: string;
  sourceLabel: string;
  sourceUrl: string;
  dataGovUrl?: string;
  coordinates: [number, number][];
}

export interface VerifiedOverlayLayerConfig {
  id: string;
  title: string;
  shortTitle: string;
  category: LayerCategory;
  categoryLabel: string;
  geometryType: 'point' | 'line-network';
  geometryLabel: string;
  unit: string;
  publisher: string;
  sourceUrl: string;
  dataGovUrl?: string;
  description: string;
  color: string;
  badgeText?: string;
  defaultVisible: boolean;
  defaultOpacity: number;
  points: VerifiedPointFeature[];
  lines?: VerifiedLineCorridor[];
}

export interface CustomLayer {
  id: string;
  slug?: string;
  name: string;
  description?: string;
  methodology?: string;
  targetState?: string;
  type: 'point' | 'choropleth' | 'line';
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
  description?: string;
  methodology?: string;
  target_state?: string;
  layer_type: 'point' | 'choropleth' | 'line';
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
  shortLabel: string;
  category: LayerCategory;
  categoryLabel: string;
  unit: string;
  sourceLabel: string;
  sourceUrl: string;
  dataGovUrl?: string;
  description: string;
  polarity: 'higher_better' | 'lower_better' | 'neutral';
  benchmarkMax: number;
  defaultVisible: boolean;
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

// Scientific Stress / Hazard Ramp (Cool Teal -> Amber -> Crimson)
export const HAZARD_STRESS_RAMP: [string, string, string, string, string] = [
  '#10b981',
  '#84cc16',
  '#eab308',
  '#f97316',
  '#ef4444',
];

// Hydrological Blue-to-Crimson Ramp for Groundwater Stress
export const HYDRO_STRESS_RAMP: [string, string, string, string, string] = [
  '#0ea5e9',
  '#22c55e',
  '#eab308',
  '#f97316',
  '#e11d48',
];

export const METRIC_CONFIGS: Record<MetricKey, MetricConfig> = {
  green_cover_pct: {
    key: 'green_cover_pct',
    label: 'Green & Forest Cover (ISFR 2023)',
    shortLabel: 'Green Cover',
    category: 'environment',
    categoryLabel: 'Environment',
    unit: '%',
    sourceLabel: 'Forest Survey of India — ISFR 2023 (MoEFCC)',
    sourceUrl: 'https://fsi.nic.in/isfr-2023',
    dataGovUrl: 'https://data.gov.in/catalog/india-state-forest-report',
    description:
      'Combined forest and tree cover percentage per official ISFR 2023 district satellite assessment.',
    polarity: 'higher_better',
    benchmarkMax: 35,
    defaultVisible: true,
    stops: [
      [4, '#0c3b4e'],
      [8, '#117864'],
      [15, '#2ecc71'],
      [23, '#f4d03f'],
      [32, '#f39c12'],
    ],
  },
  aqi_pm25: {
    key: 'aqi_pm25',
    label: 'Air Pollution — CPCB AQI (CAAQMS)',
    shortLabel: 'CPCB Air Quality (AQI)',
    category: 'environment',
    categoryLabel: 'Environment',
    unit: 'AQI',
    sourceLabel: 'Central Pollution Control Board (CPCB CAAQMS)',
    sourceUrl: 'https://airquality.cpcb.gov.in/ccr/#/caaqm-dashboard-all/caaqm-landing',
    dataGovUrl: 'https://data.gov.in/resource/real-time-air-quality-index-various-locations',
    description:
      'Continuous Ambient Air Quality Monitoring (CAAQMS) station index & IDW spatial field.',
    polarity: 'lower_better',
    benchmarkMax: 400,
    defaultVisible: true,
    stops: [
      [150, '#22c55e'],
      [220, '#84cc16'],
      [280, '#eab308'],
      [330, '#f97316'],
      [370, '#ef4444'],
    ],
  },
  groundwater_extraction_pct: {
    key: 'groundwater_extraction_pct',
    label: 'Groundwater Extraction Stage (CGWB)',
    shortLabel: 'Groundwater Extraction',
    category: 'water',
    categoryLabel: 'Water & Hydrology',
    unit: '%',
    sourceLabel: 'Central Ground Water Board — Dynamic Ground Water Resources (Jal Shakti)',
    sourceUrl: 'https://cgwb.gov.in/en/dynamic-ground-water-resources-india',
    dataGovUrl: 'https://nwdp.nwic.gov.in/',
    description:
      'Annual groundwater draft as % of extractable recharge (>100% indicates Over-Exploited aquifer).',
    polarity: 'lower_better',
    benchmarkMax: 220,
    defaultVisible: false,
    stops: [
      [70, HYDRO_STRESS_RAMP[0]],
      [90, HYDRO_STRESS_RAMP[1]],
      [105, HYDRO_STRESS_RAMP[2]],
      [130, HYDRO_STRESS_RAMP[3]],
      [180, HYDRO_STRESS_RAMP[4]],
    ],
  },
  groundwater_depth_m: {
    key: 'groundwater_depth_m',
    label: 'Groundwater Table Depth (CGWB DWLR)',
    shortLabel: 'Water Table Depth',
    category: 'water',
    categoryLabel: 'Water & Hydrology',
    unit: 'm bgl',
    sourceLabel: 'Central Ground Water Board & NWIC Telemetry (Ministry of Jal Shakti)',
    sourceUrl: 'https://cgwb.gov.in/en/ground-water-year-book',
    dataGovUrl: 'https://nwdp.nwic.gov.in/',
    description:
      'Pre-monsoon depth to water table in meters below ground level (m bgl) from CGWB piezometers.',
    polarity: 'lower_better',
    benchmarkMax: 40,
    defaultVisible: false,
    stops: [
      [10, HYDRO_STRESS_RAMP[0]],
      [15, HYDRO_STRESS_RAMP[1]],
      [20, HYDRO_STRESS_RAMP[2]],
      [28, HYDRO_STRESS_RAMP[3]],
      [34, HYDRO_STRESS_RAMP[4]],
    ],
  },
  piped_water_pct: {
    key: 'piped_water_pct',
    label: 'Improved / Piped Drinking Water (NFHS-5)',
    shortLabel: 'Piped Water Access',
    category: 'water',
    categoryLabel: 'Water & Hydrology',
    unit: '%',
    sourceLabel: 'NFHS-5 District Fact Sheets & Jal Jeevan Mission (MoHFW / Jal Shakti)',
    sourceUrl: 'https://rchiips.org/nfhs/factsheet_NFHS-5.shtml',
    dataGovUrl: 'https://data.gov.in/catalog/key-indicators-national-family-health-survey-nfhs',
    description:
      'Percentage of households living in dwellings with improved/piped drinking water source.',
    polarity: 'higher_better',
    benchmarkMax: 100,
    defaultVisible: false,
    stops: [
      [92, VIRIDIS_TEAL_AMBER[0]],
      [96, VIRIDIS_TEAL_AMBER[1]],
      [98, VIRIDIS_TEAL_AMBER[2]],
      [99, VIRIDIS_TEAL_AMBER[3]],
      [99.5, VIRIDIS_TEAL_AMBER[4]],
    ],
  },
  clean_fuel_pct: {
    key: 'clean_fuel_pct',
    label: 'Clean Cooking Fuel Adoption (NFHS-5)',
    shortLabel: 'Clean Cooking Fuel',
    category: 'infrastructure',
    categoryLabel: 'Civic Infrastructure',
    unit: '%',
    sourceLabel: 'National Family Health Survey (NFHS-5) District Fact Sheets (MoHFW)',
    sourceUrl: 'https://rchiips.org/nfhs/factsheet_NFHS-5.shtml',
    dataGovUrl: 'https://data.gov.in/catalog/key-indicators-national-family-health-survey-nfhs',
    description:
      'Percentage of households using clean fuel for cooking (LPG, PNG, electricity, biogas).',
    polarity: 'higher_better',
    benchmarkMax: 100,
    defaultVisible: false,
    stops: [
      [70, VIRIDIS_TEAL_AMBER[0]],
      [82, VIRIDIS_TEAL_AMBER[1]],
      [91, VIRIDIS_TEAL_AMBER[2]],
      [96, VIRIDIS_TEAL_AMBER[3]],
      [99, VIRIDIS_TEAL_AMBER[4]],
    ],
  },
  stunting_pct: {
    key: 'stunting_pct',
    label: 'Child Nutrition — Under-5 Stunting (NFHS-5)',
    shortLabel: 'Child Stunting (<5Y)',
    category: 'health',
    categoryLabel: 'Public Health',
    unit: '%',
    sourceLabel: 'National Family Health Survey (NFHS-5) District Fact Sheets (IIPS / MoHFW)',
    sourceUrl: 'https://rchiips.org/nfhs/factsheet_NFHS-5.shtml',
    dataGovUrl: 'https://data.gov.in/catalog/key-indicators-national-family-health-survey-nfhs',
    description:
      'Percentage of children under age 5 years who are stunted (height-for-age below -2 SD).',
    polarity: 'lower_better',
    benchmarkMax: 45,
    defaultVisible: false,
    stops: [
      [18, HAZARD_STRESS_RAMP[0]],
      [24, HAZARD_STRESS_RAMP[1]],
      [28, HAZARD_STRESS_RAMP[2]],
      [31, HAZARD_STRESS_RAMP[3]],
      [34, HAZARD_STRESS_RAMP[4]],
    ],
  },
  hospital_beds_per_10k: {
    key: 'hospital_beds_per_10k',
    label: 'Public & Empaneled Hospital Beds (MoHFW / NHA)',
    shortLabel: 'Hospital Beds / 10k',
    category: 'health',
    categoryLabel: 'Public Health',
    unit: '/10k pop',
    sourceLabel: 'MoHFW National Health Profile & Delhi/State Health Bulletins',
    sourceUrl: 'https://data.gov.in/catalog/hospital-directory-national-health-portal',
    dataGovUrl: 'https://data.gov.in/catalog/hospital-directory-national-health-portal',
    description:
      'Sanctioned government & AB-PMJAY empaneled hospital beds per 10,000 resident population.',
    polarity: 'higher_better',
    benchmarkMax: 65,
    defaultVisible: false,
    stops: [
      [15, VIRIDIS_TEAL_AMBER[0]],
      [21, VIRIDIS_TEAL_AMBER[1]],
      [27, VIRIDIS_TEAL_AMBER[2]],
      [35, VIRIDIS_TEAL_AMBER[3]],
      [50, VIRIDIS_TEAL_AMBER[4]],
    ],
  },
  pupil_teacher_ratio: {
    key: 'pupil_teacher_ratio',
    label: 'School Pupil-Teacher Ratio (UDISE+)',
    shortLabel: 'Pupil-Teacher Ratio',
    category: 'education',
    categoryLabel: 'Education (UDISE+)',
    unit: ':1 PTR',
    sourceLabel: 'Unified District Information System for Education Plus (UDISE+, MoE)',
    sourceUrl: 'https://dashboard.udiseplus.gov.in/',
    dataGovUrl: 'https://data.gov.in/catalog/unified-district-information-system-education-udise',
    description:
      'Average number of enrolled students per teacher across school education stages (NEP 2020 target ≤30:1).',
    polarity: 'lower_better',
    benchmarkMax: 36,
    defaultVisible: false,
    stops: [
      [19, HAZARD_STRESS_RAMP[0]],
      [22, HAZARD_STRESS_RAMP[1]],
      [24, HAZARD_STRESS_RAMP[2]],
      [26, HAZARD_STRESS_RAMP[3]],
      [28, HAZARD_STRESS_RAMP[4]],
    ],
  },
  crime_rate_per_lakh: {
    key: 'crime_rate_per_lakh',
    label: 'Cognizable Crime Rate per Lakh (NCRB)',
    shortLabel: 'Crime Rate (NCRB)',
    category: 'safety',
    categoryLabel: 'Public Safety (NCRB)',
    unit: '/1L pop',
    sourceLabel: 'National Crime Records Bureau (NCRB) — Crime in India (MHA)',
    sourceUrl: 'https://ncrb.gov.in/crime-in-india.html',
    dataGovUrl: 'https://data.gov.in/catalog/crime-india',
    description:
      'Registered IPC/BNS & SLL cognizable crimes per 1,00,000 population per official NCRB methodology.',
    polarity: 'lower_better',
    benchmarkMax: 2000,
    defaultVisible: false,
    stops: [
      [500, HAZARD_STRESS_RAMP[0]],
      [750, HAZARD_STRESS_RAMP[1]],
      [1100, HAZARD_STRESS_RAMP[2]],
      [1550, HAZARD_STRESS_RAMP[3]],
      [1750, HAZARD_STRESS_RAMP[4]],
    ],
  },
  population_density: {
    key: 'population_density',
    label: 'Population Density (Census PCA)',
    shortLabel: 'Population Density',
    category: 'demographics',
    categoryLabel: 'Demographics',
    unit: '/km²',
    sourceLabel: 'Registrar General & Census Commissioner of India (PCA 2011)',
    sourceUrl: 'https://censusindia.gov.in/nada/index.php/catalog/42648',
    dataGovUrl: 'https://data.gov.in/catalog/primary-census-abstract-pca',
    description: 'Resident population per square kilometer from Primary Census Abstract.',
    polarity: 'neutral',
    benchmarkMax: 36000,
    defaultVisible: false,
    stops: [
      [600, VIRIDIS_TEAL_AMBER[0]],
      [2500, VIRIDIS_TEAL_AMBER[1]],
      [8500, VIRIDIS_TEAL_AMBER[2]],
      [18000, VIRIDIS_TEAL_AMBER[3]],
      [32000, VIRIDIS_TEAL_AMBER[4]],
    ],
  },
  literacy_rate: {
    key: 'literacy_rate',
    label: 'Literacy Rate (Census PCA)',
    shortLabel: 'Literacy Rate',
    category: 'demographics',
    categoryLabel: 'Demographics',
    unit: '%',
    sourceLabel: 'Registrar General & Census Commissioner of India (PCA 2011)',
    sourceUrl: 'https://censusindia.gov.in/nada/index.php/catalog/42648',
    dataGovUrl: 'https://data.gov.in/catalog/primary-census-abstract-pca',
    description: 'Effective literacy rate among population aged 7 years and above.',
    polarity: 'higher_better',
    benchmarkMax: 100,
    defaultVisible: false,
    stops: [
      [68, VIRIDIS_TEAL_AMBER[0]],
      [75, VIRIDIS_TEAL_AMBER[1]],
      [81, VIRIDIS_TEAL_AMBER[2]],
      [85, VIRIDIS_TEAL_AMBER[3]],
      [89, VIRIDIS_TEAL_AMBER[4]],
    ],
  },
  sex_ratio: {
    key: 'sex_ratio',
    label: 'Sex Ratio (Census PCA)',
    shortLabel: 'Sex Ratio',
    category: 'demographics',
    categoryLabel: 'Demographics',
    unit: 'F/1000M',
    sourceLabel: 'Registrar General & Census Commissioner of India (PCA 2011)',
    sourceUrl: 'https://censusindia.gov.in/nada/index.php/catalog/42648',
    dataGovUrl: 'https://data.gov.in/catalog/primary-census-abstract-pca',
    description: 'Number of females per 1,000 males in the resident population.',
    polarity: 'higher_better',
    benchmarkMax: 1000,
    defaultVisible: false,
    stops: [
      [830, VIRIDIS_TEAL_AMBER[0]],
      [855, VIRIDIS_TEAL_AMBER[1]],
      [870, VIRIDIS_TEAL_AMBER[2]],
      [885, VIRIDIS_TEAL_AMBER[3]],
      [900, VIRIDIS_TEAL_AMBER[4]],
    ],
  },
};

export const ALL_METRIC_KEYS = Object.keys(METRIC_CONFIGS) as MetricKey[];

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

export function sanitizeText(input: unknown, maxLen = 500): string {
  const raw = String(input ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/^[=+\-@\t\r]+/, '')
    .trim();
  return raw.slice(0, maxLen);
}

export function sanitizeUrl(input: unknown): string {
  const s = String(input ?? '').trim();
  if (/^https?:\/\/[^\s<>"]+$/i.test(s)) return s;
  return '';
}

export function isValidIndiaCoord(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= 6 &&
    lat <= 38 &&
    lon >= 68 &&
    lon <= 98
  );
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

  // 1. Exact AC number or Ward number match if numeric
  if (/^\d+$/.test(norm)) {
    const num = Number(norm);
    for (const r of pool) {
      if (r.ac_no === num || String(r.ward_no || '') === norm) {
        return r;
      }
    }
  }

  // 2. Exact normalized name or code match
  for (const r of pool) {
    const rNorm = normalizeAreaString(r.name);
    const rNoSpace = rNorm.replace(/\s+/g, '');
    const cNorm = normalizeAreaString(r.code);
    if (rNorm === norm || rNoSpace === noSpaceNorm || cNorm === norm) {
      return r;
    }
  }

  // 3. Ward number pattern match (e.g. "Ward 80" or "Delhi Ward 80")
  const wardMatch = norm.match(/\bward\s*(\d+[a-z]?)\b/i);
  if (wardMatch) {
    const targetNo = wardMatch[1].toLowerCase();
    for (const r of pool) {
      if (String(r.ward_no || '').toLowerCase() === targetNo) return r;
    }
  }

  // 4. Substring / token overlap match
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
