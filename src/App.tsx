import { useEffect, useRef, useState, FormEvent, ChangeEvent } from 'react';
import { supabase } from './lib/supabase';
import {
  BoundaryLevel,
  MetricKey,
  METRIC_CONFIGS,
  Region,
  Insight,
  AqiStation,
  InfraPoint,
  CustomLayer,
} from './types';
import {
  DEFAULT_REGIONS,
  DEMO_AQI_STATIONS,
  PUBLIC_INFRA_POINTS,
} from './data/ncrDefaults';
import DataImporterModal from './components/DataImporterModal';
import CompareModal from './components/CompareModal';
import CreatorStudioModal from './components/CreatorStudioModal';
import {
  Layers,
  Search,
  Sun,
  Moon,
  Plus,
  ArrowLeftRight,
  Award,
  Wind,
  Building2,
  Upload,
  Eye,
  EyeOff,
  Trash2,
  X,
  Share2,
  Database,
  CheckCircle2,
  Download,
} from 'lucide-react';

// Minimal typing for global maplibregl loaded from CDN
interface MapLibreMap {
  addControl: (ctrl: unknown, pos?: string) => void;
  on: (event: string, layerOrCb: unknown, cb?: unknown) => void;
  once: (event: string, cb: () => void) => void;
  getSource: (id: string) => { setData: (data: unknown) => void } | undefined;
  addSource: (id: string, spec: unknown) => void;
  getLayer: (id: string) => unknown;
  addLayer: (spec: unknown) => void;
  removeLayer: (id: string) => void;
  removeSource: (id: string) => void;
  setPaintProperty: (layerId: string, prop: string, val: unknown) => void;
  setLayoutProperty: (layerId: string, prop: string, val: unknown) => void;
  setStyle: (styleUrl: string) => void;
  flyTo: (opts: { center: [number, number]; zoom: number }) => void;
  queryRenderedFeatures: (point: unknown, opts: { layers: string[] }) => unknown[];
  getCanvas: () => HTMLCanvasElement;
  remove: () => void;
}

declare global {
  interface Window {
    maplibregl: {
      Map: new (opts: Record<string, unknown>) => MapLibreMap;
      NavigationControl: new () => unknown;
    };
  }
}

const STYLES = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
};

function getPolygonCenter(geojson: Record<string, unknown> | null | undefined): [number, number] {
  try {
    const coords = (geojson as { coordinates?: number[][][] })?.coordinates?.[0];
    if (!coords || coords.length === 0) return [77.21, 28.56];
    let sumLon = 0;
    let sumLat = 0;
    for (const pt of coords) {
      sumLon += pt[0];
      sumLat += pt[1];
    }
    return [sumLon / coords.length, sumLat / coords.length];
  } catch {
    return [77.21, 28.56];
  }
}

