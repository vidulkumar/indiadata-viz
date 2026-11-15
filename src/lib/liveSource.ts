import {
  CustomLayer,
  LiveAggregate,
  LiveMapping,
  LiveSourceConfig,
  Region,
  fuzzyMatchRegion,
  isValidIndiaCoord,
} from '../types';

type Row = Record<string, unknown>;

export interface FetchedRows {
  rows: Row[];
  total: number;
  /** Real column names reported by the source (data.gov.in filters are case-sensitive). */
  fields: string[];
}

const DATAGOV_PAGE = 100;
const CKAN_PAGE = 500;
const HIDDEN_FIELDS = new Set(['_id', '_full_text']);

/** Source cells arrive as strings; turn numeric-looking ones into numbers. */
export function toCell(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (t === '') return '';
  const n = Number(t.replace(/,/g, ''));
  return /^-?[\d,]*\.?\d+(e[+-]?\d+)?$/i.test(t) && Number.isFinite(n) ? n : t;
}

export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const n = Number(v.replace(/,/g, '').trim());
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
}

export function parseFilterText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(',')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

export function formatFilters(filters: Record<string, string> | undefined): string {
  return Object.entries(filters || {})
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}

function pageUrl(
  cfg: Pick<LiveSourceConfig, 'portal' | 'resourceId' | 'filters'>,
  offset: number,
  limit: number,
  apiKey?: string
): string {
  const p = new URLSearchParams({
    resource_id: cfg.resourceId,
    limit: String(limit),
    offset: String(offset),
  });
  if (cfg.filters && Object.keys(cfg.filters).length > 0) {
    p.set('filters', JSON.stringify(cfg.filters));
  }
  if (cfg.portal === 'ckan') {
    p.set('action', 'datastore_search');
    return `/api/ckan?${p.toString()}`;
  }
  if (apiKey) p.set('api_key', apiKey);
  return `/api/datagov?${p.toString()}`;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    const msg = data?.error?.message || data?.error || data?.message;
    if (msg) return String(msg);
  } catch {
    /* body was not JSON */
  }
  if (res.status === 429) return 'The source portal is rate limiting this API key (HTTP 429). Try again shortly.';
  return `${fallback} (HTTP ${res.status})`;
}

/**
 * Pulls rows from the source portal through our proxy, page by page.
 * Nothing is persisted: callers hold the result in memory only.
 */
export async function fetchLiveRows(
  cfg: Pick<LiveSourceConfig, 'portal' | 'resourceId' | 'filters'>,
  opts: { maxRows?: number; apiKey?: string; signal?: AbortSignal } = {}
): Promise<FetchedRows> {
  const maxRows = opts.maxRows ?? 2000;
  const pageSize = cfg.portal === 'ckan' ? CKAN_PAGE : DATAGOV_PAGE;
  const rows: Row[] = [];
  let total = 0;
  let fields: string[] = [];

  for (let offset = 0; rows.length < maxRows; offset += pageSize) {
    const limit = Math.min(pageSize, maxRows - rows.length);
    const res = await fetch(pageUrl(cfg, offset, limit, opts.apiKey), { signal: opts.signal });
    if (!res.ok) throw new Error(await readError(res, 'Source portal request failed'));
    const data = await res.json();

    let records: Row[];
    if (cfg.portal === 'ckan') {
      if (data?.success === false) throw new Error(data?.error?.message || 'CKAN request failed');
      records = Array.isArray(data?.result?.records) ? data.result.records : [];
      total = Number(data?.result?.total ?? total) || total;
      if (offset === 0 && Array.isArray(data?.result?.fields)) {
        fields = data.result.fields.map((f: { id: string }) => f.id);
      }
    } else {
      if (data?.status === 'error' || data?.error) {
        throw new Error(String(data.message || data.error));
      }
      records = Array.isArray(data?.records) ? data.records : [];
      total = Number(data?.total ?? total) || total;
      if (offset === 0 && Array.isArray(data?.field)) {
        fields = data.field.map((f: { id: string }) => f.id);
      }
    }

    for (const rec of records) {
      const clean: Row = {};
      for (const [k, v] of Object.entries(rec)) {
        if (!HIDDEN_FIELDS.has(k)) clean[k] = toCell(v);
      }
      rows.push(clean);
    }
    if (records.length < limit || (total > 0 && offset + records.length >= total)) break;
  }

  if (rows.length === 0 && fields.length === 0) {
    throw new Error('The resource returned no rows. Check the Resource ID and filters.');
  }
  if (fields.length === 0 && rows[0]) fields = Object.keys(rows[0]);
  return { rows, total: total || rows.length, fields };
}

/** Resolves a raw source name to a standard boundary: manual override first, then fuzzy match. */
export function matchRegion(
  rawArea: string,
  stateHint: string | undefined,
  tier: Region[],
  overrides?: Record<string, string>
): Region | null {
  const name = rawArea.trim();
  if (!name) return null;
  const code = overrides?.[name];
  if (code) return tier.find((r) => r.code === code) ?? null;
  return fuzzyMatchRegion(name, tier, stateHint);
}

