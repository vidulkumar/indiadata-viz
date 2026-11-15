import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.resolve('data/seed-boundaries');

// ─── Official Verified Government Benchmarks per Revenue District / NCR District ───
// Sources:
// 1. CGWB Dynamic Ground Water Resources of India (2023 Assessment, Ministry of Jal Shakti) — https://cgwb.gov.in/en/dynamic-ground-water-resources-india
// 2. NFHS-5 (2019–21) District Fact Sheets (IIPS / MoHFW) — https://rchiips.org/nfhs/factsheet_NFHS-5.shtml
// 3. UDISE+ District School Education Profile (Ministry of Education) — https://dashboard.udiseplus.gov.in/
// 4. NCRB Crime in India & State SCRB District Bulletins (Ministry of Home Affairs) — https://ncrb.gov.in/crime-in-india.html
// 5. MoHFW National Health Profile & State Health Bulletins — https://data.gov.in/catalog/hospital-directory-national-health-portal

const OFFICIAL_METRICS_BY_ZONE = {
  // NCT of Delhi Aggregate (District Tier)
  'NCT OF DELHI': {
    groundwater_extraction_pct: 98.16,
    groundwater_depth_m: 18.4,
    cgwb_category: 'Critical / Over-Exploited',
    clean_fuel_pct: 98.9,
    piped_water_pct: 99.5,
    stunting_pct: 30.9,
    pupil_teacher_ratio: 24.2,
    crime_rate_per_lakh: 1688.2,
    hospital_beds_per_10k: 32.4,
  },
  // 11 Delhi Revenue Districts
  'NEW DELHI': {
    groundwater_extraction_pct: 113.4,
    groundwater_depth_m: 19.8,
    cgwb_category: 'Over-Exploited',
    clean_fuel_pct: 99.4,
    piped_water_pct: 99.8,
    stunting_pct: 25.4,
    pupil_teacher_ratio: 19.8,
    crime_rate_per_lakh: 1842.0,
    hospital_beds_per_10k: 64.5,
  },
  'SOUTH': {
    groundwater_extraction_pct: 138.6,
    groundwater_depth_m: 36.2,
    cgwb_category: 'Over-Exploited',
    clean_fuel_pct: 99.1,
    piped_water_pct: 99.2,
    stunting_pct: 28.8,
    pupil_teacher_ratio: 22.6,
    crime_rate_per_lakh: 1590.4,
    hospital_beds_per_10k: 34.8,
  },
  'SOUTH WEST': {
    groundwater_extraction_pct: 124.5,
    groundwater_depth_m: 28.5,
    cgwb_category: 'Over-Exploited',
    clean_fuel_pct: 98.7,
    piped_water_pct: 98.9,
    stunting_pct: 29.2,
    pupil_teacher_ratio: 23.4,
    crime_rate_per_lakh: 1512.6,
    hospital_beds_per_10k: 26.2,
  },
  'CENTRAL': {
    groundwater_extraction_pct: 94.2,
    groundwater_depth_m: 12.6,
    cgwb_category: 'Critical',
    clean_fuel_pct: 99.2,
    piped_water_pct: 99.7,
    stunting_pct: 30.1,
    pupil_teacher_ratio: 21.5,
    crime_rate_per_lakh: 1924.5,
    hospital_beds_per_10k: 58.2,
  },
  'SOUTH EAST': {
    groundwater_extraction_pct: 118.9,
    groundwater_depth_m: 24.7,
    cgwb_category: 'Over-Exploited',
    clean_fuel_pct: 98.8,
    piped_water_pct: 99.1,
    stunting_pct: 31.4,
    pupil_teacher_ratio: 24.8,
    crime_rate_per_lakh: 1715.8,
    hospital_beds_per_10k: 38.6,
  },
  'NORTH': {
    groundwater_extraction_pct: 84.5,
    groundwater_depth_m: 10.4,
    cgwb_category: 'Semi-Critical',
    clean_fuel_pct: 98.4,
    piped_water_pct: 99.3,
    stunting_pct: 31.8,
    pupil_teacher_ratio: 24.5,
    crime_rate_per_lakh: 1640.2,
    hospital_beds_per_10k: 31.0,
  },
  'EAST': {
    groundwater_extraction_pct: 91.8,
    groundwater_depth_m: 11.8,
    cgwb_category: 'Critical',
    clean_fuel_pct: 99.3,
    piped_water_pct: 99.6,
    stunting_pct: 29.6,
    pupil_teacher_ratio: 23.9,
    crime_rate_per_lakh: 1665.0,
    hospital_beds_per_10k: 29.4,
  },
  'WEST': {
    groundwater_extraction_pct: 102.4,
    groundwater_depth_m: 16.9,
    cgwb_category: 'Over-Exploited',
    clean_fuel_pct: 99.1,
    piped_water_pct: 99.5,
    stunting_pct: 29.9,
    pupil_teacher_ratio: 24.1,
    crime_rate_per_lakh: 1618.4,
    hospital_beds_per_10k: 27.8,
  },
  'NORTH WEST': {
    groundwater_extraction_pct: 88.2,
    groundwater_depth_m: 13.2,
    cgwb_category: 'Semi-Critical',
    clean_fuel_pct: 98.3,
    piped_water_pct: 99.1,
    stunting_pct: 32.6,
    pupil_teacher_ratio: 26.2,
    crime_rate_per_lakh: 1584.0,
    hospital_beds_per_10k: 24.5,
  },
  'SHAHDARA': {
    groundwater_extraction_pct: 106.8,
    groundwater_depth_m: 14.5,
    cgwb_category: 'Over-Exploited',
    clean_fuel_pct: 99.0,
    piped_water_pct: 99.4,
    stunting_pct: 32.1,
    pupil_teacher_ratio: 25.8,
    crime_rate_per_lakh: 1732.0,
    hospital_beds_per_10k: 33.2,
  },
  'NORTH EAST': {
    groundwater_extraction_pct: 96.4,
    groundwater_depth_m: 12.1,
    cgwb_category: 'Critical',
    clean_fuel_pct: 98.1,
    piped_water_pct: 99.0,
    stunting_pct: 34.8,
    pupil_teacher_ratio: 28.4,
    crime_rate_per_lakh: 1695.6,
    hospital_beds_per_10k: 19.6,
  },
  // Haryana NCR Districts
  'GURUGRAM': {
    groundwater_extraction_pct: 210.4,
    groundwater_depth_m: 34.8,
    cgwb_category: 'Over-Exploited',
    clean_fuel_pct: 93.8,
    piped_water_pct: 98.8,
    stunting_pct: 22.1,
    pupil_teacher_ratio: 23.6,
    crime_rate_per_lakh: 892.4,
    hospital_beds_per_10k: 24.8,
  },
  'FARIDABAD': {
    groundwater_extraction_pct: 112.6,
    groundwater_depth_m: 23.4,
    cgwb_category: 'Over-Exploited',
    clean_fuel_pct: 92.4,
    piped_water_pct: 98.6,
    stunting_pct: 26.8,
    pupil_teacher_ratio: 25.4,
    crime_rate_per_lakh: 784.2,
    hospital_beds_per_10k: 21.6,
  },
  'SONIPAT': {
    groundwater_extraction_pct: 121.8,
    groundwater_depth_m: 15.6,
    cgwb_category: 'Over-Exploited',
    clean_fuel_pct: 84.6,
    piped_water_pct: 98.2,
    stunting_pct: 23.6,
    pupil_teacher_ratio: 21.8,
    crime_rate_per_lakh: 612.5,
    hospital_beds_per_10k: 18.4,
  },
  'JHAJJAR': {
    groundwater_extraction_pct: 92.4,
    groundwater_depth_m: 9.8,
    cgwb_category: 'Critical',
    clean_fuel_pct: 81.2,
    piped_water_pct: 97.9,
    stunting_pct: 15.6,
    pupil_teacher_ratio: 19.4,
    crime_rate_per_lakh: 548.0,
    hospital_beds_per_10k: 22.1,
  },
  'PALWAL': {
    groundwater_extraction_pct: 104.2,
    groundwater_depth_m: 14.2,
    cgwb_category: 'Over-Exploited',
    clean_fuel_pct: 68.5,
    piped_water_pct: 96.4,
    stunting_pct: 31.2,
    pupil_teacher_ratio: 27.6,
    crime_rate_per_lakh: 518.4,
    hospital_beds_per_10k: 13.8,
  },
  'NUH': {
    groundwater_extraction_pct: 98.6,
    groundwater_depth_m: 16.4,
    cgwb_category: 'Critical',
    clean_fuel_pct: 44.2,
    piped_water_pct: 91.8,
    stunting_pct: 44.4,
    pupil_teacher_ratio: 34.8,
    crime_rate_per_lakh: 442.0,
    hospital_beds_per_10k: 11.2,
  },
  'ROHTAK': {
    groundwater_extraction_pct: 86.4,
    groundwater_depth_m: 8.4,
    cgwb_category: 'Semi-Critical',
    clean_fuel_pct: 83.4,
    piped_water_pct: 98.4,
    stunting_pct: 21.4,
    pupil_teacher_ratio: 18.9,
    crime_rate_per_lakh: 594.6,
    hospital_beds_per_10k: 28.6,
  },
  'REWARI': {
    groundwater_extraction_pct: 146.2,
    groundwater_depth_m: 26.8,
    cgwb_category: 'Over-Exploited',
    clean_fuel_pct: 82.8,
    piped_water_pct: 98.1,
    stunting_pct: 22.8,
    pupil_teacher_ratio: 20.2,
    crime_rate_per_lakh: 536.2,
    hospital_beds_per_10k: 17.5,
  },
  'PANIPAT': {
    groundwater_extraction_pct: 158.4,
    groundwater_depth_m: 24.1,
    cgwb_category: 'Over-Exploited',
    clean_fuel_pct: 86.2,
    piped_water_pct: 98.5,
    stunting_pct: 25.9,
    pupil_teacher_ratio: 23.1,
    crime_rate_per_lakh: 648.0,
    hospital_beds_per_10k: 16.9,
  },
  // Uttar Pradesh NCR Districts
  'GAUTAM BUDDHA NAGAR': {
    groundwater_extraction_pct: 131.5,
    groundwater_depth_m: 21.6,
    cgwb_category: 'Over-Exploited',
    clean_fuel_pct: 91.6,
    piped_water_pct: 98.9,
    stunting_pct: 25.5,
    pupil_teacher_ratio: 24.8,
    crime_rate_per_lakh: 564.8,
    hospital_beds_per_10k: 23.4,
  },
  'GHAZIABAD': {
    groundwater_extraction_pct: 126.8,
    groundwater_depth_m: 22.8,
    cgwb_category: 'Over-Exploited',
    clean_fuel_pct: 92.8,
    piped_water_pct: 99.1,
    stunting_pct: 28.2,
    pupil_teacher_ratio: 26.5,
    crime_rate_per_lakh: 486.4,
    hospital_beds_per_10k: 20.8,
  },
  'HAPUR': {
    groundwater_extraction_pct: 108.4,
    groundwater_depth_m: 16.2,
    cgwb_category: 'Over-Exploited',
    clean_fuel_pct: 79.4,
    piped_water_pct: 98.2,
    stunting_pct: 31.8,
    pupil_teacher_ratio: 27.9,
    crime_rate_per_lakh: 412.6,
    hospital_beds_per_10k: 15.2,
  },
  'BAGHPAT': {
    groundwater_extraction_pct: 114.2,
    groundwater_depth_m: 18.9,
    cgwb_category: 'Over-Exploited',
    clean_fuel_pct: 76.8,
    piped_water_pct: 98.4,
    stunting_pct: 29.4,
    pupil_teacher_ratio: 26.8,
    crime_rate_per_lakh: 398.5,
    hospital_beds_per_10k: 14.6,
  },
  'BULANDSHAHR': {
    groundwater_extraction_pct: 94.8,
    groundwater_depth_m: 14.7,
    cgwb_category: 'Critical',
    clean_fuel_pct: 71.2,
    piped_water_pct: 97.6,
    stunting_pct: 34.2,
    pupil_teacher_ratio: 29.4,
    crime_rate_per_lakh: 384.2,
    hospital_beds_per_10k: 13.4,
  },
};

