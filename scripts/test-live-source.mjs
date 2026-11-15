import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { getLocalDb, getBoundariesFromLocalDb } from './local-db.mjs';

// Bundle the TS modules so they can run under plain node
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-test-'));
async function bundle(entry, name) {
  const outfile = path.join(outDir, `${name}.mjs`);
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' });
  return import(pathToFileURL(outfile).href);
}
const core = await bundle('src/lib/proxyCore.ts', 'proxyCore');
const live = await bundle('src/lib/liveSource.ts', 'liveSource');

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`❌ FAIL: ${name}\n   ${err.message}`);
  }
}

console.log('==========================================================');
console.log('🔍 Live-linked layers: proxy + mapping tests');
console.log('==========================================================\n');

// ── Proxy core ───────────────────────────────────────────────────────────────
await test('data.gov.in target forwards filters, clamps limit, keeps the key out of the cache key', () => {
  const sp = new URLSearchParams({
    resource_id: '3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69',
    limit: '5000',
    offset: '200',
    filters: JSON.stringify({ State: 'Delhi' }),
  });
  const t = core.buildDatagovTarget(sp, 'SECRETKEY');
  assert.equal(t.ok, true);
  const u = new URL(t.url);
  assert.equal(u.searchParams.get('limit'), '100');
  assert.equal(u.searchParams.get('offset'), '200');
  assert.equal(u.searchParams.get('filters[State]'), 'Delhi');
  assert.equal(u.searchParams.get('api-key'), 'SECRETKEY');
  assert.ok(!t.cacheKey.includes('SECRETKEY'));
});

await test('proxy rejects malformed resource ids and filters', () => {
  const bad = (params) => core.buildDatagovTarget(new URLSearchParams(params), 'k').ok;
  assert.equal(bad({ resource_id: '../etc/passwd' }), false);
  assert.equal(bad({ resource_id: 'abc' }), false);
  assert.equal(bad({ resource_id: '3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69', filters: '[1,2]' }), false);
  assert.equal(bad({ resource_id: '3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69', filters: '{not json' }), false);
  assert.equal(core.buildCkanTarget(new URLSearchParams({ action: 'organization_list' })).ok, false);
});

await test('CKAN datastore target passes filters as JSON and stays on the OpenCity host', () => {
  const t = core.buildCkanTarget(
    new URLSearchParams({
      action: 'datastore_search',
      resource_id: '3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69',
      filters: JSON.stringify({ ward: '12' }),
    })
  );
  assert.equal(t.ok, true);
  const u = new URL(t.url);
  assert.equal(u.host, 'data.opencity.in');
  assert.equal(u.searchParams.get('filters'), JSON.stringify({ ward: '12' }));
});

await test('TTL cache serves repeats from memory and never caches failures', async () => {
  core.clearProxyCache();
  let calls = 0;
  const ok = async () => ({ status: 200, body: `{"n":${++calls}}` });
  const a = await core.fetchCached('k1', ok);
  const b = await core.fetchCached('k1', ok);
  assert.equal(calls, 1);
  assert.equal(a.cached, false);
  assert.equal(b.cached, true);
  assert.equal(b.body, a.body);
  let fails = 0;
  const bad = async () => ({ status: 429, body: `{"e":${++fails}}` });
  await core.fetchCached('k2', bad);
  await core.fetchCached('k2', bad);
  assert.equal(fails, 2);
});

await test('sanitizeLiveConfig whitelists keys, clamps maxRows and rejects bad portals', () => {
  assert.equal(core.sanitizeLiveConfig({ portal: 'evil.com', resourceId: '3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69' }), null);
  assert.equal(core.sanitizeLiveConfig({ portal: 'ckan', resourceId: '../x' }), null);
  const cfg = core.sanitizeLiveConfig({
    portal: 'data.gov.in',
    resourceId: '3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69',
    areaColumn: 'District',
    valueColumn: 'Value',
    maxRows: 999999,
    aggregate: 'bogus',
    nameOverrides: { Atlantis: 'dl-nct', Bad: '<script>' },
    injected: 'DROP TABLE',
  });
  assert.equal(cfg.maxRows, 5000);
  assert.equal(cfg.aggregate, 'avg');
  assert.deepEqual(cfg.nameOverrides, { Atlantis: 'dl-nct' });
  assert.equal('injected' in cfg, false);
});

// ── Mapping to the standard boundaries (real data from the DB) ───────────────
const db = getLocalDb();
const toRegions = (level) => getBoundariesFromLocalDb(db, level).map((f) => ({ ...f.properties }));
const districts = toRegions('district');
const wards = toRegions('ward');

