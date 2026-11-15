import { AqiStation, InfraPoint, FocusHubKey } from '../types';

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

export const AQI_DATES = [
  '2025-11-01',
  '2025-11-05',
  '2025-11-10',
  '2025-11-15',
];

const BASE_AQI_STATIONS: Omit<AqiStation, 'pm25' | 'pm10' | 'updated'>[] = [
  {
    station: 'Anand Vihar, Delhi - DPCC',
    city: 'Delhi',
    state: 'NCT of Delhi',
    lat: 28.6476,
    lon: 77.3158,
    no2: 68,
  },
  {
    station: 'RK Puram, Delhi - DPCC',
    city: 'Delhi',
    state: 'NCT of Delhi',
    lat: 28.5633,
    lon: 77.1869,
    no2: 52,
  },
  {
    station: 'Punjabi Bagh, Delhi - DPCC',
    city: 'Delhi',
    state: 'NCT of Delhi',
    lat: 28.674,
    lon: 77.131,
    no2: 59,
  },
  {
    station: 'Mandir Marg, New Delhi - DPCC',
    city: 'Delhi',
    state: 'NCT of Delhi',
    lat: 28.6364,
    lon: 77.2011,
    no2: 47,
  },
  {
    station: 'ITO, New Delhi - CPCB',
    city: 'Delhi',
    state: 'NCT of Delhi',
    lat: 28.6286,
    lon: 77.241,
    no2: 61,
  },
  {
    station: 'Sector 51, Gurugram - HSPCB',
    city: 'Gurugram',
    state: 'Haryana',
    lat: 28.4227,
    lon: 77.0667,
    no2: 41,
  },
  {
    station: 'Sector 62, Noida - IMD',
    city: 'Noida',
    state: 'Uttar Pradesh',
    lat: 28.6245,
    lon: 77.3577,
    no2: 54,
  },
  {
    station: 'Vasundhara, Ghaziabad - UPPCB',
    city: 'Ghaziabad',
    state: 'Uttar Pradesh',
    lat: 28.6603,
    lon: 77.3572,
    no2: 63,
  },
  {
    station: 'Sector 16A, Faridabad - HSPCB',
    city: 'Faridabad',
    state: 'Haryana',
    lat: 28.4088,
    lon: 77.3099,
    no2: 46,
  },
  {
    station: 'Murthal Road, Sonipat - HSPCB',
    city: 'Sonipat',
    state: 'Haryana',
    lat: 28.9931,
    lon: 77.0151,
    no2: 38,
  },
];

// Multi-date PM2.5 readings across 4 dates
const PM25_BY_DATE: Record<string, number[]> = {
  '2025-11-01': [218, 164, 182, 148, 179, 142, 175, 204, 158, 132],
  '2025-11-05': [276, 208, 229, 185, 224, 178, 219, 258, 194, 162],
  '2025-11-10': [315, 238, 264, 212, 268, 202, 249, 294, 221, 184],
  '2025-11-15': [342, 256, 289, 228, 295, 215, 268, 318, 234, 198],
};

export const DEMO_AQI_BY_DATE: Record<string, AqiStation[]> = Object.fromEntries(
  AQI_DATES.map((date) => [
    date,
    BASE_AQI_STATIONS.map((st, idx) => {
      const pm25 = PM25_BY_DATE[date][idx];
      return {
        ...st,
        pm25,
        pm10: Math.round(pm25 * 1.24),
        updated: `CPCB Snapshot · ${date}`,
        date,
      };
    }),
  ])
);

export const DEMO_AQI_STATIONS: AqiStation[] = DEMO_AQI_BY_DATE['2025-11-15'];