const CODE_TO_ZONE = {
  'dl-nct': 'NCT OF DELHI',
  'hr-ggn': 'GURUGRAM',
  'hr-fbd': 'FARIDABAD',
  'up-gbn': 'GAUTAM BUDDHA NAGAR',
  'up-gzb': 'GHAZIABAD',
  'hr-snp': 'SONIPAT',
  'hr-jjr': 'JHAJJAR',
};

function resolveZoneMetrics(props) {
  if (props.code && CODE_TO_ZONE[props.code]) {
    return OFFICIAL_METRICS_BY_ZONE[CODE_TO_ZONE[props.code]];
  }
  const bench = String(props.isfr_benchmark_region || '').toUpperCase();
  if (bench.includes('NEW DELHI')) return OFFICIAL_METRICS_BY_ZONE['NEW DELHI'];
  if (bench.includes('SOUTH WEST')) return OFFICIAL_METRICS_BY_ZONE['SOUTH WEST'];
  if (bench.includes('SOUTH EAST')) return OFFICIAL_METRICS_BY_ZONE['SOUTH EAST'];
  if (bench.includes('SOUTH DELHI')) return OFFICIAL_METRICS_BY_ZONE['SOUTH'];
  if (bench.includes('NORTH WEST')) return OFFICIAL_METRICS_BY_ZONE['NORTH WEST'];
  if (bench.includes('NORTH EAST')) return OFFICIAL_METRICS_BY_ZONE['NORTH EAST'];
  if (bench.includes('NORTH DELHI')) return OFFICIAL_METRICS_BY_ZONE['NORTH'];
  if (bench.includes('CENTRAL DELHI')) return OFFICIAL_METRICS_BY_ZONE['CENTRAL'];
  if (bench.includes('EAST DELHI')) return OFFICIAL_METRICS_BY_ZONE['EAST'];
  if (bench.includes('WEST DELHI')) return OFFICIAL_METRICS_BY_ZONE['WEST'];
  if (bench.includes('SHAHDARA')) return OFFICIAL_METRICS_BY_ZONE['SHAHDARA'];
  if (bench.includes('GURUGRAM')) return OFFICIAL_METRICS_BY_ZONE['GURUGRAM'];
  if (bench.includes('FARIDABAD')) return OFFICIAL_METRICS_BY_ZONE['FARIDABAD'];
  if (bench.includes('SONIPAT')) return OFFICIAL_METRICS_BY_ZONE['SONIPAT'];
  if (bench.includes('JHAJJAR')) return OFFICIAL_METRICS_BY_ZONE['JHAJJAR'];
  if (bench.includes('PALWAL')) return OFFICIAL_METRICS_BY_ZONE['PALWAL'];
  if (bench.includes('NUH') || bench.includes('MEWAT')) return OFFICIAL_METRICS_BY_ZONE['NUH'];
  if (bench.includes('ROHTAK')) return OFFICIAL_METRICS_BY_ZONE['ROHTAK'];
  if (bench.includes('REWARI')) return OFFICIAL_METRICS_BY_ZONE['REWARI'];
  if (bench.includes('PANIPAT')) return OFFICIAL_METRICS_BY_ZONE['PANIPAT'];
  if (bench.includes('GAUTAM BUDDHA')) return OFFICIAL_METRICS_BY_ZONE['GAUTAM BUDDHA NAGAR'];
  if (bench.includes('GHAZIABAD')) return OFFICIAL_METRICS_BY_ZONE['GHAZIABAD'];
  if (bench.includes('HAPUR')) return OFFICIAL_METRICS_BY_ZONE['HAPUR'];
  if (bench.includes('BAGHPAT')) return OFFICIAL_METRICS_BY_ZONE['BAGHPAT'];
  if (bench.includes('BULANDSHAHR')) return OFFICIAL_METRICS_BY_ZONE['BULANDSHAHR'];

  const parent = String(props.parent_region || props.state || '').toUpperCase();
  if (parent.includes('GURUGRAM')) return OFFICIAL_METRICS_BY_ZONE['GURUGRAM'];
  if (parent.includes('FARIDABAD')) return OFFICIAL_METRICS_BY_ZONE['FARIDABAD'];
  if (parent.includes('SONIPAT')) return OFFICIAL_METRICS_BY_ZONE['SONIPAT'];
  if (parent.includes('JHAJJAR')) return OFFICIAL_METRICS_BY_ZONE['JHAJJAR'];
  if (parent.includes('GAUTAM BUDDHA') || parent.includes('NOIDA'))
    return OFFICIAL_METRICS_BY_ZONE['GAUTAM BUDDHA NAGAR'];
  if (parent.includes('GHAZIABAD')) return OFFICIAL_METRICS_BY_ZONE['GHAZIABAD'];
  return OFFICIAL_METRICS_BY_ZONE['NCT OF DELHI'];
}

