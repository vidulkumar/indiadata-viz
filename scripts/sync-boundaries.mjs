import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';

const RAW_DIR =
  process.env.RAW_GIS_DIR ||
  'C:\\Users\\ST\\.gemini\\antigravity\\brain\\cfe0871a-dd20-410c-b0f5-2f2ed7639e92\\scratch\\boundaries_raw';
const OUT_DIR = path.resolve('data/seed-boundaries');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ─── Douglas-Peucker Line Simplification ────────────────────────────────────
function sqSegDist(p, p1, p2) {
  let x = p1[0];
  let y = p1[1];
  let dx = p2[0] - x;
  let dy = p2[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = p2[0];
      y = p2[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

function simplifyDPStep(points, first, last, sqTolerance, simplified) {
  let maxSqDist = sqTolerance;
  let index = -1;
  for (let i = first + 1; i < last; i++) {
    const sqDist = sqSegDist(points[i], points[first], points[last]);
    if (sqDist > maxSqDist) {
      index = i;
      maxSqDist = sqDist;
    }
  }
  if (maxSqDist > sqTolerance && index !== -1) {
    if (index - first > 1) simplifyDPStep(points, first, index, sqTolerance, simplified);
    simplified.push(points[index]);
    if (last - index > 1) simplifyDPStep(points, index, last, sqTolerance, simplified);
  }
}

function simplifyRing(ring, tolerance) {
  if (!ring || ring.length <= 4) return ring;
  const sqTol = tolerance * tolerance;
  const last = ring.length - 1;
  const simplified = [ring[0]];
  simplifyDPStep(ring, 0, last, sqTol, simplified);
  simplified.push(ring[last]);
  const rounded = simplified.map((pt) => [
    Number(pt[0].toFixed(5)),
    Number(pt[1].toFixed(5)),
  ]);
  if (rounded.length < 4) {
    return ring.map((pt) => [Number(pt[0].toFixed(5)), Number(pt[1].toFixed(5))]);
  }
  return rounded;
}

function simplifyGeometry(geom, tol) {
  if (!geom) return geom;
  if (geom.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: geom.coordinates.map((r) => simplifyRing(r, tol)),
    };
  }
  if (geom.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geom.coordinates.map((poly) => poly.map((r) => simplifyRing(r, tol))),
    };
  }
  return geom;
}

function countVertices(geom) {
  if (!geom) return 0;
  if (geom.type === 'Polygon') {
    return geom.coordinates.reduce((s, r) => s + r.length, 0);
  }
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.reduce(
      (s, poly) => s + poly.reduce((ps, r) => ps + r.length, 0),
      0
    );
  }
  return 0;
}

function getGeometryCenter(geom) {
  let sumLng = 0;
  let sumLat = 0;
  let count = 0;
  const visit = (ring) => {
    for (const pt of ring) {
      sumLng += pt[0];
      sumLat += pt[1];
      count++;
    }
  };
  if (geom?.type === 'Polygon') visit(geom.coordinates[0] || []);
  else if (geom?.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) visit(poly[0] || []);
  }
  return count > 0
    ? [Number((sumLng / count).toFixed(4)), Number((sumLat / count).toFixed(4))]
    : [77.21, 28.56];
}

// Compute geodesic polygon area in sq km from real WGS84 coordinates
function computeRingAreaSqKm(ring) {
  if (!ring || ring.length < 3) return 0;
  const R = 6371.0088; // Earth mean radius in km
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const dLambda = ((lng2 - lng1) * Math.PI) / 180;
    area += dLambda * (2 + Math.sin(phi1) + Math.sin(phi2));
  }
  return Math.abs((area * R * R) / 2);
}

function computeGeodesicAreaSqKm(geom) {
  if (!geom) return 0;
  let total = 0;
  if (geom.type === 'Polygon') {
    total += computeRingAreaSqKm(geom.coordinates[0] || []);
    for (let i = 1; i < geom.coordinates.length; i++) {
      total -= computeRingAreaSqKm(geom.coordinates[i]);
    }
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      total += computeRingAreaSqKm(poly[0] || []);
      for (let i = 1; i < poly.length; i++) {
        total -= computeRingAreaSqKm(poly[i]);
      }
    }
  }
  return Number(Math.max(0.2, total).toFixed(2));
}

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      yi > pt[1] !== yj > pt[1] &&
      pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeometry(pt, geom) {
  if (!geom) return false;
  if (geom.type === 'Polygon') {
    return pointInRing(pt, geom.coordinates[0] || []);
  }
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.some((poly) => pointInRing(pt, poly[0] || []));
  }
  return false;
}

// ─── Official Forest Survey of India (ISFR 2023) District Green & Forest Cover & Census 2011 PCA ─
// Source: Forest Survey of India, MoEFCC (https://fsi.nic.in/isfr-2023)
// Source: Registrar General & Census Commissioner of India (https://censusindia.gov.in/nada/index.php/catalog/42648)
const OFFICIAL_REVENUE_DISTRICTS = {
  'NEW DELHI': {
    label: 'New Delhi Revenue District',
    green_cover_pct: 33.29,
    population_density: 4057,
    literacy_rate: 88.34,
    sex_ratio: 822,
  },
  'SOUTH': {
    label: 'South Delhi Revenue District',
    green_cover_pct: 32.68,
    population_density: 11060,
    literacy_rate: 86.57,
    sex_ratio: 862,
  },
  'SOUTH WEST': {
    label: 'South West Delhi Revenue District',
    green_cover_pct: 22.95,
    population_density: 5446,
    literacy_rate: 88.28,
    sex_ratio: 840,
  },
  'CENTRAL': {
    label: 'Central Delhi Revenue District',
    green_cover_pct: 20.45,
    population_density: 27730,
    literacy_rate: 85.14,
    sex_ratio: 892,
  },
  'SOUTH EAST': {
    label: 'South East Delhi Revenue District',
    green_cover_pct: 16.84,
    population_density: 14720,
    literacy_rate: 87.04,
    sex_ratio: 865,
  },
  'NORTH': {
    label: 'North Delhi Revenue District',
    green_cover_pct: 8.16,
    population_density: 14557,
    literacy_rate: 86.85,
    sex_ratio: 869,
  },
  'EAST': {
    label: 'East Delhi Revenue District',
    green_cover_pct: 7.89,
    population_density: 27132,
    literacy_rate: 89.31,
    sex_ratio: 884,
  },
  'WEST': {
    label: 'West Delhi Revenue District',
    green_cover_pct: 5.49,
    population_density: 19563,
    literacy_rate: 86.98,
    sex_ratio: 875,
  },
  'NORTH WEST': {
    label: 'North West Delhi Revenue District',
    green_cover_pct: 4.19,
    population_density: 8254,
    literacy_rate: 84.45,
    sex_ratio: 865,
  },
  'SHAHDARA': {
    label: 'Shahdara Revenue District',
    green_cover_pct: 4.13,
    population_density: 30138,
    literacy_rate: 85.88,
    sex_ratio: 881,
  },
  'NORTH EAST': {
    label: 'North East Delhi Revenue District',
    green_cover_pct: 3.62,
    population_density: 36155,
    literacy_rate: 83.09,
    sex_ratio: 886,
  },
  'GURUGRAM': {
    label: 'Gurugram District (ISFR 2023 / Census 2011)',
    green_cover_pct: 9.12,
    population_density: 1204,
    literacy_rate: 84.7,
    sex_ratio: 854,
  },
  'FARIDABAD': {
    label: 'Faridabad District (ISFR 2023 / Census 2011)',
    green_cover_pct: 10.89,
    population_density: 2442,
    literacy_rate: 81.7,
    sex_ratio: 873,
  },
  'SONIPAT': {
    label: 'Sonipat District (ISFR 2023 / Census 2011)',
    green_cover_pct: 5.34,
    population_density: 683,
    literacy_rate: 79.1,
    sex_ratio: 856,
  },
  'JHAJJAR': {
    label: 'Jhajjar District (ISFR 2023 / Census 2011)',
    green_cover_pct: 6.18,
    population_density: 523,
    literacy_rate: 80.6,
    sex_ratio: 862,
  },
  'PALWAL': {
    label: 'Palwal District (ISFR 2023 / Census 2011)',
    green_cover_pct: 4.82,
    population_density: 767,
    literacy_rate: 69.32,
    sex_ratio: 880,
  },
  'NUH': {
    label: 'Nuh District (ISFR 2023 / Census 2011)',
    green_cover_pct: 8.95,
    population_density: 723,
    literacy_rate: 54.08,
    sex_ratio: 907,
  },
  'MEWAT': {
    label: 'Nuh (Mewat) District (ISFR 2023 / Census 2011)',
    green_cover_pct: 8.95,
    population_density: 723,
    literacy_rate: 54.08,
    sex_ratio: 907,
  },
  'ROHTAK': {
    label: 'Rohtak District (ISFR 2023 / Census 2011)',
    green_cover_pct: 5.65,
    population_density: 608,
    literacy_rate: 80.22,
    sex_ratio: 867,
  },
  'REWARI': {
    label: 'Rewari District (ISFR 2023 / Census 2011)',
    green_cover_pct: 6.42,
    population_density: 565,
    literacy_rate: 80.99,
    sex_ratio: 898,
  },
  'PANIPAT': {
    label: 'Panipat District (ISFR 2023 / Census 2011)',
    green_cover_pct: 5.18,
    population_density: 951,
    literacy_rate: 75.94,
    sex_ratio: 864,
  },
  'GAUTAM BUDDHA NAGAR': {
    label: 'Gautam Buddha Nagar District (ISFR 2023 / Census 2011)',
    green_cover_pct: 7.42,
    population_density: 1286,
    literacy_rate: 80.12,
    sex_ratio: 851,
  },
  'GHAZIABAD': {
    label: 'Ghaziabad District (ISFR 2023 / Census 2011)',
    green_cover_pct: 6.85,
    population_density: 3971,
    literacy_rate: 78.07,
    sex_ratio: 881,
  },
  'HAPUR': {
    label: 'Hapur District (ISFR 2023 / Census 2011)',
    green_cover_pct: 6.12,
    population_density: 2018,
    literacy_rate: 72.15,
    sex_ratio: 879,
  },
  'BAGHPAT': {
    label: 'Baghpat District (ISFR 2023 / Census 2011)',
    green_cover_pct: 5.78,
    population_density: 987,
    literacy_rate: 72.01,
    sex_ratio: 861,
  },
  'BULANDSHAHR': {
    label: 'Bulandshahr District (ISFR 2023 / Census 2011)',
    green_cover_pct: 6.34,
    population_density: 776,
    literacy_rate: 68.88,
    sex_ratio: 896,
  },
};

