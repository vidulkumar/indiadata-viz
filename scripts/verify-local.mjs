import fs from 'node:fs';
import path from 'node:path';
import { getLocalDb, seedLocalBoundaries, getLocalDbPath } from './local-db.mjs';

console.log('==========================================================');
console.log('🔍 IndiaData.viz — Local DB & Zero-Mock Verification Suite');
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

// 1. Seed & Verify Local SQLite Database
const db = getLocalDb();
const totalSeeded = seedLocalBoundaries(db, true);
check('Local SQLite DB initialized & seeded', totalSeeded === 740, `${totalSeeded} polygons in ${getLocalDbPath()}`);

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

// 2. Verify Every Feature Has Real Source Links & Zero Synthetic Properties
const sampleRows = db
  .prepare('SELECT code, level, green_cover_pct, aqi_pm25, green_source_url, pollution_source_url, rep_source_url, properties_json FROM boundary_features')
  .all();

let missingUrls = 0;
let mockPropFound = 0;
for (const r of sampleRows) {
  if (
    !String(r.green_source_url || '').startsWith('https://') ||
    !String(r.pollution_source_url || '').startsWith('https://') ||
    !String(r.rep_source_url || '').startsWith('https://')
  ) {
    missingUrls++;
  }
  const props = JSON.parse(r.properties_json);
  if ('avg_circle_rate' in props || 'hospitals_count' in props || 'schools_count' in props) {
    mockPropFound++;
  }
}

check('All 740 features have verified https:// source URLs (Green Cover, CPCB Pollution, Elected Rep)', missingUrls === 0, `missing=${missingUrls}`);
check('Zero synthetic/mock properties (avg_circle_rate, hospitals_count, schools_count) in boundaries', mockPropFound === 0, `found=${mockPropFound}`);

// 3. Test Local SQLite Upload Persistence Round-Trip
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
check('Local SQLite community_layers write/read round-trip', Boolean(readBack && readBack.source_url === 'https://fsi.nic.in/isfr-2023'));

// 4. Verify Default Active Layers & Dedicated Upload Page in Frontend Source
const appSrc = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');
check(
  'Default visible layers are ONLY Green Cover (green_cover_pct) and Pollution (aqi_pm25)',
  appSrc.includes("useState<MetricKey[]>([\n    'green_cover_pct',\n    'aqi_pm25',\n  ])") &&
    appSrc.includes("useState<MetricKey>('green_cover_pct')")
);
check(
  'Dedicated Upload Data Page (/upload route) is wired into App.tsx',
  appSrc.includes("window.location.pathname === '/upload'") && appSrc.includes('<UploadDataPage')
);

if (failed) {
  console.error('\n❌ Verification failed.');
  process.exit(1);
} else {
  console.log('\n🎉 ALL LOCAL VERIFICATION CHECKS PASSED!');
}