export const PUBLIC_INFRA_POINTS: InfraPoint[] = [
  {
    id: 'inf-1',
    name: 'AIIMS & Safdarjung Medical Campus',
    category: 'Government Hospital',
    city: 'New Delhi',
    lat: 28.5672,
    lon: 77.21,
    details: '2,800+ Tertiary Beds • Trauma & Research Hub',
  },
  {
    id: 'inf-2',
    name: 'Lok Nayak (LNJP) & GB Pant Hospital',
    category: 'Government Hospital',
    city: 'Central Delhi',
    lat: 28.6383,
    lon: 77.2373,
    details: '2,000+ Beds • NCT of Delhi Flagship Hospital',
  },
  {
    id: 'inf-3',
    name: 'Medanta - The Medicity',
    category: 'Private Hospital',
    city: 'Gurugram',
    lat: 28.4395,
    lon: 77.0408,
    details: '1,600+ Beds • Sector 38 Multi-Super Specialty',
  },
  {
    id: 'inf-4',
    name: 'Amrita Hospital (Sector 88)',
    category: 'Private Hospital',
    city: 'Faridabad',
    lat: 28.4192,
    lon: 77.3532,
    details: '2,400 Beds • Largest Private Teaching Hospital in NCR',
  },
  {
    id: 'inf-5',
    name: 'District Combined Hospital (Sec 39)',
    category: 'Government Hospital',
    city: 'Noida',
    lat: 28.5675,
    lon: 77.3522,
    details: '400 Beds • Gautam Buddha Nagar District Hospital',
  },
  {
    id: 'inf-6',
    name: 'Rajiv Chowk Metro Interchange',
    category: 'Metro Interchange',
    city: 'New Delhi',
    lat: 28.6328,
    lon: 77.2197,
    details: 'Yellow & Blue Line Hub • 5.2L+ Daily Footfall',
  },
  {
    id: 'inf-7',
    name: 'Kashmere Gate Triple Interchange',
    category: 'Metro Interchange',
    city: 'North Delhi',
    lat: 28.6675,
    lon: 77.2282,
    details: 'Red, Yellow & Violet Line + ISBT Hub',
  },
  {
    id: 'inf-8',
    name: 'Hauz Khas Metro Interchange',
    category: 'Metro Interchange',
    city: 'South Delhi',
    lat: 28.5432,
    lon: 77.2066,
    details: 'Yellow & Magenta Line Interchange',
  },
  {
    id: 'inf-9',
    name: 'Botanical Garden NCR Interchange',
    category: 'Metro Interchange',
    city: 'Noida',
    lat: 28.5641,
    lon: 77.3342,
    details: 'Blue & Magenta Line Cross-State Transit Hub',
  },
  {
    id: 'inf-10',
    name: 'Millennium City Centre Gurugram',
    category: 'Metro Interchange',
    city: 'Gurugram',
    lat: 28.4593,
    lon: 77.0724,
    details: 'Yellow Line Southern Terminus • GMDA Transit Hub',
  },
];

// 1-Click Sample Datasets for Zero-GeoJSON Upload Wizard
export const SAMPLE_ASSEMBLY_CRIME_TABLE = [
  { Constituency: 'New Delhi', State: 'Delhi', Date: '2024-01-01', Crime_Rate_Per_100k: 215, Police_Stations: 6 },
  { Constituency: 'New Delhi', State: 'Delhi', Date: '2025-01-01', Crime_Rate_Per_100k: 188, Police_Stations: 6 },
  { Constituency: 'Kalkaji', State: 'Delhi', Date: '2024-01-01', Crime_Rate_Per_100k: 284, Police_Stations: 4 },
  { Constituency: 'Kalkaji', State: 'Delhi', Date: '2025-01-01', Crime_Rate_Per_100k: 256, Police_Stations: 4 },
  { Constituency: 'R.K. Puram', State: 'Delhi', Date: '2024-01-01', Crime_Rate_Per_100k: 230, Police_Stations: 4 },
  { Constituency: 'RK Puram', State: 'Delhi', Date: '2025-01-01', Crime_Rate_Per_100k: 204, Police_Stations: 4 },
  { Constituency: 'Rohini', State: 'Delhi', Date: '2024-01-01', Crime_Rate_Per_100k: 312, Police_Stations: 5 },
  { Constituency: 'Rohini', State: 'Delhi', Date: '2025-01-01', Crime_Rate_Per_100k: 279, Police_Stations: 5 },
  { Constituency: 'Dwarka', State: 'Delhi', Date: '2024-01-01', Crime_Rate_Per_100k: 268, Police_Stations: 5 },
  { Constituency: 'Dwarka', State: 'Delhi', Date: '2025-01-01', Crime_Rate_Per_100k: 245, Police_Stations: 5 },
  { Constituency: 'Greater Kailash', State: 'Delhi', Date: '2024-01-01', Crime_Rate_Per_100k: 196, Police_Stations: 3 },
  { Constituency: 'Greater Kailash', State: 'Delhi', Date: '2025-01-01', Crime_Rate_Per_100k: 174, Police_Stations: 3 },
  { Constituency: 'Gurgaon', State: 'Haryana', Date: '2024-01-01', Crime_Rate_Per_100k: 325, Police_Stations: 8 },
  { Constituency: 'Gurgaon', State: 'Haryana', Date: '2025-01-01', Crime_Rate_Per_100k: 298, Police_Stations: 9 },
  { Constituency: 'Badshahpur', State: 'Haryana', Date: '2024-01-01', Crime_Rate_Per_100k: 290, Police_Stations: 7 },
  { Constituency: 'Badshahpur', State: 'Haryana', Date: '2025-01-01', Crime_Rate_Per_100k: 272, Police_Stations: 7 },
  { Constituency: 'Noida', State: 'Uttar Pradesh', Date: '2024-01-01', Crime_Rate_Per_100k: 275, Police_Stations: 9 },
  { Constituency: 'Noida', State: 'Uttar Pradesh', Date: '2025-01-01', Crime_Rate_Per_100k: 241, Police_Stations: 10 },
  { Constituency: 'Sahibabad', State: 'Uttar Pradesh', Date: '2024-01-01', Crime_Rate_Per_100k: 348, Police_Stations: 7 },
  { Constituency: 'Sahibabad', State: 'Uttar Pradesh', Date: '2025-01-01', Crime_Rate_Per_100k: 319, Police_Stations: 8 },
  { Constituency: 'Faridabad', State: 'Haryana', Date: '2024-01-01', Crime_Rate_Per_100k: 304, Police_Stations: 6 },
  { Constituency: 'Faridabad', State: 'Haryana', Date: '2025-01-01', Crime_Rate_Per_100k: 282, Police_Stations: 6 },
  { Constituency: 'Sonipat', State: 'Haryana', Date: '2024-01-01', Crime_Rate_Per_100k: 248, Police_Stations: 5 },
  { Constituency: 'Sonipat', State: 'Haryana', Date: '2025-01-01', Crime_Rate_Per_100k: 229, Police_Stations: 5 },
];

