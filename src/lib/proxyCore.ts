// Shared by the Cloudflare Worker (src/worker.ts) and the Vite dev middleware (vite.config.ts).
// Pure functions only: no Worker or Node specific APIs, no TS-only runtime syntax.
import type { LiveAggregate, LiveSourceConfig } from '../types.ts';

export const PROXY_TTL_MS = 5 * 60 * 1000;
export const DATAGOV_MAX_PAGE = 100; // data.gov.in caps a page at 100 records
const MAX_CACHE_ENTRIES = 200;

const RESOURCE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const COLUMN_RE = /^[^\u0000-\u001F<>"'`\\]{1,80}$/;
const BOUNDARY_CODE_RE = /^[A-Za-z0-9_-]{2,60}$/;
const AGGREGATES = ['avg', 'sum', 'max', 'min', 'last'];
const CKAN_ACTIONS = ['package_search', 'datastore_search', 'package_show'];

export type ProxyTarget =
  | { ok: true; url: string; cacheKey: string }
  | { ok: false; error: string };

interface CacheEntry {
  expires: number;
  status: number;
  body: string;
}
const cache = new Map<string, CacheEntry>();

/** In-memory TTL cache. Only successful (200) upstream answers are cached. */
export async function fetchCached(
  key: string,
  fetcher: () => Promise<{ status: number; body: string }>
): Promise<{ status: number; body: string; cached: boolean }> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) {
    return { status: hit.status, body: hit.body, cached: true };
  }
  const res = await fetcher();
  if (res.status === 200) {
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { expires: now + PROXY_TTL_MS, status: res.status, body: res.body });
  }
  return { status: res.status, body: res.body, cached: false };
}

export function clearProxyCache(): void {
  cache.clear();
}

