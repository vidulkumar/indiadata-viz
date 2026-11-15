import { useState, ChangeEvent } from 'react';
import { Region, CustomLayer, fuzzyMatchRegion } from '../types';
import {
  X,
  Upload,
  Globe,
  FileSpreadsheet,
  MapPin,
  Layers,
  CheckCircle2,
  Sparkles,
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
  onAddLayer: (layer: CustomLayer) => void;
}

const SAMPLE_AREA_DATASET = [
  { Area_Name: 'Gurgaon', EV_Chargers_Count: 148, Solar_Rooftop_MW: 62.4 },
  { Area_Name: 'NCT of Delhi', EV_Chargers_Count: 612, Solar_Rooftop_MW: 245.0 },
  { Area_Name: 'G.B. Nagar', EV_Chargers_Count: 194, Solar_Rooftop_MW: 88.5 },
  { Area_Name: 'Faridabad', EV_Chargers_Count: 86, Solar_Rooftop_MW: 41.2 },
  { Area_Name: 'Ghaziabad', EV_Chargers_Count: 112, Solar_Rooftop_MW: 53.8 },
  { Area_Name: 'Sonepat', EV_Chargers_Count: 44, Solar_Rooftop_MW: 22.1 },
  { Area_Name: 'Jhajjar', EV_Chargers_Count: 29, Solar_Rooftop_MW: 17.5 },
];

