import { useState, ChangeEvent } from 'react';
import {
  BoundaryLevel,
  Region,
  CustomLayer,
  fuzzyMatchRegion,
  detectBestBoundaryLevel,
  sanitizeText,
  sanitizeUrl,
  isValidIndiaCoord,
} from '../types';
import {
  SAMPLE_ASSEMBLY_CRIME_TABLE,
  SAMPLE_MULTIDATE_DISTRICT_AQI,
} from '../data/ncrDefaults';
import { supabase } from '../lib/supabase';
import {
  X,
  Upload,
  Globe,
  FileSpreadsheet,
  MapPin,
  Layers,
  CheckCircle2,
  Sparkles,
  AlertCircle,
  Database,
} from 'lucide-react';

declare global {
  interface Window {
    Papa: {
      parse: (
        file: File,
        config: {
          header: boolean;
          skipEmptyLines: boolean;
          complete: (results: { data: Array<Record<string, unknown>> }) => void;
        }
      ) => void;
    };
    XLSX: {
      read: (data: ArrayBuffer, opts: { type: string }) => {
        SheetNames: string[];
        Sheets: Record<string, unknown>;
      };
      utils: {
        sheet_to_json: (sheet: unknown) => Array<Record<string, unknown>>;
      };
    };
  }
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  regions: Region[];
  onAddLayer: (layer: CustomLayer, switchToLevel?: BoundaryLevel) => void;
  onCatalogUpdated: () => void;
}

const CATEGORIES = [
  'Crime & Safety',
  'Public Health',
  'Environment & AQI',
  'Civic Infrastructure',
  'Education',
  'Demographics',
];