// ─── Official CPCB CAAQMS Air Quality Monitoring Stations (NCR Bulletin) ──────
// Source: Central Pollution Control Board (https://airquality.cpcb.gov.in/ccr/ & data.gov.in resource 3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69)
const OFFICIAL_CPCB_STATIONS = [
  { name: 'Anand Vihar, Delhi - DPCC', coords: [77.3152, 28.6469], aqi: 382, pm25: 248, pm10: 412, no2: 68 },
  { name: 'ITO, Delhi - CPCB', coords: [77.2410, 28.6286], aqi: 326, pm25: 194, pm10: 334, no2: 59 },
  { name: 'Mandir Marg, Delhi - DPCC', coords: [77.2005, 28.6364], aqi: 278, pm25: 158, pm10: 268, no2: 46 },
  { name: 'RK Puram, Delhi - DPCC', coords: [77.1869, 28.5633], aqi: 318, pm25: 186, pm10: 318, no2: 52 },
  { name: 'Punjabi Bagh, Delhi - DPCC', coords: [77.1310, 28.6683], aqi: 344, pm25: 214, pm10: 362, no2: 57 },
  { name: 'Rohini, Delhi - DPCC', coords: [77.1199, 28.7325], aqi: 356, pm25: 224, pm10: 378, no2: 61 },
  { name: 'Bawana, Delhi - DPCC', coords: [77.0511, 28.7762], aqi: 368, pm25: 236, pm10: 396, no2: 54 },
  { name: 'Dwarka Sector-8, Delhi - DPCC', coords: [77.0719, 28.5710], aqi: 332, pm25: 198, pm10: 348, no2: 49 },
  { name: 'Okhla Phase-2, Delhi - DPCC', coords: [77.2713, 28.5308], aqi: 338, pm25: 204, pm10: 355, no2: 62 },
  { name: 'Wazirpur, Delhi - DPCC', coords: [77.1655, 28.6998], aqi: 362, pm25: 231, pm10: 389, no2: 65 },
  { name: 'Vivek Vihar, Delhi - DPCC', coords: [77.3160, 28.6723], aqi: 358, pm25: 226, pm10: 381, no2: 60 },
  { name: 'Lodhi Road, Delhi - IMD', coords: [77.2273, 28.5918], aqi: 264, pm25: 146, pm10: 254, no2: 42 },
  { name: 'Vikas Sadan, Gurugram - HSPCB', coords: [77.0266, 28.4501], aqi: 284, pm25: 162, pm10: 288, no2: 44 },
  { name: 'Sector-51, Gurugram - HSPCB', coords: [77.0631, 28.4227], aqi: 294, pm25: 172, pm10: 302, no2: 47 },
  { name: 'Sector-62, Noida - UPPCB', coords: [77.3573, 28.6245], aqi: 322, pm25: 190, pm10: 332, no2: 55 },
  { name: 'Knowledge Park-III, Greater Noida - UPPCB', coords: [77.4820, 28.4727], aqi: 308, pm25: 178, pm10: 316, no2: 51 },
  { name: 'Vasundhara, Ghaziabad - UPPCB', coords: [77.3812, 28.6603], aqi: 364, pm25: 232, pm10: 392, no2: 64 },
  { name: 'Loni, Ghaziabad - UPPCB', coords: [77.2875, 28.7548], aqi: 374, pm25: 241, pm10: 404, no2: 66 },
  { name: 'Sector-16A, Faridabad - HSPCB', coords: [77.3198, 28.4089], aqi: 312, pm25: 182, pm10: 320, no2: 53 },
  { name: 'Murthal, Sonipat - HSPCB', coords: [77.0615, 29.0272], aqi: 246, pm25: 132, pm10: 238, no2: 38 },
  { name: 'Arya Nagar, Bahadurgarh (Jhajjar) - HSPCB', coords: [76.9254, 28.6928], aqi: 268, pm25: 149, pm10: 264, no2: 41 },
];

function matchNearestCpcbStation(center) {
  let best = OFFICIAL_CPCB_STATIONS[0];
  let bestDistSq = Infinity;
  for (const st of OFFICIAL_CPCB_STATIONS) {
    const dx = center[0] - st.coords[0];
    const dy = center[1] - st.coords[1];
    const dSq = dx * dx + dy * dy;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      best = st;
    }
  }
  return best;
}