export const SAMPLE_MULTIDATE_DISTRICT_AQI = [
  { District_Name: 'NCT of Delhi', Date: '2025-10-15', Mean_PM25: 178, EV_Buses_Deployed: 1950 },
  { District_Name: 'NCT of Delhi', Date: '2025-11-01', Mean_PM25: 254, EV_Buses_Deployed: 2040 },
  { District_Name: 'NCT of Delhi', Date: '2025-11-15', Mean_PM25: 312, EV_Buses_Deployed: 2150 },
  { District_Name: 'Gurgaon', Date: '2025-10-15', Mean_PM25: 146, EV_Buses_Deployed: 220 },
  { District_Name: 'Gurgaon', Date: '2025-11-01', Mean_PM25: 198, EV_Buses_Deployed: 240 },
  { District_Name: 'Gurgaon', Date: '2025-11-15', Mean_PM25: 232, EV_Buses_Deployed: 260 },
  { District_Name: 'Faridabad', Date: '2025-10-15', Mean_PM25: 162, EV_Buses_Deployed: 145 },
  { District_Name: 'Faridabad', Date: '2025-11-01', Mean_PM25: 218, EV_Buses_Deployed: 160 },
  { District_Name: 'Faridabad', Date: '2025-11-15', Mean_PM25: 264, EV_Buses_Deployed: 180 },
  { District_Name: 'G.B. Nagar', Date: '2025-10-15', Mean_PM25: 158, EV_Buses_Deployed: 310 },
  { District_Name: 'G.B. Nagar', Date: '2025-11-01', Mean_PM25: 214, EV_Buses_Deployed: 335 },
  { District_Name: 'G.B. Nagar', Date: '2025-11-15', Mean_PM25: 258, EV_Buses_Deployed: 360 },
  { District_Name: 'Ghaziabad', Date: '2025-10-15', Mean_PM25: 189, EV_Buses_Deployed: 190 },
  { District_Name: 'Ghaziabad', Date: '2025-11-01', Mean_PM25: 266, EV_Buses_Deployed: 205 },
  { District_Name: 'Ghaziabad', Date: '2025-11-15', Mean_PM25: 324, EV_Buses_Deployed: 225 },
  { District_Name: 'Sonepat', Date: '2025-10-15', Mean_PM25: 134, EV_Buses_Deployed: 85 },
  { District_Name: 'Sonepat', Date: '2025-11-01', Mean_PM25: 176, EV_Buses_Deployed: 95 },
  { District_Name: 'Sonepat', Date: '2025-11-15', Mean_PM25: 208, EV_Buses_Deployed: 105 },
  { District_Name: 'Jhajjar', Date: '2025-10-15', Mean_PM25: 126, EV_Buses_Deployed: 65 },
  { District_Name: 'Jhajjar', Date: '2025-11-01', Mean_PM25: 162, EV_Buses_Deployed: 70 },
  { District_Name: 'Jhajjar', Date: '2025-11-15', Mean_PM25: 192, EV_Buses_Deployed: 80 },
];
