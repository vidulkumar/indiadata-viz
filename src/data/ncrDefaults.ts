import { FocusHubKey, Region } from '../types';

export interface FocusHubConfig {
  key: FocusHubKey;
  label: string;
  regionCode?: string;
  parentMatch?: string;
  center: [number, number];
  zoom: number;
}

export const FOCUS_NCR_HUBS: FocusHubConfig[] = [
  {
    key: 'current',
    label: 'Current Location',
    regionCode: 'dl-nct',
    parentMatch: 'NCT of Delhi',
    center: [77.209, 28.6139],
    zoom: 10.2,
  },
  {
    key: 'all',
    label: 'All NCR',
    center: [77.21, 28.56],
    zoom: 9.2,
  },
  {
    key: 'dl-nct',
    label: 'Delhi',
    regionCode: 'dl-nct',
    parentMatch: 'NCT of Delhi',
    center: [77.185, 28.635],
    zoom: 10.35,
  },
  {
    key: 'hr-ggn',
    label: 'Gurugram',
    regionCode: 'hr-ggn',
    parentMatch: 'Gurugram',
    center: [77.0266, 28.425],
    zoom: 10.3,
  },
  {
    key: 'hr-fbd',
    label: 'Faridabad',
    regionCode: 'hr-fbd',
    parentMatch: 'Faridabad',
    center: [77.3178, 28.38],
    zoom: 10.5,
  },
  {
    key: 'up-gbn',
    label: 'Noida',
    regionCode: 'up-gbn',
    parentMatch: 'Gautam Buddha Nagar / Noida',
    center: [77.48, 28.48],
    zoom: 10.2,
  },
  {
    key: 'up-gzb',
    label: 'Ghaziabad',
    regionCode: 'up-gzb',
    parentMatch: 'Ghaziabad',
    center: [77.4538, 28.72],
    zoom: 10.3,
  },
  {
    key: 'hr-snp',
    label: 'Sonipat',
    regionCode: 'hr-snp',
    parentMatch: 'Sonipat',
    center: [76.92, 29.02],
    zoom: 9.9,
  },
  {
    key: 'hr-jjr',
    label: 'Jhajjar',
    regionCode: 'hr-jjr',
    parentMatch: 'Jhajjar',
    center: [76.66, 28.61],
    zoom: 10.0,
  },
];

export const CPCB_SOURCE_LABEL =
  'Central Pollution Control Board (CPCB CAAQMS / data.gov.in)';
export const CPCB_SOURCE_URL =
  'https://airquality.cpcb.gov.in/ccr/#/caaqm-dashboard-all/caaqm-landing';
export const CPCB_DATAGOV_URL =
  'https://data.gov.in/resource/real-time-air-quality-index-various-locations';

// ─── Verified Government Open API Presets for Upload Page (`/upload`) ────────
export interface VerifiedApiPreset {
  id: string;
  label: string;
  resourceId: string;
  portal: 'data.gov.in' | 'opencity';
  category: string;
  unit: string;
  publisher: string;
  sourceUrl: string;
  description: string;
}

export const VERIFIED_API_PRESETS: VerifiedApiPreset[] = [
  {
    id: 'cpcb-realtime-aqi',
    label: 'CPCB Real-Time Air Quality Index (CAAQMS Stations)',
    resourceId: '3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69',
    portal: 'data.gov.in',
    category: 'Environment',
    unit: 'µg/m³',
    publisher: 'Central Pollution Control Board (MoEFCC)',
    sourceUrl: 'https://data.gov.in/resource/real-time-air-quality-index-various-locations',
    description:
      'Live hourly pollutant averages (PM2.5, PM10, NO2, SO2) with station GPS coordinates from CPCB.',
  },
  {
    id: 'nhp-hospital-directory',
    label: 'National Health Portal (NHP) — Verified Hospital Directory',
    resourceId: '7d208ae4-5d65-47ec-8c80-209d1247d646',
    portal: 'data.gov.in',
    category: 'Public Health',
    unit: 'Beds',
    publisher: 'Ministry of Health and Family Welfare (MoHFW)',
    sourceUrl: 'https://data.gov.in/catalog/hospital-directory-national-health-portal',
    description:
      'State and district directory of public and empaneled hospitals with coordinates and bed counts.',
  },
  {
    id: 'cgwb-groundwater-telemetry',
    label: 'CGWB / NWIC — District Ground Water Extraction & Telemetry',
    resourceId: '6f4b3e1a-9c82-4d30-a15b-8e2f90c41d2e',
    portal: 'data.gov.in',
    category: 'Water & Hydrology',
    unit: '%',
    publisher: 'Central Ground Water Board (Ministry of Jal Shakti)',
    sourceUrl: 'https://cgwb.gov.in/en/dynamic-ground-water-resources-india',
    description:
      'Dynamic ground water resources assessment — annual recharge, extraction stage, and block status.',
  },
];

// Helper to get the appropriate official source label & URL for any MetricKey on a Region
export function getRegionMetricSource(
  region: Region,
  metricKey: string
): { label: string; url: string } {
  switch (metricKey) {
    case 'green_cover_pct':
      return {
        label:
          region.green_source_label ||
          'Forest Survey of India — ISFR 2023 (MoEFCC)',
        url: region.green_source_url || 'https://fsi.nic.in/isfr-2023',
      };
    case 'aqi_pm25':
      return {
        label:
          region.pollution_source_label ||
          'Central Pollution Control Board (CPCB CAAQMS)',
        url: region.pollution_source_url || CPCB_SOURCE_URL,
      };
    case 'groundwater_extraction_pct':
    case 'groundwater_depth_m':
      return {
        label:
          region.cgwb_source_label ||
          'Central Ground Water Board — Dynamic Ground Water Resources (Jal Shakti)',
        url:
          region.cgwb_source_url ||
          'https://cgwb.gov.in/en/dynamic-ground-water-resources-india',
      };
    case 'clean_fuel_pct':
    case 'piped_water_pct':
    case 'stunting_pct':
      return {
        label:
          region.nfhs_source_label ||
          'National Family Health Survey (NFHS-5) District Fact Sheets (MoHFW)',
        url:
          region.nfhs_source_url ||
          'https://rchiips.org/nfhs/factsheet_NFHS-5.shtml',
      };
    case 'pupil_teacher_ratio':
      return {
        label:
          region.udise_source_label ||
          'UDISE+ District Report Cards — Ministry of Education',
        url: region.udise_source_url || 'https://dashboard.udiseplus.gov.in/',
      };
    case 'crime_rate_per_lakh':
      return {
        label:
          region.ncrb_source_label ||
          'National Crime Records Bureau (NCRB) — Crime in India (MHA)',
        url: region.ncrb_source_url || 'https://ncrb.gov.in/crime-in-india.html',
      };
    case 'hospital_beds_per_10k':
      return {
        label:
          region.health_source_label ||
          'MoHFW National Health Profile & NHP Hospital Directory',
        url:
          region.health_source_url ||
          'https://data.gov.in/catalog/hospital-directory-national-health-portal',
      };
    default:
      return {
        label:
          region.census_source_label ||
          'Registrar General & Census Commissioner of India (PCA 2011)',
        url:
          region.census_source_url ||
          'https://censusindia.gov.in/nada/index.php/catalog/42648',
      };
  }
}
