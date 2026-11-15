import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = path.resolve('data');
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
      green_cover_pct REAL DEFAULT 0,
      aqi_pm25 REAL DEFAULT 0,
      pm25_ugm3 REAL DEFAULT 0,
      population_density REAL DEFAULT 0,
      literacy_rate REAL DEFAULT 0,
      sex_ratio REAL DEFAULT 0,
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
      boundary_source_label TEXT,
      boundary_source_url TEXT,
      data_source_label TEXT,
      data_source_url TEXT,
      properties_json TEXT NOT NULL,
      geojson_json TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_local_boundary_level ON boundary_features(level);

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

  dbInstance = db;
  ensureBoundariesSeeded(db);
  return db;
}

export function seedLocalBoundaries(db, force = false) {
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM boundary_features').get();
  if (!force && countRow && countRow.cnt >= 740) {
    return countRow.cnt;
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
      area_sq_km, green_cover_pct, aqi_pm25, pm25_ugm3,
      population_density, literacy_rate, sex_ratio,
      rep_name, rep_role, rep_party, rep_term, rep_votes,
      rep_source_label, rep_source_url, rep_affidavit_url,
      green_source_label, green_source_url,
      pollution_source_label, pollution_source_url,
      boundary_source_label, boundary_source_url,
      data_source_label, data_source_url,
      properties_json, geojson_json
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?
    )
  `);

  let total = 0;
  db.exec('BEGIN TRANSACTION;');
  try {
    for (const f of files) {
      const fullPath = path.resolve('public/boundaries', f);
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
          Number(p.green_cover_pct || 0),
          Number(p.aqi_pm25 || 0),
          Number(p.pm25_ugm3 || 0),
          Number(p.population_density || p.density || 0),
          Number(p.literacy_rate || 0),
          Number(p.sex_ratio || 0),
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
          p.boundary_source_label || null,
          p.boundary_source_url || null,
          p.data_source_label || null,
          p.data_source_url || null,
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