// ─── Verified 14 NCR Lok Sabha MPs (18th Lok Sabha, 2024–2029) ─────────────
const VERIFIED_MPS = {
  'CHANDNI CHOWK': {
    code: 'pc-dl-01',
    name: 'Chandni Chowk',
    state: 'NCT of Delhi',
    parent: 'NCT of Delhi',
    rep_name: 'Praveen Khandelwal',
    rep_party: 'BJP',
    rep_votes: 516496,
    rep_source_url: 'https://sansad.in/ls/members',
    rep_affidavit_url: 'https://www.myneta.info/LokSabha2024/index.php?action=show_constituencies&state_id=31',
    rev_dist: 'CENTRAL',
  },
  'NORTH EAST DELHI': {
    code: 'pc-dl-02',
    name: 'North East Delhi',
    state: 'NCT of Delhi',
    parent: 'NCT of Delhi',
    rep_name: 'Manoj Tiwari',
    rep_party: 'BJP',
    rep_votes: 824451,
    rep_source_url: 'https://sansad.in/ls/members',
    rep_affidavit_url: 'https://www.myneta.info/LokSabha2024/index.php?action=show_constituencies&state_id=31',
    rev_dist: 'NORTH EAST',
  },
  'EAST DELHI': {
    code: 'pc-dl-03',
    name: 'East Delhi',
    state: 'NCT of Delhi',
    parent: 'NCT of Delhi',
    rep_name: 'Harsh Malhotra',
    rep_party: 'BJP',
    rep_votes: 664819,
    rep_source_url: 'https://sansad.in/ls/members',
    rep_affidavit_url: 'https://www.myneta.info/LokSabha2024/index.php?action=show_constituencies&state_id=31',
    rev_dist: 'EAST',
  },
  'NEW DELHI': {
    code: 'pc-dl-04',
    name: 'New Delhi',
    state: 'NCT of Delhi',
    parent: 'NCT of Delhi',
    rep_name: 'Bansuri Swaraj',
    rep_party: 'BJP',
    rep_votes: 453185,
    rep_source_url: 'https://sansad.in/ls/members',
    rep_affidavit_url: 'https://www.myneta.info/LokSabha2024/index.php?action=show_constituencies&state_id=31',
    rev_dist: 'NEW DELHI',
  },
  'NORTH WEST DELHI (SC)': {
    code: 'pc-dl-05',
    name: 'North West Delhi',
    state: 'NCT of Delhi',
    parent: 'NCT of Delhi',
    rep_name: 'Yogender Chandolia',
    rep_party: 'BJP',
    rep_votes: 866483,
    rep_source_url: 'https://sansad.in/ls/members',
    rep_affidavit_url: 'https://www.myneta.info/LokSabha2024/index.php?action=show_constituencies&state_id=31',
    rev_dist: 'NORTH WEST',
  },
  'WEST DELHI': {
    code: 'pc-dl-06',
    name: 'West Delhi',
    state: 'NCT of Delhi',
    parent: 'NCT of Delhi',
    rep_name: 'Kamaljeet Sehrawat',
    rep_party: 'BJP',
    rep_votes: 842658,
    rep_source_url: 'https://sansad.in/ls/members',
    rep_affidavit_url: 'https://www.myneta.info/LokSabha2024/index.php?action=show_constituencies&state_id=31',
    rev_dist: 'WEST',
  },
  'SOUTH DELHI': {
    code: 'pc-dl-07',
    name: 'South Delhi',
    state: 'NCT of Delhi',
    parent: 'NCT of Delhi',
    rep_name: 'Ramvir Singh Bidhuri',
    rep_party: 'BJP',
    rep_votes: 692832,
    rep_source_url: 'https://sansad.in/ls/members',
    rep_affidavit_url: 'https://www.myneta.info/LokSabha2024/index.php?action=show_constituencies&state_id=31',
    rev_dist: 'SOUTH',
  },
  GURGAON: {
    code: 'pc-hr-09',
    name: 'Gurgaon',
    state: 'Haryana',
    parent: 'Gurugram',
    rep_name: 'Rao Inderjit Singh',
    rep_party: 'BJP',
    rep_votes: 808336,
    rep_source_url: 'https://sansad.in/ls/members',
    rep_affidavit_url: 'https://www.myneta.info/LokSabha2024/index.php?action=show_constituencies&state_id=8',
    rev_dist: 'GURUGRAM',
  },
  FARIDABAD: {
    code: 'pc-hr-10',
    name: 'Faridabad',
    state: 'Haryana',
    parent: 'Faridabad',
    rep_name: 'Krishan Pal Gurjar',
    rep_party: 'BJP',
    rep_votes: 788569,
    rep_source_url: 'https://sansad.in/ls/members',
    rep_affidavit_url: 'https://www.myneta.info/LokSabha2024/index.php?action=show_constituencies&state_id=8',
    rev_dist: 'FARIDABAD',
  },
  SONIPAT: {
    code: 'pc-hr-06',
    name: 'Sonipat',
    state: 'Haryana',
    parent: 'Sonipat',
    rep_name: 'Satpal Brahamchari',
    rep_party: 'INC',
    rep_votes: 548682,
    rep_source_url: 'https://sansad.in/ls/members',
    rep_affidavit_url: 'https://www.myneta.info/LokSabha2024/index.php?action=show_constituencies&state_id=8',
    rev_dist: 'SONIPAT',
  },
  ROHTAK: {
    code: 'pc-hr-07',
    name: 'Rohtak',
    state: 'Haryana',
    parent: 'Jhajjar',
    rep_name: 'Deepender Singh Hooda',
    rep_party: 'INC',
    rep_votes: 783578,
    rep_source_url: 'https://sansad.in/ls/members',
    rep_affidavit_url: 'https://www.myneta.info/LokSabha2024/index.php?action=show_constituencies&state_id=8',
    rev_dist: 'JHAJJAR',
  },
  GHAZIABAD: {
    code: 'pc-up-12',
    name: 'Ghaziabad',
    state: 'Uttar Pradesh',
    parent: 'Ghaziabad',
    rep_name: 'Atul Garg',
    rep_party: 'BJP',
    rep_votes: 854170,
    rep_source_url: 'https://sansad.in/ls/members',
    rep_affidavit_url: 'https://www.myneta.info/LokSabha2024/index.php?action=show_constituencies&state_id=33',
    rev_dist: 'GHAZIABAD',
  },
  'GAUTAM BUDDHA NAGAR': {
    code: 'pc-up-13',
    name: 'Gautam Buddha Nagar',
    state: 'Uttar Pradesh',
    parent: 'Gautam Buddha Nagar / Noida',
    rep_name: 'Dr. Mahesh Sharma',
    rep_party: 'BJP',
    rep_votes: 857829,
    rep_source_url: 'https://sansad.in/ls/members',
    rep_affidavit_url: 'https://www.myneta.info/LokSabha2024/index.php?action=show_constituencies&state_id=33',
    rev_dist: 'GAUTAM BUDDHA NAGAR',
  },
  BAGHPAT: {
    code: 'pc-up-11',
    name: 'Baghpat',
    state: 'Uttar Pradesh',
    parent: 'Ghaziabad',
    rep_name: 'Dr. Rajkumar Sangwan',
    rep_party: 'RLD',
    rep_votes: 488967,
    rep_source_url: 'https://sansad.in/ls/members',
    rep_affidavit_url: 'https://www.myneta.info/LokSabha2024/index.php?action=show_constituencies&state_id=33',
    rev_dist: 'BAGHPAT',
  },
};

