import { useEffect, useRef, useState, FormEvent, ChangeEvent } from 'react';
import { supabase } from './lib/supabase';
import {
  BoundaryLevel,
  MetricKey,
  METRIC_CONFIGS,
  VIRIDIS_TEAL_AMBER,
  Region,
  Insight,
  AqiStation,
  AqiDisplayMode,
  FocusHubKey,
  CustomLayer,
  CommunityCatalogLayer,
  sanitizeText,
} from './types';
import {
  FOCUS_NCR_HUBS,
  AQI_DATES,
  DEMO_AQI_BY_DATE,
  DEMO_AQI_STATIONS,
  PUBLIC_INFRA_POINTS,
} from './data/ncrDefaults';
import DataImporterModal from './components/DataImporterModal';
import CompareModal from './components/CompareModal';
import CreatorStudioModal from './components/CreatorStudioModal';
import { BenchmarkChart, TimeSeriesTrendChart } from './components/CivicCharts';
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
  Database,
  CheckCircle2,
  Download,
  ShieldCheck,
  ExternalLink,
  Navigation,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Sparkles,
  Info,
} from 'lucide-react';

interface MapLibreMap {
  addControl: (ctrl: unknown, pos?: string) => void;
  on: (event: string, layerOrCb: unknown, cb?: unknown) => void;
  once: (event: string, cb: () => void) => void;
  getSource: (id: string) =>
    | {
        setData?: (data: unknown) => void;
        updateImage?: (opts: { url: string; coordinates: number[][] }) => void;
      }
    | undefined;
  addSource: (id: string, spec: unknown) => void;
  getLayer: (id: string) => unknown;
  addLayer: (spec: unknown, beforeId?: string) => void;
  removeLayer: (id: string) => void;
  removeSource: (id: string) => void;
  setPaintProperty: (layerId: string, prop: string, val: unknown) => void;
  setLayoutProperty: (layerId: string, prop: string, val: unknown) => void;
  setStyle: (styleUrl: string) => void;
  flyTo: (opts: { center: [number, number]; zoom: number; duration?: number }) => void;
  getCenter: () => { lng: number; lat: number };
  getZoom: () => number;
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

const BOUNDARY_FILES: Record<BoundaryLevel, string> = {
  district: '/boundaries/districts.geojson',
  constituency: '/boundaries/constituencies.geojson',
  assembly: '/boundaries/assemblies.geojson',
  ward: '/boundaries/wards.geojson',
};

const IDW_BOUNDS: [[number, number], [number, number], [number, number], [number, number]] = [
  [76.15, 29.35], // top-left [lng, lat]
  [78.05, 29.35], // top-right
  [78.05, 27.75], // bottom-right
  [76.15, 27.75], // bottom-left
];

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeometry(
  lon: number,
  lat: number,
  geom: Record<string, unknown> | null | undefined
): boolean {
  if (!geom) return false;
  if (geom.type === 'Polygon') {
    const coords = geom.coordinates as number[][][];
    return coords?.[0] ? pointInRing(lon, lat, coords[0]) : false;
  }
  if (geom.type === 'MultiPolygon') {
    const polys = geom.coordinates as number[][][][];
    return polys.some((p) => p?.[0] && pointInRing(lon, lat, p[0]));
  }
  return false;
}

function getPolygonCenter(region: Region | null | undefined): [number, number] {
  if (region?.center && Array.isArray(region.center) && region.center.length === 2) {
    return [Number(region.center[0]), Number(region.center[1])];
  }
  try {
    const geom = region?.geojson as {
      type?: string;
      coordinates?: number[][][] | number[][][][];
    };
    const ring =
      geom?.type === 'MultiPolygon'
        ? (geom.coordinates as number[][][][])?.[0]?.[0]
        : (geom?.coordinates as number[][][])?.[0];
    if (!ring || ring.length === 0) return [77.209, 28.6139];
    let sumLon = 0;
    let sumLat = 0;
    for (const pt of ring) {
      sumLon += pt[0];
      sumLat += pt[1];
    }
    return [sumLon / ring.length, sumLat / ring.length];
  } catch {
    return [77.209, 28.6139];
  }
}

function pm25ToRgb(pm25: number): [number, number, number] {
  if (pm25 <= 90) return [34, 197, 94]; // Green
  if (pm25 <= 170) return [234, 179, 8]; // Yellow
  if (pm25 <= 250) return [249, 115, 22]; // Orange
  return [239, 68, 68]; // Red
}

// Render client-side Inverse Distance Weighting (1/d^2) continuous AQI field to DataURL
function renderIdwCanvasDataUrl(stations: AqiStation[]): string {
  const width = 180;
  const height = 160;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx || stations.length === 0) return '';

  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  const minLng = 76.15;
  const maxLng = 78.05;
  const maxLat = 29.35;
  const minLat = 27.75;

  for (let y = 0; y < height; y++) {
    const lat = maxLat - (y / (height - 1)) * (maxLat - minLat);
    for (let x = 0; x < width; x++) {
      const lng = minLng + (x / (width - 1)) * (maxLng - minLng);

      let weightSum = 0;
      let valSum = 0;
      let minDistKm = 9999;

      for (const s of stations) {
        const dKm = Math.max(0.35, haversineKm(lat, lng, s.lat, s.lon));
        if (dKm < minDistKm) minDistKm = dKm;
        const w = 1 / (dKm * dKm);
        weightSum += w;
        valSum += w * s.pm25;
      }

      const idx = (y * width + x) * 4;
      // Fade alpha gracefully to transparent beyond ~18 km from any sensor
      if (minDistKm > 20 || weightSum === 0) {
        data[idx + 3] = 0;
        continue;
      }

      const idwPm25 = valSum / weightSum;
      const [r, g, b] = pm25ToRgb(idwPm25);
      const fade = minDistKm <= 10 ? 1 : Math.max(0, 1 - (minDistKm - 10) / 10);
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = Math.round(fade * 145);
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}

export default function App() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  // Dynamic Regions (fetched from Supabase boundary_features + /boundaries/*.geojson — zero hardcoded geometry)
  const [regionsByLevel, setRegionsByLevel] = useState<Record<BoundaryLevel, Region[]>>({
    district: [],
    constituency: [],
    assembly: [],
    ward: [],
  });
  const [loadingTier, setLoadingTier] = useState<boolean>(true);
  const [dbSynced, setDbSynced] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Current Location District detection & Focus Hub state (Defaults to Current Location District, NOT whole NCR)
  const [currentDistrictCode, setCurrentDistrictCode] = useState<string>('dl-nct');
  const [currentDistrictName, setCurrentDistrictName] = useState<string>('NCT of Delhi');
  const [locationDetected, setLocationDetected] = useState<boolean>(false);
  const [focusHub, setFocusHub] = useState<FocusHubKey>('current');

  // Map & Layer controls
  const [isDark, setIsDark] = useState<boolean>(true);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [level, setLevel] = useState<BoundaryLevel>('district');
  const [metric, setMetric] = useState<MetricKey>('population_density');
  const [showAreaLayer, setShowAreaLayer] = useState<boolean>(true);
  const [areaOpacity, setAreaOpacity] = useState<number>(0.68);
  const [customBoundaryOverride, setCustomBoundaryOverride] = useState<{
    name: string;
    geojson: Record<string, unknown>;
  } | null>(null);

  // CPCB Multi-Date AQI + IDW Blended Field state
  const [showAqiLayer, setShowAqiLayer] = useState<boolean>(true);
  const [aqiDate, setAqiDate] = useState<string>(AQI_DATES[AQI_DATES.length - 1]);
  const [aqiMode, setAqiMode] = useState<AqiDisplayMode>('both');
  const [liveAqiOverride, setLiveAqiOverride] = useState<AqiStation[] | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [aqiStatus, setAqiStatus] = useState<string>(
    'CPCB Multi-Date NCR Stations + IDW Field'
  );

  // Infrastructure & Community Layers
  const [showInfraLayer, setShowInfraLayer] = useState<boolean>(true);
  const [customLayers, setCustomLayers] = useState<CustomLayer[]>([]);
  const [activeChoroplethLayerId, setActiveChoroplethLayerId] = useState<string | null>(
    null
  );
  const [catalogLayers, setCatalogLayers] = useState<CommunityCatalogLayer[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);

  // Search, Modals & Right Insights Drawer
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isImporterOpen, setIsImporterOpen] = useState<boolean>(false);
  const [isCompareOpen, setIsCompareOpen] = useState<boolean>(false);
  const [isCreatorOpen, setIsCreatorOpen] = useState<boolean>(false);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<{
    tag: string;
    title: string;
    subtitle: string;
    metrics: Record<string, string | number>;
  } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(true);
  const [chartMode, setChartMode] = useState<'radar' | 'bar'>('radar');