export default function App() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  // Core state
  const [regions, setRegions] = useState<Region[]>(DEFAULT_REGIONS);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [dbSynced, setDbSynced] = useState<boolean>(false);

  // Map controls state
  const [isDark, setIsDark] = useState<boolean>(true);
  const [level, setLevel] = useState<BoundaryLevel>('district');
  const [metric, setMetric] = useState<MetricKey>('literacy_rate');
  const [showAreaLayer, setShowAreaLayer] = useState<boolean>(true);
  const [areaOpacity, setAreaOpacity] = useState<number>(0.52);

  // Point layers state
  const [showAqiLayer, setShowAqiLayer] = useState<boolean>(true);
  const [aqiStations, setAqiStations] = useState<AqiStation[]>(DEMO_AQI_STATIONS);
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [aqiStatus, setAqiStatus] = useState<string>(
    'Showing 8 NCR CPCB stations (Live Edge Preset)'
  );

  const [showInfraLayer, setShowInfraLayer] = useState<boolean>(true);
  const [customLayers, setCustomLayers] = useState<CustomLayer[]>([]);

  // Search & Modals
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isImporterOpen, setIsImporterOpen] = useState<boolean>(false);
  const [isCompareOpen, setIsCompareOpen] = useState<boolean>(false);
  const [isCreatorOpen, setIsCreatorOpen] = useState<boolean>(false);

  // Right Insights Drawer state
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(DEFAULT_REGIONS[0]);
  const [selectedPoint, setSelectedPoint] = useState<{
    tag: string;
    title: string;
    subtitle: string;
    metrics: Record<string, string | number>;
  } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(true);

  // Publish Finding Form inside Drawer
  const [noteTitle, setNoteTitle] = useState<string>('');
  const [noteSummary, setNoteSummary] = useState<string>('');
  const [noteAuthor, setNoteAuthor] = useState<string>('');
  const [publishing, setPublishing] = useState<boolean>(false);

  // Refs to keep latest state accessible inside MapLibre click callbacks
  const regionsRef = useRef<Region[]>(regions);
  regionsRef.current = regions;
  const levelRef = useRef<BoundaryLevel>(level);
  levelRef.current = level;
  const metricRef = useRef<MetricKey>(metric);
  metricRef.current = metric;

  // 1. Fetch Regions & Insights from Supabase PostgreSQL
  async function syncFromSupabase() {
    try {
      const [regRes, insRes] = await Promise.all([
        supabase.from('regions').select('*').order('population', { ascending: false }),
        supabase.from('insights').select('*').order('created_at', { ascending: false }),
      ]);

      if (!regRes.error && regRes.data && regRes.data.length > 0) {
        const merged: Region[] = regRes.data.map((r: Region) => {
          const fallback = DEFAULT_REGIONS.find((d) => d.code === r.code);
          return {
            ...fallback,
            ...r,
            literacy_rate: Number(r.literacy_rate),
            green_cover_pct: Number(r.green_cover_pct ?? fallback?.green_cover_pct ?? 18.5),
            geojson: r.geojson || fallback?.geojson || null,
          };
        });
        setRegions(merged);
        setSelectedRegion((prev) => merged.find((m) => m.code === prev?.code) || merged[0]);
        setDbSynced(true);
      }

      if (!insRes.error && insRes.data) {
        setInsights(insRes.data);
      }
    } catch {
      // Fallback defaults remain active
    }
  }

  useEffect(() => {
    syncFromSupabase();
  }, []);

  // Build GeoJSON FeatureCollection for active administrative level
  function buildRegionsGeoJSON(allRegions: Region[], activeLevel: BoundaryLevel) {
    const filtered = allRegions.filter((r) => r.level === activeLevel && r.geojson);
    return {
      type: 'FeatureCollection',
      features: filtered.map((r) => ({
        type: 'Feature',
        properties: {
          code: r.code,
          name: r.name,
          state: r.state,
          level: r.level,
          population: Number(r.population),
          density: Number(r.density),
          literacy_rate: Number(r.literacy_rate),
          aqi_pm25: Number(r.aqi_pm25 ?? 220),
          hospitals_count: Number(r.hospitals_count),
          sex_ratio: Number(r.sex_ratio),
          green_cover_pct: Number(r.green_cover_pct),
          schools_count: Number(r.schools_count),
          avg_circle_rate: Number(r.avg_circle_rate),
        },
        geometry: r.geojson,
      })),
    };
  }

  function buildAqiGeoJSON(stations: AqiStation[]) {
    return {
      type: 'FeatureCollection',
      features: stations.map((s) => ({
        type: 'Feature',
        properties: s,
        geometry: {
          type: 'Point',
          coordinates: [Number(s.lon), Number(s.lat)],
        },
      })),
    };
  }

  function buildInfraGeoJSON(points: InfraPoint[]) {
    return {
      type: 'FeatureCollection',
      features: points.map((p) => ({
        type: 'Feature',
        properties: p,
        geometry: {
          type: 'Point',
          coordinates: [Number(p.lon), Number(p.lat)],
        },
      })),
    };
  }

  function getFillColorExpression(mKey: MetricKey) {
    const cfg = METRIC_CONFIGS[mKey];
    const [s0, s1, s2] = cfg.stops;
    return [
      'interpolate',
      ['linear'],
      ['coalesce', ['get', mKey], s0[0]],
      s0[0],
      s0[1],
      s1[0],
      s1[1],
      s2[0],
      s2[1],
    ];
  }

  // Initialize MapLibre GL JS
  function setupMapLayers(map: MapLibreMap) {
    const areaGeoJSON = buildRegionsGeoJSON(regionsRef.current, levelRef.current);

    if (!map.getSource('ncr-areas')) {
      map.addSource('ncr-areas', { type: 'geojson', data: areaGeoJSON });
      map.addLayer({
        id: 'area-fill',
        type: 'fill',
        source: 'ncr-areas',
        paint: {
          'fill-color': getFillColorExpression(metricRef.current),
          'fill-opacity': areaOpacity,
        },
      });
      map.addLayer({
        id: 'area-outline',
        type: 'line',
        source: 'ncr-areas',
        paint: {
          'line-color': '#34d399',
          'line-width': 1.8,
        },
      });
    }

    if (!map.getSource('infra-points')) {
      map.addSource('infra-points', {
        type: 'geojson',
        data: buildInfraGeoJSON(PUBLIC_INFRA_POINTS),
      });
      map.addLayer({
        id: 'infra-circles',
        type: 'circle',
        source: 'infra-points',
        paint: {
          'circle-radius': 6.5,
          'circle-color': '#38bdf8',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#0f172a',
        },
      });
    }

    if (!map.getSource('aqi-points')) {
      map.addSource('aqi-points', {
        type: 'geojson',
        data: buildAqiGeoJSON(aqiStations),
      });
      map.addLayer({
        id: 'aqi-circles',
        type: 'circle',
        source: 'aqi-points',
        paint: {
          'circle-radius': 8.5,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-color': [
            'interpolate',
            ['linear'],
            ['coalesce', ['get', 'pm25'], 150],
            60,
            '#22c55e',
            160,
            '#eab308',
            250,
            '#f97316',
            320,
            '#ef4444',
          ],
        },
      });
    }
  }

  useEffect(() => {
    if (!mapContainerRef.current || !window.maplibregl) return;

    const map = new window.maplibregl.Map({
      container: mapContainerRef.current,
      style: STYLES.dark,
      center: [77.21, 28.56],
      zoom: 9.4,
    });

    map.addControl(new window.maplibregl.NavigationControl(), 'bottom-right');
    mapRef.current = map;

    map.on('load', () => {
      setupMapLayers(map);

      // Click AQI station
      map.on('click', 'aqi-circles', (e: { originalEvent: { stopPropagation: () => void }; features?: Array<{ properties: Record<string, unknown> }> }) => {
        e.originalEvent.stopPropagation();
        const p = e.features?.[0]?.properties;
        if (!p) return;
        setSelectedPoint({
          tag: 'CPCB Live Air Quality Station',
          title: String(p.station || 'AQI Station'),
          subtitle: `${p.city || 'NCR'} • ${p.updated || 'Live Feed'}`,
          metrics: {
            'PM2.5 (µg/m³)': Number(p.pm25 || 0),
            'PM10 (µg/m³)': Number(p.pm10 || 0),
            'NO2 (µg/m³)': Number(p.no2 || 48),
            Source: 'api.data.gov.in / CPCB',
          },
        });
        setDrawerOpen(true);
      });

      // Click Public Infrastructure point
      map.on('click', 'infra-circles', (e: { originalEvent: { stopPropagation: () => void }; features?: Array<{ properties: Record<string, unknown> }> }) => {
        e.originalEvent.stopPropagation();
        const p = e.features?.[0]?.properties;
        if (!p) return;
        setSelectedPoint({
          tag: String(p.category || 'Public Infrastructure'),
          title: String(p.name || 'Facility'),
          subtitle: String(p.city || 'Delhi-NCR'),
          metrics: {
            Category: String(p.category || ''),
            Details: String(p.details || ''),
          },
        });
        setDrawerOpen(true);
      });

      // Click Area polygon
      map.on('click', 'area-fill', (e: { point: unknown; features?: Array<{ properties: Record<string, unknown> }> }) => {
        const hitPoints = map.queryRenderedFeatures(e.point, {
          layers: ['aqi-circles', 'infra-circles'],
        });
        if (hitPoints.length > 0) return;

        const p = e.features?.[0]?.properties;
        if (!p) return;
        const found = regionsRef.current.find((r) => r.code === p.code);
        if (found) {
          setSelectedPoint(null);
          setSelectedRegion(found);
          setDrawerOpen(true);
        } else {
          // Uploaded custom GeoJSON boundary feature
          const name = String(
            p.name || p.Ward_Name || p.WARD_NAME || p.AC_NAME || p.district || 'Custom Boundary'
          );
          setSelectedPoint({
            tag: 'Custom GeoJSON Feature',
            title: name,
            subtitle: 'Uploaded Boundary Polygon',
            metrics: p as Record<string, string | number>,
          });
          setDrawerOpen(true);
        }
      });

      ['aqi-circles', 'infra-circles', 'area-fill'].forEach((lyr) => {
        map.on('mouseenter', lyr, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', lyr, () => {
          map.getCanvas().style.cursor = '';
        });
      });
    });

    return () => {
      map.remove();
    };
  }, []);

  // Update polygons when regions or administrative level changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource('ncr-areas');
    if (src) {
      src.setData(buildRegionsGeoJSON(regions, level));
    }
  }, [regions, level]);

  // Update fill color when metric changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer('area-fill')) return;
    map.setPaintProperty('area-fill', 'fill-color', getFillColorExpression(metric));
  }, [metric]);

  // Update area opacity & visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer('area-fill')) return;
    map.setPaintProperty('area-fill', 'fill-opacity', areaOpacity);
    const vis = showAreaLayer ? 'visible' : 'none';
    map.setLayoutProperty('area-fill', 'visibility', vis);
    map.setLayoutProperty('area-outline', 'visibility', vis);
  }, [areaOpacity, showAreaLayer]);

  // Update AQI & Infra visibility and data
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource('aqi-points');
    if (src) src.setData(buildAqiGeoJSON(aqiStations));
    if (map.getLayer('aqi-circles')) {
      map.setLayoutProperty('aqi-circles', 'visibility', showAqiLayer ? 'visible' : 'none');
    }
    if (map.getLayer('infra-circles')) {
      map.setLayoutProperty('infra-circles', 'visibility', showInfraLayer ? 'visible' : 'none');
    }
  }, [aqiStations, showAqiLayer, showInfraLayer]);

  // Switch boundary level
  function handleSwitchLevel(newLevel: BoundaryLevel) {
    setLevel(newLevel);
    const firstInLevel = regions.find((r) => r.level === newLevel);
    if (firstInLevel) {
      setSelectedPoint(null);
      setSelectedRegion(firstInLevel);
    }
    mapRef.current?.flyTo({
      center: [77.21, 28.56],
      zoom: newLevel === 'district' ? 9.3 : newLevel === 'constituency' ? 10.1 : 10.8,
    });
  }

  // Toggle dark/light map style
  function handleToggleTheme() {
    const nextDark = !isDark;
    setIsDark(nextDark);
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(nextDark ? STYLES.dark : STYLES.light);
    map.once('styledata', () => {
      setupMapLayers(map);
    });
  }

  // Upload custom boundary GeoJSON file
  function handleBoundaryGeoJsonUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const geo = JSON.parse(String(ev.target?.result));
        const src = mapRef.current?.getSource('ncr-areas');
        if (src) {
          src.setData(geo);
          alert(
            `Loaded ${geo.features?.length || 0} custom boundary polygons from ${file.name}! Click any polygon on the map to inspect.`
          );
        }
      } catch {
        alert('Invalid GeoJSON file.');
      }
    };
    reader.readAsText(file);
  }

  // Fetch live CPCB AQI via Cloudflare Worker /api/datagov proxy
  async function handleFetchLiveAqi(useDemo = false) {
    setAqiStatus('Fetching via Cloudflare Worker /api/datagov...');
    try {
      const keyParam = useDemo ? 'demo' : apiKeyInput.trim() || 'demo';
      const res = await fetch(
        `/api/datagov?resource_id=3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69&api_key=${encodeURIComponent(
          keyParam
        )}`
      );
      const data = await res.json();
      const rawRecords: Array<Record<string, unknown>> = data.records || [];

      const ncrCities = [
        'delhi',
        'gurugram',
        'gurgaon',
        'faridabad',
        'noida',
        'greater noida',
        'ghaziabad',
      ];

      const grouped: Record<string, AqiStation> = {};
      for (const r of rawRecords) {
        const city = String(r.city || '').toLowerCase();
        if (!ncrCities.some((c) => city.includes(c))) continue;
        const lat = parseFloat(String(r.latitude ?? r.lat ?? ''));
        const lon = parseFloat(String(r.longitude ?? r.lon ?? ''));
        if (isNaN(lat) || isNaN(lon)) continue;
        const stName = String(r.station || 'NCR Station');

        if (!grouped[stName]) {
          grouped[stName] = {
            station: stName,
            city: String(r.city || 'NCR'),
            state: String(r.state || ''),
            lat,
            lon,
            pm25: Number(r.pm25 || r.avg_value || r.pollutant_avg || 240),
            pm10: Number(r.pm10 || 290),
            no2: Number(r.no2 || 48),
            updated: String(r.last_update || r.updated || 'Live Edge Proxy'),
          };
        } else {
          if (r.pollutant_id === 'PM2.5') {
            grouped[stName].pm25 = Number(r.avg_value || r.pollutant_avg);
          }
          if (r.pollutant_id === 'PM10') {
            grouped[stName].pm10 = Number(r.avg_value || r.pollutant_avg);
          }
        }
      }

      const list = Object.values(grouped);
      if (list.length > 0) {
        setAqiStations(list);
        setAqiStatus(
          `Loaded ${list.length} NCR stations (${data.source || 'Cloudflare Edge'})`
        );
      } else {
        setAqiStations(DEMO_AQI_STATIONS);
        setAqiStatus('Showing 8 NCR CPCB stations (Fallback)');
      }
    } catch {
      setAqiStations(DEMO_AQI_STATIONS);
      setAqiStatus('Showing 8 NCR CPCB stations (Offline Fallback)');
    }
  }

  // Add custom layer from Universal Importer
  function handleAddCustomLayer(layer: CustomLayer) {
    setCustomLayers((prev) => [...prev, layer]);
    const map = mapRef.current;
    if (!map) return;

    map.addSource(layer.id, { type: 'geojson', data: layer.geojson });
    if (layer.type === 'point') {
      map.addLayer({
        id: layer.id,
        type: 'circle',
        source: layer.id,
        paint: {
          'circle-radius': 7,
          'circle-color': layer.color,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
    } else {
      map.addLayer({
        id: layer.id,
        type: 'fill',
        source: layer.id,
        paint: {
          'fill-color': layer.color,
          'fill-opacity': 0.55,
        },
      });
    }

    map.on('click', layer.id, (e: { originalEvent: { stopPropagation: () => void }; features?: Array<{ properties: Record<string, unknown> }> }) => {
      e.originalEvent.stopPropagation();
      const p = e.features?.[0]?.properties;
      if (!p) return;
      setSelectedPoint({
        tag: `Custom Layer: ${layer.name}`,
        title: String(p._label || p.name || 'Imported Record'),
        subtitle: layer.metricLabel ? `Metric: ${layer.metricLabel}` : 'Custom Dataset',
        metrics: p as Record<string, string | number>,
      });
      setDrawerOpen(true);
    });
  }

  function toggleCustomLayer(id: string) {
    setCustomLayers((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const nextVis = !l.visible;
        if (mapRef.current?.getLayer(id)) {
          mapRef.current.setLayoutProperty(id, 'visibility', nextVis ? 'visible' : 'none');
        }
        return { ...l, visible: nextVis };
      })
    );
  }

  function removeCustomLayer(id: string) {
    const map = mapRef.current;
    if (map) {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    }
    setCustomLayers((prev) => prev.filter((l) => l.id !== id));
  }

  function exportCustomLayerGeoJSON(layer: CustomLayer) {
    const blob = new Blob([JSON.stringify(layer.geojson, null, 2)], {
      type: 'application/geo+json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${layer.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.geojson`;
    a.click();
  }

  // Publish Finding to Supabase PostgreSQL
  async function handlePublishInsight(e: FormEvent) {
    e.preventDefault();
    if (!selectedRegion || !noteTitle.trim() || !noteSummary.trim()) return;
    setPublishing(true);
    try {
      const { error } = await supabase.from('insights').insert([
        {
          region_code: selectedRegion.code,
          title: noteTitle.trim(),
          summary: noteSummary.trim(),
          author: noteAuthor.trim() || 'Civic Data Creator',
          metric,
        },
      ]);
      if (error) throw error;
      setNoteTitle('');
      setNoteSummary('');
      await syncFromSupabase();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to save insight to Supabase');
    } finally {
      setPublishing(false);
    }
  }

  // Quick search filter
  const searchResults =
    searchQuery.trim().length > 1
      ? regions.filter(
          (r) =>
            r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            r.state.toLowerCase().includes(searchQuery.toLowerCase()) ||
            r.code.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : [];

  // Compute NCR averages for active level for comparison chart
  const activeLevelRegions = regions.filter((r) => r.level === (selectedRegion?.level || level));
  const avgLiteracy =
    activeLevelRegions.reduce((acc, r) => acc + Number(r.literacy_rate), 0) /
    Math.max(activeLevelRegions.length, 1);
  const avgAqi =
    activeLevelRegions.reduce((acc, r) => acc + Number(r.aqi_pm25 || 220), 0) /
    Math.max(activeLevelRegions.length, 1);
  const avgGreen =
    activeLevelRegions.reduce((acc, r) => acc + Number(r.green_cover_pct || 18), 0) /
    Math.max(activeLevelRegions.length, 1);

  const regionInsights = insights.filter(
    (ins) => ins.region_code === selectedRegion?.code
  );

  const activeMetricCfg = METRIC_CONFIGS[metric];

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 text-slate-100 select-none">
      {/* Full-Bleed MapLibre Canvas */}
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Top Center Search & Studio Actions Bar */}
      <header className="fixed top-3 left-88 right-88 z-20 pointer-events-none flex items-center justify-between gap-3">
        {/* Search Box */}
        <div className="relative pointer-events-auto w-72">
          <div className="flex items-center bg-slate-900/95 backdrop-blur border border-slate-800 rounded-xl px-3 py-2 shadow-xl">
            <Search className="w-4 h-4 text-slate-400 mr-2 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Jump to NCR District, Ward, AC..."
              className="w-full bg-transparent text-xs text-white placeholder-slate-400 focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {searchResults.length > 0 && (
            <div className="absolute left-0 right-0 mt-1.5 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden max-h-60 overflow-y-auto">
              {searchResults.map((r) => (
                <button
                  key={r.code}
                  onClick={() => {
                    setLevel(r.level);
                    setSelectedPoint(null);
                    setSelectedRegion(r);
                    setDrawerOpen(true);
                    setSearchQuery('');
                    const center = getPolygonCenter(r.geojson);
                    mapRef.current?.flyTo({
                      center,
                      zoom: r.level === 'ward' ? 12 : r.level === 'constituency' ? 10.8 : 10,
                    });
                  }}
                  className="w-full text-left px-3.5 py-2 hover:bg-slate-800 flex items-center justify-between text-xs cursor-pointer border-b border-slate-800/60 last:border-none"
                >
                  <span className="font-medium text-white">{r.name}</span>
                  <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                    {r.level}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Studio Action Buttons */}
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            onClick={() => setIsImporterOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xl transition cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Add Data Layer (.XLSX / .CSV / API)
          </button>

          <button
            onClick={() => setIsCompareOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900/95 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-medium shadow-xl transition cursor-pointer"
          >
            <ArrowLeftRight className="w-3.5 h-3.5 text-sky-400" /> Compare 2 Areas
          </button>

          <button
            onClick={() => setIsCreatorOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900/95 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-medium shadow-xl transition cursor-pointer"
          >
            <Award className="w-3.5 h-3.5 text-amber-400" /> Creator Studio ({insights.length})
          </button>

          <button
            onClick={handleToggleTheme}
            className="p-2 rounded-xl bg-slate-900/95 hover:bg-slate-800 border border-slate-800 text-slate-200 shadow-xl transition cursor-pointer"
            title="Toggle Dark / Light Basemap"
          >
            {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-sky-400" />}
          </button>
        </div>
      </header>

      {/* Left Sidebar: Layer Manager */}
      <aside className="fixed top-3 left-3 bottom-3 w-80 bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-2xl shadow-2xl z-20 flex flex-col overflow-hidden">
        {/* Brand Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="font-bold text-base tracking-tight text-white">
                IndiaData<span className="text-emerald-400">.viz</span>
              </h1>
              <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                NCR Studio
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
              <Database className="w-3 h-3 text-emerald-400" />
              {dbSynced ? 'Supabase PostGIS Live' : 'Local NCR GeoJSON Active'}
            </p>
          </div>
          <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-emerald-400 border border-slate-700">
            <CheckCircle2 className="w-3 h-3" /> {regions.length} Polygons
          </span>
        </div>

        {/* Layer Controls Scroll Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
          {/* 1. Map Administrative Hierarchy */}
          <section className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-emerald-400" /> 1. Boundary Hierarchy
            </label>
            <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
              {(['district', 'constituency', 'ward'] as BoundaryLevel[]).map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => handleSwitchLevel(lvl)}
                  className={`py-1.5 rounded-lg text-[11px] font-medium capitalize transition cursor-pointer ${
                    level === lvl
                      ? 'bg-emerald-600 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {lvl === 'constituency' ? 'AC / PC' : `${lvl}s`}
                </button>
              ))}
            </div>

            <div className="pt-1">
              <label className="flex items-center justify-center gap-1.5 w-full py-1.5 px-2.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 text-[11px] cursor-pointer transition">
                <Upload className="w-3.5 h-3.5 text-emerald-400" />
                <span>Load Custom GeoJSON Boundary (Bharatlas)</span>
                <input
                  type="file"
                  accept=".geojson,.json"
                  onChange={handleBoundaryGeoJsonUpload}
                  className="hidden"
                />
              </label>
            </div>
          </section>

          {/* 2. Census & Civic Choropleth Layer */}
          <section className="border-t border-slate-800 pt-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                2. Choropleth Layer (Census &amp; Civic)
              </label>
              <input
                type="checkbox"
                checked={showAreaLayer}
                onChange={(e) => setShowAreaLayer(e.target.checked)}
                className="accent-emerald-500 w-4 h-4 cursor-pointer"
              />
            </div>

            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as MetricKey)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white font-medium"
            >
              {Object.values(METRIC_CONFIGS).map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>

            {/* Dynamic Color Ramp Legend */}
            <div className="space-y-1 pt-1">
              <div
                className="h-2.5 rounded-full w-full"
                style={{
                  background: `linear-gradient(to right, ${activeMetricCfg.stops[0][1]}, ${activeMetricCfg.stops[1][1]}, ${activeMetricCfg.stops[2][1]})`,
                }}
              />
              <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                <span>
                  {activeMetricCfg.stops[0][0].toLocaleString('en-IN')} {activeMetricCfg.unit}
                </span>
                <span>
                  {activeMetricCfg.stops[1][0].toLocaleString('en-IN')} {activeMetricCfg.unit}
                </span>
                <span>
                  {activeMetricCfg.stops[2][0].toLocaleString('en-IN')} {activeMetricCfg.unit}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1 text-[11px] text-slate-400">
              <span>Polygon Opacity</span>
              <input
                type="range"
                min={0.1}
                max={0.9}
                step={0.05}
                value={areaOpacity}
                onChange={(e) => setAreaOpacity(parseFloat(e.target.value))}
                className="w-36 accent-emerald-500 cursor-pointer"
              />
            </div>
          </section>

          {/* 3. Live CPCB Air Quality Layer (data.gov.in) */}
          <section className="border-t border-slate-800 pt-4 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Wind className="w-3.5 h-3.5 text-amber-400" /> 3. Live CPCB AQI (data.gov.in)
              </label>
              <input
                type="checkbox"
                checked={showAqiLayer}
                onChange={(e) => setShowAqiLayer(e.target.checked)}
                className="accent-emerald-500 w-4 h-4 cursor-pointer"
              />
            </div>

            <input
              type="text"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="Optional data.gov.in API key..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
            />

            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => handleFetchLiveAqi(false)}
                className="py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium transition cursor-pointer"
              >
                Fetch Edge API
              </button>
              <button
                onClick={() => handleFetchLiveAqi(true)}
                className="py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
              >
                Reset Preset
              </button>
            </div>
            <p className="text-[10px] text-slate-400">{aqiStatus}</p>
          </section>

          {/* 4. Public Infrastructure Point Layer */}
          <section className="border-t border-slate-800 pt-4 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-sky-400" /> 4. Public Infra (Metro &amp; Hospitals)
              </label>
              <input
                type="checkbox"
                checked={showInfraLayer}
                onChange={(e) => setShowInfraLayer(e.target.checked)}
                className="accent-emerald-500 w-4 h-4 cursor-pointer"
              />
            </div>
            <p className="text-[11px] text-slate-400">
              Displays {PUBLIC_INFRA_POINTS.length} major NCR hospitals &amp; metro interchanges.
            </p>
          </section>

          {/* 5. User Imported Layers */}
          <section className="border-t border-slate-800 pt-4 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                5. Imported Custom Layers ({customLayers.length})
              </label>
              <button
                onClick={() => setIsImporterOpen(true)}
                className="text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold cursor-pointer"
              >
                + Import File/API
              </button>
            </div>

            {customLayers.length === 0 ? (
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 text-[11px] text-slate-400">
                No custom layers yet. Click <strong>+ Import File/API</strong> to plot any{' '}
                <code>.xlsx</code>, <code>.csv</code>, or <code>data.gov.in</code> dataset!
              </div>
            ) : (
              <div className="space-y-1.5">
                {customLayers.map((lyr) => (
                  <div
                    key={lyr.id}
                    className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: lyr.color }}
                      />
                      <div className="truncate">
                        <div className="text-xs font-medium text-white truncate">
                          {lyr.name}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {lyr.type === 'point' ? 'Point Layer' : 'Fuzzy Choropleth'} •{' '}
                          {lyr.featureCount} features
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => exportCustomLayerGeoJSON(lyr)}
                        className="p-1 text-slate-400 hover:text-emerald-400 cursor-pointer"
                        title="Export Joined GeoJSON"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => toggleCustomLayer(lyr.id)}
                        className="p-1 text-slate-400 hover:text-white cursor-pointer"
                        title="Toggle visibility"
                      >
                        {lyr.visible ? (
                          <Eye className="w-3.5 h-3.5" />
                        ) : (
                          <EyeOff className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => removeCustomLayer(lyr.id)}
                        className="p-1 text-slate-400 hover:text-red-400 cursor-pointer"
                        title="Remove layer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>

      {/* Right Sidebar: Interactive Insights & Creator Publishing Drawer */}
      {drawerOpen && (selectedRegion || selectedPoint) && (
        <aside className="fixed top-3 right-3 bottom-3 w-84 bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-2xl shadow-2xl z-20 flex flex-col overflow-hidden">
          {selectedPoint ? (
            <>
              <div className="p-4 border-b border-slate-800 flex items-start justify-between gap-2">
                <div>
                  <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-sky-500/20 text-sky-300">
                    {selectedPoint.tag}
                  </span>
                  <h2 className="font-bold text-base text-white mt-1">
                    {selectedPoint.title}
                  </h2>
                  <p className="text-xs text-slate-400">{selectedPoint.subtitle}</p>
                </div>
                <button
                  onClick={() => setSelectedPoint(null)}
                  className="text-slate-400 hover:text-white p-1 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 flex-1 overflow-y-auto space-y-3 text-xs">
                {Object.entries(selectedPoint.metrics).map(([k, v]) => (
                  <div
                    key={k}
                    className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex justify-between gap-2"
                  >
                    <span className="text-slate-400">{k}</span>
                    <span className="font-mono text-white font-medium text-right">
                      {String(v)}
                    </span>
                  </div>
                ))}
                <button
                  onClick={() => setSelectedPoint(null)}
                  className="w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-emerald-400 font-medium cursor-pointer"
                >
                  &larr; Back to Region Inspector
                </button>
              </div>
            </>
          ) : (
            selectedRegion && (
              <>
                {/* Region Header */}
                <div className="p-4 border-b border-slate-800 flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                        {selectedRegion.level}
                      </span>
                      <span className="text-xs text-slate-400">{selectedRegion.state}</span>
                    </div>
                    <h2 className="font-bold text-base text-white mt-1">
                      {selectedRegion.name}
                    </h2>
                  </div>
                  <button
                    onClick={() => setDrawerOpen(false)}
                    className="text-slate-400 hover:text-white p-1 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Metrics & Comparison Chart */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400">Population</div>
                      <div className="text-sm font-bold text-white mt-0.5 font-mono">
                        {Number(selectedRegion.population).toLocaleString('en-IN')}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400">Density (/km²)</div>
                      <div className="text-sm font-bold text-sky-400 mt-0.5 font-mono">
                        {Number(selectedRegion.density).toLocaleString('en-IN')}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400">Literacy Rate</div>
                      <div className="text-sm font-bold text-emerald-400 mt-0.5 font-mono">
                        {selectedRegion.literacy_rate}%
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400">Avg PM2.5 AQI</div>
                      <div className="text-sm font-bold text-amber-400 mt-0.5 font-mono">
                        {selectedRegion.aqi_pm25 ?? 220} µg/m³
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400">Hospitals &amp; Clinics</div>
                      <div className="text-sm font-bold text-white mt-0.5 font-mono">
                        {selectedRegion.hospitals_count}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400">Schools (UDISE+)</div>
                      <div className="text-sm font-bold text-white mt-0.5 font-mono">
                        {selectedRegion.schools_count}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400">Green Cover</div>
                      <div className="text-sm font-bold text-emerald-400 mt-0.5 font-mono">
                        {selectedRegion.green_cover_pct}%
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400">Circle Rate</div>
                      <div className="text-sm font-bold text-purple-400 mt-0.5 font-mono">
                        ₹{Number(selectedRegion.avg_circle_rate).toLocaleString('en-IN')}/sq.ft
                      </div>
                    </div>
                  </div>

                  {/* Visual Benchmark vs NCR Average */}
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                    <div className="text-[11px] font-semibold text-slate-300">
                      Benchmark vs. NCR {selectedRegion.level} Average
                    </div>

                    <div>
                      <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                        <span>Literacy ({selectedRegion.literacy_rate}%)</span>
                        <span>NCR Avg: {avgLiteracy.toFixed(1)}%</span>
                      </div>
                      <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full"
                          style={{
                            width: `${Math.min(Number(selectedRegion.literacy_rate), 100)}%`,
                          }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                        <span>Green Cover ({selectedRegion.green_cover_pct}%)</span>
                        <span>NCR Avg: {avgGreen.toFixed(1)}%</span>
                      </div>
                      <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-teal-400 rounded-full"
                          style={{
                            width: `${Math.min(Number(selectedRegion.green_cover_pct) * 2.5, 100)}%`,
                          }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                        <span>PM2.5 Load ({selectedRegion.aqi_pm25 ?? 220})</span>
                        <span>NCR Avg: {avgAqi.toFixed(0)}</span>
                      </div>
                      <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500 rounded-full"
                          style={{
                            width: `${Math.min(((selectedRegion.aqi_pm25 ?? 220) / 400) * 100, 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Published Insights for this Region from Supabase */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Region Data Stories ({regionInsights.length})
                      </span>
                      <button
                        onClick={() => setIsCreatorOpen(true)}
                        className="text-[11px] text-emerald-400 hover:underline cursor-pointer"
                      >
                        View All
                      </button>
                    </div>

                    {regionInsights.length === 0 ? (
                      <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 text-[11px] text-slate-400">
                        No stories published for {selectedRegion.name} yet. Be the first creator
                        below!
                      </div>
                    ) : (
                      regionInsights.map((ins) => (
                        <div
                          key={ins.id}
                          className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1"
                        >
                          <div className="font-semibold text-white text-xs">{ins.title}</div>
                          <p className="text-[11px] text-slate-300 leading-relaxed">
                            {ins.summary}
                          </p>
                          <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1">
                            <span>By {ins.author}</span>
                            <button
                              onClick={() => {
                                const url = `${window.location.origin}/?region=${selectedRegion.code}&insight=${ins.id}`;
                                navigator.clipboard?.writeText(url);
                                alert(`Copied shareable link:\n${url}`);
                              }}
                              className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
                            >
                              <Share2 className="w-3 h-3" /> Share
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Publish Finding Form (Saves directly to Supabase Postgres) */}
                <form
                  onSubmit={handlePublishInsight}
                  className="p-3.5 border-t border-slate-800 bg-slate-950/90 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-emerald-400">
                      Publish Data Story to Postgres
                    </span>
                    <span className="text-[10px] text-slate-400">Earns Creator Revenue</span>
                  </div>
                  <input
                    type="text"
                    required
                    minLength={3}
                    value={noteTitle}
                    onChange={(e) => setNoteTitle(e.target.value)}
                    placeholder={`Finding title for ${selectedRegion.name}...`}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                  <textarea
                    rows={2}
                    required
                    minLength={5}
                    value={noteSummary}
                    onChange={(e) => setNoteSummary(e.target.value)}
                    placeholder="Explain correlation across active map layers..."
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={noteAuthor}
                      onChange={(e) => setNoteAuthor(e.target.value)}
                      placeholder="Your creator name"
                      className="w-1/2 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                    <button
                      type="submit"
                      disabled={publishing}
                      className="w-1/2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold py-1.5 rounded-lg transition cursor-pointer"
                    >
                      {publishing ? 'Publishing...' : 'Publish Story'}
                    </button>
                  </div>
                </form>
              </>
            )
          )}
        </aside>
      )}

      {/* Re-open Drawer Pill if closed */}
      {!drawerOpen && (
        <button
          onClick={() => setDrawerOpen(true)}
          className="fixed top-16 right-4 z-20 px-3 py-2 rounded-xl bg-slate-900/95 border border-slate-800 text-xs font-medium text-emerald-400 shadow-xl cursor-pointer"
        >
          Open Region Inspector &larr;
        </button>
      )}

      {/* Modals */}
      <DataImporterModal
        isOpen={isImporterOpen}
        onClose={() => setIsImporterOpen(false)}
        regions={regions}
        onAddLayer={handleAddCustomLayer}
      />

      <CompareModal
        isOpen={isCompareOpen}
        onClose={() => setIsCompareOpen(false)}
        regions={regions}
      />

      <CreatorStudioModal
        isOpen={isCreatorOpen}
        onClose={() => setIsCreatorOpen(false)}
        insights={insights}
        regions={regions}
      />
    </div>
  );
}