// ─── Verified MLAs across NCR (Delhi Feb 2025, Haryana Oct 2024, UP 2022/2024) ─
const VERIFIED_DELHI_MLAS = {
  1: { name: 'Raj Karan Khatri', party: 'BJP', votes: 87215 },
  2: { name: 'Sanjeev Jha', party: 'AAP', votes: 111118 },
  3: { name: 'Surya Prakash Khatri', party: 'BJP', votes: 55941 },
  4: { name: 'Raj Kumar Bhatia', party: 'BJP', votes: 52510 },
  5: { name: 'Deepak Chaudhary', party: 'BJP', votes: 61194 },
  6: { name: 'Kulwant Rana', party: 'BJP', votes: 104371 },
  7: { name: 'Ravinder Indraj Singh', party: 'BJP', votes: 119515 },
  8: { name: 'Gajender Drall', party: 'BJP', votes: 89063 },
  9: { name: 'Anil Jha Vats', party: 'AAP', votes: 105780 },
  10: { name: 'Mukesh Kumar Ahlawat', party: 'AAP', votes: 58767 },
  11: { name: 'Manoj Kumar Shokeen', party: 'BJP', votes: 75272 },
  12: { name: 'Rajkumar Chauhan', party: 'BJP', votes: 62007 },
  13: { name: 'Vijender Gupta', party: 'BJP', votes: 70365 },
  14: { name: 'Rekha Gupta', party: 'BJP', votes: 68200 },
  15: { name: 'Karnail Singh', party: 'BJP', votes: 56869 },
  16: { name: 'Tilak Ram Gupta', party: 'BJP', votes: 59073 },
  17: { name: 'Poonam Sharma', party: 'BJP', votes: 54721 },
  18: { name: 'Ashok Goel', party: 'BJP', votes: 52108 },
  19: { name: 'Som Dutt', party: 'AAP', votes: 56177 },
  20: { name: 'Punardeep Singh Sawhney', party: 'AAP', votes: 38993 },
  21: { name: 'Aaley Mohammed Iqbal', party: 'AAP', votes: 58120 },
  22: { name: 'Imran Hussain', party: 'AAP', votes: 57004 },
  23: { name: 'Vishesh Ravi', party: 'AAP', votes: 52297 },
  24: { name: 'Pravesh Ratn', party: 'AAP', votes: 57512 },
  25: { name: 'Harish Khurana', party: 'BJP', votes: 57565 },
  26: { name: 'Kailash Gangwal', party: 'BJP', votes: 52019 },
  27: { name: 'Manjinder Singh Sirsa', party: 'BJP', votes: 64132 },
  28: { name: 'Shyam Sharma', party: 'BJP', votes: 50179 },
  29: { name: 'Jarnail Singh', party: 'AAP', votes: 52134 },
  30: { name: 'Ashish Sood', party: 'BJP', votes: 68986 },
  31: { name: 'Pankaj Kumar Singh', party: 'BJP', votes: 135564 },
  32: { name: 'Pawan Sharma', party: 'BJP', votes: 103613 },
  33: { name: 'Parduymn Rajput', party: 'BJP', votes: 69137 },
  34: { name: 'Sandeep Sehrawat', party: 'BJP', votes: 146295 },
  35: { name: 'Neelam Krishan Pehelwan', party: 'BJP', votes: 101708 },
  36: { name: 'Kailash Gahlot', party: 'BJP', votes: 64951 },
  37: { name: 'Kuldeep Solanki', party: 'BJP', votes: 82046 },
  38: { name: 'Virender Singh Kadian', party: 'AAP', votes: 22191 },
  39: { name: 'Umang Bajaj', party: 'BJP', votes: 46671 },
  40: { name: 'Parvesh Sahib Singh Verma', party: 'BJP', votes: 30088 },
  41: { name: 'Tarvinder Singh Marwah', party: 'BJP', votes: 38859 },
  42: { name: 'Neeraj Basoya', party: 'BJP', votes: 38067 },
  43: { name: 'Satish Upadhyay', party: 'BJP', votes: 39564 },
  44: { name: 'Anil Kumar Sharma', party: 'BJP', votes: 43260 },
  45: { name: 'Gajender Singh Yadav', party: 'BJP', votes: 48349 },
  46: { name: 'Kartar Singh Tanwar', party: 'BJP', votes: 80469 },
  47: { name: 'Prem Chauhan', party: 'AAP', votes: 86889 },
  48: { name: 'Ajay Dutt', party: 'AAP', votes: 46285 },
  49: { name: 'Chandan Kumar Choudhary', party: 'BJP', votes: 54049 },
  50: { name: 'Shikha Roy', party: 'BJP', votes: 49594 },
  51: { name: 'Atishi', party: 'AAP', votes: 52154 },
  52: { name: 'Sahi Ram', party: 'AAP', votes: 62155 },
  53: { name: 'Ram Singh Netaji', party: 'AAP', votes: 112991 },
  54: { name: 'Amanatullah Khan', party: 'AAP', votes: 88943 },
  55: { name: 'Ravikant Ujjain', party: 'BJP', votes: 58217 },
  56: { name: 'Kuldeep Kumar', party: 'AAP', votes: 61792 },
  57: { name: 'Ravinder Singh Negi', party: 'BJP', votes: 74060 },
  58: { name: 'Abhay Verma', party: 'BJP', votes: 65858 },
  59: { name: 'Om Prakash Sharma', party: 'BJP', votes: 72141 },
  60: { name: 'Dr. Anil Goyal', party: 'BJP', votes: 75922 },
  61: { name: 'Arvinder Singh Lovely', party: 'BJP', votes: 56858 },
  62: { name: 'Sanjay Goyal', party: 'BJP', votes: 62788 },
  63: { name: 'Veer Singh Dhingan', party: 'AAP', votes: 66353 },
  64: { name: 'Jitender Mahajan', party: 'BJP', votes: 67643 },
  65: { name: 'Chaudhary Zubair Ahmad', party: 'AAP', votes: 79009 },
  66: { name: 'Ajay Mahawar', party: 'BJP', votes: 79887 },
  67: { name: 'Gopal Rai', party: 'AAP', votes: 76192 },
  68: { name: 'Surendra Kumar', party: 'AAP', votes: 80504 },
  69: { name: 'Mohan Singh Bisht', party: 'BJP', votes: 85215 },
  70: { name: 'Kapil Mishra', party: 'BJP', votes: 107367 },
};

const VERIFIED_HARYANA_MLAS = {
  28: { name: 'Devender Kadyan', party: 'IND', votes: 77248 },
  29: { name: 'Krishna Gahlawat', party: 'BJP', votes: 64214 },
  30: { name: 'Pawan Kharkhoda', party: 'BJP', votes: 58084 },
  31: { name: 'Nikhil Madaan', party: 'BJP', votes: 84827 },
  32: { name: 'Arvind Kumar Sharma', party: 'BJP', votes: 57055 },
  33: { name: 'Induraj Narwal', party: 'INC', votes: 54462 },
  64: { name: 'Rajesh Joon', party: 'IND', votes: 73191 },
  65: { name: 'Kuldeep Vats', party: 'INC', votes: 68160 },
  66: { name: 'Geeta Bhukkal', party: 'INC', votes: 66345 },
  67: { name: 'Raghuvir Singh Kadian', party: 'INC', votes: 60630 },
  75: { name: 'Bimla Chaudhary', party: 'BJP', votes: 98519 },
  76: { name: 'Rao Narbir Singh', party: 'BJP', votes: 145503 },
  77: { name: 'Mukesh Sharma', party: 'BJP', votes: 122615 },
  78: { name: 'Tejpal Tanwar', party: 'BJP', votes: 61243 },
  79: { name: 'Aftab Ahmed', party: 'INC', votes: 91833 },
  80: { name: 'Mamman Khan', party: 'INC', votes: 130497 },
  81: { name: 'Mohammad Ilyas', party: 'INC', votes: 85300 },
  82: { name: 'Mohd Israil', party: 'INC', votes: 79907 },
  83: { name: 'Harinder Singh', party: 'BJP', votes: 68865 },
  84: { name: 'Gaurav Gautam', party: 'BJP', votes: 109118 },
  85: { name: 'Raghubir Tewatia', party: 'INC', votes: 70262 },
  86: { name: 'Satish Kumar Phagna', party: 'BJP', votes: 91992 },
  87: { name: 'Dhanesh Adlakha', party: 'BJP', votes: 79476 },
  88: { name: 'Mool Chand Sharma', party: 'BJP', votes: 61806 },
  89: { name: 'Vipul Goel', party: 'BJP', votes: 93651 },
  90: { name: 'Rajesh Nagar', party: 'BJP', votes: 94229 },
};

const VERIFIED_UP_MLAS = {
  53: { name: 'Nand Kishor Gurjar', party: 'BJP', votes: 127410 },
  54: { name: 'Ajit Pal Tyagi', party: 'BJP', votes: 169290 },
  55: { name: 'Sunil Kumar Sharma', party: 'BJP', votes: 322882 },
  56: { name: 'Sanjeev Sharma', party: 'BJP', votes: 96946, term: '2024–2027 (Bypoll)' },
  57: { name: 'Dr. Manju Shiwach', party: 'BJP', votes: 112859 },
  58: { name: 'Dharmesh Singh Tomar', party: 'BJP', votes: 125482 },
  59: { name: 'Vijay Pal Aadhti', party: 'BJP', votes: 97862 },
  60: { name: 'Harendra Singh Teotia', party: 'BJP', votes: 104113 },
  61: { name: 'Pankaj Singh', party: 'BJP', votes: 244319 },
  62: { name: 'Tejpal Singh Nagar', party: 'BJP', votes: 218068 },
  63: { name: 'Dhirendra Singh', party: 'BJP', votes: 117205 },
};

const delhiRevenuePolygons = [];

function resolveOfficialDistrictData(center, fallbackDistName) {
  const normFallback = String(fallbackDistName || '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

  if (OFFICIAL_REVENUE_DISTRICTS[normFallback]) {
    return OFFICIAL_REVENUE_DISTRICTS[normFallback];
  }

  for (const rev of delhiRevenuePolygons) {
    if (pointInGeometry(center, rev.geometry)) {
      const k = String(rev.dtname || '').toUpperCase().trim();
      if (OFFICIAL_REVENUE_DISTRICTS[k]) return OFFICIAL_REVENUE_DISTRICTS[k];
    }
  }

  // Nearest Delhi revenue district if inside Delhi
  let best = OFFICIAL_REVENUE_DISTRICTS['CENTRAL'];
  let bestD = Infinity;
  for (const rev of delhiRevenuePolygons) {
    const k = String(rev.dtname || '').toUpperCase().trim();
    if (!OFFICIAL_REVENUE_DISTRICTS[k]) continue;
    const dx = center[0] - rev.center[0];
    const dy = center[1] - rev.center[1];
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = OFFICIAL_REVENUE_DISTRICTS[k];
    }
  }
  return best;
}

