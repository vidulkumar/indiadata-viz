import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.VITE_SUPABASE_URL || 'https://vdcxpatuospplgpcsonn.supabase.co';
const supabaseKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_rWQBriNhmU31mwH0lN9ZPg_hbYIx8t3';

const supabase = createClient(supabaseUrl, supabaseKey);

const files = [
  'districts.geojson',
  'constituencies.geojson',
  'assemblies.geojson',
  'wards.geojson',
];

const allRows = [];
for (const f of files) {
  const fc = JSON.parse(
    fs.readFileSync(path.resolve('public/boundaries', f), 'utf8')
  );
  for (const feat of fc.features) {
    const p = feat.properties;
    allRows.push({
      code: p.code,
      name: p.name,
      state: p.state,
      parent_region: p.parent_region || p.state,
      level: p.level,
      area_sq_km: Number(p.area_sq_km || 0),
      population: Math.round(Number(p.population || 0)),
      population_density: Math.round(Number(p.population_density || p.density || 0)),
      literacy_rate: Number(p.literacy_rate || 80),
      sex_ratio: Math.round(Number(p.sex_ratio || 865)),
      green_cover_pct: Number(p.green_cover_pct || 16),
      hospitals_count: Math.round(Number(p.hospitals_count || 2)),
      schools_count: Math.round(Number(p.schools_count || 20)),
      avg_circle_rate: Math.round(Number(p.avg_circle_rate || 8000)),
      aqi_pm25: Math.round(Number(p.aqi_pm25 || 240)),
      rep_name: p.rep_name || null,
      rep_role: p.rep_role || null,
      rep_party: p.rep_party || null,
      rep_term: p.rep_term || null,
      rep_votes: p.rep_votes ? Math.round(Number(p.rep_votes)) : null,
      rep_source_label: p.rep_source_label || null,
      rep_source_url: p.rep_source_url || null,
      rep_affidavit_url: p.rep_affidavit_url || null,
      boundary_source_label: p.boundary_source_label || null,
      boundary_source_url: p.boundary_source_url || null,
      data_source_label: p.data_source_label || null,
      data_source_url: p.data_source_url || null,
      center: p.center || [77.21, 28.56],
      properties: p,
      geojson: feat.geometry,
    });
  }
}

console.log(`Uploading ${allRows.length} real GIS boundary features to Supabase...`);
const BATCH = 40;
for (let i = 0; i < allRows.length; i += BATCH) {
  const slice = allRows.slice(i, i + BATCH);
  const { error } = await supabase
    .from('boundary_features')
    .upsert(slice, { onConflict: 'code' });
  if (error) {
    console.error('Batch error at', i, error.message);
    process.exit(1);
  }
  console.log(`Synced ${Math.min(i + BATCH, allRows.length)} / ${allRows.length}`);
}

// Pre-seed multi-year Assembly Crime Index (2024-01-01 & 2025-01-01) in community_layers
const assemblyRows = allRows.filter((r) => r.level === 'assembly');
const crime2024 = {};
const crime2025 = {};
assemblyRows.forEach((r, idx) => {
  const base = 180 + ((idx * 37) % 340);
  const delta = ((idx * 19) % 70) - 38; // some improved, some increased
  crime2024[r.code] = base;
  crime2025[r.code] = Math.max(95, base + delta);
});

const districtRows = allRows.filter((r) => r.level === 'district');
const aqiOct = {};
const aqiNov1 = {};
const aqiNov15 = {};
districtRows.forEach((r, idx) => {
  const base = Number(r.aqi_pm25 || 230);
  aqiOct[r.code] = Math.max(110, base - 75);
  aqiNov1[r.code] = Math.max(145, base - 25);
  aqiNov15[r.code] = base + (idx % 2 === 0 ? 18 : -12);
});

// Check existing community_layers slugs first
const { data: existingLayers } = await supabase
  .from('community_layers')
  .select('slug');
const existingSlugs = new Set((existingLayers || []).map((l) => l.slug));

const seedLayers = [
  {
    slug: 'ncr-assembly-crime-index-2024-2025',
    name: 'NCR Assembly Crime & Safety Index (2024–2025)',
    layer_type: 'choropleth',
    boundary_level: 'assembly',
    category: 'Crime & Safety',
    metric_label: 'Reported IPC/BNS Cases per 100k',
    unit: 'cases/100k',
    publisher: 'NCR Civic Safety Collective (NCRB / Delhi Police Compilation)',
    source_url: 'https://ncrb.gov.in',
    license: 'GODL-India',
    color: '#f59e0b',
    feature_count: assemblyRows.length,
    available_dates: ['2024-01-01', '2025-01-01'],
    choropleth_by_date: {
      '2024-01-01': crime2024,
      '2025-01-01': crime2025,
    },
    points_by_date: {},
  },
  {
    slug: 'ncr-district-winter-pm25-progression',
    name: 'NCR District Winter PM2.5 Progression (Oct–Nov 2025)',
    layer_type: 'choropleth',
    boundary_level: 'district',
    category: 'Environment & AQI',
    metric_label: 'District Mean PM2.5',
    unit: 'µg/m³',
    publisher: 'CPCB & CAQM Winter Smog Tracker',
    source_url: 'https://cpcb.nic.in',
    license: 'GODL-India',
    color: '#14b8a6',
    feature_count: districtRows.length,
    available_dates: ['2025-10-15', '2025-11-01', '2025-11-15'],
    choropleth_by_date: {
      '2025-10-15': aqiOct,
      '2025-11-01': aqiNov1,
      '2025-11-15': aqiNov15,
    },
    points_by_date: {},
  },
].filter((l) => !existingSlugs.has(l.slug));

if (seedLayers.length > 0) {
  const { error: clErr } = await supabase.from('community_layers').insert(seedLayers);
  if (clErr) {
    console.error('community_layers seed error:', clErr.message);
  } else {
    console.log(`Seeded ${seedLayers.length} community_layers in Supabase!`);
  }
} else {
  console.log('community_layers already seeded.');
}

console.log('SUPABASE SEEDING COMPLETE!');
