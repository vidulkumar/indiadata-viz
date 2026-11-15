import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  VERIFIED_CPCB_STATIONS,
  VERIFIED_OVERLAY_LAYERS,
} from './spatial-seed-data.mjs';

// Load .env.local if present for local CLI execution
const envLocalPath = path.resolve('.env.local');
if (fs.existsSync(envLocalPath)) {
  const lines = fs.readFileSync(envLocalPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim();
    }
  }
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_KEY. Set them in .env.local (gitignored) or environment variables.'
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// 1. Seed CPCB Stations table (public.cpcb_stations)
const stationRows = VERIFIED_CPCB_STATIONS.map((st, idx) => ({
  id: `cpcb-${idx + 1}-${st.station.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32)}`,
  name: st.station,
  city: st.city,
  state: st.state,
  lat: Number(st.lat),
  lon: Number(st.lon),
  aqi: Math.round(Number(st.aqi || 0)),
  pm25: Number(st.pm25 || 0),
  pm10: Number(st.pm10 || 0),
  no2: Number(st.no2 || 0),
  so2: 0,
  last_updated: st.updated || 'CPCB CAAQMS Official Bulletin',
  source: st.sourceLabel,
  source_url: st.sourceUrl,
}));

console.log(`Seeding ${stationRows.length} CPCB stations into public.cpcb_stations...`);
const { error: stErr } = await supabase
  .from('cpcb_stations')
  .upsert(stationRows, { onConflict: 'id' });
if (stErr) {
  console.error('cpcb_stations error:', stErr.message);
  process.exit(1);
}

// 2. Seed Spatial Overlay Layers, Points & Lines tables
const layerRows = [];
const pointRows = [];
const lineRows = [];

VERIFIED_OVERLAY_LAYERS.forEach((layer, idx) => {
  layerRows.push({
    id: layer.id,
    title: layer.title,
    short_title: layer.shortTitle,
    category: layer.category,
    category_label: layer.categoryLabel,
    geometry_type:
      layer.geometryType === 'line-network' ? 'hybrid' : layer.geometryType,
    geometry_label: layer.geometryLabel,
    unit: layer.unit,
    publisher: layer.publisher,
    source_url: layer.sourceUrl,
    data_gov_url: layer.dataGovUrl || null,
    description: layer.description,
    color: layer.color,
    badge_text: layer.badgeText,
    default_visible: Boolean(layer.defaultVisible),
    default_opacity: Number(layer.defaultOpacity ?? 0.9),
    sort_order: idx,
  });

  for (const pt of layer.points || []) {
    pointRows.push({
      id: pt.id,
      layer_id: layer.id,
      name: pt.name,
      city: pt.city,
      state: pt.state,
      lat: Number(pt.lat),
      lon: Number(pt.lon),
      primary_metric_label: pt.primaryMetricLabel,
      primary_metric_value: Number.isFinite(Number(pt.primaryMetricValue))
        ? Number(pt.primaryMetricValue)
        : 0,
      primary_metric_unit:
        typeof pt.primaryMetricValue === 'string'
          ? pt.primaryMetricValue
          : pt.primaryMetricUnit || '',
      secondary_metric_label: pt.secondaryMetricLabel || null,
      secondary_metric_value:
        pt.secondaryMetricValue !== undefined ? String(pt.secondaryMetricValue) : null,
      secondary_metric_unit: pt.secondaryMetricUnit || null,
      status_badge: pt.statusBadge || null,
      agency: pt.agency,
      source_label: pt.sourceLabel,
      source_url: pt.sourceUrl,
      data_gov_url: pt.dataGovUrl || null,
      color: pt.color || layer.color,
    });
  }

  for (const ln of layer.lines || []) {
    lineRows.push({
      id: ln.id,
      layer_id: layer.id,
      name: ln.name,
      corridor_type: ln.code || 'METRO',
      color: ln.color,
      length_km: Number(ln.routeLengthKm || 0),
      stations_count: Math.round(Number(ln.stationsCount || 0)),
      daily_ridership_lakh: parseFloat(String(ln.dailyRidershipEst || '0')) || null,
      status: ln.terminalEndpoints || 'Operational',
      agency: ln.operator || layer.publisher,
      source_label: ln.sourceLabel,
      source_url: ln.sourceUrl,
      coordinates: ln.coordinates || [],
    });
  }
});