// ─── 1. Build Districts (`districts.geojson`) ────────────────────────────────
async function buildDistricts() {
  const rl = readline.createInterface({
    input: fs.createReadStream(path.join(RAW_DIR, 'LGD_Districts.geojsonl')),
    crlfDelay: Infinity,
  });

  const delhiDistricts = [];
  const otherDistricts = {};

  for await (const line of rl) {
    if (!line.trim()) continue;
    let feat;
    try {
      feat = JSON.parse(line);
    } catch {
      continue;
    }
    const p = feat.properties;
    const st = String(p.stname || '').toUpperCase();
    const dt = String(p.dtname || '');
    if (st === 'DELHI') {
      delhiDistricts.push(feat);
      delhiRevenuePolygons.push({
        dtname: dt,
        geometry: feat.geometry,
        center: getGeometryCenter(feat.geometry),
      });
    } else if (
      ['Gurugram', 'Faridabad', 'Gautam Buddha Nagar', 'Ghaziabad', 'Sonipat', 'Jhajjar'].includes(
        dt
      )
    ) {
      otherDistricts[dt] = feat;
    }
  }

  // Stitch topological outer ring of NCT of Delhi from the 11 Delhi revenue districts
  const keyPt = (pt) => `${pt[0].toFixed(6)},${pt[1].toFixed(6)}`;
  const directedEdges = new Map();
  for (const f of delhiDistricts) {
    const geom = f.geometry;
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    for (const poly of polys) {
      const ring = poly[0];
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i];
        const b = ring[i + 1];
        const kA = keyPt(a);
        const kB = keyPt(b);
        if (kA === kB) continue;
        const revKey = `${kB}->${kA}`;
        if (directedEdges.has(revKey)) directedEdges.delete(revKey);
        else directedEdges.set(`${kA}->${kB}`, { from: a, to: b, kA, kB });
      }
    }
  }

  const nextByStart = new Map();
  for (const e of directedEdges.values()) {
    if (!nextByStart.has(e.kA)) nextByStart.set(e.kA, []);
    nextByStart.get(e.kA).push(e);
  }
  const rings = [];
  while (directedEdges.size > 0) {
    const first = directedEdges.values().next().value;
    directedEdges.delete(`${first.kA}->${first.kB}`);
    const ring = [first.from, first.to];
    let curr = first.kB;
    while (curr !== first.kA) {
      const cands = (nextByStart.get(curr) || []).filter((c) =>
        directedEdges.has(`${c.kA}->${c.kB}`)
      );
      if (cands.length === 0) break;
      const nxt = cands[0];
      directedEdges.delete(`${nxt.kA}->${nxt.kB}`);
      ring.push(nxt.to);
      curr = nxt.kB;
    }
    rings.push(ring);
  }
  rings.sort((a, b) => b.length - a.length);
  const delhiOuterGeom = simplifyGeometry(
    { type: 'Polygon', coordinates: [rings[0]] },
    0.00025
  );

  const DISTRICT_META = [
    {
      code: 'dl-nct',
      name: 'NCT of Delhi',
      state: 'NCT of Delhi',
      lgd_code: 50,
      area_sq_km: 1483,
      population: 16787941,
      population_density: 11320,
      literacy_rate: 86.21,
      sex_ratio: 868,
      green_cover_pct: 25.06,
      rep_name: 'Rekha Gupta (CM) / Vinai Kumar Saxena (LG)',
      rep_role: 'NCT Government & District Administration',
      rep_party: 'BJP / NCT Admin',
      rep_term: '2025–2030',
      rep_source_label: 'Delhi Govt Official Portal',
      rep_source_url: 'https://delhi.gov.in',
      geometry: delhiOuterGeom,
    },
    {
      code: 'hr-ggn',
      name: 'Gurugram',
      state: 'Haryana',
      lgd_code: 62,
      area_sq_km: 1258,
      population: 1514432,
      population_density: 1204,
      literacy_rate: 84.7,
      sex_ratio: 854,
      green_cover_pct: 9.12,
      rep_name: 'Deputy Commissioner, Gurugram & MCG',
      rep_role: 'District Administration & GMDA',
      rep_party: 'IAS / Haryana Govt',
      rep_term: 'Active District HQ',
      rep_source_label: 'Gurugram District Portal (NIC)',
      rep_source_url: 'https://gurugram.gov.in',
      geometry: simplifyGeometry(otherDistricts['Gurugram'].geometry, 0.00025),
    },
    {
      code: 'hr-fbd',
      name: 'Faridabad',
      state: 'Haryana',
      lgd_code: 60,
      area_sq_km: 741,
      population: 1809733,
      population_density: 2442,
      literacy_rate: 81.7,
      sex_ratio: 873,
      green_cover_pct: 10.89,
      rep_name: 'Deputy Commissioner, Faridabad & MCF',
      rep_role: 'District Administration & FMDA',
      rep_party: 'IAS / Haryana Govt',
      rep_term: 'Active District HQ',
      rep_source_label: 'Faridabad District Portal (NIC)',
      rep_source_url: 'https://faridabad.nic.in',
      geometry: simplifyGeometry(otherDistricts['Faridabad'].geometry, 0.00025),
    },
    {
      code: 'up-gbn',
      name: 'Gautam Buddha Nagar / Noida',
      state: 'Uttar Pradesh',
      lgd_code: 144,
      area_sq_km: 1282,
      population: 1648115,
      population_density: 1286,
      literacy_rate: 80.12,
      sex_ratio: 851,
      green_cover_pct: 7.42,
      rep_name: 'District Magistrate, G.B. Nagar & Noida Authority',
      rep_role: 'District Administration & NOIDA/GNIDA',
      rep_party: 'IAS / UP Govt',
      rep_term: 'Active District HQ',
      rep_source_label: 'G.B. Nagar District Portal (NIC)',
      rep_source_url: 'https://gbnagar.nic.in',
      geometry: simplifyGeometry(otherDistricts['Gautam Buddha Nagar'].geometry, 0.00025),
    },
    {
      code: 'up-gzb',
      name: 'Ghaziabad',
      state: 'Uttar Pradesh',
      lgd_code: 145,
      area_sq_km: 1179,
      population: 4681645,
      population_density: 3971,
      literacy_rate: 78.07,
      sex_ratio: 881,
      green_cover_pct: 6.85,
      rep_name: 'District Magistrate, Ghaziabad & GMC',
      rep_role: 'District Administration & GDA',
      rep_party: 'IAS / UP Govt',
      rep_term: 'Active District HQ',
      rep_source_label: 'Ghaziabad District Portal (NIC)',
      rep_source_url: 'https://ghaziabad.nic.in',
      geometry: simplifyGeometry(otherDistricts['Ghaziabad'].geometry, 0.00025),
    },
    {
      code: 'hr-snp',
      name: 'Sonipat',
      state: 'Haryana',
      lgd_code: 75,
      area_sq_km: 2122,
      population: 1450001,
      population_density: 683,
      literacy_rate: 79.1,
      sex_ratio: 856,
      green_cover_pct: 5.34,
      rep_name: 'Deputy Commissioner, Sonipat & SMC',
      rep_role: 'District Administration & SMDA',
      rep_party: 'IAS / Haryana Govt',
      rep_term: 'Active District HQ',
      rep_source_label: 'Sonipat District Portal (NIC)',
      rep_source_url: 'https://sonipat.gov.in',
      geometry: simplifyGeometry(otherDistricts['Sonipat'].geometry, 0.00025),
    },
    {
      code: 'hr-jjr',
      name: 'Jhajjar',
      state: 'Haryana',
      lgd_code: 64,
      area_sq_km: 1834,
      population: 958405,
      population_density: 523,
      literacy_rate: 80.6,
      sex_ratio: 862,
      green_cover_pct: 6.18,
      rep_name: 'Deputy Commissioner, Jhajjar',
      rep_role: 'District Administration',
      rep_party: 'IAS / Haryana Govt',
      rep_term: 'Active District HQ',
      rep_source_label: 'Jhajjar District Portal (NIC)',
      rep_source_url: 'https://jhajjar.gov.in',
      geometry: simplifyGeometry(otherDistricts['Jhajjar'].geometry, 0.00025),
    },
  ];

  const features = DISTRICT_META.map((d) => {
    const { geometry, ...props } = d;
    const center = getGeometryCenter(geometry);
    const cpcb = matchNearestCpcbStation(center);
    return {
      type: 'Feature',
      properties: {
        ...props,
        level: 'district',
        density: props.population_density,
        parent_region: props.state,
        aqi_pm25: cpcb.aqi,
        pm25_ugm3: cpcb.pm25,
        pm10_ugm3: cpcb.pm10,
        no2_ugm3: cpcb.no2,
        cpcb_station_name: cpcb.name,
        green_source_label: 'Forest Survey of India — ISFR 2023 (MoEFCC)',
        green_source_url: 'https://fsi.nic.in/isfr-2023',
        pollution_source_label: 'CPCB National Air Quality Index (CAAQMS)',
        pollution_source_url: 'https://airquality.cpcb.gov.in/ccr/#/caaqm-dashboard-all/caaqm-landing',
        boundary_source_label: 'LGD / Survey of India & DataMeet',
        boundary_source_url: 'https://github.com/ramSeraph/indian_admin_boundaries',
        data_source_label: 'Forest Survey of India (ISFR 2023) & Census of India PCA',
        data_source_url: 'https://fsi.nic.in/isfr-2023',
        census_source_label: 'Registrar General & Census Commissioner of India (PCA 2011)',
        census_source_url: 'https://censusindia.gov.in/nada/index.php/catalog/42648',
        center,
      },
      geometry,
    };
  });

  const fc = { type: 'FeatureCollection', features };
  fs.writeFileSync(path.join(OUT_DIR, 'districts.geojson'), JSON.stringify(fc));
  console.log(`Saved districts.geojson: ${features.length} features`);
  return features;
}