  // Publish Story form inside Drawer
  const [noteTitle, setNoteTitle] = useState<string>('');
  const [noteSummary, setNoteSummary] = useState<string>('');
  const [noteAuthor, setNoteAuthor] = useState<string>('');
  const [publishing, setPublishing] = useState<boolean>(false);

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 4000);
  }

  const allRegions: Region[] = [
    ...regionsByLevel.district,
    ...regionsByLevel.constituency,
    ...regionsByLevel.assembly,
    ...regionsByLevel.ward,
  ];

  const activeAqiStations: AqiStation[] =
    liveAqiOverride || DEMO_AQI_BY_DATE[aqiDate] || DEMO_AQI_STATIONS;

  const activeCustomChoropleth = customLayers.find(
    (l) => l.id === activeChoroplethLayerId && l.type === 'choropleth' && l.visible
  );

  // Convert GeoJSON FeatureCollection into Region[]
  function parseGeoJsonFeatures(
    fc: { features?: Array<{ properties?: Record<string, unknown>; geometry?: Record<string, unknown> }> },
    fallbackLevel: BoundaryLevel
  ): Region[] {
    return (fc.features || []).map((f, idx) => {
      const p = (f.properties || {}) as Record<string, unknown>;
      const popDensity = Number(p.population_density ?? p.density ?? 2500);
      return {
        code: String(p.code || `${fallbackLevel}-${idx + 1}`),
        name: String(
          p.name ||
            p.Ward_Name ||
            p.ac_name ||
            p.pc_name ||
            p.dtname ||
            `Zone ${idx + 1}`
        ),
        state: String(p.state || p.st_name || 'NCT of Delhi'),
        parent_region: String(p.parent_region || p.district_name || p.state || 'NCT of Delhi'),
        district_name: p.district_name ? String(p.district_name) : undefined,
        pc_name: p.pc_name ? String(p.pc_name) : undefined,
        ac_no: p.ac_no ? Number(p.ac_no) : undefined,
        ward_no: p.ward_no ? String(p.ward_no) : undefined,
        ulb_name: p.ulb_name ? String(p.ulb_name) : undefined,
        level: (p.level as BoundaryLevel) || fallbackLevel,
        area_sq_km: Number(p.area_sq_km || 25),
        population: Number(p.population || 150000),
        population_density: popDensity,
        density: popDensity,
        literacy_rate: Number(p.literacy_rate || 84.5),
        sex_ratio: Number(p.sex_ratio || 868),
        green_cover_pct: Number(p.green_cover_pct || 18.0),
        hospitals_count: Number(p.hospitals_count || 6),
        schools_count: Number(p.schools_count || 45),
        avg_circle_rate: Number(p.avg_circle_rate || 12500),
        aqi_pm25: Number(p.aqi_pm25 || 245),
        rep_name: p.rep_name ? String(p.rep_name) : null,
        rep_role: p.rep_role ? String(p.rep_role) : null,
        rep_party: p.rep_party ? String(p.rep_party) : null,
        rep_term: p.rep_term ? String(p.rep_term) : null,
        rep_votes: p.rep_votes ? Number(p.rep_votes) : null,
        rep_source_label: p.rep_source_label ? String(p.rep_source_label) : null,
        rep_source_url: p.rep_source_url ? String(p.rep_source_url) : null,
        rep_affidavit_url: p.rep_affidavit_url ? String(p.rep_affidavit_url) : null,
        boundary_source_label: p.boundary_source_label
          ? String(p.boundary_source_label)
          : null,
        boundary_source_url: p.boundary_source_url ? String(p.boundary_source_url) : null,
        data_source_label: p.data_source_label ? String(p.data_source_label) : null,
        data_source_url: p.data_source_url ? String(p.data_source_url) : null,
        center: Array.isArray(p.center)
          ? [Number(p.center[0]), Number(p.center[1])]
          : undefined,
        geojson: f.geometry || null,
      };
    });
  }

  // Lazy-load boundary tier from Supabase PostgreSQL (`boundary_features`) with `/boundaries/*.geojson` edge asset fallback
  async function ensureBoundaryTierLoaded(targetTier: BoundaryLevel): Promise<Region[]> {
    if (regionsByLevel[targetTier].length > 0) {
      return regionsByLevel[targetTier];
    }
    setLoadingTier(true);
    try {
      // 1. Try Supabase PostgreSQL `boundary_features` first
      const { data: sbRows, error } = await supabase
        .from('boundary_features')
        .select('*')
        .eq('level', targetTier);

      if (!error && sbRows && sbRows.length > 0) {
        const parsed: Region[] = sbRows.map((r: Record<string, unknown>) => ({
          code: String(r.code),
          name: String(r.name),
          state: String(r.state),
          parent_region: String(r.parent_region || r.state),
          level: r.level as BoundaryLevel,
          area_sq_km: Number(r.area_sq_km || 0),
          population: Number(r.population || 0),
          population_density: Number(r.population_density || 0),
          density: Number(r.population_density || 0),
          literacy_rate: Number(r.literacy_rate || 84),
          sex_ratio: Number(r.sex_ratio || 868),
          green_cover_pct: Number(r.green_cover_pct || 18),
          hospitals_count: Number(r.hospitals_count || 5),
          schools_count: Number(r.schools_count || 40),
          avg_circle_rate: Number(r.avg_circle_rate || 12000),
          aqi_pm25: Number(r.aqi_pm25 || 240),
          rep_name: r.rep_name ? String(r.rep_name) : null,
          rep_role: r.rep_role ? String(r.rep_role) : null,
          rep_party: r.rep_party ? String(r.rep_party) : null,
          rep_term: r.rep_term ? String(r.rep_term) : null,
          rep_votes: r.rep_votes ? Number(r.rep_votes) : null,
          rep_source_label: r.rep_source_label ? String(r.rep_source_label) : null,
          rep_source_url: r.rep_source_url ? String(r.rep_source_url) : null,
          rep_affidavit_url: r.rep_affidavit_url ? String(r.rep_affidavit_url) : null,
          boundary_source_label: r.boundary_source_label
            ? String(r.boundary_source_label)
            : null,
          boundary_source_url: r.boundary_source_url
            ? String(r.boundary_source_url)
            : null,
          data_source_label: r.data_source_label ? String(r.data_source_label) : null,
          data_source_url: r.data_source_url ? String(r.data_source_url) : null,
          center: Array.isArray(r.center)
            ? [Number(r.center[0]), Number(r.center[1])]
            : undefined,
          geojson: (r.geojson as Record<string, unknown>) || null,
        }));
        setRegionsByLevel((prev) => ({ ...prev, [targetTier]: parsed }));
        setDbSynced(true);
        return parsed;
      }

      // 2. Fallback to static GeoJSON in `/boundaries/*.geojson`
      const res = await fetch(BOUNDARY_FILES[targetTier]);
      const fc = await res.json();
      const parsed = parseGeoJsonFeatures(fc, targetTier);
      setRegionsByLevel((prev) => ({ ...prev, [targetTier]: parsed }));
      return parsed;
    } catch {
      return [];
    } finally {
      setLoadingTier(false);
    }
  }

  // Fetch Community Catalog & Insights from Supabase PostgreSQL
  async function syncCatalogAndInsights() {
    try {
      const [catRes, insRes] = await Promise.all([
        supabase
          .from('community_layers')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase.from('insights').select('*').order('created_at', { ascending: false }),
      ]);
      if (!catRes.error && catRes.data) {
        setCatalogLayers(catRes.data as CommunityCatalogLayer[]);
      }
      if (!insRes.error && insRes.data) {
        setInsights(insRes.data as Insight[]);
      }
    } catch {
      // Keep current state
    }
  }

  // Initial Boot: Load Districts + Detect Current Location District by Default + Preload Catalog
  useEffect(() => {
    let mounted = true;
    async function boot() {
      syncCatalogAndInsights();
      const districts = await ensureBoundaryTierLoaded('district');
      if (!mounted || districts.length === 0) return;

      const defaultDist =
        districts.find((d) => d.code === 'dl-nct') || districts[0];
      setSelectedRegion(defaultDist);
      setCurrentDistrictCode(defaultDist.code);
      setCurrentDistrictName(defaultDist.name);

      // Detect user's current district via Geolocation + Point-in-Polygon check
      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (!mounted) return;
            const { longitude, latitude } = pos.coords;
            let matchedDist = districts.find((d) =>
              pointInGeometry(longitude, latitude, d.geojson)
            );
            if (!matchedDist) {
              // Find closest NCR district center if within 80 km
              let bestDist = Infinity;
              for (const d of districts) {
                const [cLng, cLat] = getPolygonCenter(d);
                const distKm = haversineKm(latitude, longitude, cLat, cLng);
                if (distKm < bestDist) {
                  bestDist = distKm;
                  if (distKm <= 80) matchedDist = d;
                }
              }
            }
            const chosen = matchedDist || defaultDist;
            setCurrentDistrictCode(chosen.code);
            setCurrentDistrictName(chosen.name);
            setLocationDetected(Boolean(matchedDist));
            setSelectedRegion(chosen);
            setFocusHub('current');
            const center = getPolygonCenter(chosen);
            mapRef.current?.flyTo({ center, zoom: 10.35, duration: 1200 });
          },
          () => {
            // Geolocation permission declined -> stay focused on default current district (NCT of Delhi)
            const center = getPolygonCenter(defaultDist);
            mapRef.current?.flyTo({ center, zoom: 10.35, duration: 900 });
          },
          { timeout: 5000, maximumAge: 60000 }
        );
      }

      // Background-warm other tiers so switching & Zero-GeoJSON upload auto-detection have all 740 polygons ready
      setTimeout(async () => {
        for (const t of ['constituency', 'assembly', 'ward'] as BoundaryLevel[]) {
          await ensureBoundaryTierLoaded(t);
        }
      }, 600);
    }
    boot();
    return () => {
      mounted = false;
    };
  }, []);

  // Filter regions according to active Focus Hub (by default 'current' shows only the current location district!)
  function getVisibleTierRegions(
    tierRegions: Region[],
    activeLevel: BoundaryLevel,
    activeFocus: FocusHubKey,
    currDistCode: string
  ): Region[] {
    if (activeFocus === 'all') return tierRegions;

    const targetDistCode = activeFocus === 'current' ? currDistCode : activeFocus;
    const hubCfg = FOCUS_NCR_HUBS.find((h) => h.key === targetDistCode);
    const parentTarget = (hubCfg?.parentMatch || 'NCT of Delhi').toLowerCase();

    if (activeLevel === 'district') {
      const exact = tierRegions.filter((r) => r.code === targetDistCode);
      return exact.length > 0 ? exact : tierRegions;
    }

    const scoped = tierRegions.filter((r) => {
      const p = (r.parent_region || r.district_name || r.state || '').toLowerCase();
      return p.includes(parentTarget) || parentTarget.includes(p);
    });
    return scoped.length > 0 ? scoped : tierRegions;
  }

  // Build GeoJSON FeatureCollection for MapLibre source
  function buildRegionsGeoJSON(
    tierRegions: Region[],
    activeLevel: BoundaryLevel,
    activeFocus: FocusHubKey,
    currDistCode: string,
    customChoro: CustomLayer | undefined
  ) {
    if (customBoundaryOverride) {
      return customBoundaryOverride.geojson;
    }

    const filtered = getVisibleTierRegions(
      tierRegions,
      activeLevel,
      activeFocus,
      currDistCode
    );

    const activeDate = customChoro?.activeDate || '';
    const compareDate = customChoro?.compareDate || '';
    const showDelta = Boolean(customChoro?.showDelta && compareDate && activeDate);
    const dateMap =
      (activeDate && customChoro?.choroplethByDate?.[activeDate]) || {};
    const baseMap =
      (compareDate && customChoro?.choroplethByDate?.[compareDate]) || {};

    return {
      type: 'FeatureCollection',
      features: filtered
        .filter((r) => r.geojson)
        .map((r) => {
          const curVal = dateMap[r.code];
          const prevVal = baseMap[r.code];
          const customVal =
            curVal !== undefined
              ? showDelta && prevVal !== undefined
                ? Number((curVal - prevVal).toFixed(2))
                : curVal
              : null;

          return {
            type: 'Feature',
            properties: {
              code: r.code,
              name: r.name,
              state: r.state,
              parent_region: r.parent_region || r.state,
              level: r.level,
              area_sq_km: Number(r.area_sq_km || 0),
              population: Number(r.population),
              population_density: Number(r.population_density || r.density),
              density: Number(r.population_density || r.density),
              literacy_rate: Number(r.literacy_rate),
              sex_ratio: Number(r.sex_ratio),
              green_cover_pct: Number(r.green_cover_pct),
              hospitals_count: Number(r.hospitals_count),
              schools_count: Number(r.schools_count),
              avg_circle_rate: Number(r.avg_circle_rate),
              aqi_pm25: Number(r.aqi_pm25 ?? 235),
              custom_metric: customVal,
            },
            geometry: r.geojson,
          };
        }),
    };
  }

  function buildParentDistrictBackdropGeoJSON() {
    return {
      type: 'FeatureCollection',
      features: regionsByLevel.district
        .filter((d) => d.geojson)
        .map((d) => ({
          type: 'Feature',
          properties: { code: d.code, name: d.name },
          geometry: d.geojson,
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

  function buildInfraGeoJSON() {
    return {
      type: 'FeatureCollection',
      features: PUBLIC_INFRA_POINTS.map((p) => ({
        type: 'Feature',
        properties: p,
        geometry: {
          type: 'Point',
          coordinates: [Number(p.lon), Number(p.lat)],
        },
      })),
    };
  }

  function getFillColorExpression(
    mKey: MetricKey,
    customChoro: CustomLayer | undefined
  ) {
    if (customChoro && customChoro.choroplethByDate) {
      const activeDate = customChoro.activeDate || '';
      const compareDate = customChoro.compareDate || '';
      if (customChoro.showDelta && activeDate && compareDate) {
        return [
          'interpolate',
          ['linear'],
          ['coalesce', ['get', 'custom_metric'], 0],
          -50,
          '#10b981',
          0,
          '#1e293b',
          50,
          '#f43f5e',
        ];
      }
      const vals = Object.values(
        customChoro.choroplethByDate[activeDate] || {}
      ).filter((v) => Number.isFinite(v));
      const minV = vals.length > 0 ? Math.min(...vals) : 0;
      const maxV = vals.length > 0 ? Math.max(...vals, minV + 4) : 100;
      const span = maxV - minV;
      return [
        'interpolate',
        ['linear'],
        ['coalesce', ['get', 'custom_metric'], minV],
        minV,
        VIRIDIS_TEAL_AMBER[0],
        minV + span * 0.25,
        VIRIDIS_TEAL_AMBER[1],
        minV + span * 0.5,
        VIRIDIS_TEAL_AMBER[2],
        minV + span * 0.75,
        VIRIDIS_TEAL_AMBER[3],
        maxV,
        VIRIDIS_TEAL_AMBER[4],
      ];
    }

    const cfg = METRIC_CONFIGS[mKey];
    const [s0, s1, s2, s3, s4] = cfg.stops;
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
      s3[0],
      s3[1],
      s4[0],
      s4[1],
    ];
  }

  // Refs for MapLibre event handlers
  const allRegionsRef = useRef<Region[]>(allRegions);
  allRegionsRef.current = allRegions;

  function setupMapLayers(map: MapLibreMap) {
    const tierRegions = regionsByLevel[level] || [];
    const areaGeoJSON = buildRegionsGeoJSON(
      tierRegions,
      level,
      focusHub,
      currentDistrictCode,
      activeCustomChoropleth
    );

    // 1. Parent District Backdrop Outline (visible behind Municipal Wards)
    if (!map.getSource('district-backdrop')) {
      map.addSource('district-backdrop', {
        type: 'geojson',
        data: buildParentDistrictBackdropGeoJSON(),
      });
      map.addLayer({
        id: 'district-backdrop-line',
        type: 'line',
        source: 'district-backdrop',
        paint: {
          'line-color': '#64748b',
          'line-width': 1.5,
          'line-dasharray': [3, 2],
          'line-opacity': level === 'ward' ? 0.65 : 0.2,
        },
      });
    }

    // 2. Main Choropleth Polygons + Crisp Outlines + Highlighted Selection Outline
    if (!map.getSource('ncr-areas')) {
      map.addSource('ncr-areas', { type: 'geojson', data: areaGeoJSON });
      map.addLayer({
        id: 'area-fill',
        type: 'fill',
        source: 'ncr-areas',
        paint: {
          'fill-color': getFillColorExpression(metric, activeCustomChoropleth),
          'fill-opacity': areaOpacity,
        },
      });
      map.addLayer({
        id: 'area-outline',
        type: 'line',
        source: 'ncr-areas',
        paint: {
          'line-color': isDark ? '#5eead4' : '#0f766e',
          'line-width': level === 'ward' ? 0.8 : level === 'assembly' ? 1.2 : 1.8,
          'line-opacity': 0.85,
        },
      });
      map.addLayer({
        id: 'area-selected-outline',
        type: 'line',
        source: 'ncr-areas',
        paint: {
          'line-color': '#fbbf24',
          'line-width': 3,
          'line-opacity': [
            'case',
            ['==', ['get', 'code'], selectedRegion?.code || ''],
            1,
            0,
          ],
        },
      });
    }

    // 3. Client-Side IDW Blended Field Canvas Overlay (`image` source)
    const idwUrl = renderIdwCanvasDataUrl(activeAqiStations);
    if (!map.getSource('aqi-idw-field') && idwUrl) {
      map.addSource('aqi-idw-field', {
        type: 'image',
        url: idwUrl,
        coordinates: IDW_BOUNDS,
      });
      map.addLayer({
        id: 'aqi-idw-layer',
        type: 'raster',
        source: 'aqi-idw-field',
        paint: {
          'raster-opacity':
            showAqiLayer && (aqiMode === 'blended' || aqiMode === 'both') ? 0.58 : 0,
          'raster-fade-duration': 0,
        },
      });
    }

    // 4. Public Infrastructure Points
    if (!map.getSource('infra-points')) {
      map.addSource('infra-points', {
        type: 'geojson',
        data: buildInfraGeoJSON(),
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

    // 5. CPCB AQI Station Dots (Crisp on top of IDW field)
    if (!map.getSource('aqi-points')) {
      map.addSource('aqi-points', {
        type: 'geojson',
        data: buildAqiGeoJSON(activeAqiStations),
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

  // Initialize MapLibre GL JS
  useEffect(() => {
    if (!mapContainerRef.current || !window.maplibregl) return;

    const map = new window.maplibregl.Map({
      container: mapContainerRef.current,
      style: STYLES.dark,
      center: [77.209, 28.6139],
      zoom: 10.2,
    });

    map.addControl(new window.maplibregl.NavigationControl(), 'bottom-right');
    mapRef.current = map;

    map.on('load', () => {
      setupMapLayers(map);

      map.on(
        'click',
        'aqi-circles',
        (e: {
          originalEvent: { stopPropagation: () => void };
          features?: Array<{ properties: Record<string, unknown> }>;
        }) => {
          e.originalEvent.stopPropagation();
          const p = e.features?.[0]?.properties;
          if (!p) return;
          setSelectedPoint({
            tag: 'CPCB Air Quality Monitoring Station',
            title: String(p.station || 'AQI Station'),
            subtitle: `${p.city || 'NCR'} • ${p.updated || aqiDate}`,
            metrics: {
              'PM2.5 (µg/m³)': Number(p.pm25 || 0),
              'PM10 (µg/m³)': Number(p.pm10 || 0),
              'NO2 (µg/m³)': Number(p.no2 || 48),
              Source: 'CPCB / api.data.gov.in',
            },
          });
          setDrawerOpen(true);
        }
      );

      map.on(
        'click',
        'infra-circles',
        (e: {
          originalEvent: { stopPropagation: () => void };
          features?: Array<{ properties: Record<string, unknown> }>;
        }) => {
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
        }
      );

      map.on(
        'click',
        'area-fill',
        (e: {
          point: unknown;
          features?: Array<{ properties: Record<string, unknown> }>;
        }) => {
          const hitPoints = map.queryRenderedFeatures(e.point, {
            layers: ['aqi-circles', 'infra-circles'],
          });
          if (hitPoints.length > 0) return;

          const p = e.features?.[0]?.properties;
          if (!p) return;
          const found = allRegionsRef.current.find((r) => r.code === p.code);
          if (found) {
            setSelectedPoint(null);
            setSelectedRegion(found);
            setDrawerOpen(true);
          } else {
            const name = String(
              p.name || p.Ward_Name || p.AC_NAME || p.district || 'Custom Zone'
            );
            setSelectedPoint({
              tag: 'Custom Geography Polygon',
              title: name,
              subtitle: 'Uploaded Boundary Feature',
              metrics: p as Record<string, string | number>,
            });
            setDrawerOpen(true);
          }
        }
      );

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

  // Update polygons, backdrop, and choropleth expression whenever tier, focusHub, metric, or custom choropleth changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const tierRegions = regionsByLevel[level] || [];
    const src = map.getSource('ncr-areas');
    if (src?.setData) {
      src.setData(
        buildRegionsGeoJSON(
          tierRegions,
          level,
          focusHub,
          currentDistrictCode,
          activeCustomChoropleth
        )
      );
    }
    const backdropSrc = map.getSource('district-backdrop');
    if (backdropSrc?.setData) {
      backdropSrc.setData(buildParentDistrictBackdropGeoJSON());
    }
    if (map.getLayer('district-backdrop-line')) {
      map.setPaintProperty(
        'district-backdrop-line',
        'line-opacity',
        level === 'ward' ? 0.65 : 0.2
      );
    }
    if (map.getLayer('area-fill')) {
      map.setPaintProperty(
        'area-fill',
        'fill-color',
        getFillColorExpression(metric, activeCustomChoropleth)
      );
    }
    if (map.getLayer('area-outline')) {
      map.setPaintProperty(
        'area-outline',
        'line-width',
        level === 'ward' ? 0.8 : level === 'assembly' ? 1.2 : 1.8
      );
    }
    if (map.getLayer('area-selected-outline')) {
      map.setPaintProperty('area-selected-outline', 'line-opacity', [
        'case',
        ['==', ['get', 'code'], selectedRegion?.code || ''],
        1,
        0,
      ]);
    }
  }, [
    regionsByLevel,
    level,
    focusHub,
    currentDistrictCode,
    metric,
    activeCustomChoropleth,
    customBoundaryOverride,
    selectedRegion,
  ]);

  // Update area opacity & visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer('area-fill')) return;
    map.setPaintProperty('area-fill', 'fill-opacity', areaOpacity);
    const vis = showAreaLayer ? 'visible' : 'none';
    map.setLayoutProperty('area-fill', 'visibility', vis);
    map.setLayoutProperty('area-outline', 'visibility', vis);
    map.setLayoutProperty('area-selected-outline', 'visibility', vis);
  }, [areaOpacity, showAreaLayer]);

  // Update AQI station dots, IDW blended field canvas, and Infra visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource('aqi-points');
    if (src?.setData) src.setData(buildAqiGeoJSON(activeAqiStations));

    const idwSrc = map.getSource('aqi-idw-field');
    const idwUrl = renderIdwCanvasDataUrl(activeAqiStations);
    if (idwSrc?.updateImage && idwUrl) {
      idwSrc.updateImage({ url: idwUrl, coordinates: IDW_BOUNDS });
    }

    if (map.getLayer('aqi-circles')) {
      const showDots = showAqiLayer && (aqiMode === 'stations' || aqiMode === 'both');
      map.setLayoutProperty('aqi-circles', 'visibility', showDots ? 'visible' : 'none');
    }
    if (map.getLayer('aqi-idw-layer')) {
      const showField = showAqiLayer && (aqiMode === 'blended' || aqiMode === 'both');
      map.setPaintProperty('aqi-idw-layer', 'raster-opacity', showField ? 0.58 : 0);
    }
    if (map.getLayer('infra-circles')) {
      map.setLayoutProperty(
        'infra-circles',
        'visibility',
        showInfraLayer ? 'visible' : 'none'
      );
    }
  }, [activeAqiStations, showAqiLayer, aqiMode, showInfraLayer]);

  // Switch boundary level (lazy-loads tier if not yet in state)
  async function handleSwitchLevel(newLevel: BoundaryLevel) {
    setCustomBoundaryOverride(null);
    setLevel(newLevel);
    const loaded = await ensureBoundaryTierLoaded(newLevel);
    const visible = getVisibleTierRegions(
      loaded,
      newLevel,
      focusHub,
      currentDistrictCode
    );
    if (visible.length > 0) {
      setSelectedPoint(null);
      setSelectedRegion(visible[0]);
      const center = getPolygonCenter(visible[0]);
      mapRef.current?.flyTo({
        center: focusHub === 'all' ? [77.21, 28.56] : center,
        zoom:
          focusHub === 'all'
            ? newLevel === 'district'
              ? 9.2
              : newLevel === 'constituency'
                ? 9.6
                : newLevel === 'assembly'
                  ? 9.9
                  : 10.3
            : newLevel === 'ward'
              ? 11.4
              : newLevel === 'assembly'
                ? 10.8
                : 10.3,
      });
    }
  }

  // Switch Focus NCR Hub chip
  function handleSelectFocusHub(hubKey: FocusHubKey) {
    setFocusHub(hubKey);
    const tierRegions = regionsByLevel[level] || [];
    const visible = getVisibleTierRegions(
      tierRegions,
      level,
      hubKey,
      currentDistrictCode
    );
    if (visible.length > 0) {
      setSelectedPoint(null);
      setSelectedRegion(visible[0]);
    }

    if (hubKey === 'all') {
      mapRef.current?.flyTo({ center: [77.21, 28.56], zoom: 9.2 });
      return;
    }

    const targetCode = hubKey === 'current' ? currentDistrictCode : hubKey;
    const dist = regionsByLevel.district.find((d) => d.code === targetCode);
    const hubCfg = FOCUS_NCR_HUBS.find((h) => h.key === targetCode);
    const center = dist ? getPolygonCenter(dist) : hubCfg?.center || [77.209, 28.6139];
    mapRef.current?.flyTo({ center, zoom: hubCfg?.zoom || 10.3 });
  }

  // Toggle Dark/Light Basemap
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

  // Upload Custom Geography (.geojson)
  function handleBoundaryGeoJsonUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const geo = JSON.parse(String(ev.target?.result));
        if (geo.type === 'FeatureCollection' && Array.isArray(geo.features)) {
          setCustomBoundaryOverride({ name: file.name, geojson: geo });
          showToast(
            `Loaded ${geo.features.length} custom geography polygons from ${file.name}`
          );
        } else {
          showToast('File must be a valid GeoJSON FeatureCollection.');
        }
      } catch {
        showToast('Invalid GeoJSON file.');
      }
    };
    reader.readAsText(file);
  }

  // Live CPCB AQI Sync via /api/datagov
  async function handleFetchLiveAqi(useDemo = false) {
    if (useDemo) {
      setLiveAqiOverride(null);
      setAqiStatus(`CPCB Multi-Date Snapshot (${aqiDate})`);
      showToast('Switched to Multi-Date CPCB Demo Dataset');
      return;
    }

    setAqiStatus('Syncing via /api/datagov proxy...');
    try {
      const keyParam = apiKeyInput.trim() || 'demo';
      const res = await fetch(
        `/api/datagov?resource_id=3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69&api_key=${encodeURIComponent(
          keyParam
        )}`
      );
      const data = await res.json();
      const rawRecords: Array<Record<string, unknown>> = data.records || [];
      const list: AqiStation[] = [];

      for (const r of rawRecords) {
        const lat = parseFloat(String(r.latitude ?? r.lat ?? ''));
        const lon = parseFloat(String(r.longitude ?? r.lon ?? ''));
        if (isNaN(lat) || isNaN(lon)) continue;
        list.push({
          station: String(r.station || 'NCR Station'),
          city: String(r.city || 'NCR'),
          state: String(r.state || ''),
          lat,
          lon,
          pm25: Number(r.pm25 || r.avg_value || r.pollutant_avg || 240),
          pm10: Number(r.pm10 || 295),
          no2: Number(r.no2 || 48),
          updated: String(r.last_update || 'Live /api/datagov'),
        });
      }

      if (list.length > 0) {
        setLiveAqiOverride(list);
        setAqiStatus(`Synced ${list.length} CPCB stations (${data.source})`);
        showToast(`Synced ${list.length} live NCR AQI stations`);
      }
    } catch {
      setLiveAqiOverride(null);
      setAqiStatus('Using CPCB Multi-Date Preset');
    }
  }

  // Add or Activate Custom / Community Layer
  async function handleAddCustomLayer(
    layer: CustomLayer,
    switchToLevel?: BoundaryLevel
  ) {
    setCustomLayers((prev) => {
      const exists = prev.some((l) => l.id === layer.id);
      return exists ? prev.map((l) => (l.id === layer.id ? layer : l)) : [layer, ...prev];
    });

    if (layer.type === 'choropleth') {
      const targetTier = switchToLevel || layer.boundaryLevel || level;
      await ensureBoundaryTierLoaded(targetTier);
      setLevel(targetTier);
      setActiveChoroplethLayerId(layer.id);
      showToast(`Activated "${layer.name}" on ${targetTier.toUpperCase()} boundaries`);
      return;
    }

    const map = mapRef.current;
    if (!map) return;
    if (!map.getSource(layer.id)) {
      map.addSource(layer.id, { type: 'geojson', data: layer.geojson });
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
      map.on(
        'click',
        layer.id,
        (e: {
          originalEvent: { stopPropagation: () => void };
          features?: Array<{ properties: Record<string, unknown> }>;
        }) => {
          e.originalEvent.stopPropagation();
          const p = e.features?.[0]?.properties;
          if (!p) return;
          setSelectedPoint({
            tag: `Community Layer: ${layer.name}`,
            title: String(p._label || p.name || 'Point Record'),
            subtitle: layer.metricLabel || 'Community Point Layer',
            metrics: p as Record<string, string | number>,
          });
          setDrawerOpen(true);
        }
      );
    }
    showToast(`Added point layer "${layer.name}"`);
  }

  // Load a persisted layer from Community Data Catalog
  async function handleLoadCatalogLayer(cat: CommunityCatalogLayer) {
    const existing = customLayers.find((l) => l.slug === cat.slug);
    if (existing) {
      if (cat.layer_type === 'choropleth') {
        const tier = (cat.boundary_level as BoundaryLevel) || 'assembly';
        await ensureBoundaryTierLoaded(tier);
        setLevel(tier);
        setActiveChoroplethLayerId(
          activeChoroplethLayerId === existing.id ? null : existing.id
        );
      } else {
        toggleCustomLayer(existing.id);
      }
      return;
    }

    const tier = (cat.boundary_level as BoundaryLevel) || 'assembly';
    const loadedRegions = await ensureBoundaryTierLoaded(tier);
    const dates = Array.isArray(cat.available_dates) ? cat.available_dates : [];
    const latestDate = dates[dates.length - 1] || '2025-01-01';
    const latestMap = cat.choropleth_by_date?.[latestDate] || {};

    const features = loadedRegions
      .filter((r) => r.geojson && latestMap[r.code] !== undefined)
      .map((r) => ({
        type: 'Feature',
        properties: {
          code: r.code,
          name: r.name,
          state: r.state,
          metricValue: latestMap[r.code],
        },
        geometry: r.geojson,
      }));

    const newLayer: CustomLayer = {
      id: `catalog-${cat.id}`,
      slug: cat.slug,
      name: cat.name,
      type: cat.layer_type,
      boundaryLevel: tier,
      category: cat.category,
      unit: cat.unit,
      publisher: cat.publisher,
      sourceUrl: cat.source_url,
      license: cat.license,
      color: cat.color || '#f59e0b',
      visible: true,
      opacity: 0.72,
      featureCount: cat.feature_count,
      metricLabel: cat.metric_label,
      availableDates: dates,
      activeDate: latestDate,
      compareDate: dates.length > 1 ? dates[0] : undefined,
      showDelta: false,
      choroplethByDate: cat.choropleth_by_date,
      pointsByDate: cat.points_by_date,
      geojson: { type: 'FeatureCollection', features },
    };

    await handleAddCustomLayer(newLayer, tier);
  }

  function toggleCustomLayer(id: string) {
    setCustomLayers((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const nextVis = !l.visible;
        if (l.type === 'point' && mapRef.current?.getLayer(id)) {
          mapRef.current.setLayoutProperty(
            id,
            'visibility',
            nextVis ? 'visible' : 'none'
          );
        }
        if (l.type === 'choropleth' && !nextVis && activeChoroplethLayerId === id) {
          setActiveChoroplethLayerId(null);
        } else if (l.type === 'choropleth' && nextVis) {
          setActiveChoroplethLayerId(id);
        }
        return { ...l, visible: nextVis };
      })
    );
  }

  function updateCustomLayerDate(id: string, nextDate: string) {
    setCustomLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, activeDate: nextDate } : l))
    );
  }

  function toggleCustomLayerDelta(id: string) {
    setCustomLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, showDelta: !l.showDelta } : l))
    );
  }

  function removeCustomLayer(id: string) {
    const map = mapRef.current;
    if (map) {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    }
    if (activeChoroplethLayerId === id) setActiveChoroplethLayerId(null);
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

  // Publish Data Story to Supabase PostgreSQL
  async function handlePublishInsight(e: FormEvent) {
    e.preventDefault();
    if (!selectedRegion || !noteTitle.trim() || !noteSummary.trim()) return;
    setPublishing(true);
    try {
      const center = mapRef.current?.getCenter() || { lng: 77.209, lat: 28.6139 };
      const zoom = mapRef.current?.getZoom() || 10.2;
      const { error } = await supabase.from('insights').insert([
        {
          slug: `story-${Date.now()}`,
          region_code: selectedRegion.code,
          title: sanitizeText(noteTitle, 180),
          summary: sanitizeText(noteSummary, 1800),
          author: sanitizeText(noteAuthor || 'Civic Data Creator', 80),
          boundary_level: level,
          metric: activeCustomChoropleth
            ? activeCustomChoropleth.metricLabel || metric
            : metric,
          center_lng: Number(center.lng.toFixed(4)),
          center_lat: Number(center.lat.toFixed(4)),
          zoom: Number(zoom.toFixed(2)),
        },
      ]);
      if (error) throw error;
      setNoteTitle('');
      setNoteSummary('');
      showToast('Published Data Story to Supabase PostgreSQL!');
      await syncCatalogAndInsights();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save Data Story');
    } finally {
      setPublishing(false);
    }
  }

  // Load saved story state into Studio
  async function handleLoadStoryIntoStudio(story: Insight) {
    const targetLevel = (story.boundary_level as BoundaryLevel) || 'district';
    const loaded = await ensureBoundaryTierLoaded(targetLevel);
    setLevel(targetLevel);
    if (story.metric && story.metric in METRIC_CONFIGS) {
      setMetric(story.metric as MetricKey);
      setActiveChoroplethLayerId(null);
    }
    const found = loaded.find((r) => r.code === story.region_code);
    if (found) {
      setSelectedRegion(found);
      setDrawerOpen(true);
    }
    if (story.center_lng && story.center_lat) {
      mapRef.current?.flyTo({
        center: [Number(story.center_lng), Number(story.center_lat)],
        zoom: Number(story.zoom || 10.4),
      });
    }
    showToast(`Loaded story "${story.title}" into Studio`);
  }

  // Global search across all loaded boundaries and infrastructure points
  const searchResults =
    searchQuery.trim().length > 1
      ? allRegions
          .filter(
            (r) =>
              r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
              r.state.toLowerCase().includes(searchQuery.toLowerCase()) ||
              r.code.toLowerCase().includes(searchQuery.toLowerCase())
          )
          .slice(0, 12)
      : [];

  const activeTierRegions = regionsByLevel[selectedRegion?.level || level] || [];
  const visibleCount = getVisibleTierRegions(
    regionsByLevel[level] || [],
    level,
    focusHub,
    currentDistrictCode
  ).length;

  // Nearby CPCB AQI & Infrastructure points within 4.5 km of selected region center
  const selectedCenter = getPolygonCenter(selectedRegion);
  const nearbyAqi = activeAqiStations
    .map((s) => ({
      ...s,
      distKm: haversineKm(selectedCenter[1], selectedCenter[0], s.lat, s.lon),
    }))
    .filter((s) => s.distKm <= 12)
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, 3);

  const nearbyInfra = PUBLIC_INFRA_POINTS.map((p) => ({
    ...p,
    distKm: haversineKm(selectedCenter[1], selectedCenter[0], p.lat, p.lon),
  }))
    .filter((p) => p.distKm <= 12)
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, 3);

  // Build time-series trend for selected region if multi-date custom choropleth or multi-date AQI is active
  const trendSeries = (() => {
    if (
      activeCustomChoropleth &&
      activeCustomChoropleth.availableDates &&
      activeCustomChoropleth.availableDates.length > 1 &&
      selectedRegion
    ) {
      const pts = activeCustomChoropleth.availableDates
        .map((dt) => ({
          date: dt,
          value: Number(
            activeCustomChoropleth.choroplethByDate?.[dt]?.[selectedRegion.code] ?? NaN
          ),
        }))
        .filter((p) => Number.isFinite(p.value));
      if (pts.length >= 2) {
        return {
          title: `${activeCustomChoropleth.name} Trend`,
          unit: activeCustomChoropleth.unit || '',
          series: pts,
        };
      }
    }
    if (nearbyAqi.length > 0) {
      const closestName = nearbyAqi[0].station;
      const pts = AQI_DATES.map((dt) => {
        const st = DEMO_AQI_BY_DATE[dt]?.find((s) => s.station === closestName);
        return { date: dt, value: st ? st.pm25 : 220 };
      });
      return {
        title: `Nearest CPCB Sensor PM2.5 (${closestName.split(',')[0]})`,
        unit: 'µg/m³',
        series: pts,
      };
    }
    return null;
  })();

  const regionInsights = insights.filter(
    (ins) => ins.region_code === selectedRegion?.code
  );
  const activeMetricCfg = METRIC_CONFIGS[metric];

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 text-slate-100 select-none">
      {/* Full-Bleed MapLibre Canvas */}
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Non-blocking Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 border border-emerald-500/40 text-emerald-300 px-4 py-2 rounded-xl shadow-2xl text-xs font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Top Navigation Bar */}
      <header className="fixed top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none flex items-center gap-2.5">
        {/* Global Search Box */}
        <div className="relative pointer-events-auto w-72">
          <div className="flex items-center bg-slate-900/95 backdrop-blur border border-slate-800 rounded-xl px-3 py-2 shadow-xl">
            <Search className="w-4 h-4 text-slate-400 mr-2 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search 740 NCR Districts, PCs, ACs, Wards..."
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
            <div className="absolute left-0 right-0 mt-1.5 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden max-h-64 overflow-y-auto">
              {searchResults.map((r) => (
                <button
                  key={r.code}
                  onClick={() => {
                    setLevel(r.level);
                    setFocusHub('all');
                    setSelectedPoint(null);
                    setSelectedRegion(r);
                    setDrawerOpen(true);
                    setSearchQuery('');
                    const center = getPolygonCenter(r);
                    mapRef.current?.flyTo({
                      center,
                      zoom:
                        r.level === 'ward'
                          ? 12.2
                          : r.level === 'assembly'
                            ? 11.2
                            : r.level === 'constituency'
                              ? 10.4
                              : 10,
                    });
                  }}
                  className="w-full text-left px-3.5 py-2 hover:bg-slate-800 flex items-center justify-between text-xs cursor-pointer border-b border-slate-800/60 last:border-none"
                >
                  <div>
                    <div className="font-medium text-white">{r.name}</div>
                    <div className="text-[10px] text-slate-400">{r.state}</div>
                  </div>
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
            <Plus className="w-4 h-4" /> Upload &amp; Map Civic Data
          </button>

          <button
            onClick={() => setIsCompareOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900/95 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-medium shadow-xl transition cursor-pointer"
          >
            <ArrowLeftRight className="w-3.5 h-3.5 text-sky-400" /> Compare Areas
          </button>

          <button
            onClick={() => setIsCreatorOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900/95 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-medium shadow-xl transition cursor-pointer"
          >
            <Award className="w-3.5 h-3.5 text-amber-400" /> Data Stories ({insights.length})
          </button>

          <button
            onClick={handleToggleTheme}
            title="Toggle Dark / Light Basemap"
            className="p-2 rounded-xl bg-slate-900/95 hover:bg-slate-800 border border-slate-800 text-slate-200 shadow-xl transition cursor-pointer"
          >
            {isDark ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-sky-400" />
            )}
          </button>
        </div>
      </header>

      {/* Left Floating Layer & Boundary Sidebar (Collapsible) */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed top-3 left-3 z-30 p-2 rounded-xl bg-slate-900/95 border border-slate-800 text-slate-300 hover:text-white shadow-xl cursor-pointer"
        title="Toggle Studio Sidebar"
      >
        {sidebarOpen ? (
          <ChevronLeft className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
      </button>

      {sidebarOpen && (
        <aside className="fixed top-3 left-13 bottom-4 w-84 z-20 bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          {/* Brand Header */}
          <div className="p-3.5 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-sm tracking-tight text-white">
                    IndiaData.viz
                  </span>
                  <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                    NCR GIS
                  </span>
                </div>
                <p className="text-[10px] text-slate-400">
                  Survey-Grade LGD &amp; Municipal Boundaries
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-500/20">
              <Database className="w-3 h-3" />
              {loadingTier ? 'Syncing...' : dbSynced ? 'PG Live' : 'Edge Geo'}
            </div>
          </div>

          <div className="p-3.5 overflow-y-auto space-y-3.5 text-xs flex-1">
            {/* 1. Focus NCR Hub Chips (Current Location District Default!) */}
            <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800/90 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <Navigation className="w-3.5 h-3.5 text-emerald-400" />
                  Focus NCR District Hub
                </span>
                <span className="text-[10px] text-emerald-400 font-mono tabular-nums">
                  {visibleCount} polygons
                </span>
              </div>

              <div className="flex flex-wrap gap-1">
                {FOCUS_NCR_HUBS.map((hub) => {
                  const isCurrentChip = hub.key === 'current';
                  const active = focusHub === hub.key;
                  return (
                    <button
                      key={hub.key}
                      onClick={() => handleSelectFocusHub(hub.key)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-medium cursor-pointer transition border ${
                        active
                          ? 'bg-emerald-600 border-emerald-400 text-white shadow'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {isCurrentChip
                        ? `📍 ${currentDistrictName.replace('NCT of ', '')} (${
                            locationDetected ? 'GPS' : 'Default'
                          })`
                        : hub.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. 4-Tier Boundary Switcher + Custom Geography Upload */}
            <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800/90 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">
                  1. Administrative Boundary Tier
                </span>
                <button
                  onClick={() => setShowAreaLayer(!showAreaLayer)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  {showAreaLayer ? (
                    <Eye className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              <div className="grid grid-cols-4 gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
                {(
                  [
                    ['district', 'District'],
                    ['constituency', 'Lok Sabha'],
                    ['assembly', 'Assembly'],
                    ['ward', 'Ward'],
                  ] as const
                ).map(([lvl, label]) => (
                  <button
                    key={lvl}
                    onClick={() => handleSwitchLevel(lvl)}
                    className={`py-1.5 rounded-md text-[10px] font-semibold transition cursor-pointer ${
                      level === lvl
                        ? 'bg-emerald-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {level === 'ward' && (
                <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 text-[10px] text-slate-400 leading-relaxed flex gap-1.5">
                  <Info className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
                  <span>
                    Showing <strong>612 urban municipal wards</strong> over parent district outlines. Blank gaps between ULBs represent rural <strong>Gram Panchayats / CD Blocks</strong> or <strong>Industrial Authorities</strong> (Greater Noida / YEIDA).
                  </span>
                </div>
              )}

              {/* Custom Geography (.geojson) + Reset Default */}
              <div className="pt-1 flex items-center justify-between gap-1.5">
                <label className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-dashed border-slate-700 text-[10px] text-slate-300 cursor-pointer transition">
                  <Upload className="w-3 h-3 text-emerald-400" />
                  <span>Custom Geography (.geojson)</span>
                  <input
                    type="file"
                    accept=".geojson,.json"
                    onChange={handleBoundaryGeoJsonUpload}
                    className="hidden"
                  />
                </label>
                {customBoundaryOverride && (
                  <button
                    onClick={() => setCustomBoundaryOverride(null)}
                    className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-rose-500/15 text-rose-300 border border-rose-500/30 text-[10px] cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" /> Reset default
                  </button>
                )}
              </div>
            </div>

            {/* 3. Choropleth Metric Selector + Viridis Teal-to-Amber Ramp */}
            <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800/90 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">
                  2. Choropleth Metric
                </span>
                {activeCustomChoropleth && (
                  <button
                    onClick={() => setActiveChoroplethLayerId(null)}
                    className="text-[10px] text-amber-300 hover:underline cursor-pointer"
                  >
                    Reset to Census Metric
                  </button>
                )}
              </div>

              <select
                value={metric}
                onChange={(e) => {
                  setActiveChoroplethLayerId(null);
                  setMetric(e.target.value as MetricKey);
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                {Object.values(METRIC_CONFIGS).map((cfg) => (
                  <option key={cfg.key} value={cfg.key}>
                    {cfg.label}
                  </option>
                ))}
              </select>

              {/* 5-Stop Scientific Viridis Teal-to-Amber Legend */}
              <div className="space-y-1 pt-0.5">
                <div
                  className="h-2 rounded-full w-full"
                  style={{
                    background:
                      activeCustomChoropleth?.showDelta
                        ? 'linear-gradient(to right, #10b981, #1e293b, #f43f5e)'
                        : `linear-gradient(to right, ${activeMetricCfg.stops
                            .map((s) => s[1])
                            .join(', ')})`,
                  }}
                />
                <div className="flex justify-between text-[10px] text-slate-400 font-mono tabular-nums">
                  <span>
                    {activeCustomChoropleth
                      ? activeCustomChoropleth.showDelta
                        ? '-Δ Improved'
                        : 'Low'
                      : `${activeMetricCfg.stops[0][0].toLocaleString('en-IN')}`}
                  </span>
                  <span className="text-slate-300 font-sans">
                    {activeCustomChoropleth
                      ? `${activeCustomChoropleth.metricLabel} (${
                          activeCustomChoropleth.activeDate || ''
                        })`
                      : activeMetricCfg.unit}
                  </span>
                  <span>
                    {activeCustomChoropleth
                      ? activeCustomChoropleth.showDelta
                        ? '+Δ Increased'
                        : 'High'
                      : `${activeMetricCfg.stops[4][0].toLocaleString('en-IN')}`}
                  </span>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[10px] text-slate-400 mb-1 tabular-nums">
                  <span>Polygon Fill Opacity</span>
                  <span>{Math.round(areaOpacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.15}
                  max={0.92}
                  step={0.05}
                  value={areaOpacity}
                  onChange={(e) => setAreaOpacity(parseFloat(e.target.value))}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>
            </div>

            {/* 4. CPCB Air Quality Stations + IDW Blended Field + Multi-Date Switcher */}
            <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800/90 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <Wind className="w-3.5 h-3.5 text-amber-400" />
                  3. CPCB Air Quality &amp; IDW Field
                </span>
                <button
                  onClick={() => setShowAqiLayer(!showAqiLayer)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  {showAqiLayer ? (
                    <Eye className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              {/* AQI Display Mode Switch: Stations | IDW Blended Field | Both */}
              <div className="grid grid-cols-3 gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 text-[10px]">
                {(
                  [
                    ['stations', 'Stations'],
                    ['blended', 'IDW Field'],
                    ['both', 'Both (IDW+Dots)'],
                  ] as const
                ).map(([m, lbl]) => (
                  <button
                    key={m}
                    onClick={() => setAqiMode(m)}
                    className={`py-1 rounded font-medium cursor-pointer ${
                      aqiMode === m
                        ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>

              {/* Compact < [YYYY-MM-DD dropdown] > Date Switcher */}
              {!liveAqiOverride && (
                <div className="flex items-center justify-between bg-slate-900 px-2 py-1 rounded-lg border border-slate-800">
                  <span className="text-[10px] text-slate-400">Snapshot Date:</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        const idx = AQI_DATES.indexOf(aqiDate);
                        if (idx > 0) setAqiDate(AQI_DATES[idx - 1]);
                      }}
                      className="p-0.5 text-slate-400 hover:text-white cursor-pointer"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <select
                      value={aqiDate}
                      onChange={(e) => setAqiDate(e.target.value)}
                      className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] font-mono text-amber-300"
                    >
                      {AQI_DATES.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        const idx = AQI_DATES.indexOf(aqiDate);
                        if (idx < AQI_DATES.length - 1) setAqiDate(AQI_DATES[idx + 1]);
                      }}
                      className="p-0.5 text-slate-400 hover:text-white cursor-pointer"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="Optional data.gov.in API key..."
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[10px] text-white placeholder-slate-500"
                />
                <button
                  onClick={() => handleFetchLiveAqi(false)}
                  className="px-2 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-[10px] font-semibold cursor-pointer"
                >
                  Live Sync
                </button>
                {liveAqiOverride && (
                  <button
                    onClick={() => handleFetchLiveAqi(true)}
                    className="px-2 py-1 rounded-lg bg-slate-800 text-slate-300 text-[10px] cursor-pointer"
                  >
                    Demo
                  </button>
                )}
              </div>
              <div className="text-[10px] text-slate-400">{aqiStatus}</div>
            </div>

            {/* 5. Public Infrastructure Layer */}
            <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800/90 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-sky-400" />
                <div>
                  <div className="font-semibold text-slate-200">
                    4. Public Infra (Metro &amp; Hospitals)
                  </div>
                  <div className="text-[10px] text-slate-400">
                    10 NCR Metro Hubs &amp; Tertiary Hospitals
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowInfraLayer(!showInfraLayer)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                {showInfraLayer ? (
                  <Eye className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            {/* 6. Active Custom / Community Layer Stack with Per-Layer Date Switcher & Show Change (Δ) */}
            {customLayers.length > 0 && (
              <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800/90 space-y-2">
                <div className="font-semibold text-slate-200">
                  Active Custom &amp; Community Layers ({customLayers.length})
                </div>
                {customLayers.map((lyr) => {
                  const hasMultiDates =
                    lyr.availableDates && lyr.availableDates.length > 1;
                  return (
                    <div
                      key={lyr.id}
                      className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 truncate">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: lyr.color }}
                          />
                          <div className="truncate">
                            <div className="text-[11px] font-medium text-white truncate">
                              {lyr.name}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {lyr.type.toUpperCase()} • {lyr.featureCount} features
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => exportCustomLayerGeoJSON(lyr)}
                            title="Download GeoJSON"
                            className="p-1 text-slate-400 hover:text-emerald-400 cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => toggleCustomLayer(lyr.id)}
                            className="p-1 text-slate-400 hover:text-white cursor-pointer"
                          >
                            {lyr.visible ? (
                              <Eye className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <EyeOff className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            onClick={() => removeCustomLayer(lyr.id)}
                            className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Per-Layer Date Switcher & Show Change (Δ) */}
                      {hasMultiDates && lyr.availableDates && (
                        <div className="pt-1 border-t border-slate-800 flex items-center justify-between gap-1 text-[10px]">
                          <select
                            value={lyr.activeDate}
                            onChange={(e) => updateCustomLayerDate(lyr.id, e.target.value)}
                            className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-emerald-300"
                          >
                            {lyr.availableDates.map((d) => (
                              <option key={d} value={d}>
                                {d}
                              </option>
                            ))}
                          </select>

                          {lyr.type === 'choropleth' && (
                            <button
                              onClick={() => toggleCustomLayerDelta(lyr.id)}
                              className={`px-2 py-0.5 rounded font-semibold cursor-pointer ${
                                lyr.showDelta
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                  : 'bg-slate-800 text-slate-300'
                              }`}
                            >
                              Show Change (Δ)
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 7. Persistent Community Data Catalog (Supabase PostgreSQL) */}
            <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800/90 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  5. Community Data Catalog ({catalogLayers.length})
                </span>
                <span className="text-[10px] text-slate-400">Zero-GeoJSON</span>
              </div>

              <div className="space-y-2">
                {catalogLayers.map((cat) => {
                  const isLoaded = customLayers.some(
                    (l) =>
                      l.slug === cat.slug &&
                      (l.id === activeChoroplethLayerId || l.visible)
                  );
                  return (
                    <div
                      key={cat.id}
                      className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                          {cat.boundary_level || cat.layer_type}
                        </span>
                        <span className="text-[9px] text-slate-400">
                          {cat.category} • {cat.feature_count} matched
                        </span>
                      </div>
                      <div className="text-[11px] font-semibold text-white">
                        {cat.name}
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
                        <a
                          href={cat.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sky-400 hover:underline truncate max-w-[140px]"
                        >
                          {cat.publisher} <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                        </a>
                        <button
                          onClick={() => handleLoadCatalogLayer(cat)}
                          className={`px-2.5 py-1 rounded-md font-semibold cursor-pointer transition ${
                            isLoaded
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-800 hover:bg-emerald-600 text-slate-200 hover:text-white'
                          }`}
                        >
                          {isLoaded ? 'Active' : 'Load Layer'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* Right Slide-Over Insights Drawer */}
      {drawerOpen && (
        <aside className="fixed top-3 right-3 bottom-4 w-88 z-20 bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          {selectedPoint ? (
            <div className="p-4 space-y-4 overflow-y-auto">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-sky-500/20 text-sky-300">
                    {selectedPoint.tag}
                  </span>
                  <h2 className="text-base font-bold text-white mt-1.5">
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

              <div className="grid grid-cols-2 gap-2.5 tabular-nums">
                {Object.entries(selectedPoint.metrics)
                  .slice(0, 8)
                  .map(([k, v]) => (
                    <div
                      key={k}
                      className="p-3 rounded-xl bg-slate-950 border border-slate-800"
                    >
                      <div className="text-[10px] text-slate-400 uppercase truncate">
                        {k}
                      </div>
                      <div className="text-sm font-bold text-white mt-0.5 truncate">
                        {String(v)}
                      </div>
                    </div>
                  ))}
              </div>

              <button
                onClick={() => setSelectedPoint(null)}
                className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 font-medium cursor-pointer"
              >
                &larr; Back to Region Inspector
              </button>
            </div>
          ) : selectedRegion ? (
            <div className="p-4 overflow-y-auto space-y-4 text-xs flex-1">
              {/* Region Header */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                      {selectedRegion.level}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {selectedRegion.parent_region || selectedRegion.state}
                    </span>
                    {selectedRegion.area_sq_km ? (
                      <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                        • {selectedRegion.area_sq_km} km²
                      </span>
                    ) : null}
                  </div>
                  <h2 className="text-lg font-bold text-white mt-1">
                    {selectedRegion.name}
                  </h2>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setIsCompareOpen(true)}
                    title="Compare with another area"
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] text-sky-300 font-medium cursor-pointer"
                  >
                    Compare
                  </button>
                  <button
                    onClick={() => setDrawerOpen(false)}
                    className="text-slate-400 hover:text-white p-1 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Elected Representative & Verification Source Links Card */}
              <div className="p-3.5 rounded-xl bg-slate-950 border border-emerald-500/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-400 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {selectedRegion.rep_role || 'Elected Representative & Governance'}
                  </span>
                  {selectedRegion.rep_party && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-bold text-[10px]">
                      {selectedRegion.rep_party}
                    </span>
                  )}
                </div>
                <div className="text-sm font-bold text-white">
                  {selectedRegion.rep_name || 'Official Jurisdiction'}
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 tabular-nums">
                  <span>Term: {selectedRegion.rep_term || 'Active'}</span>
                  {selectedRegion.rep_votes ? (
                    <span>
                      Winning Votes:{' '}
                      <strong className="text-slate-200">
                        {selectedRegion.rep_votes.toLocaleString('en-IN')}
                      </strong>
                    </span>
                  ) : null}
                </div>

                {/* Clickable Official Verification Links */}
                <div className="pt-1.5 border-t border-slate-900 flex flex-wrap gap-2 text-[10px]">
                  {selectedRegion.rep_source_url && (
                    <a
                      href={selectedRegion.rep_source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-emerald-400 border border-slate-800"
                    >
                      {selectedRegion.rep_source_label || 'Official Portal'}{' '}
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                  {selectedRegion.rep_affidavit_url && (
                    <a
                      href={selectedRegion.rep_affidavit_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-sky-400 border border-slate-800"
                    >
                      MyNeta / SEC Roll <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                  {selectedRegion.boundary_source_url && (
                    <a
                      href={selectedRegion.boundary_source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800"
                    >
                      GIS Boundary Repo <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                </div>
              </div>

              {/* Census & Civic Indicators Grid */}
              <div className="grid grid-cols-2 gap-2 tabular-nums">
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[10px] text-slate-400">Population Density</div>
                  <div className="text-sm font-bold text-emerald-400 mt-0.5 font-mono">
                    {Number(
                      selectedRegion.population_density || selectedRegion.density
                    ).toLocaleString('en-IN')}{' '}
                    /km²
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[10px] text-slate-400">Total Population</div>
                  <div className="text-sm font-bold text-white mt-0.5 font-mono">
                    {Number(selectedRegion.population).toLocaleString('en-IN')}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[10px] text-slate-400">Literacy Rate</div>
                  <div className="text-sm font-bold text-white mt-0.5 font-mono">
                    {selectedRegion.literacy_rate}%
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[10px] text-slate-400">Sex Ratio</div>
                  <div className="text-sm font-bold text-sky-400 mt-0.5 font-mono">
                    {selectedRegion.sex_ratio} F/1kM
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[10px] text-slate-400">Green Cover</div>
                  <div className="text-sm font-bold text-emerald-300 mt-0.5 font-mono">
                    {selectedRegion.green_cover_pct}%
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[10px] text-slate-400">Hospitals / Schools</div>
                  <div className="text-sm font-bold text-purple-300 mt-0.5 font-mono">
                    {selectedRegion.hospitals_count} / {selectedRegion.schools_count}
                  </div>
                </div>
              </div>

              {/* Multi-Date Time-Series Trend Chart */}
              {trendSeries && (
                <TimeSeriesTrendChart
                  title={trendSeries.title}
                  unit={trendSeries.unit}
                  series={trendSeries.series}
                />
              )}

              {/* Benchmark Chart (Radar / Bar Toggle vs NCR Tier Mean) */}
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200">
                    Benchmark vs NCR {selectedRegion.level.toUpperCase()} Mean
                  </span>
                  <div className="inline-flex bg-slate-900 p-0.5 rounded-lg border border-slate-800 text-[10px]">
                    <button
                      onClick={() => setChartMode('radar')}
                      className={`px-2 py-0.5 rounded cursor-pointer ${
                        chartMode === 'radar'
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-400'
                      }`}
                    >
                      Radar
                    </button>
                    <button
                      onClick={() => setChartMode('bar')}
                      className={`px-2 py-0.5 rounded cursor-pointer ${
                        chartMode === 'bar'
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-400'
                      }`}
                    >
                      Bars
                    </button>
                  </div>
                </div>
                <BenchmarkChart
                  region={selectedRegion}
                  peerRegions={activeTierRegions}
                  mode={chartMode}
                />
              </div>

              {/* Nearby CPCB AQI Stations & Public Infrastructure */}
              {(nearbyAqi.length > 0 || nearbyInfra.length > 0) && (
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="font-semibold text-slate-200">
                    Nearby Sensors &amp; Civic Infrastructure
                  </div>
                  {nearbyAqi.map((s) => (
                    <div
                      key={s.station}
                      className="flex items-center justify-between text-[11px] py-1 border-b border-slate-900 last:border-none tabular-nums"
                    >
                      <span className="text-slate-300 truncate max-w-[175px]">
                        {s.station.split(',')[0]} ({s.distKm.toFixed(1)} km)
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${
                          s.pm25 > 250
                            ? 'bg-rose-500/20 text-rose-300'
                            : 'bg-amber-500/20 text-amber-300'
                        }`}
                      >
                        PM2.5 {s.pm25}
                      </span>
                    </div>
                  ))}
                  {nearbyInfra.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between text-[11px] py-1 border-b border-slate-900 last:border-none tabular-nums"
                    >
                      <span className="text-slate-300 truncate max-w-[185px]">
                        {p.name}
                      </span>
                      <span className="text-[10px] text-sky-400 font-mono">
                        {p.distKm.toFixed(1)} km
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Publish Finding to Supabase PostgreSQL */}
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200">
                    Publish Geo-Verified Data Story
                  </span>
                  <span className="text-[10px] text-emerald-400">
                    Supabase PostgreSQL
                  </span>
                </div>

                <form onSubmit={handlePublishInsight} className="space-y-2">
                  <input
                    type="text"
                    required
                    value={noteTitle}
                    onChange={(e) => setNoteTitle(e.target.value)}
                    placeholder={`Headline for ${selectedRegion.name}...`}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  />
                  <textarea
                    rows={2}
                    required
                    value={noteSummary}
                    onChange={(e) => setNoteSummary(e.target.value)}
                    placeholder="Cite civic metrics, AQI trends, or ward infrastructure gaps..."
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={noteAuthor}
                      onChange={(e) => setNoteAuthor(e.target.value)}
                      placeholder="Your Name / Handle"
                      className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                    />
                    <button
                      type="submit"
                      disabled={publishing}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer"
                    >
                      {publishing ? 'Saving...' : 'Publish'}
                    </button>
                  </div>
                </form>

                {regionInsights.length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t border-slate-900">
                    {regionInsights.slice(0, 2).map((ins) => (
                      <div
                        key={ins.id}
                        className="p-2 rounded-lg bg-slate-900/80 border border-slate-800"
                      >
                        <div className="font-semibold text-white">{ins.title}</div>
                        <p className="text-[11px] text-slate-300 mt-0.5">{ins.summary}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </aside>
      )}

      {!drawerOpen && (
        <button
          onClick={() => setDrawerOpen(true)}
          className="fixed top-16 right-4 z-20 px-3 py-2 rounded-xl bg-slate-900/95 border border-slate-800 text-xs font-medium text-emerald-400 shadow-xl cursor-pointer"
        >
          Open Region Inspector
        </button>
      )}

      {/* Modals */}
      <DataImporterModal
        isOpen={isImporterOpen}
        onClose={() => setIsImporterOpen(false)}
        regions={allRegions}
        onAddLayer={handleAddCustomLayer}
        onCatalogUpdated={syncCatalogAndInsights}
      />

      <CompareModal
        isOpen={isCompareOpen}
        onClose={() => setIsCompareOpen(false)}
        regions={allRegions}
        initialRegionA={selectedRegion}
      />

      <CreatorStudioModal
        isOpen={isCreatorOpen}
        onClose={() => setIsCreatorOpen(false)}
        insights={insights}
        regions={allRegions}
        onLoadStoryIntoStudio={handleLoadStoryIntoStudio}
      />
    </div>
  );
}
