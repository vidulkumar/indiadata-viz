import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
// @ts-ignore
import { getLocalDb, getLocalDbPath } from './scripts/local-db.mjs';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function localSqliteApiPlugin(): Plugin {
  const attachMiddleware = (middlewares: any) => {
    middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      const rawUrl = req.url || '/';
      if (!rawUrl.startsWith('/api/')) {
        return next();
      }

      const url = new URL(rawUrl, 'http://localhost');
      const db = getLocalDb();

      try {
        if (url.pathname === '/api/local/status' && req.method === 'GET') {
          const bCount = db.prepare('SELECT COUNT(*) as cnt FROM boundary_features').get() as any;
          const cCount = db
            .prepare("SELECT COUNT(*) as cnt FROM community_layers WHERE category != 'archived'")
            .get() as any;
          const iCount = db.prepare('SELECT COUNT(*) as cnt FROM insights').get() as any;
          return sendJson(res, 200, {
            ok: true,
            mode: 'local-sqlite',
            dbPath: getLocalDbPath(),
            boundaries: bCount?.cnt || 0,
            communityLayers: cCount?.cnt || 0,
            insights: iCount?.cnt || 0,
          });
        }

        if (
          (url.pathname === '/api/local/boundaries' ||
            url.pathname === '/api/boundaries') &&
          req.method === 'GET'
        ) {
          const level = url.searchParams.get('level') || 'district';
          const rows = db
            .prepare('SELECT properties_json, geojson_json FROM boundary_features WHERE level = ? ORDER BY code ASC')
            .all(level) as Array<{ properties_json: string; geojson_json: string }>;

          const features = rows.map((r) => ({
            type: 'Feature',
            properties: JSON.parse(r.properties_json),
            geometry: JSON.parse(r.geojson_json),
          }));
          return sendJson(res, 200, {
            type: 'FeatureCollection',
            features,
            source: 'local-sqlite',
          });
        }

        if (
          (url.pathname === '/api/local/community-layers' ||
            url.pathname === '/api/community-layers') &&
          req.method === 'GET'
        ) {
          const rows = db
            .prepare("SELECT * FROM community_layers WHERE category != 'archived' ORDER BY created_at DESC")
            .all() as any[];

          const records = rows.map((r) => ({
            id: r.id,
            slug: r.slug,
            name: r.name,
            description: r.description,
            methodology: r.methodology,
            layer_type: r.layer_type,
            boundary_level: r.boundary_level,
            target_state: r.target_state,
            category: r.category,
            metric_label: r.metric_label,
            unit: r.unit,
            publisher: r.publisher,
            source_url: r.source_url,
            license: r.license,
            color: r.color,
            feature_count: r.feature_count,
            available_dates: JSON.parse(r.available_dates_json || '[]'),
            choropleth_by_date: JSON.parse(r.choropleth_by_date_json || '{}'),
            points_by_date: JSON.parse(r.points_by_date_json || '{}'),
            created_at: r.created_at,
          }));
          return sendJson(res, 200, { records, source: 'local-sqlite' });
        }

        if (
          (url.pathname === '/api/local/community-layers' ||
            url.pathname === '/api/community-layers') &&
          req.method === 'POST'
        ) {
          const raw = await readBody(req);
          const body = JSON.parse(raw || '{}');
          const slug = String(body.slug || `comm-${Date.now()}`).slice(0, 120);
          const stmt = db.prepare(`
            INSERT OR REPLACE INTO community_layers (
              slug, name, description, methodology, layer_type, boundary_level,
              target_state, category, metric_label, unit, publisher, source_url,
              license, color, feature_count, available_dates_json,
              choropleth_by_date_json, points_by_date_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          stmt.run(
            slug,
            String(body.name || 'Uploaded Civic Dataset'),
            String(body.description || ''),
            String(body.methodology || ''),
            String(body.layer_type || 'choropleth'),
            String(body.boundary_level || 'district'),
            String(body.target_state || 'All NCR'),
            String(body.category || 'Civic Dataset'),
            String(body.metric_label || 'Value'),
            String(body.unit || ''),
            String(body.publisher || 'Civic Contributor'),
            String(body.source_url || ''),
            String(body.license || 'GODL-India / CC-BY-4.0'),
            String(body.color || '#14b8a6'),
            Number(body.feature_count || 0),
            JSON.stringify(Array.isArray(body.available_dates) ? body.available_dates : []),
            JSON.stringify(body.choropleth_by_date || {}),
            JSON.stringify(body.points_by_date || {})
          );
          return sendJson(res, 200, { ok: true, slug, source: 'local-sqlite' });
        }

        if (url.pathname === '/api/local/insights' && req.method === 'GET') {
          const rows = db
            .prepare('SELECT * FROM insights ORDER BY created_at DESC LIMIT 50')
            .all();
          return sendJson(res, 200, { records: rows, source: 'local-sqlite' });
        }

        if (url.pathname === '/api/local/insights' && req.method === 'POST') {
          const raw = await readBody(req);
          const body = JSON.parse(raw || '{}');
          const stmt = db.prepare(`
            INSERT INTO insights (
              region_code, region_name, title, summary, category,
              metric_name, metric_value, metric_unit, source_label, source_url, author
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          stmt.run(
            String(body.region_code || ''),
            String(body.region_name || ''),
            String(body.title || ''),
            String(body.summary || ''),
            String(body.category || 'Environment'),
            String(body.metric_name || ''),
            Number(body.metric_value || 0),
            String(body.metric_unit || ''),
            String(body.source_label || ''),
            String(body.source_url || ''),
            String(body.author || '')
          );
          return sendJson(res, 200, { ok: true, source: 'local-sqlite' });
        }

        if (url.pathname === '/api/datagov' && req.method === 'GET') {
          const resourceId =
            url.searchParams.get('resource_id') || '3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69';
          const apiKey =
            url.searchParams.get('api_key') ||
            '579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b';
          const limit = url.searchParams.get('limit') || '50';
          const target = new URL(`https://api.data.gov.in/resource/${encodeURIComponent(resourceId)}`);
          target.searchParams.set('api-key', apiKey);
          target.searchParams.set('format', 'json');
          target.searchParams.set('limit', limit);
          const upstream = await fetch(target.toString());
          const data = await upstream.json();
          return sendJson(res, 200, data);
        }

        if (url.pathname === '/api/ckan' && req.method === 'GET') {
          const action = url.searchParams.get('action') || 'package_search';
          const q = url.searchParams.get('q') || 'delhi';
          const target = new URL(`https://data.opencity.in/api/3/action/${encodeURIComponent(action)}`);
          target.searchParams.set('q', q);
          const upstream = await fetch(target.toString());
          const data = await upstream.json();
          return sendJson(res, 200, data);
        }
      } catch (err) {
        return sendJson(res, 500, { error: String(err) });
      }

      next();
    });
  };

  return {
    name: 'local-sqlite-api',
    configureServer(server) {
      attachMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      attachMiddleware(server.middlewares);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localSqliteApiPlugin()],
  server: {
    port: 3000,
    hmr: process.env.DISABLE_HMR === 'true' ? false : undefined,
  },
});
