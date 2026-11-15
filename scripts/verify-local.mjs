import fs from 'node:fs';
import path from 'node:path';
import {
  getLocalDb,
  seedLocalBoundaries,
  getLocalDbPath,
  getBoundariesFromLocalDb,
  getSpatialLayersFromLocalDb,
} from './local-db.mjs';

console.log('==========================================================');
console.log('🔍 IndiaData.viz — Relational DB & Zero-Mock Verification');
console.log('==========================================================\n');

let failed = false;
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`✅ PASS: ${label}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`❌ FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
    failed = true;
  }
}

// 1. Seed & Verify Local SQLite Relational Database
const db = getLocalDb();
const totalSeeded = seedLocalBoundaries(db, true);
check(
  'Local SQLite DB initialized & seeded',
  totalSeeded === 740,
  `${totalSeeded} polygons in ${getLocalDbPath()}`
);

const tierCounts = Object.fromEntries(
  db
    .prepare('SELECT level, COUNT(*) as cnt FROM boundary_features GROUP BY level')
    .all()
    .map((r) => [r.level, r.cnt])
);

check('District boundaries in local DB', tierCounts.district === 7, `${tierCounts.district} features`);
check('Lok Sabha PC boundaries in local DB', tierCounts.constituency === 14, `${tierCounts.constituency} features`);
check('Assembly AC boundaries in local DB', tierCounts.assembly === 107, `${tierCounts.assembly} features`);
check('Municipal Ward boundaries in local DB', tierCounts.ward === 612, `${tierCounts.ward} features`);

// 2. Verify Relational Columns on boundary_features (NOT JSON-only)
const sampleRows = db
  .prepare(`
    SELECT
      code, level,
      green_cover_pct, aqi_pm25,
      groundwater_extraction_pct, groundwater_depth_m, cgwb_source_url,
      clean_fuel_pct, piped_water_pct, stunting_pct, nfhs_source_url,
      pupil_teacher_ratio, udise_source_url,
      crime_rate_per_lakh, ncrb_source_url,
      hospital_beds_per_10k, health_source_url,
      green_source_url, pollution_source_url, rep_source_url
    FROM boundary_features
  `)
  .all();

let missingUrls = 0;
let missingEnrichedColumns = 0;
for (const r of sampleRows) {
  if (
    !String(r.green_source_url || '').startsWith('https://') ||
    !String(r.pollution_source_url || '').startsWith('https://') ||
    !String(r.rep_source_url || '').startsWith('https://')
  ) {
    missingUrls++;
  }
  if (
    !(Number(r.groundwater_extraction_pct) > 0) ||
    !(Number(r.clean_fuel_pct) > 0) ||
    !(Number(r.pupil_teacher_ratio) > 0) ||
    !(Number(r.crime_rate_per_lakh) > 0) ||
    !(Number(r.hospital_beds_per_10k) > 0) ||
    !String(r.cgwb_source_url || '').startsWith('https://') ||
    !String(r.nfhs_source_url || '').startsWith('https://') ||
    !String(r.udise_source_url || '').startsWith('https://') ||
    !String(r.ncrb_source_url || '').startsWith('https://') ||
    !String(r.health_source_url || '').startsWith('https://')
  ) {
    missingEnrichedColumns++;
  }
}

check(
  'All 740 features have verified https:// source URLs in DB columns',
  missingUrls === 0,
  `missing=${missingUrls}`
);
check(
  'All 740 features have normalized relational DB columns for CGWB, NFHS-5, UDISE+, NCRB & MoHFW',
  missingEnrichedColumns === 0,
  `missing=${missingEnrichedColumns}`
);

// 3. Verify Spatial Overlay Tables & CPCB Stations Table in Database
const spatialPayload = getSpatialLayersFromLocalDb(db);
check(
  'Relational spatial_overlay_layers table populated in DB',
  spatialPayload.overlayLayers.length === 5,
  `${spatialPayload.overlayLayers.length} layers`
);
const totalOverlayPts = spatialPayload.overlayLayers.reduce(
  (acc, l) => acc + (l.points?.length || 0),
  0
);
const totalOverlayLines = spatialPayload.overlayLayers.reduce(
  (acc, l) => acc + (l.lines?.length || 0),
  0
);
check(
  'Relational spatial_overlay_points & spatial_overlay_lines populated in DB',
  totalOverlayPts === 72 && totalOverlayLines === 10,
  `${totalOverlayPts} GPS points, ${totalOverlayLines} transit corridors`
);
check(
  'Relational cpcb_stations table populated in DB',
  spatialPayload.cpcbStations.length === 21,
  `${spatialPayload.cpcbStations.length} CPCB stations`
);

