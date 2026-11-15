import React, { useState, useMemo } from 'react';
import {
  ArrowLeft,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  FileText,
  Check,
} from 'lucide-react';
import {
  BoundaryLevel,
  CustomLayer,
  Region,
  detectBestBoundaryLevel,
  fuzzyMatchRegion,
  isValidIndiaCoord,
  sanitizeText,
  sanitizeUrl,
} from '../types';
import { VERIFIED_API_PRESETS } from '../data/ncrDefaults';

interface UploadDataPageProps {
  allRegions: Region[];
  isDarkMode: boolean;
  onBackToMap: () => void;
  onPublishLayer: (layer: CustomLayer) => Promise<void>;
}

type SourceTab = 'csv' | 'excel' | 'json' | 'api';

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

function parseCsvText(text: string): Array<Record<string, unknown>> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((h) => sanitizeText(h, 80));
  return lines.slice(1).map((line) => {
    const vals = parseCsvLine(line);
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      if (!h) return;
      const raw = vals[i] ?? '';
      const num = Number(String(raw).replace(/,/g, ''));
      row[h] = raw !== '' && !Number.isNaN(num) ? num : sanitizeText(raw, 200);
    });
    return row;
  });
}

export const UploadDataPage: React.FC<UploadDataPageProps> = ({
  allRegions,
  isDarkMode,
  onBackToMap,
  onPublishLayer,
}) => {
  // Step 1: Required Explanation & Metadata
  const [title, setTitle] = useState('');
  const [publisher, setPublisher] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [description, setDescription] = useState('');
  const [methodology] = useState('');
  const [targetState, setTargetState] = useState('All NCR');
  const [mappingMode, setMappingMode] = useState<'choropleth' | 'point'>('choropleth');
  const [boundaryLevel, setBoundaryLevel] = useState<BoundaryLevel>('assembly');
  const [metricLabel, setMetricLabel] = useState('');
  const [unit, setUnit] = useState('');
  const [layerColor, setLayerColor] = useState('#14b8a6');

  // Step 2: File / API Data Input
  const [sourceTab, setSourceTab] = useState<SourceTab>('csv');
  const [rawCsvInput, setRawCsvInput] = useState('');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [fileName, setFileName] = useState('');
  const [apiResourceId, setApiResourceId] = useState('3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69');
  const [apiKey, setApiKey] = useState('');
  const [loadingApi, setLoadingApi] = useState(false);

  // Step 3: Column Mapping
  const [areaColumn, setAreaColumn] = useState('');
  const [stateColumn, setStateColumn] = useState('');
  const [valueColumn, setValueColumn] = useState('');
  const [dateColumn, setDateColumn] = useState('');
  const [latColumn, setLatColumn] = useState('');
  const [lonColumn, setLonColumn] = useState('');
  const [labelColumn, setLabelColumn] = useState('');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const columns = useMemo(() => {
    if (rows.length === 0) return [];
    return Object.keys(rows[0]);
  }, [rows]);

  const autoDetectColumns = (parsedRows: Array<Record<string, unknown>>) => {
    if (parsedRows.length === 0) return;
    const cols = Object.keys(parsedRows[0]);
    const lowerCols = cols.map((c) => c.toLowerCase());

    // Detect area/constituency column
    const areaIdx = lowerCols.findIndex((c) =>
      /(constituency|assembly|ac_name|ac_no|district|ward|pc_name|region|area|city|name)/i.test(c)
    );
    if (areaIdx >= 0) setAreaColumn(cols[areaIdx]);
    else if (cols[0]) setAreaColumn(cols[0]);

    // Detect state column
    const stIdx = lowerCols.findIndex((c) => /(state|st_name|ulb|parent)/i.test(c));
    if (stIdx >= 0) setStateColumn(cols[stIdx]);

    // Detect date column
    const dtIdx = lowerCols.findIndex((c) => /(date|year|month|period|last_update)/i.test(c));
    if (dtIdx >= 0) setDateColumn(cols[dtIdx]);

    // Detect lat/lon if point dataset
    const latIdx = lowerCols.findIndex((c) => /^(lat|latitude|y)$/i.test(c));
    const lonIdx = lowerCols.findIndex((c) => /^(lon|lng|longitude|x)$/i.test(c));
    if (latIdx >= 0 && lonIdx >= 0) {
      setLatColumn(cols[latIdx]);
      setLonColumn(cols[lonIdx]);
      setLabelColumn(cols[areaIdx >= 0 ? areaIdx : 0]);
    }

    // Detect numeric metric column
    const numericCols = cols.filter((col) => {
      if (col === cols[areaIdx] || col === cols[stIdx] || col === cols[dtIdx]) return false;
      if (latIdx >= 0 && (col === cols[latIdx] || col === cols[lonIdx])) return false;
      if (/^(ac_no|pc_no|ward_no|id|sl_no|s_no)$/i.test(col)) return false;
      const sampleVal = parsedRows[0][col];
      return typeof sampleVal === 'number' || !Number.isNaN(Number(sampleVal));
    });
    if (numericCols.length > 0) {
      setValueColumn(numericCols[0]);
      if (!metricLabel) setMetricLabel(numericCols[0].replace(/_/g, ' '));
    }

    // Auto-detect best boundary tier from the area names
    if (areaIdx >= 0 && allRegions.length > 0) {
      const sampleAreas = parsedRows
        .slice(0, 100)
        .map((r) => String(r[cols[areaIdx]] ?? ''));
      const hints =
        stIdx >= 0
          ? parsedRows.slice(0, 100).map((r) => String(r[cols[stIdx]] ?? ''))
          : undefined;
      const det = detectBestBoundaryLevel(sampleAreas, allRegions, hints);
      if (det.scoresByLevel[det.bestLevel].matched > 0) {
        setBoundaryLevel(det.bestLevel);
      }
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setFileName(file.name);

    try {
      if (file.name.endsWith('.csv') || file.name.endsWith('.txt')) {
        const text = await file.text();
        const parsed = parseCsvText(text);
        if (parsed.length === 0) {
          setErrorMsg('Could not parse any rows from CSV. Check header and data rows.');
          return;
        }
        setRows(parsed);
        autoDetectColumns(parsed);
      } else if (file.name.endsWith('.json') || file.name.endsWith('.geojson')) {
        const text = await file.text();
        const json = JSON.parse(text);
        const extracted: Array<Record<string, unknown>> = Array.isArray(json)
          ? json
          : Array.isArray(json.features)
            ? json.features.map((f: any) => ({ ...(f.properties || {}) }))
            : Array.isArray(json.records)
              ? json.records
              : [];
        if (extracted.length === 0) {
          setErrorMsg('JSON file must contain an array of objects, records, or GeoJSON features.');
          return;
        }
        setRows(extracted);
        autoDetectColumns(extracted);
      } else {
        setErrorMsg('Please upload a .csv, .json, or .geojson file, or paste tabular data below.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to parse file.');
    }
  };

  const handleParsePastedCsv = () => {
    setErrorMsg(null);
    const parsed = parseCsvText(rawCsvInput);
    if (parsed.length === 0) {
      setErrorMsg('Please enter valid CSV text with a header row and at least one data row.');
      return;
    }
    setFileName('Pasted CSV Table');
    setRows(parsed);
    autoDetectColumns(parsed);
  };

  const handleFetchGovernmentApi = async () => {
    setLoadingApi(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams({
        resource_id: apiResourceId.trim(),
        limit: '100',
      });
      if (apiKey.trim()) params.set('api_key', apiKey.trim());
      const res = await fetch(`/api/datagov?${params.toString()}`);
      const data = await res.json();
      const records = Array.isArray(data.records) ? data.records : [];
      if (records.length === 0) {
        setErrorMsg(
          'No records returned from data.gov.in resource. Verify the Resource ID or API key.'
        );
        return;
      }
      setFileName(`data.gov.in (${apiResourceId.slice(0, 12)}…)`);
      setRows(records);
      autoDetectColumns(records);
      if (!sourceUrl) {
        setSourceUrl(`https://data.gov.in/resource/${apiResourceId.trim()}`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to fetch from data.gov.in proxy.');
    } finally {
      setLoadingApi(false);
    }
  };

  // Live boundary match verification preview
  const matchPreview = useMemo(() => {
    if (rows.length === 0 || mappingMode !== 'choropleth' || !areaColumn) {
      return {
        tierRegions: [] as Region[],
        matchedRows: [] as Array<{
          rawArea: string;
          matchedRegion: Region | null;
          value: number;
          date: string;
        }>,
        matchedCount: 0,
        detection: null,
      };
    }

    const areaNames = rows.map((r) => String(r[areaColumn] ?? ''));
    const stateHints = stateColumn
      ? rows.map((r) => String(r[stateColumn] ?? ''))
      : targetState !== 'All NCR'
        ? rows.map(() => targetState)
        : undefined;

    const detection = detectBestBoundaryLevel(areaNames, allRegions, stateHints);
    const tierRegions = allRegions.filter((r) => r.level === boundaryLevel);

    let matchedCount = 0;
    const matchedRows = rows.map((r, idx) => {
      const rawArea = String(r[areaColumn] ?? '');
      const matchedRegion = fuzzyMatchRegion(rawArea, tierRegions, stateHints?.[idx]);
      if (matchedRegion) matchedCount++;
      const numVal = Number(String(r[valueColumn] ?? '0').replace(/,/g, ''));
      const dateStr = dateColumn ? String(r[dateColumn] ?? 'Latest') : 'Latest';
      return {
        rawArea,
        matchedRegion,
        value: Number.isFinite(numVal) ? numVal : 0,
        date: dateStr,
      };
    });

    return { tierRegions, matchedRows, matchedCount, detection };
  }, [rows, mappingMode, areaColumn, stateColumn, valueColumn, dateColumn, boundaryLevel, allRegions, targetState]);

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const cleanTitle = sanitizeText(title, 140);
    const cleanPublisher = sanitizeText(publisher, 120);
    const cleanUrl = sanitizeUrl(sourceUrl);
    const cleanDesc = sanitizeText(description, 1000);
    const cleanMethod = sanitizeText(methodology, 1000);
    const cleanMetric = sanitizeText(metricLabel || valueColumn || 'Metric Value', 80);
    const cleanUnit = sanitizeText(unit, 30);

    if (!cleanTitle) {
      setErrorMsg('Please enter a Dataset Title.');
      return;
    }
    if (!cleanPublisher) {
      setErrorMsg('Please enter the Publisher / Contributor or Department name.');
      return;
    }
    if (!cleanUrl) {
      setErrorMsg(
        'Please provide a valid official https:// Source URL so users can verify the data.'
      );
      return;
    }
    if (cleanDesc.length < 15) {
      setErrorMsg(
        'Please explain what this dataset measures and how regions/constituencies are mapped (at least 15 characters).'
      );
      return;
    }
    if (rows.length === 0) {
      setErrorMsg('Please upload or load a dataset table first.');
      return;
    }

    setSubmitting(true);
    try {
      const slug = `comm-${cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString().slice(-5)}`;

      if (mappingMode === 'choropleth') {
        if (!areaColumn || !valueColumn) {
          setErrorMsg('Please select both the Region/Constituency Column and the Metric Value Column.');
          setSubmitting(false);
          return;
        }
        if (matchPreview.matchedCount === 0) {
          setErrorMsg(
            `0 rows matched the selected ${boundaryLevel} tier. Check your Region Column or switch the Administrative Boundary Tier.`
          );
          setSubmitting(false);
          return;
        }

        const choroplethByDate: Record<string, Record<string, number>> = {};
        for (const item of matchPreview.matchedRows) {
          if (!item.matchedRegion) continue;
          const d = item.date || 'Latest';
          if (!choroplethByDate[d]) choroplethByDate[d] = {};
          choroplethByDate[d][item.matchedRegion.code] = item.value;
        }

        const availableDates = Object.keys(choroplethByDate).sort();
        const activeDate = availableDates[availableDates.length - 1] || 'Latest';

        const newLayer: CustomLayer = {
          id: slug,
          slug,
          name: cleanTitle,
          description: cleanDesc,
          methodology: cleanMethod,
          targetState,
          type: 'choropleth',
          boundaryLevel,
          category: 'Uploaded Civic Dataset',
          metricLabel: cleanMetric,
          unit: cleanUnit,
          publisher: cleanPublisher,
          sourceUrl: cleanUrl,
          license: 'GODL-India / Verified Source',
          color: layerColor,
          visible: true,
          opacity: 0.78,
          featureCount: matchPreview.matchedCount,
          availableDates,
          activeDate,
          choroplethByDate,
          geojson: { type: 'FeatureCollection', features: [] },
          rawRows: rows,
        };

        await onPublishLayer(newLayer);
      } else {
        if (!latColumn || !lonColumn || !valueColumn) {
          setErrorMsg('Please select Latitude, Longitude, and Metric Value columns.');
          setSubmitting(false);
          return;
        }

        const pointsByDate: Record<string, Array<Record<string, unknown>>> = {};
        const features: Array<Record<string, unknown>> = [];

        rows.forEach((r, idx) => {
          const lat = Number(r[latColumn]);
          const lon = Number(r[lonColumn]);
          if (!isValidIndiaCoord(lat, lon)) return;
          const val = Number(String(r[valueColumn] ?? '0').replace(/,/g, '')) || 0;
          const d = dateColumn ? String(r[dateColumn] ?? 'Latest') : 'Latest';
          const label = labelColumn ? String(r[labelColumn] ?? `Point ${idx + 1}`) : `Point ${idx + 1}`;
          if (!pointsByDate[d]) pointsByDate[d] = [];
          pointsByDate[d].push({ lat, lon, label, value: val });
          features.push({
            type: 'Feature',
            properties: {
              id: `${slug}-pt-${idx}`,
              name: label,
              value: val,
              unit: cleanUnit,
              date: d,
              sourceUrl: cleanUrl,
              publisher: cleanPublisher,
            },
            geometry: { type: 'Point', coordinates: [lon, lat] },
          });
        });

        if (features.length === 0) {
          setErrorMsg('No valid India GPS coordinates (Lat 6..38, Lon 68..98) found in the selected columns.');
          setSubmitting(false);
          return;
        }

        const availableDates = Object.keys(pointsByDate).sort();
        const activeDate = availableDates[availableDates.length - 1] || 'Latest';

        const newLayer: CustomLayer = {
          id: slug,
          slug,
          name: cleanTitle,
          description: cleanDesc,
          methodology: cleanMethod,
          targetState,
          type: 'point',
          category: 'Uploaded Point Layer',
          metricLabel: cleanMetric,
          unit: cleanUnit,
          publisher: cleanPublisher,
          sourceUrl: cleanUrl,
          license: 'GODL-India / Verified Source',
          color: layerColor,
          visible: true,
          opacity: 0.9,
          featureCount: features.length,
          availableDates,
          activeDate,
          pointsByDate,
          geojson: { type: 'FeatureCollection', features },
          rawRows: rows,
        };

        await onPublishLayer(newLayer);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={`min-h-screen w-full transition-colors ${
        isDarkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'
      }`}
    >
      {/* Top Bar */}
      <header
        className={`sticky top-0 z-30 border-b px-6 py-4 backdrop-blur-md flex items-center justify-between ${
          isDarkMode
            ? 'bg-slate-900/90 border-slate-800'
            : 'bg-white/90 border-slate-200'
        }`}
      >
        <div className="flex items-center gap-4">
          <button
            onClick={onBackToMap}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800'
            }`}
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Map Explorer
          </button>
          <div>
            <h1 className="text-base font-bold tracking-tight flex items-center gap-2">
              <Upload className="w-4 h-4 text-teal-400" />
              Publish & Map Verified Civic Dataset
            </h1>
            <p className="text-xs text-slate-400">
              Document your dataset provenance, map rows to official State / Assembly / District / Ward boundaries, and view it live on the Home Map.
            </p>
          </div>
        </div>
        <div className="text-[11px] font-medium text-teal-400 bg-teal-500/10 border border-teal-500/20 px-3 py-1.5 rounded-lg">
          Zero-GeoJSON Auto-Mapper • Verified Sources Only
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <form onSubmit={handlePublish} className="space-y-8">
          {errorMsg && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* STEP 1: REQUIRED DATA EXPLANATION & ADMINISTRATIVE TARGET */}
          <section
            className={`p-6 rounded-2xl border ${
              isDarkMode
                ? 'bg-slate-900/70 border-slate-800'
                : 'bg-white border-slate-200 shadow-sm'
            }`}
          >
            <div className="flex items-center gap-2.5 mb-4">
              <span className="w-6 h-6 rounded-full bg-teal-500 text-slate-950 font-bold text-xs flex items-center justify-center">
                1
              </span>
              <h2 className="text-sm font-bold uppercase tracking-wider text-teal-400">
                Required: Explain Dataset & Select Administrative Mapping Level
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-semibold mb-1.5">
                  Dataset Title <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Delhi Assembly Rooftop Solar Installations (2025)"
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs border ${
                    isDarkMode
                      ? 'bg-slate-950 border-slate-800 text-slate-100'
                      : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5">
                  Official Publisher / Organization <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={publisher}
                  onChange={(e) => setPublisher(e.target.value)}
                  placeholder="e.g., Ministry of New & Renewable Energy / Delhi Statistical Handbook"
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs border ${
                    isDarkMode
                      ? 'bg-slate-950 border-slate-800 text-slate-100'
                      : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5">
                  Official Verification Link (URL) <span className="text-rose-400">*</span>
                </label>
                <input
                  type="url"
                  required
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://data.gov.in/resource/... or official government report link"
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs border ${
                    isDarkMode
                      ? 'bg-slate-950 border-slate-800 text-slate-100'
                      : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Shown as a clickable verification link when a user clicks any region on the map.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1.5">
                    Target State / Region <span className="text-rose-400">*</span>
                  </label>
                  <select
                    value={targetState}
                    onChange={(e) => setTargetState(e.target.value)}
                    className={`w-full px-3 py-2.5 rounded-xl text-xs border ${
                      isDarkMode
                        ? 'bg-slate-950 border-slate-800 text-slate-100'
                        : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  >
                    <option value="All NCR">All NCR (Delhi, Haryana, UP)</option>
                    <option value="NCT of Delhi">NCT of Delhi</option>
                    <option value="Haryana">Haryana (NCR Districts)</option>
                    <option value="Uttar Pradesh">Uttar Pradesh (NCR Districts)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1.5">
                    Administrative Level <span className="text-rose-400">*</span>
                  </label>
                  <select
                    value={mappingMode === 'point' ? 'point' : boundaryLevel}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === 'point') {
                        setMappingMode('point');
                      } else {
                        setMappingMode('choropleth');
                        setBoundaryLevel(val as BoundaryLevel);
                      }
                    }}
                    className={`w-full px-3 py-2.5 rounded-xl text-xs border ${
                      isDarkMode
                        ? 'bg-slate-950 border-slate-800 text-slate-100'
                        : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  >
                    <option value="assembly">State Assembly Constituency (AC)</option>
                    <option value="district">District (LGD District)</option>
                    <option value="constituency">Lok Sabha Constituency (PC)</option>
                    <option value="ward">Municipal Ward (MCD / ULB)</option>
                    <option value="point">GPS Point Coordinates (Lat/Lon)</option>
                  </select>
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-semibold mb-1.5">
                  Dataset Explanation & Mapping Context <span className="text-rose-400">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Explain what this dataset measures, the time period covered, how each row corresponds to a State Assembly Constituency / District / Ward, and any methodology notes..."
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs border ${
                    isDarkMode
                      ? 'bg-slate-950 border-slate-800 text-slate-100'
                      : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5">
                  Metric Name (shown on Hover & Legend) <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={metricLabel}
                  onChange={(e) => setMetricLabel(e.target.value)}
                  placeholder="e.g., Installed Solar Capacity or Voter Turnout"
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs border ${
                    isDarkMode
                      ? 'bg-slate-950 border-slate-800 text-slate-100'
                      : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1.5">
                    Measurement Unit <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="e.g., %, MW, µg/m³, ₹ Cr"
                    className={`w-full px-3.5 py-2.5 rounded-xl text-xs border ${
                      isDarkMode
                        ? 'bg-slate-950 border-slate-800 text-slate-100'
                        : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5">Layer Accent Color</label>
                  <input
                    type="color"
                    value={layerColor}
                    onChange={(e) => setLayerColor(e.target.value)}
                    className="w-full h-10 rounded-xl cursor-pointer bg-transparent"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* STEP 2: LOAD FILE OR API */}
          <section
            className={`p-6 rounded-2xl border ${
              isDarkMode
                ? 'bg-slate-900/70 border-slate-800'
                : 'bg-white border-slate-200 shadow-sm'
            }`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <span className="w-6 h-6 rounded-full bg-teal-500 text-slate-950 font-bold text-xs flex items-center justify-center">
                  2
                </span>
                <h2 className="text-sm font-bold uppercase tracking-wider text-teal-400">
                  Upload Tabular File or Connect Open Government API
                </h2>
              </div>

              <div className="flex gap-1.5">
                {(
                  [
                    { id: 'csv', label: 'CSV / Paste Table' },
                    { id: 'json', label: 'JSON / GeoJSON' },
                    { id: 'api', label: 'data.gov.in API' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSourceTab(t.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                      sourceTab === t.id
                        ? 'bg-teal-500 text-slate-950'
                        : isDarkMode
                          ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {sourceTab === 'csv' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div
                  className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center ${
                    isDarkMode ? 'border-slate-700 bg-slate-950/50' : 'border-slate-300 bg-slate-50'
                  }`}
                >
                  <FileSpreadsheet className="w-8 h-8 text-teal-400 mb-2" />
                  <p className="text-xs font-semibold mb-1">Upload .CSV File</p>
                  <p className="text-[11px] text-slate-400 mb-3">
                    Include a column with Assembly Constituency, District, PC, or Ward names/numbers.
                  </p>
                  <input
                    type="file"
                    accept=".csv,.txt"
                    onChange={handleFileChange}
                    className="text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-teal-500 file:text-slate-950 file:font-semibold hover:file:bg-teal-400 cursor-pointer"
                  />
                  {fileName && (
                    <span className="mt-2 text-[11px] text-emerald-400 font-medium">
                      Loaded: {fileName} ({rows.length} rows)
                    </span>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1.5">
                    Or Paste CSV Rows Directly (Header + Data Rows)
                  </label>
                  <textarea
                    rows={4}
                    value={rawCsvInput}
                    onChange={(e) => setRawCsvInput(e.target.value)}
                    placeholder={`Constituency,State,Value\nNew Delhi,NCT of Delhi,33.29\nKalkaji,NCT of Delhi,16.84\nGurgaon,Haryana,9.12`}
                    className={`w-full px-3 py-2 rounded-xl text-xs font-mono border ${
                      isDarkMode
                        ? 'bg-slate-950 border-slate-800 text-slate-200'
                        : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={handleParsePastedCsv}
                    className="mt-2 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-teal-400 border border-slate-700 text-xs font-semibold cursor-pointer"
                  >
                    Parse Pasted CSV Table
                  </button>
                </div>
              </div>
            )}

            {sourceTab === 'json' && (
              <div
                className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center ${
                  isDarkMode ? 'border-slate-700 bg-slate-950/50' : 'border-slate-300 bg-slate-50'
                }`}
              >
                <FileText className="w-8 h-8 text-teal-400 mb-2" />
                <p className="text-xs font-semibold mb-1">Upload .JSON or .GeoJSON File</p>
                <input
                  type="file"
                  accept=".json,.geojson"
                  onChange={handleFileChange}
                  className="text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-teal-500 file:text-slate-950 file:font-semibold cursor-pointer"
                />
              </div>
            )}

            {sourceTab === 'api' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Verified data.gov.in & Open Government Catalog Presets
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {VERIFIED_API_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setApiResourceId(preset.resourceId);
                          setTitle(preset.label);
                          setPublisher(preset.publisher);
                          setSourceUrl(preset.sourceUrl);
                          setDescription(preset.description);
                          setMetricLabel(preset.category);
                          setUnit(preset.unit);
                        }}
                        className={`text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
                          apiResourceId === preset.resourceId
                            ? 'bg-teal-500/15 border-teal-500/50 text-teal-200'
                            : isDarkMode
                              ? 'bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-300'
                              : 'bg-slate-50 border-slate-200 hover:border-slate-300 text-slate-800'
                        }`}
                      >
                        <div className="text-xs font-bold truncate">{preset.label}</div>
                        <div className="text-[10px] text-slate-400 truncate mt-0.5">
                          {preset.publisher}
                        </div>
                        <div className="text-[10px] font-mono text-teal-400 mt-1 truncate">
                          ID: {preset.resourceId}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      data.gov.in Resource ID
                    </label>
                    <input
                      type="text"
                      value={apiResourceId}
                      onChange={(e) => setApiResourceId(e.target.value)}
                      className={`w-full px-3 py-2 rounded-xl text-xs border ${
                        isDarkMode
                          ? 'bg-slate-950 border-slate-800 text-slate-100'
                          : 'bg-slate-50 border-slate-300 text-slate-900'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      API Key (Optional — uses proxy key if blank)
                    </label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Optional data.gov.in key"
                      className={`w-full px-3 py-2 rounded-xl text-xs border ${
                        isDarkMode
                          ? 'bg-slate-950 border-slate-800 text-slate-100'
                          : 'bg-slate-50 border-slate-300 text-slate-900'
                      }`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleFetchGovernmentApi}
                    disabled={loadingApi}
                    className="px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs cursor-pointer"
                  >
                    {loadingApi ? 'Fetching Live Records…' : 'Fetch Live API Records'}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* STEP 3: COLUMN MAPPING & LIVE BOUNDARY VERIFICATION */}
          {rows.length > 0 && (
            <section
              className={`p-6 rounded-2xl border ${
                isDarkMode
                  ? 'bg-slate-900/70 border-slate-800'
                  : 'bg-white border-slate-200 shadow-sm'
              }`}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-teal-500 text-slate-950 font-bold text-xs flex items-center justify-center">
                    3
                  </span>
                  <h2 className="text-sm font-bold uppercase tracking-wider text-teal-400">
                    Column Mapping & Boundary Match Verification ({rows.length} rows loaded)
                  </h2>
                </div>

                {mappingMode === 'choropleth' && matchPreview.detection && (
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-slate-400">Auto-Match Scores:</span>
                    {(['assembly', 'district', 'constituency', 'ward'] as BoundaryLevel[]).map(
                      (lvl) => {
                        const sc = matchPreview.detection!.scoresByLevel[lvl];
                        return (
                          <button
                            key={lvl}
                            type="button"
                            onClick={() => setBoundaryLevel(lvl)}
                            className={`px-2.5 py-1 rounded-lg border font-semibold cursor-pointer ${
                              boundaryLevel === lvl
                                ? 'bg-teal-500/20 border-teal-400 text-teal-300'
                                : 'bg-slate-800/60 border-slate-700 text-slate-400'
                            }`}
                          >
                            {lvl}: {sc.matched}/{sc.total}
                          </button>
                        );
                      }
                    )}
                  </div>
                )}
              </div>

              {mappingMode === 'choropleth' ? (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-5">
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      Region / Constituency Column <span className="text-rose-400">*</span>
                    </label>
                    <select
                      value={areaColumn}
                      onChange={(e) => setAreaColumn(e.target.value)}
                      className={`w-full px-3 py-2 rounded-xl text-xs border ${
                        isDarkMode
                          ? 'bg-slate-950 border-slate-800 text-slate-100'
                          : 'bg-slate-50 border-slate-300 text-slate-900'
                      }`}
                    >
                      <option value="">-- Select Column --</option>
                      {columns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      Metric Value Column <span className="text-rose-400">*</span>
                    </label>
                    <select
                      value={valueColumn}
                      onChange={(e) => setValueColumn(e.target.value)}
                      className={`w-full px-3 py-2 rounded-xl text-xs border ${
                        isDarkMode
                          ? 'bg-slate-950 border-slate-800 text-slate-100'
                          : 'bg-slate-50 border-slate-300 text-slate-900'
                      }`}
                    >
                      <option value="">-- Select Column --</option>
                      {columns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      State / District Hint Column (Optional)
                    </label>
                    <select
                      value={stateColumn}
                      onChange={(e) => setStateColumn(e.target.value)}
                      className={`w-full px-3 py-2 rounded-xl text-xs border ${
                        isDarkMode
                          ? 'bg-slate-950 border-slate-800 text-slate-100'
                          : 'bg-slate-50 border-slate-300 text-slate-900'
                      }`}
                    >
                      <option value="">-- None --</option>
                      {columns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      Date / Year Column (Optional)
                    </label>
                    <select
                      value={dateColumn}
                      onChange={(e) => setDateColumn(e.target.value)}
                      className={`w-full px-3 py-2 rounded-xl text-xs border ${
                        isDarkMode
                          ? 'bg-slate-950 border-slate-800 text-slate-100'
                          : 'bg-slate-50 border-slate-300 text-slate-900'
                      }`}
                    >
                      <option value="">-- Single Snapshot --</option>
                      {columns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-5">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Latitude Column *</label>
                    <select
                      value={latColumn}
                      onChange={(e) => setLatColumn(e.target.value)}
                      className={`w-full px-3 py-2 rounded-xl text-xs border ${
                        isDarkMode
                          ? 'bg-slate-950 border-slate-800 text-slate-100'
                          : 'bg-slate-50 border-slate-300 text-slate-900'
                      }`}
                    >
                      <option value="">-- Select --</option>
                      {columns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Longitude Column *</label>
                    <select
                      value={lonColumn}
                      onChange={(e) => setLonColumn(e.target.value)}
                      className={`w-full px-3 py-2 rounded-xl text-xs border ${
                        isDarkMode
                          ? 'bg-slate-950 border-slate-800 text-slate-100'
                          : 'bg-slate-50 border-slate-300 text-slate-900'
                      }`}
                    >
                      <option value="">-- Select --</option>
                      {columns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Station / Point Label *</label>
                    <select
                      value={labelColumn}
                      onChange={(e) => setLabelColumn(e.target.value)}
                      className={`w-full px-3 py-2 rounded-xl text-xs border ${
                        isDarkMode
                          ? 'bg-slate-950 border-slate-800 text-slate-100'
                          : 'bg-slate-50 border-slate-300 text-slate-900'
                      }`}
                    >
                      <option value="">-- Select --</option>
                      {columns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Metric Value Column *</label>
                    <select
                      value={valueColumn}
                      onChange={(e) => setValueColumn(e.target.value)}
                      className={`w-full px-3 py-2 rounded-xl text-xs border ${
                        isDarkMode
                          ? 'bg-slate-950 border-slate-800 text-slate-100'
                          : 'bg-slate-50 border-slate-300 text-slate-900'
                      }`}
                    >
                      <option value="">-- Select --</option>
                      {columns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Live Mapping Preview Table */}
              {mappingMode === 'choropleth' && (
                <div className="rounded-xl border border-slate-800 overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between text-xs">
                    <span className="font-semibold text-teal-400">
                      Boundary Match Preview: {matchPreview.matchedCount} of {rows.length} rows mapped to official{' '}
                      <span className="uppercase">{boundaryLevel}</span> GIS polygons
                    </span>
                    <span className="text-slate-400">Showing first 12 rows</span>
                  </div>
                  <div className="overflow-x-auto max-h-64">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800">
                        <tr>
                          <th className="py-2 px-3">Uploaded Region Value</th>
                          <th className="py-2 px-3">Matched Official GIS Boundary</th>
                          <th className="py-2 px-3">Boundary Code</th>
                          <th className="py-2 px-3">State / Hub</th>
                          <th className="py-2 px-3 text-right">
                            {metricLabel || valueColumn || 'Value'} ({unit})
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {matchPreview.matchedRows.slice(0, 12).map((row, i) => (
                          <tr key={i}>
                            <td className="py-2 px-3 font-medium">{row.rawArea}</td>
                            <td className="py-2 px-3">
                              {row.matchedRegion ? (
                                <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                                  <Check className="w-3.5 h-3.5" />
                                  {row.matchedRegion.name}
                                </span>
                              ) : (
                                <span className="text-amber-400">Unmatched on {boundaryLevel} tier</span>
                              )}
                            </td>
                            <td className="py-2 px-3 font-mono text-[11px] text-slate-400">
                              {row.matchedRegion?.code || '—'}
                            </td>
                            <td className="py-2 px-3 text-slate-400">
                              {row.matchedRegion?.state || '—'}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-semibold text-teal-300">
                              {row.value} {unit}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* SUBMIT BUTTON */}
          <div className="flex items-center justify-end gap-4">
            <button
              type="button"
              onClick={onBackToMap}
              className="px-5 py-2.5 rounded-xl border border-slate-700 text-xs font-semibold text-slate-300 hover:bg-slate-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || rows.length === 0}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-slate-950 font-bold text-xs shadow-lg shadow-teal-500/20 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              {submitting
                ? 'Publishing & Mapping Layer…'
                : 'Publish Dataset & Open on Home Map'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
};