/** Turns an empty or HTML upstream failure into a readable JSON error for the UI. */
export function upstreamErrorBody(status: number, body: string): string {
  if (status === 200) return body;
  if (body.trim().startsWith('{')) return body;
  const hint =
    status === 403
      ? ' (the portal blocks automated API access)'
      : status === 429
        ? ' (rate limited, try again shortly)'
        : '';
  return JSON.stringify({ error: `The source portal answered HTTP ${status}${hint}.` });
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Parses a JSON object of column → value. Returns null if malformed or unsafe. */
export function parseFilters(raw: string | null): Record<string, string> | null {
  if (raw === null || raw === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return sanitizeFilters(parsed);
}

export function sanitizeFilters(parsed: unknown): Record<string, string> | null {
  if (parsed === undefined || parsed === null) return {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const out: Record<string, string> = {};
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > 10) return null;
  for (const [k, v] of entries) {
    if (!COLUMN_RE.test(k)) return null;
    if (typeof v !== 'string' && typeof v !== 'number') return null;
    const s = String(v).trim();
    if (s.length === 0 || s.length > 120) return null;
    out[k] = s;
  }
  return out;
}

export function buildDatagovTarget(sp: URLSearchParams, apiKey: string): ProxyTarget {
  const resourceId = (sp.get('resource_id') || '').trim();
  if (!RESOURCE_ID_RE.test(resourceId)) {
    return { ok: false, error: 'resource_id is missing or malformed.' };
  }
  const filters = parseFilters(sp.get('filters'));
  if (filters === null) {
    return { ok: false, error: 'filters must be a JSON object of column to value (max 10).' };
  }
  const limit = clampInt(sp.get('limit'), 1, DATAGOV_MAX_PAGE, DATAGOV_MAX_PAGE);
  const offset = clampInt(sp.get('offset'), 0, 1_000_000, 0);

  const u = new URL(`https://api.data.gov.in/resource/${resourceId}`);
  u.searchParams.set('format', 'json');
  u.searchParams.set('limit', String(limit));
  u.searchParams.set('offset', String(offset));
  for (const [k, v] of Object.entries(filters)) u.searchParams.set(`filters[${k}]`, v);
  const cacheKey = u.toString(); // never contains the API key
  u.searchParams.set('api-key', apiKey);
  return { ok: true, url: u.toString(), cacheKey };
}

export function buildCkanTarget(sp: URLSearchParams): ProxyTarget {
  const action = sp.get('action') || 'package_search';
  if (!CKAN_ACTIONS.includes(action)) {
    return { ok: false, error: `Unsupported CKAN action. Allowed: ${CKAN_ACTIONS.join(', ')}.` };
  }
  const u = new URL(`https://data.opencity.in/api/3/action/${action}`);

  if (action === 'package_search') {
    u.searchParams.set('q', (sp.get('q') || '').slice(0, 200));
    u.searchParams.set('rows', String(clampInt(sp.get('rows'), 1, 20, 10)));
    u.searchParams.set('start', String(clampInt(sp.get('start'), 0, 10_000, 0)));
  } else if (action === 'package_show') {
    const id = (sp.get('id') || '').trim();
    if (!/^[A-Za-z0-9_-]{3,100}$/.test(id)) return { ok: false, error: 'id is malformed.' };
    u.searchParams.set('id', id);
  } else {
    const resourceId = (sp.get('resource_id') || '').trim();
    if (!RESOURCE_ID_RE.test(resourceId)) {
      return { ok: false, error: 'resource_id is missing or malformed.' };
    }
    const filters = parseFilters(sp.get('filters'));
    if (filters === null) {
      return { ok: false, error: 'filters must be a JSON object of column to value (max 10).' };
    }
    u.searchParams.set('resource_id', resourceId);
    u.searchParams.set('limit', String(clampInt(sp.get('limit'), 1, 1000, 500)));
    u.searchParams.set('offset', String(clampInt(sp.get('offset'), 0, 1_000_000, 0)));
    if (Object.keys(filters).length > 0) u.searchParams.set('filters', JSON.stringify(filters));
    const q = (sp.get('q') || '').slice(0, 200);
    if (q) u.searchParams.set('q', q);
  }
  return { ok: true, url: u.toString(), cacheKey: u.toString() };
}

function cleanColumn(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return COLUMN_RE.test(s) ? s : undefined;
}

/**
 * Validates a live-source definition coming from a client. Returns null when it is
 * not usable. Only whitelisted keys survive, so nothing arbitrary reaches the database.
 */
export function sanitizeLiveConfig(raw: unknown): LiveSourceConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.portal !== 'data.gov.in' && r.portal !== 'ckan') return null;
  const resourceId = typeof r.resourceId === 'string' ? r.resourceId.trim() : '';
  if (!RESOURCE_ID_RE.test(resourceId)) return null;
  const filters = sanitizeFilters(r.filters);
  if (filters === null) return null;

  const overrides: Record<string, string> = {};
  if (r.nameOverrides && typeof r.nameOverrides === 'object' && !Array.isArray(r.nameOverrides)) {
    const entries = Object.entries(r.nameOverrides as Record<string, unknown>).slice(0, 500);
    for (const [name, code] of entries) {
      if (name.length > 0 && name.length <= 120 && typeof code === 'string' && BOUNDARY_CODE_RE.test(code)) {
        overrides[name] = code;
      }
    }
  }

  const aggregate = AGGREGATES.includes(String(r.aggregate)) ? (r.aggregate as LiveAggregate) : 'avg';
  const maxRowsNum = Number(r.maxRows);
  const maxRows = Number.isFinite(maxRowsNum) ? Math.min(5000, Math.max(100, Math.round(maxRowsNum))) : 2000;
  const stateHint = typeof r.stateHint === 'string' ? r.stateHint.replace(/[\u0000-\u001F<>]/g, '').trim().slice(0, 60) : '';

  return {
    portal: r.portal,
    resourceId,
    filters,
    areaColumn: cleanColumn(r.areaColumn),
    stateColumn: cleanColumn(r.stateColumn),
    valueColumn: cleanColumn(r.valueColumn),
    dateColumn: cleanColumn(r.dateColumn),
    latColumn: cleanColumn(r.latColumn),
    lonColumn: cleanColumn(r.lonColumn),
    labelColumn: cleanColumn(r.labelColumn),
    aggregate,
    nameOverrides: overrides,
    stateHint: stateHint || undefined,
    maxRows,
  };
}