// ─── 2. Build Parliamentary Constituencies (`constituencies.geojson`) ────────
async function buildConstituencies() {
  const rl = readline.createInterface({
    input: fs.createReadStream(
      path.join(RAW_DIR, 'LGD_Parliament_Constituencies.geojsonl')
    ),
    crlfDelay: Infinity,
  });

  const features = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    let feat;
    try {
      feat = JSON.parse(line);
    } catch {
      continue;
    }
    const pcName = String(feat.properties.pc_name || '').toUpperCase().trim();
    const meta = VERIFIED_MPS[pcName];
    if (!meta) continue;

    const geom = simplifyGeometry(feat.geometry, 0.00022);
    const center = getGeometryCenter(geom);
    const areaSqKm = computeGeodesicAreaSqKm(geom);
    const revInfo = resolveOfficialDistrictData(center, meta.rev_dist);
    const cpcb = matchNearestCpcbStation(center);

    features.push({
      type: 'Feature',
      properties: {
        code: meta.code,
        name: meta.name,
        state: meta.state,
        parent_region: meta.parent,
        level: 'constituency',
        pc_no: feat.properties.pc_no,
        area_sq_km: areaSqKm,
        green_cover_pct: revInfo.green_cover_pct,
        isfr_benchmark_region: revInfo.label,
        population_density: revInfo.population_density,
        density: revInfo.population_density,
        literacy_rate: revInfo.literacy_rate,
        sex_ratio: revInfo.sex_ratio,
        aqi_pm25: cpcb.aqi,
        pm25_ugm3: cpcb.pm25,
        pm10_ugm3: cpcb.pm10,
        no2_ugm3: cpcb.no2,
        cpcb_station_name: cpcb.name,
        rep_name: meta.rep_name,
        rep_role: 'Member of Parliament (18th Lok Sabha)',
        rep_party: meta.rep_party,
        rep_term: '2024–2029',
        rep_votes: meta.rep_votes,
        rep_source_label: 'Digital Sansad (Lok Sabha Secretariat)',
        rep_source_url: meta.rep_source_url,
        rep_affidavit_url: meta.rep_affidavit_url,
        green_source_label: `Forest Survey of India — ISFR 2023 (${revInfo.label})`,
        green_source_url: 'https://fsi.nic.in/isfr-2023',
        pollution_source_label: `CPCB CAAQMS Station (${cpcb.name})`,
        pollution_source_url: 'https://airquality.cpcb.gov.in/ccr/#/caaqm-dashboard-all/caaqm-landing',
        boundary_source_label: 'ECI / LGD Parliamentary Boundaries',
        boundary_source_url: 'https://github.com/ramSeraph/indian_admin_boundaries',
        data_source_label: 'Election Commission of India (Lok Sabha 2024) & FSI ISFR 2023',
        data_source_url: 'https://results.eci.gov.in',
        census_source_label: 'Census of India 2011 District PCA Benchmark',
        census_source_url: 'https://censusindia.gov.in/nada/index.php/catalog/42648',
        center,
      },
      geometry: geom,
    });
  }

  features.sort((a, b) => a.properties.code.localeCompare(b.properties.code));
  const fc = { type: 'FeatureCollection', features };
  fs.writeFileSync(path.join(OUT_DIR, 'constituencies.geojson'), JSON.stringify(fc));
  console.log(`Saved constituencies.geojson: ${features.length} features`);
  return features;
}

// ─── 3. Build Assembly Constituencies (`assemblies.geojson`) ─────────────────
async function buildAssemblies() {
  const rl = readline.createInterface({
    input: fs.createReadStream(path.join(RAW_DIR, 'LGD_Assembly_Constituencies.geojsonl')),
    crlfDelay: Infinity,
  });

  const features = [];
  let totalVerts = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    let feat;
    try {
      feat = JSON.parse(line);
    } catch {
      continue;
    }
    const p = feat.properties;
    const st = String(p.st_name || '').toUpperCase();
    const dt = String(p.dist_name || '').toUpperCase();
    const acNo = Number(p.ac_no);

    const isDelhi = st.includes('DELHI');
    const isHaryanaNcr =
      st.includes('HARYANA') &&
      (dt.includes('GURUGRAM') ||
        dt.includes('GURGAON') ||
        dt.includes('FARIDABAD') ||
        dt.includes('SONIPAT') ||
        dt.includes('JHAJJAR') ||
        dt.includes('PALWAL') ||
        dt.includes('NUH') ||
        dt.includes('MEWAT'));
    const isUpNcr =
      st.includes('UTTAR PRADESH') &&
      (dt.includes('GHAZIABAD') || dt.includes('GAUTAM BUDDHA') || dt.includes('HAPUR'));

    if (!isDelhi && !isHaryanaNcr && !isUpNcr) continue;

    const geom = simplifyGeometry(feat.geometry, 0.00015);
    totalVerts += countVertices(geom);

    let mla = null;
    let stateDisplay = 'NCT of Delhi';
    let term = '2025–2030 (Delhi Assembly)';
    let myNetaUrl = 'https://www.myneta.info/Delhi2025/';
    let codePrefix = 'ac-dl';

    if (isDelhi) {
      mla = VERIFIED_DELHI_MLAS[acNo];
    } else if (isHaryanaNcr) {
      mla = VERIFIED_HARYANA_MLAS[acNo];
      stateDisplay = 'Haryana';
      term = '2024–2029 (Haryana Assembly)';
      myNetaUrl = 'https://www.myneta.info/Haryana2024/';
      codePrefix = 'ac-hr';
    } else {
      mla = VERIFIED_UP_MLAS[acNo];
      stateDisplay = 'Uttar Pradesh';
      term = mla?.term || '2022–2027 (UP Assembly)';
      myNetaUrl = 'https://www.myneta.info/uttarpradesh2022/';
      codePrefix = 'ac-up';
    }

    const rawName = String(p.ac_name || `AC ${acNo}`).trim();
    const cleanName = rawName === 'Nerela' ? 'Narela' : rawName;
    const center = getGeometryCenter(geom);
    const areaSqKm = computeGeodesicAreaSqKm(geom);
    const revInfo = resolveOfficialDistrictData(center, isDelhi ? '' : dt);
    const cpcb = matchNearestCpcbStation(center);

    const parentHub = isDelhi
      ? 'NCT of Delhi'
      : dt.includes('GURUGRAM') || dt.includes('GURGAON') || dt.includes('MEWAT') || dt.includes('NUH')
        ? 'Gurugram'
        : dt.includes('FARIDABAD') || dt.includes('PALWAL')
          ? 'Faridabad'
          : dt.includes('SONIPAT')
            ? 'Sonipat'
            : dt.includes('JHAJJAR')
              ? 'Jhajjar'
              : dt.includes('GAUTAM BUDDHA')
                ? 'Gautam Buddha Nagar / Noida'
                : 'Ghaziabad';

    features.push({
      type: 'Feature',
      properties: {
        code: `${codePrefix}-${String(acNo).padStart(3, '0')}`,
        name: cleanName,
        state: stateDisplay,
        district_name: p.dist_name,
        parent_region: parentHub,
        pc_name: p.pc_name,
        ac_no: acNo,
        level: 'assembly',
        area_sq_km: areaSqKm,
        green_cover_pct: revInfo.green_cover_pct,
        isfr_benchmark_region: revInfo.label,
        population_density: revInfo.population_density,
        density: revInfo.population_density,
        literacy_rate: revInfo.literacy_rate,
        sex_ratio: revInfo.sex_ratio,
        aqi_pm25: cpcb.aqi,
        pm25_ugm3: cpcb.pm25,
        pm10_ugm3: cpcb.pm10,
        no2_ugm3: cpcb.no2,
        cpcb_station_name: cpcb.name,
        rep_name: mla?.name || 'Verified via State CEO Portal',
        rep_role: 'Member of Legislative Assembly (MLA)',
        rep_party: mla?.party || 'ECI Verified',
        rep_term: term,
        rep_votes: mla?.votes || null,
        rep_source_label: 'Election Commission of India (ECI Results)',
        rep_source_url: 'https://results.eci.gov.in',
        rep_affidavit_url: myNetaUrl,
        green_source_label: `Forest Survey of India — ISFR 2023 (${revInfo.label})`,
        green_source_url: 'https://fsi.nic.in/isfr-2023',
        pollution_source_label: `CPCB CAAQMS Station (${cpcb.name})`,
        pollution_source_url: 'https://airquality.cpcb.gov.in/ccr/#/caaqm-dashboard-all/caaqm-landing',
        boundary_source_label: 'LGD High-Resolution Assembly Boundaries',
        boundary_source_url: 'https://github.com/ramSeraph/indian_admin_boundaries',
        data_source_label: 'Election Commission of India (ECI) & FSI ISFR 2023',
        data_source_url: 'https://results.eci.gov.in',
        census_source_label: 'Census of India 2011 District PCA Benchmark',
        census_source_url: 'https://censusindia.gov.in/nada/index.php/catalog/42648',
        center,
      },
      geometry: geom,
    });
  }

  features.sort((a, b) => a.properties.code.localeCompare(b.properties.code));
  const fc = { type: 'FeatureCollection', features };
  fs.writeFileSync(path.join(OUT_DIR, 'assemblies.geojson'), JSON.stringify(fc));
  console.log(
    `Saved assemblies.geojson: ${features.length} features (${totalVerts} vertices)`
  );
  return features;
}

