export interface Env {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
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

    // 1. CORS-safe Proxy for data.gov.in APIs
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

    // 2. CORS-safe Proxy for OpenCity CKAN API
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

    // 3. Server-side Sanitization & Proxy for /api/community-layers
    if (url.pathname === '/api/community-layers') {
      const sbUrl = env.VITE_SUPABASE_URL || 'https://vdcxpatuospplgpcsonn.supabase.co';
      const sbKey =
        env.VITE_SUPABASE_PUBLISHABLE_KEY ||
        'sb_publishable_rWQBriNhmU31mwH0lN9ZPg_hbYIx8t3';

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
