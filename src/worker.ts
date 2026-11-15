import {
  buildCkanTarget,
  buildDatagovTarget,
  fetchCached,
  sanitizeLiveConfig,
  upstreamErrorBody,
} from './lib/proxyCore';

export interface Env {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
  SUPABASE_URL?: string;
  SUPABASE_KEY?: string;
  /** data.gov.in API key. Set with: wrangler secret put DATAGOV_API_KEY */
  DATAGOV_API_KEY?: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

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

    // 1. Server-side Boundary Features API (reads normalized columns from Supabase PostgreSQL)
    if (
      (url.pathname === '/api/boundaries' || url.pathname === '/api/local/boundaries') &&
      request.method === 'GET'
    ) {
      const level = url.searchParams.get('level') || 'district';
      if (!sbUrl || !sbKey) {
        return new Response(
          JSON.stringify({
            error: 'Database connection not configured on Worker.',
            features: [],
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          }
        );
      }

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
          const features = (Array.isArray(rows) ? rows : []).map((row) => ({
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
              isfr_benchmark_region: row.isfr_benchmark_region || null,
              aqi_pm25: Number(row.aqi_pm25 || 0),
              pm25_ugm3: Number(row.pm25_ugm3 || 0),
              pm10_ugm3: Number(row.pm10_ugm3 || 0),
              no2_ugm3: Number(row.no2_ugm3 || 0),
              cpcb_station_name: row.cpcb_station_name || null,
              groundwater_extraction_pct: Number(row.groundwater_extraction_pct || 0),
              groundwater_depth_m: Number(row.groundwater_depth_m || 0),
              cgwb_category: row.cgwb_category || null,
              cgwb_source_label: row.cgwb_source_label || null,
              cgwb_source_url: row.cgwb_source_url || null,
              clean_fuel_pct: Number(row.clean_fuel_pct || 0),
              piped_water_pct: Number(row.piped_water_pct || 0),
              stunting_pct: Number(row.stunting_pct || 0),
              nfhs_source_label: row.nfhs_source_label || null,
              nfhs_source_url: row.nfhs_source_url || null,
              pupil_teacher_ratio: Number(row.pupil_teacher_ratio || 0),
              udise_source_label: row.udise_source_label || null,
              udise_source_url: row.udise_source_url || null,
              crime_rate_per_lakh: Number(row.crime_rate_per_lakh || 0),
              ncrb_source_label: row.ncrb_source_label || null,
              ncrb_source_url: row.ncrb_source_url || null,
              hospital_beds_per_10k: Number(row.hospital_beds_per_10k || 0),
              health_source_label: row.health_source_label || null,
              health_source_url: row.health_source_url || null,
              rep_name: row.rep_name,
              rep_role: row.rep_role,
              rep_party: row.rep_party,
              rep_term: row.rep_term,
              rep_votes: row.rep_votes,
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
              center: row.center,
            },
            geometry: row.geojson,
          }));
          return new Response(
            JSON.stringify({
              type: 'FeatureCollection',
              features,
              source: 'supabase-postgres',
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
      } catch (err: unknown) {
        return new Response(
          JSON.stringify({
            error: err instanceof Error ? err.message : 'Database fetch error',
            features: [],
          }),
          {
            status: 502,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          }
        );
      }
    }

    // 2. Server-side Spatial Overlay Layers & CPCB Stations API (reads from relational DB tables)
    if (
      (url.pathname === '/api/spatial-layers' ||
        url.pathname === '/api/local/spatial-layers') &&
      request.method === 'GET'
    ) {
      if (!sbUrl || !sbKey) {
        return new Response(
          JSON.stringify({ overlayLayers: [], cpcbStations: [] }),
          { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      const headers = {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
      };

      const [layersRes, pointsRes, linesRes, stationsRes] = await Promise.all([
        fetch(`${sbUrl}/rest/v1/spatial_overlay_layers?select=*&order=sort_order.asc`, {
          headers,
        }),
        fetch(`${sbUrl}/rest/v1/spatial_overlay_points?select=*`, { headers }),
        fetch(`${sbUrl}/rest/v1/spatial_overlay_lines?select=*`, { headers }),
        fetch(`${sbUrl}/rest/v1/cpcb_stations?select=*`, { headers }),
      ]);

      const layerRows = (layersRes.ok ? await layersRes.json() : []) as any[];
      const pointRows = (pointsRes.ok ? await pointsRes.json() : []) as any[];
      const lineRows = (linesRes.ok ? await linesRes.json() : []) as any[];
      const stationRows = (stationsRes.ok ? await stationsRes.json() : []) as any[];

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
            coordinates: Array.isArray(ln.coordinates) ? ln.coordinates : [],
          }));

        return {
          id: l.id,
          title: l.title,
          shortTitle: l.short_title,
          category: l.category,
          categoryLabel: l.category_label,
          geometryType:
            l.geometry_type === 'hybrid' ? 'line-network' : l.geometry_type,
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

      return new Response(
        JSON.stringify({
          overlayLayers,
          cpcbStations,
          source: 'supabase-postgres',
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

    // 3 & 4. CORS-safe proxies for data.gov.in and OpenCity CKAN (validated params, fixed hosts, TTL cache)
    if (url.pathname === '/api/datagov' || url.pathname === '/api/ckan') {
      const isDatagov = url.pathname === '/api/datagov';
      const apiKey = (isDatagov && (url.searchParams.get('api_key') || env.DATAGOV_API_KEY)) || '';
      if (isDatagov && !apiKey) {
        return jsonResponse(
          {
            error:
              'DATAGOV_API_KEY is not configured on the Worker. Create a free key at https://data.gov.in (My Account) and run: wrangler secret put DATAGOV_API_KEY',
          },
          503
        );
      }
      const target = isDatagov
        ? buildDatagovTarget(url.searchParams, apiKey)
        : buildCkanTarget(url.searchParams);
      if (!target.ok) return jsonResponse({ error: target.error }, 400);

      try {
        const result = await fetchCached(target.cacheKey, async () => {
          const upstream = await fetch(target.url, { headers: { Accept: 'application/json' } });
          return { status: upstream.status, body: await upstream.text() };
        });
        return new Response(upstreamErrorBody(result.status, result.body), {
          status: result.status,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': result.status === 200 ? 'public, max-age=300' : 'no-store',
            'X-Proxy-Cache': result.cached ? 'HIT' : 'MISS',
            ...CORS_HEADERS,
          },
        });
      } catch (err: unknown) {
        return jsonResponse(
          { error: err instanceof Error ? err.message : 'Upstream fetch error' },
          502
        );
      }
    }

    // 5. Server-side Sanitization & Proxy for /api/community-layers
    if (url.pathname === '/api/community-layers' || url.pathname === '/api/local/community-layers') {
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

          const isLive = body.source_mode === 'live';
          const liveConfig = isLive ? sanitizeLiveConfig(body.live_config) : null;
          if (isLive && !liveConfig) {
            return jsonResponse(
              { error: 'A live layer needs a valid live_config (portal, resourceId, filters).' },
              400
            );
          }

          const payload = {
            slug: sanitizeStr(body.slug || `layer-${Date.now()}`, 100),
            name: sanitizeStr(body.name || 'Community Layer', 150),
            description: sanitizeStr(body.description || '', 1000),
            methodology: sanitizeStr(body.methodology || '', 1000),
            target_state: sanitizeStr(body.target_state || 'All NCR', 80),
            source_mode: isLive ? 'live' : 'snapshot',
            live_config: liveConfig,
            layer_type:
              body.layer_type === 'point'
                ? 'point'
                : body.layer_type === 'line'
                  ? 'line'
                  : 'choropleth',
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
            // Live layers never persist source rows: the portal stays the single source of truth.
            available_dates: !isLive && Array.isArray(body.available_dates)
              ? body.available_dates
              : [],
            choropleth_by_date: isLive ? {} : body.choropleth_by_date || {},
            points_by_date: isLive ? {} : body.points_by_date || {},
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