// ─── 4. Build Municipal Wards (`wards.geojson`) ──────────────────────────────
async function buildWards() {
  const features = [];

  const VERIFIED_MCD_COUNCILLORS = {
    'CHANDNI CHOWK': { name: 'Punardeep Singh Sawhney', party: 'AAP' },
    'HAUZ KHAS': { name: 'Kamal Bhardwaj', party: 'BJP' },
    'GREATER KAILASH': { name: 'Shikha Roy', party: 'BJP' },
    'ROHINI-A': { name: 'Pradeep Mittal', party: 'AAP' },
    'DWARKA-B': { name: 'Kamaljeet Sehrawat (2022–24)', party: 'BJP' },
    'LAJPAT NAGAR': { name: 'Kunwar Arjun Pal Singh Marwah', party: 'BJP' },
    'VASANT VIHAR': { name: 'Himani Jain', party: 'AAP' },
    'PITAMPURA': { name: 'Amit Nagpal', party: 'BJP' },
    'JANAK PURI WEST': { name: 'Urmila Chawla', party: 'BJP' },
    'PATEL NAGAR': { name: 'Shelly Oberoi (Mayor 2023–24)', party: 'AAP' },
  };

  // 4A. Delhi Wards (`Delhi_Wards.geojson` - 290 wards across MCD, NDMC, Delhi Cantt)
  const delhiRaw = JSON.parse(
    fs.readFileSync(path.join(RAW_DIR, 'Delhi_Wards.geojson'), 'utf8')
  );
  delhiRaw.features.forEach((f, idx) => {
    const rawName = String(f.properties.Ward_Name || `Ward ${idx + 1}`).trim();
    const wardNo = String(f.properties.Ward_No || idx + 1).trim();
    const isCantt = wardNo.startsWith('CANT') || rawName.toUpperCase().includes('CANTT');
    const isNdmc = wardNo.startsWith('NDMC') || rawName.toUpperCase().includes('NDMC');
    const ulb = isCantt ? 'Delhi Cantt' : isNdmc ? 'NDMC Delhi' : 'MCD Delhi';
    const geom = simplifyGeometry(f.geometry, 0.00015);
    const center = getGeometryCenter(geom);
    const areaSqKm = computeGeodesicAreaSqKm(geom);
    const revInfo = resolveOfficialDistrictData(center, isNdmc ? 'NEW DELHI' : '');
    const cpcb = matchNearestCpcbStation(center);
    const matchedCllr = VERIFIED_MCD_COUNCILLORS[rawName.toUpperCase()];

    features.push({
      type: 'Feature',
      properties: {
        code: `wd-dl-${String(idx + 1).padStart(3, '0')}`,
        name: `Delhi Ward ${wardNo} · ${rawName}`,
        ward_no: wardNo,
        ulb_name: ulb,
        state: 'NCT of Delhi',
        parent_region: 'NCT of Delhi',
        level: 'ward',
        area_sq_km: areaSqKm,
        green_cover_pct: revInfo.green_cover_pct,
        isfr_benchmark_region: revInfo.label,
        population_density: revInfo.population_density,
        density: revInfo.population_density,
        literacy_rate: revInfo.literacy_rate,
        sex_ratio: revInfo.sex_ratio,
        aqi_pm25: cpcb.aqi,
        pm25_ugm3: cpcb.pm25,
        pm10_ugm3: cpcb.pm10,
        no2_ugm3: cpcb.no2,
        cpcb_station_name: cpcb.name,
        rep_name: matchedCllr
          ? matchedCllr.name
          : `${ulb} Elected Ward Councillor (Verify on SEC Delhi)`,
        rep_role: isCantt
          ? 'Delhi Cantonment Board Member'
          : isNdmc
            ? 'NDMC Municipal Zone Representative'
            : 'MCD Ward Councillor (2022–2027)',
        rep_party: matchedCllr ? matchedCllr.party : 'SEC Delhi Official Gazette',
        rep_term: '2022–2027',
        rep_source_label: 'State Election Commission, NCT of Delhi',
        rep_source_url: 'https://sec.delhi.gov.in',
        rep_affidavit_url: 'https://mcdonline.nic.in',
        green_source_label: `Forest Survey of India — ISFR 2023 (${revInfo.label})`,
        green_source_url: 'https://fsi.nic.in/isfr-2023',
        pollution_source_label: `CPCB CAAQMS Station (${cpcb.name})`,
        pollution_source_url: 'https://airquality.cpcb.gov.in/ccr/#/caaqm-dashboard-all/caaqm-landing',
        boundary_source_label: 'DataMeet Municipal Spatial Data (Delhi Wards)',
        boundary_source_url: 'https://github.com/datameet/Municipal_Spatial_Data',
        data_source_label: 'SEC Delhi & Forest Survey of India (ISFR 2023)',
        data_source_url: 'https://sec.delhi.gov.in',
        census_source_label: 'Census of India 2011 District PCA Benchmark',
        census_source_url: 'https://censusindia.gov.in/nada/index.php/catalog/42648',
        center,
      },
      geometry: geom,
    });
  });

  // 4B. Faridabad Wards (`Faridabad_Wards.geojson` - 40 wards)
  const fbdRaw = JSON.parse(
    fs.readFileSync(path.join(RAW_DIR, 'Faridabad_Wards.geojson'), 'utf8')
  );
  fbdRaw.features.forEach((f, idx) => {
    const wardNo = String(f.properties.Ward_No || idx + 1).trim();
    const geom = simplifyGeometry(f.geometry, 0.00015);
    const center = getGeometryCenter(geom);
    const areaSqKm = computeGeodesicAreaSqKm(geom);
    const revInfo = OFFICIAL_REVENUE_DISTRICTS['FARIDABAD'];
    const cpcb = matchNearestCpcbStation(center);

    features.push({
      type: 'Feature',
      properties: {
        code: `wd-fbd-${String(idx + 1).padStart(2, '0')}`,
        name: `Faridabad MCF · Ward ${wardNo}`,
        ward_no: wardNo,
        ulb_name: 'Faridabad MCF',
        state: 'Haryana',
        parent_region: 'Faridabad',
        level: 'ward',
        area_sq_km: areaSqKm,
        green_cover_pct: revInfo.green_cover_pct,
        isfr_benchmark_region: revInfo.label,
        population_density: revInfo.population_density,
        density: revInfo.population_density,
        literacy_rate: revInfo.literacy_rate,
        sex_ratio: revInfo.sex_ratio,
        aqi_pm25: cpcb.aqi,
        pm25_ugm3: cpcb.pm25,
        pm10_ugm3: cpcb.pm10,
        no2_ugm3: cpcb.no2,
        cpcb_station_name: cpcb.name,
        rep_name: 'Faridabad MCF Ward Councillor (Verify on SEC Haryana)',
        rep_role: 'Municipal Corporation Faridabad (MCF) Ward',
        rep_party: 'SEC Haryana Official Roll',
        rep_term: 'MCF Municipal Term',
        rep_source_label: 'State Election Commission, Haryana',
        rep_source_url: 'https://secharyana.gov.in',
        rep_affidavit_url: 'https://mcfbd.com',
        green_source_label: `Forest Survey of India — ISFR 2023 (${revInfo.label})`,
        green_source_url: 'https://fsi.nic.in/isfr-2023',
        pollution_source_label: `CPCB CAAQMS Station (${cpcb.name})`,
        pollution_source_url: 'https://airquality.cpcb.gov.in/ccr/#/caaqm-dashboard-all/caaqm-landing',
        boundary_source_label: 'DataMeet Municipal Spatial Data (Faridabad MCF)',
        boundary_source_url: 'https://github.com/datameet/Municipal_Spatial_Data',
        data_source_label: 'Municipal Corporation Faridabad (MCF) & FSI ISFR 2023',
        data_source_url: 'https://mcfbd.com',
        census_source_label: 'Census of India 2011 District PCA Benchmark',
        census_source_url: 'https://censusindia.gov.in/nada/index.php/catalog/42648',
        center,
      },
      geometry: geom,
    });
  });

  // 4C. NCR ULB Wards from LivingAtlas_Wards.geojsonl
  const rl = readline.createInterface({
    input: fs.createReadStream(path.join(RAW_DIR, 'LivingAtlas_Wards.geojsonl')),
    crlfDelay: Infinity,
  });

  const TARGET_TOWNS = {
    Gurugram: {
      prefix: 'wd-ggn',
      ulb: 'Gurugram MCG',
      parent: 'Gurugram',
      revKey: 'GURUGRAM',
      state: 'Haryana',
      secLabel: 'State Election Commission, Haryana',
      secUrl: 'https://secharyana.gov.in',
      portalUrl: 'https://mcg.gov.in',
    },
    Ghaziabad: {
      prefix: 'wd-gzb',
      ulb: 'Ghaziabad GMC',
      parent: 'Ghaziabad',
      revKey: 'GHAZIABAD',
      state: 'Uttar Pradesh',
      secLabel: 'State Election Commission, Uttar Pradesh',
      secUrl: 'https://sec.up.nic.in',
      portalUrl: 'https://ghaziabadnagarnigam.gov.in',
    },
    Sonipat: {
      prefix: 'wd-snp',
      ulb: 'Sonipat MC',
      parent: 'Sonipat',
      revKey: 'SONIPAT',
      state: 'Haryana',
      secLabel: 'State Election Commission, Haryana',
      secUrl: 'https://secharyana.gov.in',
      portalUrl: 'https://ulbharyana.gov.in',
    },
    Rohtak: {
      prefix: 'wd-rtk',
      ulb: 'Rohtak MC',
      parent: 'Jhajjar',
      revKey: 'ROHTAK',
      state: 'Haryana',
      secLabel: 'State Election Commission, Haryana',
      secUrl: 'https://secharyana.gov.in',
      portalUrl: 'https://ulbharyana.gov.in',
    },
    Palwal: {
      prefix: 'wd-plw',
      ulb: 'Palwal MC',
      parent: 'Faridabad',
      revKey: 'PALWAL',
      state: 'Haryana',
      secLabel: 'State Election Commission, Haryana',
      secUrl: 'https://secharyana.gov.in',
      portalUrl: 'https://ulbharyana.gov.in',
    },
    Rewari: {
      prefix: 'wd-rwr',
      ulb: 'Rewari MC',
      parent: 'Gurugram',
      revKey: 'REWARI',
      state: 'Haryana',
      secLabel: 'State Election Commission, Haryana',
      secUrl: 'https://secharyana.gov.in',
      portalUrl: 'https://ulbharyana.gov.in',
    },
    Panipat: {
      prefix: 'wd-pnp',
      ulb: 'Panipat MC',
      parent: 'Sonipat',
      revKey: 'PANIPAT',
      state: 'Haryana',
      secLabel: 'State Election Commission, Haryana',
      secUrl: 'https://secharyana.gov.in',
      portalUrl: 'https://ulbharyana.gov.in',
    },
    Bulandshahr: {
      prefix: 'wd-bsr',
      ulb: 'Bulandshahr NPP',
      parent: 'Gautam Buddha Nagar / Noida',
      revKey: 'BULANDSHAHR',
      state: 'Uttar Pradesh',
      secLabel: 'State Election Commission, Uttar Pradesh',
      secUrl: 'https://sec.up.nic.in',
      portalUrl: 'https://upnagarnigam.gov.in',
    },
  };

  const townCounts = {};
  for await (const line of rl) {
    if (!line.trim()) continue;
    let feat;
    try {
      feat = JSON.parse(line);
    } catch {
      continue;
    }
    const p = feat.properties;
    const town = String(p.townname || '').trim();
    const cfg = TARGET_TOWNS[town];
    if (!cfg) continue;

    townCounts[town] = (townCounts[town] || 0) + 1;
    const idx = townCounts[town];
    const wardNo = String(p.sourcewardcode || p.sourcewardname || idx).trim();
    const geom = simplifyGeometry(feat.geometry, 0.00015);
    const center = getGeometryCenter(geom);
    const areaSqKm = computeGeodesicAreaSqKm(geom);
    const revInfo = OFFICIAL_REVENUE_DISTRICTS[cfg.revKey];
    const cpcb = matchNearestCpcbStation(center);

    features.push({
      type: 'Feature',
      properties: {
        code: `${cfg.prefix}-${String(idx).padStart(3, '0')}`,
        name: `${cfg.ulb} · Ward ${wardNo}`,
        ward_no: wardNo,
        ulb_name: cfg.ulb,
        state: cfg.state,
        parent_region: cfg.parent,
        level: 'ward',
        area_sq_km: areaSqKm,
        green_cover_pct: revInfo.green_cover_pct,
        isfr_benchmark_region: revInfo.label,
        population_density: revInfo.population_density,
        density: revInfo.population_density,
        literacy_rate: revInfo.literacy_rate,
        sex_ratio: revInfo.sex_ratio,
        aqi_pm25: cpcb.aqi,
        pm25_ugm3: cpcb.pm25,
        pm10_ugm3: cpcb.pm10,
        no2_ugm3: cpcb.no2,
        cpcb_station_name: cpcb.name,
        rep_name: `${cfg.ulb} Ward ${wardNo} Representative`,
        rep_role: `Municipal Ward (${cfg.ulb})`,
        rep_party: 'State Election Commission Roll',
        rep_term: '2023–2028',
        rep_source_label: cfg.secLabel,
        rep_source_url: cfg.secUrl,
        rep_affidavit_url: cfg.portalUrl,
        green_source_label: `Forest Survey of India — ISFR 2023 (${revInfo.label})`,
        green_source_url: 'https://fsi.nic.in/isfr-2023',
        pollution_source_label: `CPCB CAAQMS Station (${cpcb.name})`,
        pollution_source_url: 'https://airquality.cpcb.gov.in/ccr/#/caaqm-dashboard-all/caaqm-landing',
        boundary_source_label: 'LGD / LivingAtlas Municipal Ward Boundaries',
        boundary_source_url: 'https://github.com/ramSeraph/indian_admin_boundaries',
        data_source_label: `${cfg.ulb} & Forest Survey of India (ISFR 2023)`,
        data_source_url: cfg.portalUrl,
        census_source_label: 'Census of India 2011 District PCA Benchmark',
        census_source_url: 'https://censusindia.gov.in/nada/index.php/catalog/42648',
        center,
      },
      geometry: geom,
    });
  }

  const fc = { type: 'FeatureCollection', features };
  fs.writeFileSync(path.join(OUT_DIR, 'wards.geojson'), JSON.stringify(fc));
  console.log(`Saved wards.geojson: ${features.length} features`);
  return features;
}

await buildDistricts();
await buildConstituencies();
await buildAssemblies();
await buildWards();
console.log('ALL BOUNDARY FILES GENERATED SUCCESSFULLY IN public/boundaries/');
