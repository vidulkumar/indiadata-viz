import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  VERIFIED_CPCB_STATIONS,
  VERIFIED_OVERLAY_LAYERS,
} from './spatial-seed-data.mjs';

const DATA_DIR = path.resolve('data');
const SEED_BOUNDARIES_DIR = path.resolve('data/seed-boundaries');
const DB_PATH = path.join(DATA_DIR, 'indiadata-local.sqlite');

let dbInstance = null;

export function getLocalDb() {
  if (dbInstance) return dbInstance;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS boundary_features (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      state TEXT NOT NULL,
      parent_region TEXT,
      level TEXT NOT NULL,
      area_sq_km REAL DEFAULT 0,
      population INTEGER DEFAULT 0,
      population_density REAL DEFAULT 0,
      literacy_rate REAL DEFAULT 0,
      sex_ratio REAL DEFAULT 0,
      green_cover_pct REAL DEFAULT 0,
      isfr_benchmark_region TEXT,
      aqi_pm25 REAL DEFAULT 0,
      pm25_ugm3 REAL DEFAULT 0,
      pm10_ugm3 REAL DEFAULT 0,
      no2_ugm3 REAL DEFAULT 0,
      cpcb_station_name TEXT,
      groundwater_extraction_pct REAL DEFAULT 0,
      groundwater_depth_m REAL DEFAULT 0,
      cgwb_category TEXT,
      cgwb_source_label TEXT,
      cgwb_source_url TEXT,
      clean_fuel_pct REAL DEFAULT 0,
      piped_water_pct REAL DEFAULT 0,
      stunting_pct REAL DEFAULT 0,
      nfhs_source_label TEXT,
      nfhs_source_url TEXT,
      pupil_teacher_ratio REAL DEFAULT 0,
      udise_source_label TEXT,
      udise_source_url TEXT,
      crime_rate_per_lakh REAL DEFAULT 0,
      ncrb_source_label TEXT,
      ncrb_source_url TEXT,
      hospital_beds_per_10k REAL DEFAULT 0,
      health_source_label TEXT,
      health_source_url TEXT,
      rep_name TEXT,
      rep_role TEXT,
      rep_party TEXT,
      rep_term TEXT,
      rep_votes INTEGER,
      rep_source_label TEXT,
      rep_source_url TEXT,
      rep_affidavit_url TEXT,
      green_source_label TEXT,
      green_source_url TEXT,
      pollution_source_label TEXT,
      pollution_source_url TEXT,
      census_source_label TEXT,
      census_source_url TEXT,
      boundary_source_label TEXT,
      boundary_source_url TEXT,
      data_source_label TEXT,
      data_source_url TEXT,
      center_json TEXT,
      properties_json TEXT NOT NULL,
      geojson_json TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_local_boundary_level ON boundary_features(level);

    CREATE TABLE IF NOT EXISTS cpcb_stations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      aqi INTEGER NOT NULL DEFAULT 0,
      pm25 REAL NOT NULL DEFAULT 0,
      pm10 REAL NOT NULL DEFAULT 0,
      no2 REAL NOT NULL DEFAULT 0,
      so2 REAL NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL,
      source TEXT NOT NULL,
      source_url TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS spatial_overlay_layers (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      short_title TEXT NOT NULL,
      category TEXT NOT NULL,
      category_label TEXT NOT NULL,
      geometry_type TEXT NOT NULL,
      geometry_label TEXT NOT NULL,
      unit TEXT NOT NULL,
      publisher TEXT NOT NULL,
      source_url TEXT NOT NULL,
      data_gov_url TEXT,
      description TEXT NOT NULL,
      color TEXT NOT NULL,
      badge_text TEXT NOT NULL,
      default_visible INTEGER NOT NULL DEFAULT 0,
      default_opacity REAL NOT NULL DEFAULT 0.9,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS spatial_overlay_points (
      id TEXT PRIMARY KEY,
      layer_id TEXT NOT NULL,
      name TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      primary_metric_label TEXT NOT NULL,
      primary_metric_value REAL NOT NULL DEFAULT 0,
      primary_metric_unit TEXT NOT NULL DEFAULT '',
      secondary_metric_label TEXT,
      secondary_metric_value TEXT,
      secondary_metric_unit TEXT,
      status_badge TEXT,
      agency TEXT NOT NULL,
      source_label TEXT NOT NULL,
      source_url TEXT NOT NULL,
      data_gov_url TEXT,
      color TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_local_overlay_points_layer ON spatial_overlay_points(layer_id);

    CREATE TABLE IF NOT EXISTS spatial_overlay_lines (
      id TEXT PRIMARY KEY,
      layer_id TEXT NOT NULL,
      name TEXT NOT NULL,
      corridor_type TEXT NOT NULL,
      color TEXT NOT NULL,
      length_km REAL NOT NULL DEFAULT 0,
      stations_count INTEGER NOT NULL DEFAULT 0,
      daily_ridership_lakh REAL,
      status TEXT NOT NULL,
      agency TEXT NOT NULL,
      source_label TEXT NOT NULL,
      source_url TEXT NOT NULL,
      coordinates_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_local_overlay_lines_layer ON spatial_overlay_lines(layer_id);

    CREATE TABLE IF NOT EXISTS community_layers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      methodology TEXT,
      layer_type TEXT NOT NULL DEFAULT 'choropleth',
      boundary_level TEXT NOT NULL DEFAULT 'district',
      target_state TEXT DEFAULT 'All NCR',
      category TEXT NOT NULL DEFAULT 'Civic Dataset',
      metric_label TEXT NOT NULL DEFAULT 'Value',
      unit TEXT NOT NULL DEFAULT '',
      publisher TEXT NOT NULL,
      source_url TEXT NOT NULL,
      license TEXT NOT NULL DEFAULT 'GODL-India / CC-BY-4.0',
      color TEXT NOT NULL DEFAULT '#14b8a6',
      feature_count INTEGER NOT NULL DEFAULT 0,
      available_dates_json TEXT NOT NULL DEFAULT '[]',
      choropleth_by_date_json TEXT NOT NULL DEFAULT '{}',
      points_by_date_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      region_code TEXT NOT NULL,
      region_name TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Environment',
      metric_name TEXT NOT NULL,
      metric_value REAL NOT NULL DEFAULT 0,
      metric_unit TEXT NOT NULL DEFAULT '',
      source_label TEXT NOT NULL,
      source_url TEXT NOT NULL,
      author TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Ensure new columns exist if upgrading an older SQLite table in-place
  const existingCols = new Set(
    db
      .prepare('PRAGMA table_info(boundary_features)')
      .all()
      .map((c) => c.name)
  );
  const requiredNewCols = [
    ['population', 'INTEGER DEFAULT 0'],
    ['isfr_benchmark_region', 'TEXT'],
    ['pm10_ugm3', 'REAL DEFAULT 0'],
    ['no2_ugm3', 'REAL DEFAULT 0'],
    ['cpcb_station_name', 'TEXT'],
    ['groundwater_extraction_pct', 'REAL DEFAULT 0'],
    ['groundwater_depth_m', 'REAL DEFAULT 0'],
    ['cgwb_category', 'TEXT'],
    ['cgwb_source_label', 'TEXT'],
    ['cgwb_source_url', 'TEXT'],
    ['clean_fuel_pct', 'REAL DEFAULT 0'],
    ['piped_water_pct', 'REAL DEFAULT 0'],
    ['stunting_pct', 'REAL DEFAULT 0'],
    ['nfhs_source_label', 'TEXT'],
    ['nfhs_source_url', 'TEXT'],
    ['pupil_teacher_ratio', 'REAL DEFAULT 0'],
    ['udise_source_label', 'TEXT'],
    ['udise_source_url', 'TEXT'],
    ['crime_rate_per_lakh', 'REAL DEFAULT 0'],
    ['ncrb_source_label', 'TEXT'],
    ['ncrb_source_url', 'TEXT'],
    ['hospital_beds_per_10k', 'REAL DEFAULT 0'],
    ['health_source_label', 'TEXT'],
    ['health_source_url', 'TEXT'],
    ['census_source_label', 'TEXT'],
    ['census_source_url', 'TEXT'],
    ['center_json', 'TEXT'],
  ];
  for (const [colName, colDef] of requiredNewCols) {
    if (!existingCols.has(colName)) {
      db.exec(`ALTER TABLE boundary_features ADD COLUMN ${colName} ${colDef};`);
    }
  }

  // Live-linked layers: only the mapping definition is stored, never the source rows
  const layerCols = new Set(
    db
      .prepare('PRAGMA table_info(community_layers)')
      .all()
      .map((c) => c.name)
  );
  if (!layerCols.has('source_mode')) {
    db.exec("ALTER TABLE community_layers ADD COLUMN source_mode TEXT NOT NULL DEFAULT 'snapshot';");
  }
  if (!layerCols.has('live_config_json')) {
    db.exec('ALTER TABLE community_layers ADD COLUMN live_config_json TEXT;');
  }

  dbInstance = db;
  ensureBoundariesSeeded(db);
  return db;
}

export function seedLocalSpatialTables(db, force = false) {
  const layerCount = db
    .prepare('SELECT COUNT(*) as cnt FROM spatial_overlay_layers')
    .get();
  const stationCount = db
    .prepare('SELECT COUNT(*) as cnt FROM cpcb_stations')
    .get();
  if (
    !force &&
    layerCount?.cnt >= VERIFIED_OVERLAY_LAYERS.length &&
    stationCount?.cnt >= VERIFIED_CPCB_STATIONS.length
  ) {
    return;
  }

  const stationStmt = db.prepare(`
    INSERT OR REPLACE INTO cpcb_stations (
      id, name, city, state, lat, lon, aqi, pm25, pm10, no2, so2, last_updated, source, source_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const layerStmt = db.prepare(`
    INSERT OR REPLACE INTO spatial_overlay_layers (
      id, title, short_title, category, category_label, geometry_type, geometry_label,
      unit, publisher, source_url, data_gov_url, description, color, badge_text,
      default_visible, default_opacity, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const pointStmt = db.prepare(`
    INSERT OR REPLACE INTO spatial_overlay_points (
      id, layer_id, name, city, state, lat, lon,
      primary_metric_label, primary_metric_value, primary_metric_unit,
      secondary_metric_label, secondary_metric_value, secondary_metric_unit,
      status_badge, agency, source_label, source_url, data_gov_url, color
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const lineStmt = db.prepare(`
    INSERT OR REPLACE INTO spatial_overlay_lines (
      id, layer_id, name, corridor_type, color, length_km, stations_count,
      daily_ridership_lakh, status, agency, source_label, source_url, coordinates_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN TRANSACTION;');
  try {
    VERIFIED_CPCB_STATIONS.forEach((st, idx) => {
      const id = `cpcb-${idx + 1}-${st.station.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32)}`;
      stationStmt.run(
        id,
        st.station,
        st.city,
        st.state,
        Number(st.lat),
        Number(st.lon),
        Number(st.aqi || 0),
        Number(st.pm25 || 0),
        Number(st.pm10 || 0),
        Number(st.no2 || 0),
        0,
        st.updated || 'CPCB CAAQMS Official Bulletin',
        st.sourceLabel,
        st.sourceUrl
      );
    });

    VERIFIED_OVERLAY_LAYERS.forEach((layer, idx) => {
      layerStmt.run(
        layer.id,
        layer.title,
        layer.shortTitle,
        layer.category,
        layer.categoryLabel,
        layer.geometryType,
        layer.geometryLabel,
        layer.unit,
        layer.publisher,
        layer.sourceUrl,
        layer.dataGovUrl || null,
        layer.description,
        layer.color,
        layer.badgeText,
        layer.defaultVisible ? 1 : 0,
        Number(layer.defaultOpacity ?? 0.9),
        idx
      );

      for (const pt of layer.points || []) {
        pointStmt.run(
          pt.id,
          layer.id,
          pt.name,
          pt.city,
          pt.state,
          Number(pt.lat),
          Number(pt.lon),
          pt.primaryMetricLabel,
          Number.isFinite(Number(pt.primaryMetricValue))
            ? Number(pt.primaryMetricValue)
            : 0,
          typeof pt.primaryMetricValue === 'string'
            ? pt.primaryMetricValue
            : pt.primaryMetricUnit || '',
          pt.secondaryMetricLabel || null,
          pt.secondaryMetricValue !== undefined ? String(pt.secondaryMetricValue) : null,
          pt.secondaryMetricUnit || null,
          pt.statusBadge || null,
          pt.agency,
          pt.sourceLabel,
          pt.sourceUrl,
          pt.dataGovUrl || null,
          pt.color || layer.color
        );
      }

      for (const ln of layer.lines || []) {
        lineStmt.run(
          ln.id,
          layer.id,
          ln.name,
          ln.code || 'METRO',
          ln.color,
          Number(ln.routeLengthKm || 0),
          Number(ln.stationsCount || 0),
          parseFloat(String(ln.dailyRidershipEst || '0')) || null,
          ln.terminalEndpoints || ln.dailyRidershipEst || 'Operational',
          ln.operator || layer.publisher,
          ln.sourceLabel,
          ln.sourceUrl,
          JSON.stringify(ln.coordinates || [])
        );
      }
    });
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

export function seedLocalBoundaries(db, force = false) {
  seedLocalSpatialTables(db, force);

  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM boundary_features').get();
  if (!force && countRow && countRow.cnt >= 740) {
    const sample = db
      .prepare('SELECT groundwater_extraction_pct, cgwb_source_url FROM boundary_features LIMIT 1')
      .get();
    if (
      sample &&
      Number(sample.groundwater_extraction_pct) > 0 &&
      String(sample.cgwb_source_url || '').startsWith('https://')
    ) {
      return countRow.cnt;
    }
  }

  const files = [
    'districts.geojson',
    'constituencies.geojson',
    'assemblies.geojson',
    'wards.geojson',
  ];

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO boundary_features (
      code, name, state, parent_region, level,
      area_sq_km, population, population_density, literacy_rate, sex_ratio,
      green_cover_pct, isfr_benchmark_region,
      aqi_pm25, pm25_ugm3, pm10_ugm3, no2_ugm3, cpcb_station_name,
      groundwater_extraction_pct, groundwater_depth_m, cgwb_category, cgwb_source_label, cgwb_source_url,
      clean_fuel_pct, piped_water_pct, stunting_pct, nfhs_source_label, nfhs_source_url,
      pupil_teacher_ratio, udise_source_label, udise_source_url,
      crime_rate_per_lakh, ncrb_source_label, ncrb_source_url,
      hospital_beds_per_10k, health_source_label, health_source_url,
      rep_name, rep_role, rep_party, rep_term, rep_votes,
      rep_source_label, rep_source_url, rep_affidavit_url,
      green_source_label, green_source_url,
      pollution_source_label, pollution_source_url,
      census_source_label, census_source_url,
      boundary_source_label, boundary_source_url,
      data_source_label, data_source_url,
      center_json, properties_json, geojson_json
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?, ?
    )
  `);

  let total = 0;
  db.exec('BEGIN TRANSACTION;');
  try {
    for (const f of files) {
      const fullPath = path.join(SEED_BOUNDARIES_DIR, f);
      if (!fs.existsSync(fullPath)) continue;
      const fc = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      for (const feat of fc.features) {
        const p = feat.properties;
        stmt.run(
          p.code,
          p.name,
          p.state,
          p.parent_region || p.state,
          p.level,
          Number(p.area_sq_km || 0),
          Math.round(Number(p.population || 0)),
          Number(p.population_density || p.density || 0),
          Number(p.literacy_rate || 0),
          Number(p.sex_ratio || 0),
          Number(p.green_cover_pct || 0),
          p.isfr_benchmark_region || null,
          Number(p.aqi_pm25 || 0),
          Number(p.pm25_ugm3 || 0),
          Number(p.pm10_ugm3 || 0),
          Number(p.no2_ugm3 || 0),
          p.cpcb_station_name || null,
          Number(p.groundwater_extraction_pct || 0),
          Number(p.groundwater_depth_m || 0),
          p.cgwb_category || null,
          p.cgwb_source_label || null,
          p.cgwb_source_url || null,
          Number(p.clean_fuel_pct || 0),
          Number(p.piped_water_pct || 0),
          Number(p.stunting_pct || 0),
          p.nfhs_source_label || null,
          p.nfhs_source_url || null,
          Number(p.pupil_teacher_ratio || 0),
          p.udise_source_label || null,
          p.udise_source_url || null,
          Number(p.crime_rate_per_lakh || 0),
          p.ncrb_source_label || null,
          p.ncrb_source_url || null,
          Number(p.hospital_beds_per_10k || 0),
          p.health_source_label || null,
          p.health_source_url || null,
          p.rep_name || null,
          p.rep_role || null,
          p.rep_party || null,
          p.rep_term || null,
          p.rep_votes ? Number(p.rep_votes) : null,
          p.rep_source_label || null,
          p.rep_source_url || null,
          p.rep_affidavit_url || null,
          p.green_source_label || null,
          p.green_source_url || null,
          p.pollution_source_label || null,
          p.pollution_source_url || null,
          p.census_source_label || null,
          p.census_source_url || null,
          p.boundary_source_label || null,
          p.boundary_source_url || null,
          p.data_source_label || null,
          p.data_source_url || null,
          JSON.stringify(p.center || [77.21, 28.56]),
          JSON.stringify(p),
          JSON.stringify(feat.geometry)
        );
        total++;
      }
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
  return total;
}

export function getBoundariesFromLocalDb(db, level) {
  const rows = db
    .prepare('SELECT * FROM boundary_features WHERE level = ? ORDER BY code ASC')
    .all(level);

  return rows.map((row) => ({
    type: 'Feature',
    properties: {
      code: row.code,
      name: row.name,
      state: row.state,
      parent_region: row.parent_region,
      level: row.level,
      area_sq_km: Number(row.area_sq_km || 0),
      population: Number(row.population || 0),
      population_density: Number(row.population_density || 0),
      density: Number(row.population_density || 0),
      literacy_rate: Number(row.literacy_rate || 0),
      sex_ratio: Number(row.sex_ratio || 0),
      green_cover_pct: Number(row.green_cover_pct || 0),
      isfr_benchmark_region: row.isfr_benchmark_region,
      aqi_pm25: Number(row.aqi_pm25 || 0),
      pm25_ugm3: Number(row.pm25_ugm3 || 0),
      pm10_ugm3: Number(row.pm10_ugm3 || 0),
      no2_ugm3: Number(row.no2_ugm3 || 0),
      cpcb_station_name: row.cpcb_station_name,
      groundwater_extraction_pct: Number(row.groundwater_extraction_pct || 0),
      groundwater_depth_m: Number(row.groundwater_depth_m || 0),
      cgwb_category: row.cgwb_category,
      cgwb_source_label: row.cgwb_source_label,
      cgwb_source_url: row.cgwb_source_url,
      clean_fuel_pct: Number(row.clean_fuel_pct || 0),
      piped_water_pct: Number(row.piped_water_pct || 0),
      stunting_pct: Number(row.stunting_pct || 0),
      nfhs_source_label: row.nfhs_source_label,
      nfhs_source_url: row.nfhs_source_url,
      pupil_teacher_ratio: Number(row.pupil_teacher_ratio || 0),
      udise_source_label: row.udise_source_label,
      udise_source_url: row.udise_source_url,
      crime_rate_per_lakh: Number(row.crime_rate_per_lakh || 0),
      ncrb_source_label: row.ncrb_source_label,
      ncrb_source_url: row.ncrb_source_url,
      hospital_beds_per_10k: Number(row.hospital_beds_per_10k || 0),
      health_source_label: row.health_source_label,
      health_source_url: row.health_source_url,
      rep_name: row.rep_name,
      rep_role: row.rep_role,
      rep_party: row.rep_party,
      rep_term: row.rep_term,
      rep_votes: row.rep_votes !== null ? Number(row.rep_votes) : null,
      rep_source_label: row.rep_source_label,
      rep_source_url: row.rep_source_url,
      rep_affidavit_url: row.rep_affidavit_url,
      green_source_label: row.green_source_label,
      green_source_url: row.green_source_url,
      pollution_source_label: row.pollution_source_label,
      pollution_source_url: row.pollution_source_url,
      census_source_label: row.census_source_label,
      census_source_url: row.census_source_url,
      boundary_source_label: row.boundary_source_label,
      boundary_source_url: row.boundary_source_url,
      data_source_label: row.data_source_label,
      data_source_url: row.data_source_url,
      center: row.center_json ? JSON.parse(row.center_json) : [77.21, 28.56],
    },
    geometry: JSON.parse(row.geojson_json),
  }));
}

export function getSpatialLayersFromLocalDb(db) {
  const layerRows = db
    .prepare('SELECT * FROM spatial_overlay_layers ORDER BY sort_order ASC')
    .all();
  const pointRows = db.prepare('SELECT * FROM spatial_overlay_points').all();
  const lineRows = db.prepare('SELECT * FROM spatial_overlay_lines').all();
  const stationRows = db.prepare('SELECT * FROM cpcb_stations').all();

  const overlayLayers = layerRows.map((l) => {
    const pts = pointRows
      .filter((p) => p.layer_id === l.id)
      .map((p) => ({
        id: p.id,
        name: p.name,
        city: p.city,
        state: p.state,
        lat: Number(p.lat),
        lon: Number(p.lon),
        primaryMetricLabel: p.primary_metric_label,
        primaryMetricValue: Number(p.primary_metric_value),
        primaryMetricUnit: p.primary_metric_unit,
        secondaryMetricLabel: p.secondary_metric_label || undefined,
        secondaryMetricValue: p.secondary_metric_value || undefined,
        secondaryMetricUnit: p.secondary_metric_unit || undefined,
        statusBadge: p.status_badge || undefined,
        agency: p.agency,
        sourceLabel: p.source_label,
        sourceUrl: p.source_url,
        dataGovUrl: p.data_gov_url || undefined,
        color: p.color || l.color,
      }));

    const lns = lineRows
      .filter((ln) => ln.layer_id === l.id)
      .map((ln) => ({
        id: ln.id,
        name: ln.name,
        code: ln.corridor_type,
        color: ln.color,
        operator: ln.agency,
        routeLengthKm: Number(ln.length_km),
        stationsCount: Number(ln.stations_count),
        dailyRidershipEst:
          ln.daily_ridership_lakh !== null
            ? `${ln.daily_ridership_lakh} Lakh passenger journeys/day`
            : 'Operational Rapid Transit Corridor',
        terminalEndpoints: ln.status,
        sourceLabel: ln.source_label,
        sourceUrl: ln.source_url,
        coordinates: JSON.parse(ln.coordinates_json || '[]'),
      }));

    return {
      id: l.id,
      title: l.title,
      shortTitle: l.short_title,
      category: l.category,
      categoryLabel: l.category_label,
      geometryType: l.geometry_type,
      geometryLabel: l.geometry_label,
      unit: l.unit,
      publisher: l.publisher,
      sourceUrl: l.source_url,
      dataGovUrl: l.data_gov_url || undefined,
      description: l.description,
      color: l.color,
      badgeText: l.badge_text,
      defaultVisible: Boolean(l.default_visible),
      defaultOpacity: Number(l.default_opacity),
      points: pts.length > 0 ? pts : undefined,
      lines: lns.length > 0 ? lns : undefined,
    };
  });

  const cpcbStations = stationRows.map((s) => ({
    station: s.name,
    city: s.city,
    state: s.state,
    lat: Number(s.lat),
    lon: Number(s.lon),
    aqi: Number(s.aqi),
    pm25: Number(s.pm25),
    pm10: Number(s.pm10),
    no2: Number(s.no2),
    updated: s.last_updated,
    sourceLabel: s.source,
    sourceUrl: s.source_url,
  }));

  return { overlayLayers, cpcbStations };
}

function ensureBoundariesSeeded(db) {
  try {
    seedLocalBoundaries(db, false);
  } catch (err) {
    console.warn('Local SQLite auto-seed warning:', err);
  }
}

export function getLocalDbPath() {
  return DB_PATH;
}
