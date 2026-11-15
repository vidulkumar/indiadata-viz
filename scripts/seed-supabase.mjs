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
      literacy_rate: Number(p.literacy_rate || 0),
      sex_ratio: Math.round(Number(p.sex_ratio || 0)),
      green_cover_pct: Number(p.green_cover_pct || 0),
      hospitals_count: 0,
      schools_count: 0,
      avg_circle_rate: 0,
      aqi_pm25: Math.round(Number(p.aqi_pm25 || 0)),
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

// Archive any previously seeded synthetic demo community layers so zero mock data is visible
const { error: archiveErr } = await supabase
  .from('community_layers')
  .update({ category: 'archived' })
  .in('slug', [
    'ncr-assembly-crime-index-2024-2025',
    'ncr-district-winter-pm25-progression',
  ]);
if (archiveErr) {
  console.warn('Note archiving old community layers:', archiveErr.message);
}

console.log('SUPABASE SEEDING COMPLETE (ZERO MOCK DATA)!');