// 4. Verify No Static GeoJSON Files Exposed in public/boundaries
const publicBoundariesExists = fs.existsSync(path.resolve('public/boundaries'));
check(
  'Zero static .geojson files in public/boundaries (all data served from DB)',
  !publicBoundariesExists
);

// 5. Verify DB Query Helper Reconstructs Features from Relational Columns
const districtFeatures = getBoundariesFromLocalDb(db, 'district');
check(
  'getBoundariesFromLocalDb() returns relational columns cleanly',
  districtFeatures.length === 7 &&
    typeof districtFeatures[0].properties.groundwater_extraction_pct === 'number'
);

// 6. Test Local SQLite Upload Persistence Round-Trip
const testSlug = 'verify-test-layer-local';
db.prepare(`
  INSERT OR REPLACE INTO community_layers (
    slug, name, description, methodology, layer_type, boundary_level,
    target_state, category, metric_label, unit, publisher, source_url,
    feature_count, available_dates_json, choropleth_by_date_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  testSlug,
  'Verification Test Layer',
  'Automated local DB verification test',
  'Matched against AC code',
  'choropleth',
  'assembly',
  'NCT of Delhi',
  'archived',
  'Test Metric',
  '%',
  'Local Verify Script',
  'https://fsi.nic.in/isfr-2023',
  1,
  JSON.stringify(['2025']),
  JSON.stringify({ '2025': { 'ac-dl-040': 33.29 } })
);

const readBack = db.prepare('SELECT * FROM community_layers WHERE slug = ?').get(testSlug);
check(
  'Local SQLite community_layers write/read round-trip',
  Boolean(readBack && readBack.source_url === 'https://fsi.nic.in/isfr-2023')
);

// 7. Verify Frontend Fetches Spatial Layers & Boundaries from API (Not Bundled JSON)
const appSrc = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');
const defaultsSrc = fs.readFileSync(path.resolve('src/data/ncrDefaults.ts'), 'utf8');
check(
  'Default visible layers are ONLY Green Cover (green_cover_pct) and Pollution (aqi_pm25)',
  appSrc.includes("useState<MetricKey[]>([\n    'green_cover_pct',\n    'aqi_pm25',\n  ])") &&
    appSrc.includes("useState<MetricKey>('green_cover_pct')")
);
check(
  'Frontend loads spatial layers & CPCB stations from /api/spatial-layers DB endpoint (not bundled in ncrDefaults.ts)',
  appSrc.includes('/api/spatial-layers') &&
    !defaultsSrc.includes('VERIFIED_OVERLAY_LAYERS') &&
    !defaultsSrc.includes('VERIFIED_CPCB_STATIONS')
);
check(
  'Dedicated Upload Data Page (/upload route) is wired into App.tsx',
  appSrc.includes("window.location.pathname === '/upload'") && appSrc.includes('<UploadDataPage')
);

// 8. Verify Zero Hardcoded Database URLs or Keys in Code / Workflow
const filesToAudit = [
  '.github/workflows/deploy.yml',
  'src/worker.ts',
  'src/lib/supabase.ts',
  'src/App.tsx',
  'scripts/seed-supabase.mjs',
];
let leakedSecrets = 0;
for (const rel of filesToAudit) {
  const txt = fs.readFileSync(path.resolve(rel), 'utf8');
  if (txt.includes('supabase.co') || txt.includes('sb_publishable_')) {
    leakedSecrets++;
    console.error(`   Found hardcoded DB URL/key in: ${rel}`);
  }
}
check(
  'Zero hardcoded database URLs or keys in GitHub workflow or source code',
  leakedSecrets === 0,
  `checked ${filesToAudit.length} files`
);

if (failed) {
  console.error('\n❌ Verification failed.');
  process.exit(1);
} else {
  console.log('\n🎉 ALL RELATIONAL DB & ZERO-MOCK VERIFICATION CHECKS PASSED!');
}
