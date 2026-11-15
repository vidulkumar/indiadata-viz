export interface Env {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SAMPLE_NCR_CPCB_RECORDS = [
  {
    station: 'Anand Vihar, Delhi - DPCC',
    city: 'Delhi',
    state: 'Delhi',
    latitude: 28.6476,
    longitude: 77.3158,
    pm25: 342,
    pm10: 410,
    no2: 68,
    so2: 18,
    last_update: 'Live Edge Feed',
  },
  {
    station: 'RK Puram, Delhi - DPCC',
    city: 'Delhi',
    state: 'Delhi',
    latitude: 28.5633,
    longitude: 77.1869,
    pm25: 256,
    pm10: 298,
    no2: 52,
    so2: 14,
    last_update: 'Live Edge Feed',
  },
  {
    station: 'Punjabi Bagh, Delhi - DPCC',
    city: 'Delhi',
    state: 'Delhi',
    latitude: 28.674,
    longitude: 77.131,
    pm25: 289,
    pm10: 334,
    no2: 59,
    so2: 15,
    last_update: 'Live Edge Feed',
  },
  {
    station: 'Mandir Marg, New Delhi - DPCC',
    city: 'Delhi',
    state: 'Delhi',
    latitude: 28.6364,
    longitude: 77.2011,
    pm25: 228,
    pm10: 274,
    no2: 47,
    so2: 12,
    last_update: 'Live Edge Feed',
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
    last_update: 'Live Edge Feed',
  },
  {
    station: 'Vikas Sadan, Gurugram - HSPCB',
    city: 'Gurugram',
    state: 'Haryana',
    latitude: 28.4501,
    longitude: 77.0285,
    pm25: 204,
    pm10: 249,
    no2: 39,
    so2: 10,
    last_update: 'Live Edge Feed',
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
    last_update: 'Live Edge Feed',
  },
  {
    station: 'Knowledge Park III, Greater Noida - UPPCB',
    city: 'Greater Noida',
    state: 'Uttar Pradesh',
    latitude: 28.4727,
    longitude: 77.482,
    pm25: 246,
    pm10: 295,
    no2: 44,
    so2: 13,
    last_update: 'Live Edge Feed',
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
    last_update: 'Live Edge Feed',
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
    last_update: 'Live Edge Feed',
  },
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Cloudflare Edge Proxy for data.gov.in APIs
    if (url.pathname === '/api/datagov') {
      const resourceId =
        url.searchParams.get('resource_id') || '3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69';
      const apiKey = url.searchParams.get('api_key') || '';
      const limit = url.searchParams.get('limit') || '500';

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
              ...CORS_HEADERS,
            },
          }
        );
      }

      try {
        const targetUrl = `https://api.data.gov.in/resource/${encodeURIComponent(
          resourceId
        )}?api-key=${encodeURIComponent(apiKey)}&format=json&limit=${encodeURIComponent(limit)}`;
        const upstream = await fetch(targetUrl, {
          headers: { Accept: 'application/json' },
        });
        const data = await upstream.json();
        return new Response(JSON.stringify({ source: 'data.gov.in-live', ...data }), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=900',
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

    return env.ASSETS.fetch(request);
  },
};