export default function DataImporterModal({
  isOpen,
  onClose,
  regions,
  onAddLayer,
}: Props) {
  const [sourceTab, setSourceTab] = useState<'file' | 'api'>('file');
  const [layerMode, setLayerMode] = useState<'point' | 'choropleth'>('point');
  const [layerName, setLayerName] = useState<string>('Custom Civic Layer');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [columns, setColumns] = useState<string[]>([]);

  // Point mapping
  const [latCol, setLatCol] = useState<string>('');
  const [lonCol, setLonCol] = useState<string>('');
  const [labelCol, setLabelCol] = useState<string>('');
  const [valCol, setValCol] = useState<string>('');

  // Choropleth area join mapping
  const [areaCol, setAreaCol] = useState<string>('');
  const [metricCol, setMetricCol] = useState<string>('');

  // API inputs
  const [resourceId, setResourceId] = useState<string>(
    '3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69'
  );
  const [apiKey, setApiKey] = useState<string>('');
  const [fetchingApi, setFetchingApi] = useState<boolean>(false);

  if (!isOpen) return null;

  function loadRowsIntoWizard(
    name: string,
    parsedRows: Array<Record<string, unknown>>,
    defaultMode?: 'point' | 'choropleth'
  ) {
    if (!parsedRows || parsedRows.length === 0) {
      alert('No rows detected in dataset.');
      return;
    }
    setLayerName(name);
    setRows(parsedRows);
    const cols = Object.keys(parsedRows[0]);
    setColumns(cols);

    const guessLat = cols.find((c) => /lat/i.test(c)) || '';
    const guessLon = cols.find((c) => /lon|lng/i.test(c)) || '';
    const guessLbl =
      cols.find((c) => /station|name|title|hospital|school|city/i.test(c)) || cols[0] || '';
    const guessArea =
      cols.find((c) => /area|district|ward|city|state|name/i.test(c)) || cols[0] || '';
    const guessVal =
      cols.find((c) => /pm25|value|count|rate|mw|population|total|score/i.test(c)) ||
      cols[cols.length - 1] ||
      '';

    setLatCol(guessLat);
    setLonCol(guessLon);
    setLabelCol(guessLbl);
    setValCol(guessVal);
    setAreaCol(guessArea);
    setMetricCol(guessVal);

    if (defaultMode) {
      setLayerMode(defaultMode);
    } else if (guessLat && guessLon) {
      setLayerMode('point');
    } else {
      setLayerMode('choropleth');
    }
  }

  function handleFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    const baseName = file.name.replace(/\.[^.]+$/, '');

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
          alert('Invalid JSON file.');
        }
      };
      reader.readAsText(file);
    }
  }

  async function handleFetchDataGovApi() {
    setFetchingApi(true);
    try {
      const url = `/api/datagov?resource_id=${encodeURIComponent(
        resourceId.trim()
      )}&api_key=${encodeURIComponent(apiKey.trim() || 'demo')}`;
      const res = await fetch(url);
      const data = await res.json();
      const recs = data.records || [];
      loadRowsIntoWizard(`data.gov.in (${resourceId.slice(0, 8)})`, recs, 'point');
    } catch {
      alert('Failed to fetch from /api/datagov proxy.');
    } finally {
      setFetchingApi(false);
    }
  }

  // Compute fuzzy join preview when in choropleth mode
  const joinPreview = (() => {
    if (layerMode !== 'choropleth' || !areaCol || !metricCol || rows.length === 0) {
      return { matched: 0, total: rows.length, matches: [] as Array<{ rowArea: string; matchedRegion: Region; value: number }> };
    }
    const matches: Array<{ rowArea: string; matchedRegion: Region; value: number }> = [];
    for (const r of rows) {
      const rawName = String(r[areaCol] || '');
      const numVal = parseFloat(String(r[metricCol] || '0'));
      const matched = fuzzyMatchRegion(rawName, regions);
      if (matched && !isNaN(numVal)) {
        matches.push({ rowArea: rawName, matchedRegion: matched, value: numVal });
      }
    }
    return { matched: matches.length, total: rows.length, matches };
  })();

  function handleAddLayerToMap() {
    const palette = ['#a855f7', '#ec4899', '#38bdf8', '#facc15', '#fb923c'];
    const color = palette[Math.floor(Math.random() * palette.length)];

    if (layerMode === 'point') {
      if (!latCol || !lonCol) {
        alert('Please select Latitude and Longitude columns.');
        return;
      }
      const features = rows
        .filter(
          (r) =>
            !isNaN(parseFloat(String(r[latCol]))) &&
            !isNaN(parseFloat(String(r[lonCol])))
        )
        .map((r) => ({
          type: 'Feature',
          properties: {
            ...r,
            _label: String(r[labelCol] || 'Point'),
            _value: valCol ? Number(r[valCol]) : null,
          },
          geometry: {
            type: 'Point',
            coordinates: [
              parseFloat(String(r[lonCol])),
              parseFloat(String(r[latCol])),
            ],
          },
        }));

      if (features.length === 0) {
        alert('No valid Lat/Lon coordinates found in selected columns.');
        return;
      }

      onAddLayer({
        id: `custom-pt-${Date.now()}`,
        name: layerName,
        type: 'point',
        color,
        visible: true,
        featureCount: features.length,
        metricLabel: valCol || labelCol,
        rawRows: rows,
        geojson: { type: 'FeatureCollection', features },
      });
      onClose();
    } else {
      if (joinPreview.matches.length === 0) {
        alert('No rows matched NCR regions. Check the Area Name column.');
        return;
      }
      const features = joinPreview.matches
        .filter((m) => m.matchedRegion.geojson)
        .map((m) => ({
          type: 'Feature',
          properties: {
            code: m.matchedRegion.code,
            name: m.matchedRegion.name,
            state: m.matchedRegion.state,
            sourceAreaName: m.rowArea,
            metricName: metricCol,
            metricValue: m.value,
          },
          geometry: m.matchedRegion.geojson,
        }));

      onAddLayer({
        id: `custom-area-${Date.now()}`,
        name: `${layerName} (${metricCol})`,
        type: 'choropleth',
        color,
        visible: true,
        featureCount: features.length,
        metricLabel: metricCol,
        rawRows: rows,
        geojson: { type: 'FeatureCollection', features },
      });
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
              Universal Data Importer &amp; Smart Column Mapper
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Ingest <code className="text-emerald-400">data.gov.in</code> APIs, Excel (
              <code>.xlsx</code>), <code>.csv</code>, or <code>.json</code> &mdash; map as
              Points or Fuzzy-Join to NCR Polygons
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
          {/* Source Switcher */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button
                onClick={() => setSourceTab('file')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer ${
                  sourceTab === 'file'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Upload className="w-3.5 h-3.5" /> Upload File (.xlsx / .csv / .json)
              </button>
              <button
                onClick={() => setSourceTab('api')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer ${
                  sourceTab === 'api'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Globe className="w-3.5 h-3.5" /> Fetch data.gov.in API Proxy
              </button>
            </div>

            <button
              onClick={() =>
                loadRowsIntoWizard(
                  'NCR EV & Solar Sample (Fuzzy Join)',
                  SAMPLE_AREA_DATASET,
                  'choropleth'
                )
              }
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/25 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" /> Load Sample Messy NCR Excel Table
            </button>
          </div>

          {sourceTab === 'file' ? (
            <div className="p-4 rounded-xl bg-slate-950 border border-dashed border-slate-700 flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold text-slate-200">
                  Select a spreadsheet or JSON dataset from your computer
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Supports .xlsx, .xls, .csv, .json, and .geojson
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    data.gov.in Resource ID
                  </label>
                  <input
                    type="text"
                    value={resourceId}
                    onChange={(e) => setResourceId(e.target.value)}
                    placeholder="3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    API Key (Leave blank for Cloudflare Edge Preset)
                  </label>
                  <input
                    type="text"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Optional data.gov.in API key..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  />
                </div>
              </div>
              <button
                onClick={handleFetchDataGovApi}
                disabled={fetchingApi}
                className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium cursor-pointer"
              >
                {fetchingApi
                  ? 'Fetching via Cloudflare Worker /api/datagov...'
                  : 'Fetch Dataset via /api/datagov Proxy'}
              </button>
            </div>
          )}

          {/* Mapping Wizard once rows are loaded */}
          {rows.length > 0 && (
            <div className="space-y-4 border-t border-slate-800 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Layer Title:</span>
                  <input
                    type="text"
                    value={layerName}
                    onChange={(e) => setLayerName(e.target.value)}
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white font-medium"
                  />
                  <span className="text-xs text-emerald-400 font-mono">
                    ({rows.length} rows detected)
                  </span>
                </div>

                {/* Layer Mode Switcher */}
                <div className="inline-flex bg-slate-950 p-1 rounded-lg border border-slate-800">
                  <button
                    onClick={() => setLayerMode('point')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium cursor-pointer ${
                      layerMode === 'point'
                        ? 'bg-sky-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <MapPin className="w-3.5 h-3.5" /> Point Layer (Lat/Lon)
                  </button>
                  <button
                    onClick={() => setLayerMode('choropleth')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium cursor-pointer ${
                      layerMode === 'choropleth'
                        ? 'bg-purple-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" /> Area Join (Fuzzy Name Match)
                  </button>
                </div>
              </div>

              {layerMode === 'point' ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">
                      Latitude Column *
                    </label>
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
                    <label className="text-[11px] text-slate-400 block mb-1">
                      Longitude Column *
                    </label>
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
                    <label className="text-[11px] text-slate-400 block mb-1">
                      Title / Station Column
                    </label>
                    <select
                      value={labelCol}
                      onChange={(e) => setLabelCol(e.target.value)}
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
                    <label className="text-[11px] text-slate-400 block mb-1">
                      Numeric Metric Column
                    </label>
                    <select
                      value={valCol}
                      onChange={(e) => setValCol(e.target.value)}
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
                </div>
              ) : (
                <div className="space-y-3 bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-slate-400 block mb-1">
                        Area Name Column (District / Ward / Constituency) *
                      </label>
                      <select
                        value={areaCol}
                        onChange={(e) => setAreaCol(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white"
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
                      <label className="text-[11px] text-slate-400 block mb-1">
                        Numeric Metric Value Column *
                      </label>
                      <select
                        value={metricCol}
                        onChange={(e) => setMetricCol(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white"
                      >
                        <option value="">Select...</option>
                        {columns.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Fuzzy Match Summary Pill */}
                  <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-emerald-300 font-medium">
                      <CheckCircle2 className="w-4 h-4" />
                      Fuzzy Geo-Matcher: Matched {joinPreview.matched} / {joinPreview.total}{' '}
                      rows to NCR Polygons
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Auto-normalizes &ldquo;Gurgaon&rdquo; &rarr; &ldquo;Gurugram&rdquo;, &ldquo;G.B. Nagar&rdquo; &rarr; &ldquo;Noida&rdquo;
                    </span>
                  </div>
                </div>
              )}

              {/* First 5 rows preview table */}
              <div>
                <div className="text-xs font-semibold text-slate-400 mb-1.5">
                  Data Preview (First 5 Rows)
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
                            <td key={c} className="py-1.5 px-3 text-slate-300">
                              {String(r[c] ?? '')}
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
            disabled={rows.length === 0}
            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-semibold text-white cursor-pointer"
          >
            Add Layer to Map
          </button>
        </div>
      </div>
    </div>
  );
}
