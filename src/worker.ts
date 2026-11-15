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

const SAMPLE_NCR_CPCB_RECORDS = [
  {
    station: 'Anand Vihar, Delhi - DPCC',
    city: 'Delhi',
    state: 'NCT of Delhi',
    latitude: 28.6476,
    longitude: 77.3158,
    pm25: 342,
    pm10: 410,
    no2: 68,
    so2: 18,
    last_update: '2025-11-15',
  },
  {
    station: 'RK Puram, Delhi - DPCC',
    city: 'Delhi',
    state: 'NCT of Delhi',
    latitude: 28.5633,
    longitude: 77.1869,
    pm25: 256,
    pm10: 298,
    no2: 52,
    so2: 14,
    last_update: '2025-11-15',
  },
  {
    station: 'Punjabi Bagh, Delhi - DPCC',
    city: 'Delhi',
    state: 'NCT of Delhi',
    latitude: 28.674,
    longitude: 77.131,
    pm25: 289,
    pm10: 334,
    no2: 59,
    so2: 15,
    last_update: '2025-11-15',
  },
  {
    station: 'Mandir Marg, New Delhi - DPCC',
    city: 'Delhi',
    state: 'NCT of Delhi',
    latitude: 28.6364,
    longitude: 77.2011,
    pm25: 228,
    pm10: 274,
    no2: 47,
    so2: 12,
    last_update: '2025-11-15',
  },
  {
    station: 'ITO, New Delhi - CPCB',
    city: 'Delhi',
    state: 'NCT of Delhi',
    latitude: 28.6286,
    longitude: 77.241,
    pm25: 295,
    pm10: 356,
    no2: 61,
    so2: 16,
    last_update: '2025-11-15',
  },
  {
    station: 'Sector 51, Gurugram - HSPCB',
    city: 'Gurugram',
    state: 'Haryana',
    latitude: 28.4227,
    longitude: 77.0667,
    pm25: 215,
    pm10: 265,
    no2: 41,
    so2: 11,
    last_update: '2025-11-15',
  },
  {
    station: 'Sector 62, Noida - IMD',
    city: 'Noida',
    state: 'Uttar Pradesh',
    latitude: 28.6245,
    longitude: 77.3577,
    pm25: 268,
    pm10: 312,
    no2: 54,
    so2: 16,
    last_update: '2025-11-15',
  },
  {
    station: 'Vasundhara, Ghaziabad - UPPCB',
    city: 'Ghaziabad',
    state: 'Uttar Pradesh',
    latitude: 28.6603,
    longitude: 77.3572,
    pm25: 318,
    pm10: 375,
    no2: 63,
    so2: 19,
    last_update: '2025-11-15',
  },
  {
    station: 'Sector 16A, Faridabad - HSPCB',
    city: 'Faridabad',
    state: 'Haryana',
    latitude: 28.4088,
    longitude: 77.3099,
    pm25: 234,
    pm10: 280,
    no2: 46,
    so2: 14,
    last_update: '2025-11-15',
  },
  {
    station: 'Murthal Road, Sonipat - HSPCB',
    city: 'Sonipat',
    state: 'Haryana',
    latitude: 28.9931,
    longitude: 77.0151,
    pm25: 198,
    pm10: 242,
    no2: 38,
    so2: 11,
    last_update: '2025-11-15',
  },
];

const SAMPLE_OPENCITY_RECORDS = [
  { Ward_Name: 'Chandni Chowk', ULB: 'MCD Delhi', Dengue_Cases: 34, Solid_Waste_TPD: 48.2 },
  { Ward_Name: 'Hauz Khas', ULB: 'MCD Delhi', Dengue_Cases: 19, Solid_Waste_TPD: 52.6 },
  { Ward_Name: 'Greater Kailash', ULB: 'MCD Delhi', Dengue_Cases: 14, Solid_Waste_TPD: 44.1 },
  { Ward_Name: 'Rohini-A', ULB: 'MCD Delhi', Dengue_Cases: 41, Solid_Waste_TPD: 61.0 },
  { Ward_Name: 'Dwarka-B', ULB: 'MCD Delhi', Dengue_Cases: 27, Solid_Waste_TPD: 58.4 },
  { Ward_Name: 'Lajpat Nagar', ULB: 'MCD Delhi', Dengue_Cases: 22, Solid_Waste_TPD: 49.0 },
  { Ward_Name: 'Vasant Vihar', ULB: 'MCD Delhi', Dengue_Cases: 12, Solid_Waste_TPD: 43.5 },
  { Ward_Name: 'Pitampura', ULB: 'MCD Delhi', Dengue_Cases: 29, Solid_Waste_TPD: 54.8 },
];

function sanitizeStr(val: unknown, maxLen = 200): string {
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
      const apiKey = url.searchParams.get('api_key') || '';
      const limit = url.searchParams.get('limit') || '500';
      const offset = url.searchParams.get('offset') || '0';

      if (!apiKey || apiKey === 'demo') {
        return new Response(
          JSON.stringify({
            source: 'cloudflare-edge-preset',
            resource_id: resourceId,
            count: SAMPLE_NCR_CPCB_RECORDS.length,
            records: SAMPLE_NCR_CPCB_RECORDS,
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=300',
              ...CORS_HEADERS,
            },
          }
        );
      }

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
            source: 'fallback-after-error',
            error: err instanceof Error ? err.message : 'Upstream fetch error',
            records: SAMPLE_NCR_CPCB_RECORDS,
          }),
          {
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
      const query = url.searchParams.get('q') || 'delhi wards';
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
        if (!upstream.ok) throw new Error(`CKAN status ${upstream.status}`);
        const data = await upstream.json();
        return new Response(
          JSON.stringify({
            source: 'opencity-ckan-live',
            records: SAMPLE_OPENCITY_RECORDS,
            ckan: data,
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=300',
              ...CORS_HEADERS,
            },
          }
        );
      } catch {
        return new Response(
          JSON.stringify({
            source: 'opencity-edge-preset',
            records: SAMPLE_OPENCITY_RECORDS,
          }),
          {
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
          `${sbUrl}/rest/v1/community_layers?select=*&order=created_at.desc`,
          {
            headers: {
              apikey: sbKey,
              Authorization: `Bearer ${sbKey}`,
            },
          }
        );
        const rows = await res.json();
        return new Response(JSON.stringify(rows), {
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }

      if (request.method === 'POST') {
        try {
          const body = (await request.json()) as Record<string, unknown>;
          const rawUrl = String(body.source_url || 'https://data.gov.in').trim();
          const safeUrl = /^https?:\/\/[^\s<>"]+$/i.test(rawUrl)
            ? rawUrl
            : 'https://data.gov.in';

          const payload = {
            slug: sanitizeStr(body.slug || `layer-${Date.now()}`, 100),
            name: sanitizeStr(body.name || 'Community Layer', 150),
            layer_type: body.layer_type === 'point' ? 'point' : 'choropleth',
            boundary_level: ['district', 'constituency', 'assembly', 'ward'].includes(
              String(body.boundary_level)
            )
              ? body.boundary_level
              : 'district',
            category: sanitizeStr(body.category || 'Civic Infrastructure', 80),
            metric_label: sanitizeStr(body.metric_label || 'Value', 80),
            unit: sanitizeStr(body.unit || '', 30),
            publisher: sanitizeStr(body.publisher || 'Community Contributor', 120),
            source_url: safeUrl,
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

    return env.ASSETS.fetch(request);
  },
};