await test('district names resolve to standard codes, duplicates aggregate, unmatched are reported', () => {
  const [d1, d2] = districts;
  const rows = [
    { District: d1.name, Value: 10, Year: 2024 },
    { District: d1.name, Value: 30, Year: 2024 },
    { District: d2.name, Value: 5, Year: 2024 },
    { District: 'Atlantis', Value: 99, Year: 2024 },
    { District: d2.name, Value: 'n/a', Year: 2024 },
  ];
  const map = { areaColumn: 'District', valueColumn: 'Value', dateColumn: 'Year', aggregate: 'avg' };
  const res = live.buildChoropleth(rows, map, districts);
  assert.equal(res.choroplethByDate['2024'][d1.code], 20);
  assert.equal(res.choroplethByDate['2024'][d2.code], 5);
  assert.deepEqual(res.unmatched, ['Atlantis']);
  assert.equal(res.matchedRegions, 2);
  assert.equal(live.buildChoropleth(rows, { ...map, aggregate: 'sum' }, districts).choroplethByDate['2024'][d1.code], 40);
  assert.equal(live.buildChoropleth(rows, { ...map, aggregate: 'max' }, districts).choroplethByDate['2024'][d1.code], 30);
});

await test('a manual name override maps an unmatched source name to a standard boundary', () => {
  const target = districts[0];
  const rows = [{ District: 'Atlantis', Value: 7 }];
  const map = { areaColumn: 'District', valueColumn: 'Value', nameOverrides: { Atlantis: target.code } };
  const res = live.buildChoropleth(rows, map, districts);
  assert.equal(res.choroplethByDate.Latest[target.code], 7);
  assert.equal(res.unmatched.length, 0);
});

await test('ward rows map to municipal ward polygons', () => {
  const sample = wards.slice(0, 5);
  const rows = sample.map((w, i) => ({ Ward: w.name, Cases: i + 1 }));
  const res = live.buildChoropleth(rows, { areaColumn: 'Ward', valueColumn: 'Cases' }, wards);
  assert.ok(res.matchedRegions >= 4, `only ${res.matchedRegions}/5 wards matched`);
});

await test('GPS rows become points and out-of-India coordinates are dropped', () => {
  const rows = [
    { Lat: 28.61, Lon: 77.2, Name: 'A', V: 3 },
    { Lat: 0, Lon: 0, Name: 'B', V: 4 },
  ];
  const res = live.buildPoints(rows, { latColumn: 'Lat', lonColumn: 'Lon', labelColumn: 'Name', valueColumn: 'V' }, {
    slug: 's',
    unit: 'u',
    sourceUrl: 'https://data.gov.in',
    publisher: 'p',
  });
  assert.equal(res.features.length, 1);
  assert.equal(res.features[0].properties.name, 'A');
});

// ── Paging through the proxy (mocked portal) ─────────────────────────────────
await test('fetchLiveRows pages data.gov.in 100 at a time and forwards filters', async () => {
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    const u = new URL(String(url), 'http://x');
    const offset = Number(u.searchParams.get('offset'));
    const n = Math.min(100, 250 - offset);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        total: '250',
        field: [{ id: 'District' }, { id: 'Value' }],
        records: Array.from({ length: n }, (_, i) => ({ District: 'X', Value: String(offset + i) })),
      }),
    };
  };
  const res = await live.fetchLiveRows(
    { portal: 'data.gov.in', resourceId: '3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69', filters: { State: 'Delhi' } },
    { maxRows: 1000 }
  );
  assert.equal(res.rows.length, 250);
  assert.equal(res.total, 250);
  assert.deepEqual(res.fields, ['District', 'Value']);
  assert.equal(seen.length, 3);
  assert.ok(seen.every((u) => u.includes('filters=')));
  assert.equal(res.rows[5].Value, 5); // numeric strings become numbers
});

await test('fetchLiveRows surfaces a 429 as a readable error', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
  await assert.rejects(
    live.fetchLiveRows({ portal: 'data.gov.in', resourceId: '3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69' }),
    /rate limiting/
  );
});

await test('fetchLiveRows reads CKAN datastore pages', async () => {
  globalThis.fetch = async (url) => {
    assert.ok(String(url).startsWith('/api/ckan?'));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        result: { total: 2, fields: [{ id: '_id' }, { id: 'ward' }], records: [{ _id: 1, ward: '12' }, { _id: 2, ward: '13' }] },
      }),
    };
  };
  const res = await live.fetchLiveRows({ portal: 'ckan', resourceId: '3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69' });
  assert.equal(res.rows.length, 2);
  assert.equal('_id' in res.rows[0], false);
});

fs.rmSync(outDir, { recursive: true, force: true });
if (failed > 0) {
  console.error(`\n❌ ${failed} test(s) failed.`);
  process.exit(1);
}
console.log('\n🎉 ALL LIVE-LINK TESTS PASSED!');