console.log(
  `Seeding ${layerRows.length} spatial_overlay_layers, ${pointRows.length} spatial_overlay_points, and ${lineRows.length} spatial_overlay_lines...`
);
const { error: lErr } = await supabase
  .from('spatial_overlay_layers')
  .upsert(layerRows, { onConflict: 'id' });
if (lErr) {
  console.error('spatial_overlay_layers error:', lErr.message);
  process.exit(1);
}

const { error: pErr } = await supabase
  .from('spatial_overlay_points')
  .upsert(pointRows, { onConflict: 'id' });
if (pErr) {
  console.error('spatial_overlay_points error:', pErr.message);
  process.exit(1);
}

const { error: lnErr } = await supabase
  .from('spatial_overlay_lines')
  .upsert(lineRows, { onConflict: 'id' });
if (lnErr) {
  console.error('spatial_overlay_lines error:', lnErr.message);
  process.exit(1);
}

// 3. Seed normalized boundary_features columns
const files = [
  'districts.geojson',
  'constituencies.geojson',
  'assemblies.geojson',
  'wards.geojson',
];

const allRows = [];
for (const f of files) {
  const fc = JSON.parse(
    fs.readFileSync(path.resolve('data/seed-boundaries', f), 'utf8')
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
      isfr_benchmark_region: p.isfr_benchmark_region || null,
      aqi_pm25: Math.round(Number(p.aqi_pm25 || 0)),
      pm25_ugm3: Number(p.pm25_ugm3 || 0),
      pm10_ugm3: Number(p.pm10_ugm3 || 0),
      no2_ugm3: Number(p.no2_ugm3 || 0),
      cpcb_station_name: p.cpcb_station_name || null,
      groundwater_extraction_pct: Number(p.groundwater_extraction_pct || 0),
      groundwater_depth_m: Number(p.groundwater_depth_m || 0),
      cgwb_category: p.cgwb_category || null,
      cgwb_source_label: p.cgwb_source_label || null,
      cgwb_source_url: p.cgwb_source_url || null,
      clean_fuel_pct: Number(p.clean_fuel_pct || 0),
      piped_water_pct: Number(p.piped_water_pct || 0),
      stunting_pct: Number(p.stunting_pct || 0),
      nfhs_source_label: p.nfhs_source_label || null,
      nfhs_source_url: p.nfhs_source_url || null,
      pupil_teacher_ratio: Number(p.pupil_teacher_ratio || 0),
      udise_source_label: p.udise_source_label || null,
      udise_source_url: p.udise_source_url || null,
      crime_rate_per_lakh: Number(p.crime_rate_per_lakh || 0),
      ncrb_source_label: p.ncrb_source_label || null,
      ncrb_source_url: p.ncrb_source_url || null,
      hospital_beds_per_10k: Number(p.hospital_beds_per_10k || 0),
      health_source_label: p.health_source_label || null,
      health_source_url: p.health_source_url || null,
      rep_name: p.rep_name || null,
      rep_role: p.rep_role || null,
      rep_party: p.rep_party || null,
      rep_term: p.rep_term || null,
      rep_votes: p.rep_votes ? Math.round(Number(p.rep_votes)) : null,
      rep_source_label: p.rep_source_label || null,
      rep_source_url: p.rep_source_url || null,
      rep_affidavit_url: p.rep_affidavit_url || null,
      green_source_label: p.green_source_label || null,
      green_source_url: p.green_source_url || null,
      pollution_source_label: p.pollution_source_label || null,
      pollution_source_url: p.pollution_source_url || null,
      census_source_label: p.census_source_label || null,
      census_source_url: p.census_source_url || null,
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

console.log(`Uploading ${allRows.length} normalized GIS boundary features to Supabase...`);
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
}

console.log('SUPABASE RELATIONAL SEEDING COMPLETE!');