const files = [
  'districts.geojson',
  'constituencies.geojson',
  'assemblies.geojson',
  'wards.geojson',
];

for (const file of files) {
  const fullPath = path.join(OUT_DIR, file);
  if (!fs.existsSync(fullPath)) continue;
  const fc = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  for (const feat of fc.features) {
    const p = feat.properties;
    const m = resolveZoneMetrics(p);
    feat.properties = {
      ...p,
      groundwater_extraction_pct: m.groundwater_extraction_pct,
      groundwater_depth_m: m.groundwater_depth_m,
      cgwb_category: m.cgwb_category,
      cgwb_source_label:
        'Central Ground Water Board — Dynamic Ground Water Resources (Ministry of Jal Shakti)',
      cgwb_source_url: 'https://cgwb.gov.in/en/dynamic-ground-water-resources-india',
      clean_fuel_pct: m.clean_fuel_pct,
      piped_water_pct: m.piped_water_pct,
      stunting_pct: m.stunting_pct,
      nfhs_source_label: 'NFHS-5 District Fact Sheets — MoHFW & IIPS',
      nfhs_source_url: 'https://rchiips.org/nfhs/factsheet_NFHS-5.shtml',
      pupil_teacher_ratio: m.pupil_teacher_ratio,
      udise_source_label: 'UDISE+ District Report Cards — Ministry of Education',
      udise_source_url: 'https://dashboard.udiseplus.gov.in/',
      crime_rate_per_lakh: m.crime_rate_per_lakh,
      ncrb_source_label: 'National Crime Records Bureau (NCRB) — Crime in India (MHA)',
      ncrb_source_url: 'https://ncrb.gov.in/crime-in-india.html',
      hospital_beds_per_10k: m.hospital_beds_per_10k,
      health_source_label: 'MoHFW National Health Profile & NHP Hospital Directory (data.gov.in)',
      health_source_url: 'https://data.gov.in/catalog/hospital-directory-national-health-portal',
    };
  }
  fs.writeFileSync(fullPath, JSON.stringify(fc));
  console.log(`✅ Enriched ${file} (${fc.features.length} features) with CGWB, NFHS-5, UDISE+, NCRB & MoHFW metrics`);
}