function reduceValues(values: number[], how: LiveAggregate): number {
  switch (how) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'max':
      return Math.max(...values);
    case 'min':
      return Math.min(...values);
    case 'last':
      return values[values.length - 1];
    default:
      return values.reduce((a, b) => a + b, 0) / values.length;
  }
}

export interface ChoroplethResult {
  choroplethByDate: Record<string, Record<string, number>>;
  availableDates: string[];
  matchedRows: number;
  totalRows: number;
  matchedRegions: number;
  unmatched: string[];
}

/** Joins source rows to boundary codes. The result is derived in memory, never stored. */
export function buildChoropleth(rows: Row[], map: LiveMapping, tier: Region[]): ChoroplethResult {
  const buckets: Record<string, Record<string, number[]>> = {};
  const unmatchedSet = new Set<string>();
  let matchedRows = 0;

  for (const r of rows) {
    const value = toNumber(r[map.valueColumn || '']);
    if (value === null) continue;
    const rawArea = String(r[map.areaColumn || ''] ?? '');
    const hint = map.stateColumn ? String(r[map.stateColumn] ?? '') : map.stateHint;
    const region = matchRegion(rawArea, hint, tier, map.nameOverrides);
    if (!region) {
      if (rawArea.trim() && unmatchedSet.size < 200) unmatchedSet.add(rawArea.trim());
      continue;
    }
    matchedRows++;
    const date = map.dateColumn ? String(r[map.dateColumn] ?? 'Latest') || 'Latest' : 'Latest';
    ((buckets[date] ||= {})[region.code] ||= []).push(value);
  }

  const how = map.aggregate || 'avg';
  const choroplethByDate: Record<string, Record<string, number>> = {};
  const regionCodes = new Set<string>();
  for (const [date, byCode] of Object.entries(buckets)) {
    choroplethByDate[date] = {};
    for (const [code, vals] of Object.entries(byCode)) {
      choroplethByDate[date][code] = Number(reduceValues(vals, how).toFixed(4));
      regionCodes.add(code);
    }
  }
  return {
    choroplethByDate,
    availableDates: Object.keys(choroplethByDate).sort(),
    matchedRows,
    totalRows: rows.length,
    matchedRegions: regionCodes.size,
    unmatched: [...unmatchedSet],
  };
}

export interface PointsResult {
  pointsByDate: Record<string, Array<Record<string, unknown>>>;
  features: Array<Record<string, unknown>>;
  availableDates: string[];
}

export function buildPoints(
  rows: Row[],
  map: LiveMapping,
  meta: { slug: string; unit: string; sourceUrl: string; publisher: string }
): PointsResult {
  const pointsByDate: PointsResult['pointsByDate'] = {};
  const features: PointsResult['features'] = [];
  rows.forEach((r, idx) => {
    const lat = Number(r[map.latColumn || '']);
    const lon = Number(r[map.lonColumn || '']);
    if (!isValidIndiaCoord(lat, lon)) return;
    const value = toNumber(r[map.valueColumn || '']) ?? 0;
    const date = map.dateColumn ? String(r[map.dateColumn] ?? 'Latest') || 'Latest' : 'Latest';
    const label = map.labelColumn ? String(r[map.labelColumn] ?? `Point ${idx + 1}`) : `Point ${idx + 1}`;
    (pointsByDate[date] ||= []).push({ lat, lon, label, value });
    features.push({
      type: 'Feature',
      properties: {
        id: `${meta.slug}-pt-${idx}`,
        name: label,
        value,
        unit: meta.unit,
        date,
        sourceUrl: meta.sourceUrl,
        publisher: meta.publisher,
      },
      geometry: { type: 'Point', coordinates: [lon, lat] },
    });
  });
  return { pointsByDate, features, availableDates: Object.keys(pointsByDate).sort() };
}

/** Fills a live layer with freshly fetched rows (in memory only). */
export function applyLiveData(
  layer: CustomLayer,
  rows: Row[],
  regionsByLevel: Region[]
): CustomLayer {
  const cfg = layer.liveConfig;
  if (!cfg) return layer;
  const fetchedAt = Date.now();

  if (layer.type === 'point') {
    const res = buildPoints(rows, cfg, {
      slug: layer.id,
      unit: layer.unit || '',
      sourceUrl: layer.sourceUrl || '',
      publisher: layer.publisher || '',
    });
    return {
      ...layer,
      liveLoaded: true,
      featureCount: res.features.length,
      availableDates: res.availableDates,
      activeDate: res.availableDates[res.availableDates.length - 1] || 'Latest',
      pointsByDate: res.pointsByDate,
      geojson: { type: 'FeatureCollection', features: res.features },
      liveInfo: { state: 'ready', fetchedAt, matched: res.features.length, total: rows.length },
    };
  }

  const res = buildChoropleth(rows, cfg, regionsByLevel);
  return {
    ...layer,
    liveLoaded: true,
    featureCount: res.matchedRegions,
    availableDates: res.availableDates,
    activeDate: res.availableDates[res.availableDates.length - 1] || 'Latest',
    choroplethByDate: res.choroplethByDate,
    liveInfo: {
      state: 'ready',
      fetchedAt,
      matched: res.matchedRows,
      total: res.totalRows,
      unmatched: res.unmatched,
    },
  };
}
