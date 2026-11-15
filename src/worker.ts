export interface Env {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
  SUPABASE_URL?: string;
  SUPABASE_KEY?: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function sanitizeStr(val: unknown, maxLen = 500): string {
  return String(val ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/^[=+\-@\t\r]+/, '')
    .trim()
    .slice(0, maxLen);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const sbUrl = env.SUPABASE_URL || '';
    const sbKey = env.SUPABASE_KEY || '';

    // 1. Server-side Boundary Features API (keeps DB URL & key private on the Worker)
    if (url.pathname === '/api/boundaries' && request.method === 'GET') {
      const level = url.searchParams.get('level') || 'district';
      if (sbUrl && sbKey) {
        try {
          const res = await fetch(
            `${sbUrl}/rest/v1/boundary_features?select=*&level=eq.${encodeURIComponent(
              level
            )}&order=code.asc`,
            {
              headers: {
                apikey: sbKey,
                Authorization: `Bearer ${sbKey}`,
              },
            }
          );
          if (res.ok) {
            const rows = (await res.json()) as any[];
            if (Array.isArray(rows) && rows.length > 0) {
              const features = rows.map((row) => ({
                type: 'Feature',
                properties: {
                  ...(row.properties || {}),
                  code: row.code,
                  name: row.name,
                  state: row.state,
                  parent_region: row.parent_region,
                  level: row.level,
                  area_sq_km: Number(row.area_sq_km || row.properties?.area_sq_km || 0),
                  green_cover_pct: Number(
                    row.green_cover_pct || row.properties?.green_cover_pct || 0
                  ),
                  aqi_pm25: Number(row.aqi_pm25 || row.properties?.aqi_pm25 || 0),
                  pm25_ugm3: Number(row.properties?.pm25_ugm3 || 0),
                  pm10_ugm3: Number(row.properties?.pm10_ugm3 || 0),
                  no2_ugm3: Number(row.properties?.no2_ugm3 || 0),
                  cpcb_station_name: row.properties?.cpcb_station_name || null,
                  isfr_benchmark_region: row.properties?.isfr_benchmark_region || null,
                  population_density: Number(
                    row.population_density || row.properties?.population_density || 0
                  ),
                  density: Number(
                    row.population_density || row.properties?.population_density || 0
                  ),
                  literacy_rate: Number(
                    row.literacy_rate || row.properties?.literacy_rate || 0
                  ),
                  sex_ratio: Number(row.sex_ratio || row.properties?.sex_ratio || 0),
                  rep_name: row.rep_name,
                  rep_role: row.rep_role,
                  rep_party: row.rep_party,
                  rep_term: row.rep_term,
                  rep_votes: row.rep_votes,
                  rep_source_label: row.rep_source_label,
                  rep_source_url: row.rep_source_url,
                  rep_affidavit_url: row.rep_affidavit_url,
                  boundary_source_label: row.boundary_source_label,
                  boundary_source_url: row.boundary_source_url,
                  data_source_label: row.data_source_label,
                  data_source_url: row.data_source_url,
                  center: row.center,
                },
                geometry: row.geojson,
              }));
              return new Response(
                JSON.stringify({ type: 'FeatureCollection', features }),
                {
                  headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=300',
                    ...CORS_HEADERS,
                  },
                }
              );
            }
          }
        } catch {
          // fallback to static edge GeoJSON below
        }
      }

      const fileMap: Record<string, string> = {
        district: '/boundaries/districts.geojson',
        constituency: '/boundaries/constituencies.geojson',
        assembly: '/boundaries/assemblies.geojson',
        ward: '/boundaries/wards.geojson',
      };
      const assetPath = fileMap[level] || '/boundaries/districts.geojson';
      return env.ASSETS.fetch(new Request(new URL(assetPath, request.url), request));
    }

    // 2. CORS-safe Proxy for data.gov.in APIs
    if (url.pathname === '/api/datagov') {
      const resourceId =
        url.searchParams.get('resource_id') || '3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69';
      const apiKey =
        url.searchParams.get('api_key') ||
        '579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b';
      const limit = url.searchParams.get('limit') || '100';
      const offset = url.searchParams.get('offset') || '0';

      try {
        const targetUrl = `https://api.data.gov.in/resource/${encodeURIComponent(
          resourceId
        )}?api-key=${encodeURIComponent(apiKey)}&format=json&limit=${encodeURIComponent(
          limit
        )}&offset=${encodeURIComponent(offset)}`;
        const upstream = await fetch(targetUrl, {
          headers: { Accept: 'application/json' },
        });
        const data = await upstream.json();
        return new Response(JSON.stringify({ source: 'data.gov.in-live', ...data }), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300',
            ...CORS_HEADERS,
          },
        });
      } catch (err: unknown) {
        return new Response(
          JSON.stringify({
            error: err instanceof Error ? err.message : 'Upstream data.gov.in fetch error',
          }),
          {
            status: 502,
            headers: {
              'Content-Type': 'application/json',
              ...CORS_HEADERS,
            },
          }
        );
      }
    }

    // 3. CORS-safe Proxy for OpenCity CKAN API
    if (url.pathname === '/api/ckan') {
      const query = url.searchParams.get('q') || 'delhi';
      const resourceId = url.searchParams.get('resource_id') || '';

      try {
        const targetUrl = resourceId
          ? `https://data.opencity.in/api/3/action/datastore_search?resource_id=${encodeURIComponent(
              resourceId
            )}&limit=200`
          : `https://data.opencity.in/api/3/action/package_search?q=${encodeURIComponent(
              query
            )}&rows=10`;
        const upstream = await fetch(targetUrl, {
          headers: { Accept: 'application/json' },
        });
        const data = await upstream.json();
        return new Response(JSON.stringify({ source: 'opencity-ckan-live', ...data }), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300',
            ...CORS_HEADERS,
          },
        });
      } catch (err: unknown) {
        return new Response(
          JSON.stringify({
            error: err instanceof Error ? err.message : 'OpenCity CKAN upstream error',
          }),
          {
            status: 502,
            headers: {
              'Content-Type': 'application/json',
              ...CORS_HEADERS,
            },
          }
        );
      }
    }

    // 4. Server-side Sanitization & Proxy for /api/community-layers
    if (url.pathname === '/api/community-layers') {
      if (!sbUrl || !sbKey) {
        return new Response(JSON.stringify({ records: [] }), {
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }

      if (request.method === 'GET') {
        const res = await fetch(
          `${sbUrl}/rest/v1/community_layers?select=*&category=neq.archived&order=created_at.desc`,
          {
            headers: {
              apikey: sbKey,
              Authorization: `Bearer ${sbKey}`,
            },
          }
        );
        const rows = await res.json();
        return new Response(JSON.stringify({ records: Array.isArray(rows) ? rows : [] }), {
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }

      if (request.method === 'POST') {
        try {
          const body = (await request.json()) as Record<string, unknown>;
          const rawUrl = String(body.source_url || '').trim();
          if (!/^https?:\/\/[^\s<>"]+$/i.test(rawUrl)) {
            return new Response(
              JSON.stringify({ error: 'A valid official https:// source URL is required.' }),
              { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
            );
          }

          const payload = {
            slug: sanitizeStr(body.slug || `layer-${Date.now()}`, 100),
            name: sanitizeStr(body.name || 'Community Layer', 150),
            description: sanitizeStr(body.description || '', 1000),
            methodology: sanitizeStr(body.methodology || '', 1000),
            target_state: sanitizeStr(body.target_state || 'All NCR', 80),
            layer_type: body.layer_type === 'point' ? 'point' : 'choropleth',
            boundary_level: ['district', 'constituency', 'assembly', 'ward'].includes(
              String(body.boundary_level)
            )
              ? body.boundary_level
              : 'district',
            category: sanitizeStr(body.category || 'Civic Dataset', 80),
            metric_label: sanitizeStr(body.metric_label || 'Value', 80),
            unit: sanitizeStr(body.unit || '', 30),
            publisher: sanitizeStr(body.publisher || 'Civic Contributor', 120),
            source_url: rawUrl,
            license: sanitizeStr(body.license || 'GODL-India', 40),
            color: sanitizeStr(body.color || '#10b981', 20),
            feature_count: Number(body.feature_count) || 0,
            available_dates: Array.isArray(body.available_dates)
              ? body.available_dates
              : [],
            choropleth_by_date: body.choropleth_by_date || {},
            points_by_date: body.points_by_date || {},
          };

          const res = await fetch(`${sbUrl}/rest/v1/community_layers`, {
            method: 'POST',
            headers: {
              apikey: sbKey,
              Authorization: `Bearer ${sbKey}`,
              'Content-Type': 'application/json',
              Prefer: 'return=representation',
            },
            body: JSON.stringify(payload),
          });
          const saved = await res.json();
          return new Response(JSON.stringify(saved), {
            status: res.status,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          });
        } catch (err: unknown) {
          return new Response(
            JSON.stringify({
              error: err instanceof Error ? err.message : 'Invalid payload',
            }),
            { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
          );
        }
      }
    }

    // Serve static assets, with SPA fallback to /index.html for routes like /upload
    const assetRes = await env.ASSETS.fetch(request);
    if (assetRes.status === 404 && !url.pathname.startsWith('/api/') && !url.pathname.includes('.')) {
      return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
    }
    return assetRes;
  },
};