export default function DataImporterModal({
  isOpen,
  onClose,
  regions,
  onAddLayer,
  onCatalogUpdated,
}: Props) {
  const [sourceTab, setSourceTab] = useState<'csv' | 'excel' | 'json' | 'api'>('csv');
  const [layerMode, setLayerMode] = useState<'point' | 'choropleth'>('choropleth');
  const [layerName, setLayerName] = useState<string>('NCR Community Civic Dataset');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [statusMsg, setStatusMsg] = useState<{ type: 'info' | 'error'; text: string } | null>(
    null
  );

  // Point mapping
  const [latCol, setLatCol] = useState<string>('');
  const [lonCol, setLonCol] = useState<string>('');
  const [labelCol, setLabelCol] = useState<string>('');
  const [valCol, setValCol] = useState<string>('');
  const [dateCol, setDateCol] = useState<string>('');

  // Choropleth area join mapping
  const [areaCol, setAreaCol] = useState<string>('');
  const [stateHintCol, setStateHintCol] = useState<string>('');
  const [metricCol, setMetricCol] = useState<string>('');
  const [targetLevel, setTargetLevel] = useState<BoundaryLevel>('assembly');
  const [autoDetectedLevel, setAutoDetectedLevel] = useState<BoundaryLevel | null>(null);

  // Catalog Publishing metadata
  const [publishToCatalog, setPublishToCatalog] = useState<boolean>(true);
  const [category, setCategory] = useState<string>('Crime & Safety');
  const [unit, setUnit] = useState<string>('cases/100k');
  const [publisher, setPublisher] = useState<string>('Civic Data Contributor');
  const [sourceUrl, setSourceUrl] = useState<string>('https://data.gov.in');
  const [license, setLicense] = useState<'GODL-India' | 'CC-BY-4.0'>('GODL-India');
  const [saving, setSaving] = useState<boolean>(false);

  // API inputs
  const [apiPortal, setApiPortal] = useState<'datagov' | 'ckan'>('datagov');
  const [resourceId, setResourceId] = useState<string>(
    '3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69'
  );
  const [apiKey, setApiKey] = useState<string>('');
  const [fetchingApi, setFetchingApi] = useState<boolean>(false);

  if (!isOpen) return null;

  function loadRowsIntoWizard(
    name: string,
    parsedRows: Array<Record<string, unknown>>,
    defaultMode?: 'point' | 'choropleth',
    defaultMeta?: { category?: string; unit?: string; sourceUrl?: string }
  ) {
    if (!parsedRows || parsedRows.length === 0) {
      setStatusMsg({ type: 'error', text: 'No valid rows detected in dataset.' });
      return;
    }
    setStatusMsg(null);
    setLayerName(name);
    setRows(parsedRows);
    const cols = Object.keys(parsedRows[0]);
    setColumns(cols);

    if (defaultMeta?.category) setCategory(defaultMeta.category);
    if (defaultMeta?.unit) setUnit(defaultMeta.unit);
    if (defaultMeta?.sourceUrl) setSourceUrl(defaultMeta.sourceUrl);

    const guessLat = cols.find((c) => /^lat|latitude/i.test(c)) || '';
    const guessLon = cols.find((c) => /^lon|lng|longitude/i.test(c)) || '';
    const guessDate = cols.find((c) => /date|year|month|updated|time/i.test(c)) || '';
    const guessState = cols.find((c) => /state|ulb|city_hint/i.test(c)) || '';
    const guessLbl =
      cols.find((c) => /station|name|title|hospital|school|city/i.test(c)) || cols[0] || '';
    const guessArea =
      cols.find((c) => /constituency|ac_name|pc_name|ward|district|area|name/i.test(c)) ||
      cols[0] ||
      '';
    const guessVal =
      cols.find((c) =>
        /crime|pm25|dengue|value|count|rate|mw|population|total|score|budget|cases/i.test(c)
      ) ||
      cols[cols.length - 1] ||
      '';

    setLatCol(guessLat);
    setLonCol(guessLon);
    setLabelCol(guessLbl);
    setValCol(guessVal);
    setDateCol(guessDate);
    setAreaCol(guessArea);
    setStateHintCol(guessState);
    setMetricCol(guessVal);

    const mode = defaultMode || (guessLat && guessLon ? 'point' : 'choropleth');
    setLayerMode(mode);

    if (mode === 'choropleth' && guessArea) {
      const names = parsedRows.map((r) => String(r[guessArea] || ''));
      const hints = guessState
        ? parsedRows.map((r) => String(r[guessState] || ''))
        : undefined;
      const detected = detectBestBoundaryLevel(names, regions, hints);
      setTargetLevel(detected.bestLevel);
      setAutoDetectedLevel(detected.bestLevel);
    }
  }

  function handleFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    const baseName = sanitizeText(file.name.replace(/\.[^.]+$/, ''), 100);

    if (ext === 'csv') {
      window.Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => loadRowsIntoWizard(baseName, res.data),
      });
    } else if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const wb = window.XLSX.read(ev.target?.result as ArrayBuffer, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = window.XLSX.utils.sheet_to_json(sheet);
        loadRowsIntoWizard(baseName, json);
      };
      reader.readAsArrayBuffer(file);
    } else if (ext === 'json' || ext === 'geojson') {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(String(ev.target?.result));
          if (parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
            const extracted = parsed.features.map(
              (f: { properties?: Record<string, unknown> }) => f.properties || {}
            );
            loadRowsIntoWizard(baseName, extracted);
          } else {
            const arr = Array.isArray(parsed)
              ? parsed
              : parsed.records || parsed.data || [];
            loadRowsIntoWizard(baseName, arr);
          }
        } catch {
          setStatusMsg({ type: 'error', text: 'Invalid JSON or GeoJSON file.' });
        }
      };
      reader.readAsText(file);
    }
  }

  async function handleFetchApi() {
    setFetchingApi(true);
    setStatusMsg(null);
    try {
      if (apiPortal === 'datagov') {
        const url = `/api/datagov?resource_id=${encodeURIComponent(
          resourceId.trim()
        )}&api_key=${encodeURIComponent(apiKey.trim() || 'demo')}`;
        const res = await fetch(url);
        const data = await res.json();
        const recs = data.records || [];
        loadRowsIntoWizard(
          `data.gov.in (${resourceId.slice(0, 8)})`,
          recs,
          'point',
          { category: 'Environment & AQI', unit: 'µg/m³', sourceUrl: 'https://data.gov.in' }
        );
      } else {
        const url = `/api/ckan?q=${encodeURIComponent(resourceId.trim() || 'delhi wards')}`;
        const res = await fetch(url);
        const data = await res.json();
        const recs = data.records || [];
        loadRowsIntoWizard(
          'OpenCity CKAN Municipal Dataset',
          recs,
          'choropleth',
          {
            category: 'Public Health',
            unit: 'cases',
            sourceUrl: 'https://data.opencity.in',
          }
        );
      }
    } catch {
      setStatusMsg({ type: 'error', text: 'Failed to fetch from API proxy.' });
    } finally {
      setFetchingApi(false);
    }
  }

  // Evaluate auto-detection and tier match coverage
  const areaNames = areaCol ? rows.map((r) => String(r[areaCol] || '')) : [];
  const stateHints = stateHintCol
    ? rows.map((r) => String(r[stateHintCol] || ''))
    : undefined;
  const detection =
    layerMode === 'choropleth' && areaNames.length > 0
      ? detectBestBoundaryLevel(areaNames, regions, stateHints)
      : null;

  const activeTierRegions = regions.filter((r) => r.level === targetLevel);

  async function handleAddLayerToMap() {
    setSaving(true);
    setStatusMsg(null);
    const palette = ['#f59e0b', '#14b8a6', '#a855f7', '#ec4899', '#38bdf8'];
    const color = palette[Math.floor(Math.random() * palette.length)];
    const safeTitle = sanitizeText(layerName, 140) || 'Community Layer';
    const safeUnit = sanitizeText(unit, 30);
    const safePublisher = sanitizeText(publisher, 100) || 'Community Contributor';
    const safeSourceUrl = sanitizeUrl(sourceUrl);

    try {
      if (layerMode === 'point') {
        if (!latCol || !lonCol) {
          setStatusMsg({
            type: 'error',
            text: 'Please select Latitude and Longitude columns.',
          });
          setSaving(false);
          return;
        }

        const pointsByDate: Record<string, Array<Record<string, unknown>>> = {};
        const validFeatures: Array<Record<string, unknown>> = [];

        for (const r of rows) {
          const lat = parseFloat(String(r[latCol] ?? ''));
          const lon = parseFloat(String(r[lonCol] ?? ''));
          if (!isValidIndiaCoord(lat, lon)) continue;

          const numVal = valCol ? parseFloat(String(r[valCol] ?? '0')) : 0;
          const safeVal = Number.isFinite(numVal) ? numVal : 0;
          const lbl = sanitizeText(r[labelCol] || 'Point', 120);
          const dt = dateCol
            ? sanitizeText(r[dateCol] || '2025-11-15', 20)
            : '2025-11-15';

          const ptObj = {
            lat,
            lon,
            label: lbl,
            value: safeVal,
            date: dt,
          };
          if (!pointsByDate[dt]) pointsByDate[dt] = [];
          pointsByDate[dt].push(ptObj);

          validFeatures.push({
            type: 'Feature',
            properties: {
              _label: lbl,
              _value: safeVal,
              _date: dt,
              unit: safeUnit,
            },
            geometry: {
              type: 'Point',
              coordinates: [lon, lat],
            },
          });
        }

        if (validFeatures.length === 0) {
          setStatusMsg({
            type: 'error',
            text: 'No valid coordinates within India bounds (Lat 6°–38°, Lng 68°–98°).',
          });
          setSaving(false);
          return;
        }

        const dates = Object.keys(pointsByDate).sort();
        const latestDate = dates[dates.length - 1];

        if (publishToCatalog) {
          await supabase.from('community_layers').insert([
            {
              slug: `pt-${Date.now()}`,
              name: safeTitle,
              layer_type: 'point',
              boundary_level: null,
              category: sanitizeText(category, 60),
              metric_label: sanitizeText(valCol || labelCol, 60),
              unit: safeUnit,
              publisher: safePublisher,
              source_url: safeSourceUrl,
              license,
              color,
              feature_count: validFeatures.length,
              available_dates: dates,
              choropleth_by_date: {},
              points_by_date: pointsByDate,
            },
          ]);
          onCatalogUpdated();
        }

        onAddLayer({
          id: `custom-pt-${Date.now()}`,
          name: safeTitle,
          type: 'point',
          category,
          unit: safeUnit,
          publisher: safePublisher,
          sourceUrl: safeSourceUrl,
          license,
          color,
          visible: true,
          opacity: 0.9,
          featureCount: validFeatures.length,
          metricLabel: sanitizeText(valCol || labelCol, 60),
          availableDates: dates,
          activeDate: latestDate,
          pointsByDate,
          rawRows: rows,
          geojson: { type: 'FeatureCollection', features: validFeatures },
        });
        onClose();
      } else {
        // Choropleth Area Join mode
        if (!areaCol || !metricCol) {
          setStatusMsg({
            type: 'error',
            text: 'Please select Area Name and Metric Value columns.',
          });
          setSaving(false);
          return;
        }

        const choroplethByDate: Record<string, Record<string, number>> = {};
        const matchedCodes = new Set<string>();

        rows.forEach((r, idx) => {
          const rawArea = String(r[areaCol] ?? '');
          const rawVal = parseFloat(String(r[metricCol] ?? ''));
          if (!Number.isFinite(rawVal)) return;
          const hint = stateHints?.[idx];
          const matched = fuzzyMatchRegion(rawArea, activeTierRegions, hint);
          if (!matched) return;

          const dt = dateCol
            ? sanitizeText(r[dateCol] || '2025-01-01', 20)
            : '2025-01-01';
          if (!choroplethByDate[dt]) choroplethByDate[dt] = {};
          choroplethByDate[dt][matched.code] = rawVal;
          matchedCodes.add(matched.code);
        });

        if (matchedCodes.size === 0) {
          setStatusMsg({
            type: 'error',
            text: `0 rows matched ${targetLevel.toUpperCase()} boundaries. Try switching the target boundary tier.`,
          });
          setSaving(false);
          return;
        }

        const dates = Object.keys(choroplethByDate).sort();
        const latestDate = dates[dates.length - 1];
        const latestMap = choroplethByDate[latestDate] || {};

        const features = activeTierRegions
          .filter((reg) => reg.geojson && latestMap[reg.code] !== undefined)
          .map((reg) => ({
            type: 'Feature',
            properties: {
              code: reg.code,
              name: reg.name,
              state: reg.state,
              level: reg.level,
              metricName: sanitizeText(metricCol, 60),
              metricValue: latestMap[reg.code],
              unit: safeUnit,
            },
            geometry: reg.geojson,
          }));

        if (publishToCatalog) {
          await supabase.from('community_layers').insert([
            {
              slug: `choro-${targetLevel}-${Date.now()}`,
              name: safeTitle,
              layer_type: 'choropleth',
              boundary_level: targetLevel,
              category: sanitizeText(category, 60),
              metric_label: sanitizeText(metricCol, 60),
              unit: safeUnit,
              publisher: safePublisher,
              source_url: safeSourceUrl,
              license,
              color,
              feature_count: matchedCodes.size,
              available_dates: dates,
              choropleth_by_date: choroplethByDate,
              points_by_date: {},
            },
          ]);
          onCatalogUpdated();
        }

        onAddLayer(
          {
            id: `custom-area-${Date.now()}`,
            name: safeTitle,
            type: 'choropleth',
            boundaryLevel: targetLevel,
            category,
            unit: safeUnit,
            publisher: safePublisher,
            sourceUrl: safeSourceUrl,
            license,
            color,
            visible: true,
            opacity: 0.72,
            featureCount: matchedCodes.size,
            metricLabel: sanitizeText(metricCol, 60),
            availableDates: dates,
            activeDate: latestDate,
            compareDate: dates.length > 1 ? dates[0] : undefined,
            showDelta: false,
            choroplethByDate,
            rawRows: rows,
            geojson: { type: 'FeatureCollection', features },
          },
          targetLevel
        );
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  const tierScore = detection?.scoresByLevel[targetLevel];
  const tierUnmatched = detection?.unmatchedByLevel[targetLevel] || [];

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
              Zero-GeoJSON Community Data Importer &amp; Auto-Boundary Mapper
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Upload CSV, Excel, JSON, or connect <code className="text-emerald-400">data.gov.in</code> /{' '}
              <code className="text-sky-400">OpenCity CKAN</code> &mdash; auto-detects District, PC, Assembly, or Ward boundaries
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-sm">
          {statusMsg && (
            <div
              className={`p-3 rounded-xl border flex items-center gap-2 text-xs ${
                statusMsg.type === 'error'
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              }`}
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{statusMsg.text}</span>
            </div>
          )}

          {/* 4-Source Tabs + 1-Click Sample Loaders */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex bg-slate-950 p-1 rounded-xl border border-slate-800">
              {(
                [
                  ['csv', 'CSV (.csv)'],
                  ['excel', 'Excel (.xlsx/.xls)'],
                  ['json', 'JSON / GeoJSON'],
                  ['api', 'data.gov.in / CKAN API'],
                ] as const
              ).map(([tabKey, label]) => (
                <button
                  key={tabKey}
                  onClick={() => setSourceTab(tabKey)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition ${
                    sourceTab === tabKey
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  loadRowsIntoWizard(
                    'NCR Assembly Crime Rate (2024–2025)',
                    SAMPLE_ASSEMBLY_CRIME_TABLE,
                    'choropleth',
                    {
                      category: 'Crime & Safety',
                      unit: 'cases/100k',
                      sourceUrl: 'https://ncrb.gov.in',
                    }
                  )
                }
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" /> Try Assembly Crime Table
              </button>
              <button
                onClick={() =>
                  loadRowsIntoWizard(
                    'NCR Multi-Date District AQI',
                    SAMPLE_MULTIDATE_DISTRICT_AQI,
                    'choropleth',
                    {
                      category: 'Environment & AQI',
                      unit: 'µg/m³',
                      sourceUrl: 'https://cpcb.nic.in',
                    }
                  )
                }
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/25 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" /> Try Multi-Date District AQI
              </button>
            </div>
          </div>

          {/* Source Input Area */}
          {sourceTab !== 'api' ? (
            <div className="p-4 rounded-xl bg-slate-950 border border-dashed border-slate-700 flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <Upload className="w-4 h-4 text-emerald-400" />
                  Upload {sourceTab.toUpperCase()} dataset — Zero GeoJSON required for Districts, PCs, Assemblies, or Wards
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Automatically matches area names (&ldquo;RK Puram&rdquo; &harr; &ldquo;R.K. Puram&rdquo;, &ldquo;Gurgaon&rdquo; &harr; &ldquo;Gurugram&rdquo;)
                </div>
              </div>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,.json,.geojson"
                onChange={handleFileUpload}
                className="text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-emerald-600 file:text-white hover:file:bg-emerald-500 cursor-pointer"
              />
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setApiPortal('datagov')}
                  className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer ${
                    apiPortal === 'datagov'
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-900 text-slate-400'
                  }`}
                >
                  api.data.gov.in (/api/datagov)
                </button>
                <button
                  onClick={() => setApiPortal('ckan')}
                  className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer ${
                    apiPortal === 'ckan'
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-900 text-slate-400'
                  }`}
                >
                  OpenCity CKAN (/api/ckan)
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    {apiPortal === 'datagov'
                      ? 'data.gov.in Resource ID'
                      : 'OpenCity CKAN Search Query / Resource ID'}
                  </label>
                  <input
                    type="text"
                    value={resourceId}
                    onChange={(e) => setResourceId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  />
                </div>
                {apiPortal === 'datagov' && (
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">
                      API Key (Optional — leave blank for Edge Preset)
                    </label>
                    <input
                      type="text"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Optional data.gov.in API key..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                    />
                  </div>
                )}
              </div>
              <button
                onClick={handleFetchApi}
                disabled={fetchingApi}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5" />
                {fetchingApi ? 'Fetching via Edge Proxy...' : 'Fetch Dataset via CORS Proxy'}
              </button>
            </div>
          )}

          {/* Step 2 Mapping & Auto-Detection */}
          {rows.length > 0 && (
            <div className="space-y-4 border-t border-slate-800 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Layer Title:</span>
                  <input
                    type="text"
                    value={layerName}
                    onChange={(e) => setLayerName(e.target.value)}
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white font-medium w-64"
                  />
                  <span className="text-xs text-emerald-400 font-mono tabular-nums">
                    ({rows.length} rows)
                  </span>
                </div>

                <div className="inline-flex bg-slate-950 p-1 rounded-lg border border-slate-800">
                  <button
                    onClick={() => setLayerMode('choropleth')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium cursor-pointer ${
                      layerMode === 'choropleth'
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" /> Map to Platform Boundaries (Zero-GeoJSON)
                  </button>
                  <button
                    onClick={() => setLayerMode('point')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium cursor-pointer ${
                      layerMode === 'point'
                        ? 'bg-sky-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <MapPin className="w-3.5 h-3.5" /> Point Locations (Lat/Lon)
                  </button>
                </div>
              </div>

              {layerMode === 'choropleth' ? (
                <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="text-[11px] text-slate-400 block mb-1">
                        Area Name Column *
                      </label>
                      <select
                        value={areaCol}
                        onChange={(e) => {
                          const col = e.target.value;
                          setAreaCol(col);
                          const det = detectBestBoundaryLevel(
                            rows.map((r) => String(r[col] || '')),
                            regions,
                            stateHints
                          );
                          setTargetLevel(det.bestLevel);
                          setAutoDetectedLevel(det.bestLevel);
                        }}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white"
                      >
                        {columns.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-400 block mb-1">
                        Metric Value Column *
                      </label>
                      <select
                        value={metricCol}
                        onChange={(e) => setMetricCol(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white"
                      >
                        {columns.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-400 block mb-1">
                        Date Column (Optional Time-Series)
                      </label>
                      <select
                        value={dateCol}
                        onChange={(e) => setDateCol(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white"
                      >
                        <option value="">Single Snapshot</option>
                        {columns.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-400 block mb-1">
                        State / City Scope (Optional)
                      </label>
                      <select
                        value={stateHintCol}
                        onChange={(e) => setStateHintCol(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white"
                      >
                        <option value="">All NCR</option>
                        {columns.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* 4-Tier Boundary Auto-Detection Bar */}
                  <div className="pt-2 border-t border-slate-900 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-400">Target Boundary Tier:</span>
                      {(['district', 'constituency', 'assembly', 'ward'] as BoundaryLevel[]).map(
                        (lvl) => {
                          const sc = detection?.scoresByLevel[lvl];
                          return (
                            <button
                              key={lvl}
                              onClick={() => setTargetLevel(lvl)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer border transition ${
                                targetLevel === lvl
                                  ? 'bg-emerald-600/25 border-emerald-500 text-emerald-300'
                                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                              }`}
                            >
                              {lvl.toUpperCase()} ({sc?.matched || 0}/{sc?.total || 0})
                              {autoDetectedLevel === lvl && (
                                <span className="ml-1 text-[9px] text-amber-300">★ Auto</span>
                              )}
                            </button>
                          );
                        }
                      )}
                    </div>

                    <span className="flex items-center gap-1 text-xs text-emerald-300 font-medium tabular-nums">
                      <CheckCircle2 className="w-4 h-4" />
                      Matched {tierScore?.matched || 0} of {tierScore?.total || 0} rows
                    </span>
                  </div>

                  {tierUnmatched.length > 0 && (
                    <div className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5">
                      Unmatched names on {targetLevel.toUpperCase()} tier:{' '}
                      <span className="font-mono">{tierUnmatched.slice(0, 6).join(', ')}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Latitude *</label>
                    <select
                      value={latCol}
                      onChange={(e) => setLatCol(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                    >
                      <option value="">Select...</option>
                      {columns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Longitude *</label>
                    <select
                      value={lonCol}
                      onChange={(e) => setLonCol(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                    >
                      <option value="">Select...</option>
                      {columns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Title / Station</label>
                    <select
                      value={labelCol}
                      onChange={(e) => setLabelCol(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                    >
                      {columns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Metric Value</label>
                    <select
                      value={valCol}
                      onChange={(e) => setValCol(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                    >
                      {columns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Date (Optional)</label>
                    <select
                      value={dateCol}
                      onChange={(e) => setDateCol(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                    >
                      <option value="">None</option>
                      {columns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Community Catalog Publishing Metadata */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <label className="flex items-center gap-2 text-xs font-semibold text-emerald-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={publishToCatalog}
                    onChange={(e) => setPublishToCatalog(e.target.checked)}
                    className="accent-emerald-500 rounded"
                  />
                  <Database className="w-3.5 h-3.5" />
                  Publish to Shared Community Data Catalog (Supabase PostgreSQL, sanitized &amp; standardized)
                </label>

                {publishToCatalog && (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 pt-1">
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Category</label>
                      <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                      >
                        {CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Unit</label>
                      <input
                        type="text"
                        value={unit}
                        onChange={(e) => setUnit(e.target.value)}
                        placeholder="e.g. cases/100k, %"
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">
                        Publisher / Org
                      </label>
                      <input
                        type="text"
                        value={publisher}
                        onChange={(e) => setPublisher(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">
                        Verification Source URL
                      </label>
                      <input
                        type="url"
                        value={sourceUrl}
                        onChange={(e) => setSourceUrl(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Open License</label>
                      <select
                        value={license}
                        onChange={(e) =>
                          setLicense(e.target.value as 'GODL-India' | 'CC-BY-4.0')
                        }
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                      >
                        <option value="GODL-India">GODL-India</option>
                        <option value="CC-BY-4.0">CC-BY-4.0</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* First 5 rows preview table */}
              <div>
                <div className="text-xs font-semibold text-slate-400 mb-1.5">
                  Sanitized Data Preview (First 5 Rows)
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-800">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-950 border-b border-slate-800 text-slate-400">
                        {columns.slice(0, 6).map((c) => (
                          <th key={c} className="py-2 px-3 font-mono">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 bg-slate-900/50">
                      {rows.slice(0, 5).map((r, i) => (
                        <tr key={i}>
                          {columns.slice(0, 6).map((c) => (
                            <td key={c} className="py-1.5 px-3 text-slate-300 tabular-nums">
                              {sanitizeText(r[c], 60)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleAddLayerToMap}
            disabled={rows.length === 0 || saving}
            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-semibold text-white cursor-pointer"
          >
            {saving ? 'Sanitizing & Mapping...' : 'Map & Publish Dataset'}
          </button>
        </div>
      </div>
    </div>
  );
}
