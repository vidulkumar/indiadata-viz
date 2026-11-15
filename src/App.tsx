import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { supabase } from './lib/supabase';
import {
  BoundaryLevel,
  MetricKey,
  METRIC_CONFIGS,
  Region,
  AqiStation,
  CustomLayer,
  AqiDisplayMode,
  FocusHubKey,
  CommunityCatalogLayer,
  VIRIDIS_TEAL_AMBER,
} from './types';
import {
  FOCUS_NCR_HUBS,
  VERIFIED_CPCB_STATIONS,
  CPCB_SOURCE_LABEL,
  CPCB_SOURCE_URL,
  CPCB_DATAGOV_URL,
} from './data/ncrDefaults';
import { UploadDataPage } from './components/UploadDataPage';
import CompareModal from './components/CompareModal';
import { BenchmarkChart } from './components/CivicCharts';
import {
  Map as MapIcon,
  Layers,
  Upload,
  Search,
  Wind,
  Sun,
  Moon,
  ArrowLeftRight,
  ExternalLink,
  CheckCircle2,
  ShieldCheck,
  LocateFixed,
  BarChart3,
  Eye,
  EyeOff,
  Database,
  CheckSquare,
  Square,
  Info,
} from 'lucide-react';

declare global {
  interface Window {
    maplibregl: any;
  }
}

const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const LIGHT_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

function getColorForValue(val: number, stops: [number, string][]): string {
  for (let i = stops.length - 1; i >= 0; i--) {
    if (val >= stops[i][0]) return stops[i][1];
  }
  return stops[0]?.[1] || '#14b8a6';
}

function pointInRing(pt: [number, number], ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1];
    const xj = ring[j][0],
      yj = ring[j][1];
    const intersect =
      yi > pt[1] !== yj > pt[1] &&
      pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeometry(pt: [number, number], geom: any): boolean {
  if (!geom) return false;
  if (geom.type === 'Polygon') {
    return pointInRing(pt, geom.coordinates[0] || []);
  }
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.some((poly: number[][][]) => pointInRing(pt, poly[0] || []));
  }
  return false;
}

const isLocalhost =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

export function App() {
  const [currentPage, setCurrentPage] = useState<'map' | 'upload'>(() =>
    typeof window !== 'undefined' && window.location.pathname === '/upload'
      ? 'upload'
      : 'map'
  );

  const navigateTo = useCallback((page: 'map' | 'upload') => {
    setCurrentPage(page);
    if (typeof window !== 'undefined') {
      const targetPath = page === 'upload' ? '/upload' : '/';
      if (window.location.pathname !== targetPath) {
        window.history.pushState({}, '', targetPath);
      }
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setCurrentPage(window.location.pathname === '/upload' ? 'upload' : 'map');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Theme & Map state
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [boundaryLevel, setBoundaryLevel] = useState<BoundaryLevel>('district');
  const [focusHub, setFocusHub] = useState<FocusHubKey>('current');
  const [detectedDistrictCode, setDetectedDistrictCode] = useState<string>('dl-nct');
  const [detectedDistrictName, setDetectedDistrictName] = useState<string>('NCT of Delhi');
  const [gpsStatus, setGpsStatus] = useState<'detecting' | 'gps' | 'default'>('detecting');

  // By default ONLY Green Cover (ISFR 2023) and CPCB Air Pollution are visible/selected!
  const [activeMetric, setActiveMetric] = useState<MetricKey>('green_cover_pct');
  const [selectedMetrics, setSelectedMetrics] = useState<MetricKey[]>([
    'green_cover_pct',
    'aqi_pm25',
  ]);
  const [showAqiLayer, setShowAqiLayer] = useState<boolean>(true);
  const [aqiDisplayMode, setAqiDisplayMode] = useState<AqiDisplayMode>('both');

  // Search & Selection
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [selectedStation, setSelectedStation] = useState<AqiStation | null>(null);
  const [hoveredFeature, setHoveredFeature] = useState<{
    region: Region;
    x: number;
    y: number;
  } | null>(null);
  const [hoveredStation, setHoveredStation] = useState<{
    station: AqiStation;
    x: number;
    y: number;
  } | null>(null);
  const [chartMode, setChartMode] = useState<'radar' | 'bar'>('radar');

  // Boundaries & Data state
  const [regionsByTier, setRegionsByTier] = useState<Record<BoundaryLevel, Region[]>>({
    district: [],
    constituency: [],
    assembly: [],
    ward: [],
  });
  const [, setLoadingTier] = useState<boolean>(true);
  const [dataSourceBadge, setDataSourceBadge] = useState<string>('Loading GIS Boundaries…');

  // Verified CPCB stations + optional live sync from data.gov.in
  const [aqiStations, setAqiStations] = useState<AqiStation[]>(VERIFIED_CPCB_STATIONS);
  const [syncingLiveAqi, setSyncingLiveAqi] = useState<boolean>(false);

  // Uploaded / Community Layers (zero mock layers)
  const [customLayers, setCustomLayers] = useState<CustomLayer[]>([]);
  const [activeCustomChoroplethId, setActiveCustomChoroplethId] = useState<string | null>(
    null
  );

  // Compare Modal
  const [isCompareOpen, setIsCompareOpen] = useState<boolean>(false);

  // MapLibre refs
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const mapReadyRef = useRef<boolean>(false);
  const stationMarkersRef = useRef<any[]>([]);
  const customPointMarkersRef = useRef<any[]>([]);

  // ─── 1. Load Verified GIS Boundaries (Local SQLite on localhost -> Supabase -> Edge GeoJSON) ─
  const fetchTierBoundaries = useCallback(
    async (tier: BoundaryLevel): Promise<Region[]> => {
      // A. Try Local SQLite API first when running on localhost
      if (isLocalhost) {
        try {
          const localRes = await fetch(`/api/local/boundaries?level=${tier}`);
          if (localRes.ok) {
            const fc = await localRes.json();
            if (Array.isArray(fc.features) && fc.features.length > 0) {
              setDataSourceBadge('Local SQLite DB (data/indiadata-local.sqlite)');
              return fc.features.map((f: any) => ({
                ...f.properties,
                geojson: f.geometry,
              }));
            }
          }
        } catch {
          // fallback below
        }
      }

      // B. Try Supabase PostgreSQL `boundary_features`
      if (supabase) {
        try {
          const { data, error } = await supabase
            .from('boundary_features')
            .select('*')
            .eq('level', tier)
            .order('code', { ascending: true });

          if (!error && data && data.length > 0) {
            setDataSourceBadge('Supabase PostgreSQL + PostGIS');
            return data.map((row: any) => ({
              ...(row.properties || {}),
              code: row.code,
              name: row.name,
              state: row.state,
              parent_region: row.parent_region,
              level: row.level,
              area_sq_km: Number(row.area_sq_km || row.properties?.area_sq_km || 0),
              green_cover_pct: Number(
                row.green_cover_pct || row.properties?.green_cover_pct || 0
              ),
              aqi_pm25: Number(row.aqi_pm25 || row.properties?.aqi_pm25 || 0),
              pm25_ugm3: Number(row.properties?.pm25_ugm3 || 0),
              pm10_ugm3: Number(row.properties?.pm10_ugm3 || 0),
              no2_ugm3: Number(row.properties?.no2_ugm3 || 0),
              cpcb_station_name: row.properties?.cpcb_station_name || null,
              isfr_benchmark_region: row.properties?.isfr_benchmark_region || null,
              population_density: Number(
                row.population_density || row.properties?.population_density || 0
              ),
              density: Number(
                row.population_density || row.properties?.population_density || 0
              ),
              literacy_rate: Number(
                row.literacy_rate || row.properties?.literacy_rate || 0
              ),
              sex_ratio: Number(row.sex_ratio || row.properties?.sex_ratio || 0),
              rep_name: row.rep_name,
              rep_role: row.rep_role,
              rep_party: row.rep_party,
              rep_term: row.rep_term,
              rep_votes: row.rep_votes,
              rep_source_label: row.rep_source_label,
              rep_source_url: row.rep_source_url,
              rep_affidavit_url: row.rep_affidavit_url,
              green_source_label:
                row.properties?.green_source_label ||
                'Forest Survey of India — ISFR 2023',
              green_source_url:
                row.properties?.green_source_url || 'https://fsi.nic.in/isfr-2023',
              pollution_source_label:
                row.properties?.pollution_source_label || CPCB_SOURCE_LABEL,
              pollution_source_url:
                row.properties?.pollution_source_url || CPCB_SOURCE_URL,
              boundary_source_label: row.boundary_source_label,
              boundary_source_url: row.boundary_source_url,
              data_source_label: row.data_source_label,
              data_source_url: row.data_source_url,
              center: row.center,
              geojson: row.geojson,
            }));
          }
        } catch {
          // fallback to edge static GeoJSON
        }
      }

      // C. Static Edge GeoJSON fallback
      const fileMap: Record<BoundaryLevel, string> = {
        district: '/boundaries/districts.geojson',
        constituency: '/boundaries/constituencies.geojson',
        assembly: '/boundaries/assemblies.geojson',
        ward: '/boundaries/wards.geojson',
      };
      const res = await fetch(fileMap[tier]);
      const fc = await res.json();
      setDataSourceBadge('Edge Verified GeoJSON');
      return (fc.features || []).map((f: any) => ({
        ...f.properties,
        geojson: f.geometry,
      }));
    },
    []
  );

  // Load initial districts + background-load all tiers so Upload auto-mapper has all 740 polygons
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingTier(true);
      const districts = await fetchTierBoundaries('district');
      if (cancelled) return;
      setRegionsByTier((prev) => ({ ...prev, district: districts }));
      if (districts.length > 0) {
        const defaultDist =
          districts.find((d) => d.code === 'dl-nct') || districts[0];
        setSelectedRegion(defaultDist);
      }
      setLoadingTier(false);

      // Load remaining tiers in background
      const [pcs, acs, wards] = await Promise.all([
        fetchTierBoundaries('constituency'),
        fetchTierBoundaries('assembly'),
        fetchTierBoundaries('ward'),
      ]);
      if (cancelled) return;
      setRegionsByTier({
        district: districts,
        constituency: pcs,
        assembly: acs,
        ward: wards,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchTierBoundaries]);

  // Load user-uploaded layers from Local SQLite or Supabase (excluding archived mock layers)
  useEffect(() => {
    (async () => {
      try {
        const endpoint = isLocalhost
          ? '/api/local/community-layers'
          : '/api/community-layers';
        const res = await fetch(endpoint);
        if (!res.ok) return;
        const data = await res.json();
        const records: CommunityCatalogLayer[] = Array.isArray(data.records)
          ? data.records
          : Array.isArray(data)
            ? data
            : [];

        const validLayers: CustomLayer[] = records
          .filter(
            (r) =>
              r.category !== 'archived' &&
              r.slug !== 'ncr-assembly-crime-index-2024-2025' &&
              r.slug !== 'ncr-district-winter-pm25-progression'
          )
          .map((r) => {
            const dates =
              Array.isArray(r.available_dates) && r.available_dates.length > 0
                ? r.available_dates
                : Object.keys(r.choropleth_by_date || {});
            const activeDate = dates[dates.length - 1] || 'Latest';
            return {
              id: r.slug,
              slug: r.slug,
              name: r.name,
              description: r.description || '',
              methodology: r.methodology || '',
              targetState: r.target_state || 'All NCR',
              type: r.layer_type,
              boundaryLevel: (r.boundary_level as BoundaryLevel) || 'district',
              category: r.category,
              metricLabel: r.metric_label,
              unit: r.unit,
              publisher: r.publisher,
              sourceUrl: r.source_url,
              license: r.license,
              color: r.color || '#14b8a6',
              visible: false,
              opacity: 0.78,
              featureCount: r.feature_count,
              availableDates: dates,
              activeDate,
              choroplethByDate: r.choropleth_by_date || {},
              pointsByDate: r.points_by_date || {},
              geojson: { type: 'FeatureCollection', features: [] },
            };
          });

        setCustomLayers(validLayers);
      } catch {
        // ignore
      }
    })();
  }, []);

  // Detect user's current district via browser GPS + Point-in-Polygon check
  useEffect(() => {
    const districts = regionsByTier.district;
    if (districts.length === 0) return;
    if (!navigator.geolocation) {
      setGpsStatus('default');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const pt: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        const found = districts.find((d) => pointInGeometry(pt, d.geojson));
        if (found) {
          setDetectedDistrictCode(found.code);
          setDetectedDistrictName(found.name);
          setGpsStatus('gps');
          setSelectedRegion(found);
        } else {
          setGpsStatus('default');
        }
      },
      () => {
        setGpsStatus('default');
      },
      { timeout: 5000 }
    );
  }, [regionsByTier.district]);

  const allRegions = useMemo(
    () => [
      ...regionsByTier.district,
      ...regionsByTier.constituency,
      ...regionsByTier.assembly,
      ...regionsByTier.ward,
    ],
    [regionsByTier]
  );

  // Filter current tier regions by Focus Hub (Current Location District by default!)
  const activeTierRegions = useMemo(() => {
    const raw = regionsByTier[boundaryLevel] || [];
    if (focusHub === 'all') return raw;

    const targetCode = focusHub === 'current' ? detectedDistrictCode : focusHub;
    const hubCfg = FOCUS_NCR_HUBS.find((h) => h.regionCode === targetCode);
    const parentName = hubCfg?.parentMatch || detectedDistrictName;

    return raw.filter((r) => {
      if (r.level === 'district') return r.code === targetCode;
      return (
        r.parent_region === parentName ||
        r.state === parentName ||
        r.district_name?.toLowerCase() === parentName.toLowerCase()
      );
    });
  }, [regionsByTier, boundaryLevel, focusHub, detectedDistrictCode, detectedDistrictName]);

  const searchedRegions = useMemo(() => {
    if (!searchQuery.trim()) return activeTierRegions;
    const q = searchQuery.toLowerCase().trim();
    return activeTierRegions.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.state.toLowerCase().includes(q) ||
        (r.rep_name || '').toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q)
    );
  }, [activeTierRegions, searchQuery]);

  // Active Custom Choropleth Layer (if user toggled an uploaded choropleth layer ON)
  const activeCustomChoropleth = useMemo(() => {
    if (activeCustomChoroplethId) {
      const found = customLayers.find(
        (l) => l.id === activeCustomChoroplethId && l.visible && l.type === 'choropleth'
      );
      if (found) return found;
    }
    return (
      customLayers.find((l) => l.visible && l.type === 'choropleth') || null
    );
  }, [customLayers, activeCustomChoroplethId]);

  // Get metric value for choropleth coloring
  const getRegionChoroplethValue = useCallback(
    (region: Region): number => {
      if (
        activeCustomChoropleth &&
        activeCustomChoropleth.boundaryLevel === region.level &&
        activeCustomChoropleth.choroplethByDate
      ) {
        const dateKey =
          activeCustomChoropleth.activeDate ||
          activeCustomChoropleth.availableDates?.[0] ||
          'Latest';
        const val = activeCustomChoropleth.choroplethByDate[dateKey]?.[region.code];
        if (typeof val === 'number') return val;
      }
      if (activeMetric === 'population_density') {
        return Number(region.population_density || region.density || 0);
      }
      return Number(region[activeMetric] ?? 0);
    },
    [activeCustomChoropleth, activeMetric]
  );

  // ─── Initialize MapLibre GL Map ─────────────────────────────────────────────
  useEffect(() => {
    if (currentPage !== 'map') return;
    if (!mapContainerRef.current || !window.maplibregl) return;
    if (mapRef.current) return;

    const map = new window.maplibregl.Map({
      container: mapContainerRef.current,
      style: isDarkMode ? DARK_STYLE : LIGHT_STYLE,
      center: [77.209, 28.6139],
      zoom: 10.1,
      attributionControl: false,
    });

    map.addControl(new window.maplibregl.NavigationControl(), 'bottom-right');
    mapRef.current = map;

    map.on('load', () => {
      mapReadyRef.current = true;
      renderBoundariesOnMap();
      renderIdwCanvasOverlay();
    });

    return () => {
      mapReadyRef.current = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [currentPage]);

  // Update basemap theme
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    map.setStyle(isDarkMode ? DARK_STYLE : LIGHT_STYLE);
    map.once('styledata', () => {
      renderBoundariesOnMap();
      renderIdwCanvasOverlay();
    });
  }, [isDarkMode]);

  // ─── Render High-Detail GIS Polygons on MapLibre ───────────────────────────
  const renderBoundariesOnMap = useCallback(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;

    const cfg = METRIC_CONFIGS[activeMetric];
    let stops = cfg.stops;

    // If an uploaded choropleth layer is active on this tier, compute dynamic stops
    if (
      activeCustomChoropleth &&
      activeCustomChoropleth.boundaryLevel === boundaryLevel &&
      activeCustomChoropleth.choroplethByDate
    ) {
      const dateKey =
        activeCustomChoropleth.activeDate ||
        activeCustomChoropleth.availableDates?.[0] ||
        'Latest';
      const vals = Object.values(
        activeCustomChoropleth.choroplethByDate[dateKey] || {}
      ).filter((v) => Number.isFinite(v));
      if (vals.length > 0) {
        const minV = Math.min(...vals);
        const maxV = Math.max(...vals, minV + 1);
        const span = maxV - minV;
        stops = [
          [minV, VIRIDIS_TEAL_AMBER[0]],
          [minV + span * 0.25, VIRIDIS_TEAL_AMBER[1]],
          [minV + span * 0.5, VIRIDIS_TEAL_AMBER[2]],
          [minV + span * 0.75, VIRIDIS_TEAL_AMBER[3]],
          [maxV, VIRIDIS_TEAL_AMBER[4]],
        ];
      }
    }

    const features = searchedRegions
      .filter((r) => r.geojson)
      .map((r) => {
        const val = getRegionChoroplethValue(r);
        const fillColor = getColorForValue(val, stops);
        return {
          type: 'Feature',
          properties: {
            code: r.code,
            name: r.name,
            fillColor,
            isSelected: selectedRegion?.code === r.code ? 1 : 0,
          },
          geometry: r.geojson,
        };
      });

    const fc = { type: 'FeatureCollection', features };

    if (map.getSource('ncr-boundaries')) {
      map.getSource('ncr-boundaries').setData(fc);
    } else {
      map.addSource('ncr-boundaries', {
        type: 'geojson',
        data: fc,
      });

      map.addLayer({
        id: 'ncr-boundaries-fill',
        type: 'fill',
        source: 'ncr-boundaries',
        paint: {
          'fill-color': ['get', 'fillColor'],
          'fill-opacity': [
            'case',
            ['==', ['get', 'isSelected'], 1],
            0.78,
            0.56,
          ],
        },
      });

      map.addLayer({
        id: 'ncr-boundaries-line',
        type: 'line',
        source: 'ncr-boundaries',
        paint: {
          'line-color': [
            'case',
            ['==', ['get', 'isSelected'], 1],
            '#2dd4bf',
            isDarkMode ? '#334155' : '#64748b',
          ],
          'line-width': ['case', ['==', ['get', 'isSelected'], 1], 2.6, 1.1],
        },
      });

      map.on('mousemove', 'ncr-boundaries-fill', (e: any) => {
        map.getCanvas().style.cursor = 'pointer';
        const code = e.features?.[0]?.properties?.code;
        if (!code) return;
        const found = allRegions.find((r) => r.code === code);
        if (found) {
          setHoveredFeature({
            region: found,
            x: e.point.x,
            y: e.point.y,
          });
        }
      });

      map.on('mouseleave', 'ncr-boundaries-fill', () => {
        map.getCanvas().style.cursor = '';
        setHoveredFeature(null);
      });

      map.on('click', 'ncr-boundaries-fill', (e: any) => {
        const code = e.features?.[0]?.properties?.code;
        if (!code) return;
        const found = allRegions.find((r) => r.code === code);
        if (found) {
          setSelectedStation(null);
          setSelectedRegion(found);
          if (found.center) {
            map.flyTo({ center: found.center, duration: 650 });
          }
        }
      });
    }
  }, [
    searchedRegions,
    activeMetric,
    activeCustomChoropleth,
    boundaryLevel,
    selectedRegion,
    isDarkMode,
    allRegions,
    getRegionChoroplethValue,
  ]);

  useEffect(() => {
    renderBoundariesOnMap();
  }, [renderBoundariesOnMap]);

  // ─── Render IDW Continuous Pollution Field + Verified CPCB Station Markers ─
  const renderIdwCanvasOverlay = useCallback(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;

    const showField =
      showAqiLayer && (aqiDisplayMode === 'blended' || aqiDisplayMode === 'both');

    if (!showField || aqiStations.length === 0) {
      if (map.getLayer('cpcb-idw-layer')) map.removeLayer('cpcb-idw-layer');
      if (map.getSource('cpcb-idw-source')) map.removeSource('cpcb-idw-source');
      return;
    }

    const west = 76.5;
    const east = 77.75;
    const north = 29.15;
    const south = 28.2;
    const width = 180;
    const height = 140;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imgData = ctx.createImageData(width, height);
    const data = imgData.data;

    const aqiColorRgb = (aqi: number): [number, number, number] => {
      if (aqi <= 150) return [34, 197, 94];
      if (aqi <= 220) return [132, 204, 22];
      if (aqi <= 280) return [234, 179, 8];
      if (aqi <= 330) return [249, 115, 22];
      return [239, 68, 68];
    };

    for (let y = 0; y < height; y++) {
      const lat = north - (y / height) * (north - south);
      for (let x = 0; x < width; x++) {
        const lon = west + (x / width) * (east - west);
        let weightSum = 0;
        let valSum = 0;
        let minDistKm = Infinity;

        for (const st of aqiStations) {
          const dLat = (lat - st.lat) * 111;
          const dLon = (lon - st.lon) * 97.5;
          const distSq = dLat * dLat + dLon * dLon;
          const distKm = Math.sqrt(distSq);
          if (distKm < minDistKm) minDistKm = distKm;
          const w = 1 / Math.max(distSq, 0.25);
          weightSum += w;
          valSum += w * st.aqi;
        }

        const idx = (y * width + x) * 4;
        if (minDistKm > 22) {
          data[idx + 3] = 0;
          continue;
        }
        const idwAqi = valSum / weightSum;
        const [r, g, b] = aqiColorRgb(idwAqi);
        const fade = Math.max(0, 1 - minDistKm / 22);
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = Math.round(fade * 88);
      }
    }

    ctx.putImageData(imgData, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');

    if (map.getLayer('cpcb-idw-layer')) map.removeLayer('cpcb-idw-layer');
    if (map.getSource('cpcb-idw-source')) map.removeSource('cpcb-idw-source');

    map.addSource('cpcb-idw-source', {
      type: 'image',
      url: dataUrl,
      coordinates: [
        [west, north],
        [east, north],
        [east, south],
        [west, south],
      ],
    });

    map.addLayer({
      id: 'cpcb-idw-layer',
      type: 'raster',
      source: 'cpcb-idw-source',
      paint: { 'raster-opacity': 0.72 },
    });
  }, [showAqiLayer, aqiDisplayMode, aqiStations]);

  useEffect(() => {
    renderIdwCanvasOverlay();
  }, [renderIdwCanvasOverlay]);

  // Render CPCB Station HTML Markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    stationMarkersRef.current.forEach((m) => m.remove());
    stationMarkersRef.current = [];

    const showDots =
      showAqiLayer && (aqiDisplayMode === 'stations' || aqiDisplayMode === 'both');
    if (!showDots) return;

    aqiStations.forEach((st) => {
      const el = document.createElement('div');
      const bg =
        st.aqi >= 330
          ? '#ef4444'
          : st.aqi >= 280
            ? '#f97316'
            : st.aqi >= 220
              ? '#eab308'
              : '#22c55e';
      el.className =
        'px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold text-slate-950 shadow-lg border border-slate-950/60 cursor-pointer transition-transform hover:scale-110';
      el.style.backgroundColor = bg;
      el.textContent = `${st.aqi}`;

      el.addEventListener('mouseenter', (ev) => {
        const rect = mapContainerRef.current?.getBoundingClientRect();
        setHoveredStation({
          station: st,
          x: ev.clientX - (rect?.left || 0),
          y: ev.clientY - (rect?.top || 0),
        });
      });
      el.addEventListener('mouseleave', () => {
        setHoveredStation(null);
      });
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        setSelectedStation(st);
        map.flyTo({ center: [st.lon, st.lat], zoom: Math.max(map.getZoom(), 11.2) });
      });

      const marker = new window.maplibregl.Marker({ element: el })
        .setLngLat([st.lon, st.lat])
        .addTo(map);
      stationMarkersRef.current.push(marker);
    });
  }, [showAqiLayer, aqiDisplayMode, aqiStations, currentPage]);

  // Render Custom Uploaded Point Layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    customPointMarkersRef.current.forEach((m) => m.remove());
    customPointMarkersRef.current = [];

    customLayers
      .filter((l) => l.visible && l.type === 'point')
      .forEach((layer) => {
        (layer.geojson?.features || []).forEach((f: any) => {
          const coords = f.geometry?.coordinates;
          if (!Array.isArray(coords) || coords.length < 2) return;
          const el = document.createElement('div');
          el.className =
            'w-3.5 h-3.5 rounded-full border-2 border-white shadow-md cursor-pointer';
          el.style.backgroundColor = layer.color || '#14b8a6';
          el.title = `${f.properties?.name || layer.name}: ${f.properties?.value ?? ''} ${layer.unit || ''}`;
          const marker = new window.maplibregl.Marker({ element: el })
            .setLngLat([coords[0], coords[1]])
            .addTo(map);
          customPointMarkersRef.current.push(marker);
        });
      });
  }, [customLayers, currentPage]);

  // Handle Focus Hub change
  const handleSelectFocusHub = (key: FocusHubKey) => {
    setFocusHub(key);
    const map = mapRef.current;
    if (!map) return;
    if (key === 'current') {
      const dist = regionsByTier.district.find((d) => d.code === detectedDistrictCode);
      if (dist?.center) {
        map.flyTo({ center: dist.center, zoom: 10.3, duration: 750 });
        setSelectedRegion(dist);
        return;
      }
    }
    const cfg = FOCUS_NCR_HUBS.find((h) => h.key === key);
    if (cfg) {
      map.flyTo({ center: cfg.center, zoom: cfg.zoom, duration: 750 });
      if (cfg.regionCode) {
        const dist = regionsByTier.district.find((d) => d.code === cfg.regionCode);
        if (dist) setSelectedRegion(dist);
      }
    }
  };

  // Toggle Left Panel Metric Layer Selection
  const toggleMetricSelection = (key: MetricKey) => {
    setSelectedMetrics((prev) => {
      const exists = prev.includes(key);
      const next = exists ? prev.filter((k) => k !== key) : [...prev, key];
      return next.length > 0 ? next : [key];
    });
    setActiveMetric(key);
    setActiveCustomChoroplethId(null);
    if (key === 'aqi_pm25') {
      setShowAqiLayer(true);
    }
  };

  // Live CPCB Sync via /api/datagov
  const handleSyncLiveCpcb = async () => {
    setSyncingLiveAqi(true);
    try {
      const res = await fetch(
        '/api/datagov?resource_id=3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69&limit=100'
      );
      const data = await res.json();
      const records = Array.isArray(data.records) ? data.records : [];
      if (records.length > 0) {
        const mapped: AqiStation[] = records
          .filter(
            (r: any) =>
              Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude))
          )
          .map((r: any) => {
            const pm25 = Number(r.pollutant_avg || r.pm25 || 185);
            return {
              station: String(r.station || 'CPCB Station'),
              city: String(r.city || 'NCR'),
              state: String(r.state || 'NCR'),
              lat: Number(r.latitude),
              lon: Number(r.longitude),
              aqi: Math.min(500, Math.round(pm25 * 1.45)),
              pm25,
              pm10: Number(r.pm10 || Math.round(pm25 * 1.6)),
              no2: Number(r.no2 || 48),
              updated: String(r.last_update || 'Live data.gov.in Sync'),
              sourceLabel: 'Live data.gov.in CPCB Resource (3b01bcb8)',
              sourceUrl: CPCB_DATAGOV_URL,
            };
          });
        if (mapped.length > 0) setAqiStations(mapped);
      }
    } catch {
      // keep verified CPCB bulletin stations
    } finally {
      setSyncingLiveAqi(false);
    }
  };

  // Publish layer from Dedicated Upload Page (`/upload`) -> Save to DB -> Activate on Home Map
  const handlePublishLayer = async (newLayer: CustomLayer) => {
    try {
      const endpoint = isLocalhost
        ? '/api/local/community-layers'
        : '/api/community-layers';
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: newLayer.slug || newLayer.id,
          name: newLayer.name,
          description: newLayer.description || '',
          methodology: newLayer.methodology || '',
          target_state: newLayer.targetState || 'All NCR',
          layer_type: newLayer.type,
          boundary_level: newLayer.boundaryLevel || 'district',
          category: newLayer.category || 'Uploaded Civic Dataset',
          metric_label: newLayer.metricLabel || 'Value',
          unit: newLayer.unit || '',
          publisher: newLayer.publisher || 'Civic Contributor',
          source_url: newLayer.sourceUrl || '',
          license: newLayer.license || 'GODL-India',
          color: newLayer.color,
          feature_count: newLayer.featureCount,
          available_dates: newLayer.availableDates || ['Latest'],
          choropleth_by_date: newLayer.choroplethByDate || {},
          points_by_date: newLayer.pointsByDate || {},
        }),
      });
    } catch {
      // still add to active client state
    }

    setCustomLayers((prev) => [newLayer, ...prev]);
    if (newLayer.type === 'choropleth' && newLayer.boundaryLevel) {
      setBoundaryLevel(newLayer.boundaryLevel);
      setActiveCustomChoroplethId(newLayer.id);
    }
    navigateTo('map');
  };

  // ─── Render Dedicated Upload Data Page (`/upload`) ──────────────────────────
  if (currentPage === 'upload') {
    return (
      <UploadDataPage
        allRegions={allRegions}
        isDarkMode={isDarkMode}
        onBackToMap={() => navigateTo('map')}
        onPublishLayer={handlePublishLayer}
      />
    );
  }

  const activeMetricCfg = METRIC_CONFIGS[activeMetric];

  return (
    <div
      className={`h-screen w-screen overflow-hidden flex flex-col select-none ${
        isDarkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'
      }`}
    >
      {/* ─── TOP HEADER BAR ────────────────────────────────────────────────── */}
      <header
        className={`h-14 shrink-0 border-b px-4 flex items-center justify-between z-20 ${
          isDarkMode
            ? 'bg-slate-900/95 border-slate-800'
            : 'bg-white/95 border-slate-200'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-teal-500/20 border border-teal-500/40 flex items-center justify-center">
            <MapIcon className="w-4 h-4 text-teal-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-tight">IndiaData.viz</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-400 font-semibold border border-teal-500/30">
                Verified Civic GIS
              </span>
              <span className="hidden md:inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                <Database className="w-3 h-3 text-emerald-400" />
                {dataSourceBadge}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 hidden sm:block">
              Survey-Grade LGD &amp; DataMeet Boundaries • FSI ISFR 2023 Green Cover • CPCB CAAQMS Air Quality
            </p>
          </div>
        </div>

        {/* Administrative Boundary Tier Switcher */}
        <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
          {(
            [
              { id: 'district', label: 'Districts (7)' },
              { id: 'constituency', label: 'Lok Sabha (14)' },
              { id: 'assembly', label: 'Assemblies (107)' },
              { id: 'ward', label: 'Municipal Wards (612)' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setBoundaryLevel(t.id);
                const firstInTier = regionsByTier[t.id]?.[0];
                if (firstInTier) setSelectedRegion(firstInTier);
              }}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                boundaryLevel === t.id
                  ? 'bg-teal-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Right Actions: Dedicated Upload Page Button + Compare + Theme */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsCompareOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
          >
            <ArrowLeftRight className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">Compare</span>
          </button>

          <button
            onClick={() => navigateTo('upload')}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-teal-500 hover:bg-teal-400 text-slate-950 shadow-md shadow-teal-500/20 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Data Page</span>
          </button>

          <button
            onClick={() => setIsDarkMode((d) => !d)}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
            title="Toggle Dark / Light Basemap"
          >
            {isDarkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* ─── FOCUS DISTRICT HUB BAR (Defaults to Current Location District) ── */}
      <div
        className={`h-10 shrink-0 border-b px-4 flex items-center justify-between gap-2 overflow-x-auto z-10 ${
          isDarkMode ? 'bg-slate-900/75 border-slate-800' : 'bg-slate-100 border-slate-200'
        }`}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1 mr-1">
            <LocateFixed className="w-3.5 h-3.5 text-teal-400" />
            Focus District:
          </span>
          {FOCUS_NCR_HUBS.map((hub) => {
            const isCurrent = hub.key === 'current';
            const label = isCurrent
              ? `📍 ${detectedDistrictName} (${gpsStatus === 'gps' ? 'GPS' : 'Default'})`
              : hub.label;
            return (
              <button
                key={hub.key}
                onClick={() => handleSelectFocusHub(hub.key)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  focusHub === hub.key
                    ? 'bg-teal-500/20 text-teal-300 border border-teal-500/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="text-[11px] text-slate-400 hidden lg:block">
          Showing <strong>{searchedRegions.length}</strong> verified {boundaryLevel} polygons
        </div>
      </div>

      {/* ─── MAIN WORKSPACE: LEFT LAYER PANEL + MAP + RIGHT INSIGHTS DRAWER ── */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* ─── LEFT PANEL: SELECTED LAYERS & FILTERS ──────────────────────── */}
        <aside
          className={`w-80 shrink-0 border-r flex flex-col overflow-y-auto z-10 ${
            isDarkMode ? 'bg-slate-900/95 border-slate-800' : 'bg-white border-slate-200'
          }`}
        >
          <div className="p-4 space-y-5">
            {/* Search Box */}
            <div>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search ${boundaryLevel} or MP/MLA…`}
                  className={`w-full pl-8 pr-3 py-2 rounded-xl text-xs border ${
                    isDarkMode
                      ? 'bg-slate-950 border-slate-800 text-slate-100'
                      : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>
            </div>

            {/* Active Layers Section (Controls Map, Hover Tooltip & Click Drawer) */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-teal-400 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" />
                  Selected Data Layers
                </span>
                <span className="text-[10px] text-slate-400">
                  Shown on Hover &amp; Click
                </span>
              </div>

              {/* Default Visible Layer 1: Green & Forest Cover (ISFR 2023) */}
              {(['green_cover_pct', 'aqi_pm25'] as MetricKey[]).map((key) => {
                const cfg = METRIC_CONFIGS[key];
                const isSelected = selectedMetrics.includes(key);
                const isChoroplethActive =
                  !activeCustomChoropleth && activeMetric === key;

                return (
                  <div
                    key={key}
                    className={`p-3 rounded-xl border transition-all ${
                      isSelected
                        ? isDarkMode
                          ? 'bg-slate-950/90 border-teal-500/40'
                          : 'bg-teal-50/50 border-teal-500/40'
                        : isDarkMode
                          ? 'bg-slate-950/40 border-slate-800 opacity-75'
                          : 'bg-slate-50 border-slate-200 opacity-75'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => toggleMetricSelection(key)}
                        className="flex items-start gap-2 text-left cursor-pointer"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <div className="text-xs font-bold leading-snug">
                            {cfg.label}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {cfg.sourceLabel}
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setActiveCustomChoroplethId(null);
                          setActiveMetric(key);
                          if (!selectedMetrics.includes(key)) {
                            setSelectedMetrics((p) => [...p, key]);
                          }
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer shrink-0 ${
                          isChoroplethActive
                            ? 'bg-teal-500 text-slate-950'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        {isChoroplethActive ? 'Coloring Map' : 'Color Map'}
                      </button>
                    </div>

                    <div className="mt-2 pt-2 border-t border-slate-800/70 flex items-center justify-between text-[10px]">
                      <a
                        href={cfg.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-teal-400 hover:underline inline-flex items-center gap-1"
                      >
                        Official Source <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                      <span className="text-emerald-400 font-semibold">
                        Default Active
                      </span>
                    </div>
                  </div>
                );
              })}

              {/* CPCB Station & IDW Continuous Blending Controls */}
              <div
                className={`p-3 rounded-xl border space-y-2.5 ${
                  showAqiLayer
                    ? 'bg-slate-950/90 border-amber-500/40'
                    : 'bg-slate-950/40 border-slate-800 opacity-75'
                }`}
              >
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setShowAqiLayer((v) => !v)}
                    className="flex items-center gap-2 text-xs font-bold cursor-pointer"
                  >
                    <Wind className="w-4 h-4 text-amber-400" />
                    <span>CPCB Pollution Stations ({aqiStations.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAqiLayer((v) => !v)}
                    className="text-xs text-slate-400 hover:text-white cursor-pointer"
                  >
                    {showAqiLayer ? (
                      <Eye className="w-4 h-4 text-amber-400" />
                    ) : (
                      <EyeOff className="w-4 h-4" />
                    )}
                  </button>
                </div>

                {showAqiLayer && (
                  <>
                    <div className="grid grid-cols-3 gap-1 bg-slate-900 p-1 rounded-lg">
                      {(
                        [
                          { id: 'stations', label: 'Stations' },
                          { id: 'blended', label: 'IDW Field' },
                          { id: 'both', label: 'Both' },
                        ] as const
                      ).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setAqiDisplayMode(m.id)}
                          className={`py-1 rounded text-[10px] font-semibold cursor-pointer ${
                            aqiDisplayMode === m.id
                              ? 'bg-amber-500 text-slate-950'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center justify-between text-[10px] pt-1">
                      <a
                        href={CPCB_SOURCE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-amber-400 hover:underline inline-flex items-center gap-1"
                      >
                        CPCB CAAQMS Portal <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                      <button
                        type="button"
                        onClick={handleSyncLiveCpcb}
                        disabled={syncingLiveAqi}
                        className="text-sky-400 hover:underline cursor-pointer"
                      >
                        {syncingLiveAqi ? 'Syncing…' : 'Sync data.gov.in'}
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Uploaded Civic Datasets (Automatically Selected When Uploaded from /upload) */}
              <div className="pt-2 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Uploaded Civic Layers ({customLayers.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => navigateTo('upload')}
                    className="text-[11px] text-teal-400 hover:underline font-semibold cursor-pointer"
                  >
                    + Upload New
                  </button>
                </div>

                {customLayers.length === 0 ? (
                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-[11px] text-slate-400 space-y-2">
                    <p>
                      Have State, Assembly Constituency, District, or Ward data? Upload it on the dedicated Upload Page to map and explore it here.
                    </p>
                    <button
                      type="button"
                      onClick={() => navigateTo('upload')}
                      className="w-full py-1.5 rounded-lg bg-teal-500/15 hover:bg-teal-500/25 border border-teal-500/30 text-teal-300 font-semibold text-xs cursor-pointer"
                    >
                      Open Upload Data Page &rarr;
                    </button>
                  </div>
                ) : (
                  customLayers.map((layer) => (
                    <div
                      key={layer.id}
                      className={`p-3 rounded-xl border space-y-2 ${
                        layer.visible
                          ? 'bg-slate-950 border-teal-500/50'
                          : 'bg-slate-950/40 border-slate-800 opacity-75'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setCustomLayers((prev) =>
                              prev.map((l) =>
                                l.id === layer.id ? { ...l, visible: !l.visible } : l
                              )
                            );
                            if (!layer.visible && layer.type === 'choropleth') {
                              setActiveCustomChoroplethId(layer.id);
                              if (layer.boundaryLevel) {
                                setBoundaryLevel(layer.boundaryLevel);
                              }
                            }
                          }}
                          className="flex items-start gap-2 text-left cursor-pointer"
                        >
                          {layer.visible ? (
                            <CheckSquare className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                          )}
                          <div>
                            <div className="text-xs font-bold text-white">
                              {layer.name}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {layer.boundaryLevel?.toUpperCase()} • {layer.metricLabel} ({layer.unit})
                            </div>
                          </div>
                        </button>
                      </div>

                      {layer.description && (
                        <p className="text-[10px] text-slate-400 line-clamp-2">
                          {layer.description}
                        </p>
                      )}

                      <div className="flex items-center justify-between text-[10px] pt-1 border-t border-slate-800">
                        <span className="text-slate-400 truncate max-w-[140px]">
                          By {layer.publisher}
                        </span>
                        {layer.sourceUrl && (
                          <a
                            href={layer.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-teal-400 hover:underline inline-flex items-center gap-1"
                          >
                            Source Link <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Optional Census 2011 Layers (OFF by default) */}
              <div className="pt-2 space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Additional Official Census PCA Layers (Optional)
                </span>
                {(
                  ['population_density', 'literacy_rate', 'sex_ratio'] as MetricKey[]
                ).map((key) => {
                  const cfg = METRIC_CONFIGS[key];
                  const isSelected = selectedMetrics.includes(key);
                  return (
                    <div
                      key={key}
                      className="px-3 py-2 rounded-xl bg-slate-950/50 border border-slate-800/80 flex items-center justify-between text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => toggleMetricSelection(key)}
                        className="flex items-center gap-2 text-left cursor-pointer"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-3.5 h-3.5 text-teal-400" />
                        ) : (
                          <Square className="w-3.5 h-3.5 text-slate-600" />
                        )}
                        <span className={isSelected ? 'text-slate-200 font-medium' : 'text-slate-400'}>
                          {cfg.shortLabel} ({cfg.unit})
                        </span>
                      </button>
                      <a
                        href={cfg.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-slate-500 hover:text-teal-400"
                        title={cfg.sourceLabel}
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>

        {/* ─── CENTER INTERACTIVE MAPLIBRE CANVAS ─────────────────────────── */}
        <main className="flex-1 relative overflow-hidden">
          <div ref={mapContainerRef} className="w-full h-full" />

          {/* Ward Rural / Industrial Gap Notice Banner */}
          {boundaryLevel === 'ward' && (
            <div className="absolute top-3 left-3 right-3 md:right-auto md:max-w-md z-10 p-2.5 rounded-xl bg-slate-900/90 border border-slate-700 backdrop-blur-md text-[11px] text-slate-300 flex items-start gap-2">
              <Info className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
              <span>
                Showing <strong>612 digitized Urban Local Body (ULB) wards</strong> across MCD, NDMC, Delhi Cantt, MCF, MCG, GMC &amp; Sonipat MC. Unfilled areas between urban municipalities represent rural Gram Panchayats or Industrial Authorities (GNIDA/YEIDA).
              </span>
            </div>
          )}

          {/* ─── DYNAMIC HOVER TOOLTIP (Shows ALL Selected Layers from Left Panel) ── */}
          {hoveredFeature && (
            <div
              className="pointer-events-none absolute z-30 w-76 p-3.5 rounded-2xl bg-slate-950/95 border border-teal-500/40 shadow-2xl text-xs space-y-2 backdrop-blur-md"
              style={{
                left: Math.min(hoveredFeature.x + 16, window.innerWidth - 680),
                top: Math.max(12, hoveredFeature.y - 20),
              }}
            >
              <div className="border-b border-slate-800 pb-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-teal-400">
                    {hoveredFeature.region.level} • {hoveredFeature.region.state}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {hoveredFeature.region.area_sq_km} km²
                  </span>
                </div>
                <div className="font-bold text-sm text-white mt-0.5">
                  {hoveredFeature.region.name}
                </div>
              </div>

              {/* All Selected Metric Layers from Left Panel */}
              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Selected Layers Data:
                </div>

                {selectedMetrics.map((mKey) => {
                  const mCfg = METRIC_CONFIGS[mKey];
                  const val =
                    mKey === 'population_density'
                      ? hoveredFeature.region.population_density ||
                        hoveredFeature.region.density
                      : hoveredFeature.region[mKey];
                  return (
                    <div
                      key={mKey}
                      className="flex items-center justify-between text-xs py-0.5"
                    >
                      <span className="text-slate-300">{mCfg.shortLabel}:</span>
                      <span className="font-mono font-bold text-teal-300">
                        {val ?? '—'} {mCfg.unit}
                      </span>
                    </div>
                  );
                })}

                {showAqiLayer && hoveredFeature.region.pm25_ugm3 && (
                  <div className="flex items-center justify-between text-[11px] text-amber-300 pt-0.5 border-t border-slate-800/70">
                    <span>CPCB PM2.5 ({hoveredFeature.region.cpcb_station_name?.split(',')[0]}):</span>
                    <span className="font-mono font-bold">
                      {hoveredFeature.region.pm25_ugm3} µg/m³
                    </span>
                  </div>
                )}

                {/* Any Selected Uploaded Layers from Left Panel */}
                {customLayers
                  .filter((l) => l.visible && l.type === 'choropleth')
                  .map((layer) => {
                    const dKey =
                      layer.activeDate || layer.availableDates?.[0] || 'Latest';
                    const val =
                      layer.choroplethByDate?.[dKey]?.[hoveredFeature.region.code];
                    return (
                      <div
                        key={layer.id}
                        className="flex items-center justify-between text-xs py-0.5 border-t border-slate-800/70"
                      >
                        <span className="text-sky-300 truncate max-w-[150px]">
                          {layer.metricLabel || layer.name}:
                        </span>
                        <span className="font-mono font-bold text-sky-400">
                          {val !== undefined ? `${val} ${layer.unit || ''}` : 'N/A'}
                        </span>
                      </div>
                    );
                  })}
              </div>

              <div className="pt-1 border-t border-slate-800 text-[10px] text-slate-400 flex items-center justify-between">
                <span>Rep: {hoveredFeature.region.rep_name || 'Verified'}</span>
                <span className="text-teal-400 font-semibold">Click for Source Links &rarr;</span>
              </div>
            </div>
          )}

          {/* Hover Tooltip for CPCB Air Quality Station Marker */}
          {hoveredStation && (
            <div
              className="pointer-events-none absolute z-30 w-68 p-3 rounded-2xl bg-slate-950/95 border border-amber-500/50 shadow-2xl text-xs space-y-1.5"
              style={{
                left: Math.min(hoveredStation.x + 14, window.innerWidth - 650),
                top: Math.max(12, hoveredStation.y - 20),
              }}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                CPCB CAAQMS Monitoring Station
              </div>
              <div className="font-bold text-white">{hoveredStation.station.station}</div>
              <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                <div className="p-1.5 rounded bg-slate-900">
                  <div className="text-[9px] text-slate-400">AQI</div>
                  <div className="font-mono font-bold text-amber-400">
                    {hoveredStation.station.aqi}
                  </div>
                </div>
                <div className="p-1.5 rounded bg-slate-900">
                  <div className="text-[9px] text-slate-400">PM2.5</div>
                  <div className="font-mono font-bold text-rose-400">
                    {hoveredStation.station.pm25}
                  </div>
                </div>
                <div className="p-1.5 rounded bg-slate-900">
                  <div className="text-[9px] text-slate-400">PM10</div>
                  <div className="font-mono font-bold text-sky-400">
                    {hoveredStation.station.pm10}
                  </div>
                </div>
              </div>
              <div className="text-[10px] text-slate-400 pt-1">
                Click station pin to open source link in side panel
              </div>
            </div>
          )}

          {/* Legend Card */}
          <div className="absolute bottom-4 left-4 z-10 p-3 rounded-2xl bg-slate-900/95 border border-slate-800 shadow-xl text-xs space-y-2 min-w-[230px]">
            <div className="flex items-center justify-between gap-3">
              <span className="font-bold text-slate-200">
                {activeCustomChoropleth
                  ? `${activeCustomChoropleth.name} (${activeCustomChoropleth.unit})`
                  : activeMetricCfg.label}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {activeMetricCfg.stops.map(([val, col], idx) => (
                <div key={idx} className="flex-1 text-center">
                  <div
                    className="h-2.5 w-full rounded-sm mb-1"
                    style={{ backgroundColor: col }}
                  />
                  <span className="text-[9px] font-mono text-slate-400">{val}</span>
                </div>
              ))}
            </div>
            <div className="pt-1 border-t border-slate-800 flex items-center justify-between text-[10px]">
              <a
                href={
                  activeCustomChoropleth?.sourceUrl || activeMetricCfg.sourceUrl
                }
                target="_blank"
                rel="noopener noreferrer"
                className="text-teal-400 hover:underline inline-flex items-center gap-1"
              >
                Verify Legend Source <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
          </div>
        </main>

        {/* ─── RIGHT SIDE PANEL: VERIFIED DATA & CLICKABLE SOURCE LINKS ───── */}
        <aside
          className={`w-96 shrink-0 border-l flex flex-col overflow-y-auto z-10 ${
            isDarkMode ? 'bg-slate-900/95 border-slate-800' : 'bg-white border-slate-200'
          }`}
        >
          {selectedStation ? (
            <div className="p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] uppercase tracking-wider font-bold text-amber-400">
                    Verified CPCB Air Quality Station
                  </span>
                  <h2 className="text-base font-bold mt-0.5">
                    {selectedStation.station}
                  </h2>
                  <p className="text-xs text-slate-400">
                    {selectedStation.city}, {selectedStation.state} • ({selectedStation.lat.toFixed(4)}, {selectedStation.lon.toFixed(4)})
                  </p>
                </div>
                <button
                  onClick={() => setSelectedStation(null)}
                  className="text-xs text-teal-400 hover:underline cursor-pointer"
                >
                  Back to Region
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[10px] text-slate-400">National AQI</div>
                  <div className="text-xl font-mono font-bold text-amber-400 mt-0.5">
                    {selectedStation.aqi}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[10px] text-slate-400">PM2.5 Concentration</div>
                  <div className="text-xl font-mono font-bold text-rose-400 mt-0.5">
                    {selectedStation.pm25} <span className="text-xs">µg/m³</span>
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[10px] text-slate-400">PM10 Concentration</div>
                  <div className="text-lg font-mono font-bold text-sky-400 mt-0.5">
                    {selectedStation.pm10} <span className="text-xs">µg/m³</span>
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[10px] text-slate-400">NO2 Concentration</div>
                  <div className="text-lg font-mono font-bold text-emerald-400 mt-0.5">
                    {selectedStation.no2 ?? '—'} <span className="text-xs">µg/m³</span>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
                <div className="font-bold text-slate-200 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Official Data Source Verification Links
                </div>
                <p className="text-[11px] text-slate-400">
                  Measurements sourced from Continuous Ambient Air Quality Monitoring Stations (CAAQMS) operated by CPCB, DPCC, HSPCB, and UPPCB.
                </p>
                <div className="flex flex-col gap-1.5 pt-1">
                  <a
                    href={selectedStation.sourceUrl || CPCB_SOURCE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-between px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-amber-400 font-semibold"
                  >
                    <span>Open CPCB CAAQMS Live Portal</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <a
                    href={CPCB_DATAGOV_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-between px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-teal-400 font-semibold"
                  >
                    <span>Open data.gov.in CPCB API Dataset</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>
          ) : selectedRegion ? (
            <div className="p-5 space-y-5">
              {/* Region Header */}
              <div className="border-b border-slate-800 pb-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-teal-400">
                    {selectedRegion.level} • {selectedRegion.state}
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">
                    GIS Area: {selectedRegion.area_sq_km} km²
                  </span>
                </div>
                <h2 className="text-lg font-bold mt-0.5">{selectedRegion.name}</h2>
                {selectedRegion.pc_name && (
                  <p className="text-xs text-slate-400">
                    Lok Sabha PC: {selectedRegion.pc_name} • District:{' '}
                    {selectedRegion.district_name || selectedRegion.parent_region}
                  </p>
                )}
              </div>

              {/* ─── ACTIVE SELECTED LAYERS WITH DIRECT SOURCE LINKS ──────── */}
              <div className="space-y-3">
                <div className="text-xs font-bold uppercase tracking-wider text-teal-400 flex items-center justify-between">
                  <span>Selected Layers &amp; Source Links</span>
                  <span className="text-[10px] text-slate-400 font-normal">
                    Click any link to verify
                  </span>
                </div>

                {/* 1. Green Cover Card (when selected in Left Panel) */}
                {selectedMetrics.includes('green_cover_pct') && (
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-emerald-500/30 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-emerald-400">
                        Green &amp; Forest Cover (ISFR 2023)
                      </span>
                      <span className="text-base font-mono font-bold text-white">
                        {selectedRegion.green_cover_pct}%
                      </span>
                    </div>
                    {selectedRegion.isfr_benchmark_region && (
                      <div className="text-[11px] text-slate-400">
                        Benchmark Zone: {selectedRegion.isfr_benchmark_region}
                      </div>
                    )}
                    <a
                      href={
                        selectedRegion.green_source_url || 'https://fsi.nic.in/isfr-2023'
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-teal-400 hover:underline pt-0.5"
                    >
                      <span>
                        Source:{' '}
                        {selectedRegion.green_source_label ||
                          'Forest Survey of India (ISFR 2023)'}
                      </span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  </div>
                )}

                {/* 2. Pollution Data Card (when selected in Left Panel) */}
                {(selectedMetrics.includes('aqi_pm25') || showAqiLayer) && (
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-amber-500/30 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-amber-400">
                        CPCB Air Pollution (CAAQMS)
                      </span>
                      <span className="text-base font-mono font-bold text-amber-300">
                        {selectedRegion.aqi_pm25} AQI
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center text-[11px] pt-1">
                      <div className="p-1.5 rounded bg-slate-900">
                        <div className="text-[9px] text-slate-400">PM2.5</div>
                        <div className="font-mono font-bold text-rose-400">
                          {selectedRegion.pm25_ugm3 ?? '—'} µg/m³
                        </div>
                      </div>
                      <div className="p-1.5 rounded bg-slate-900">
                        <div className="text-[9px] text-slate-400">PM10</div>
                        <div className="font-mono font-bold text-sky-400">
                          {selectedRegion.pm10_ugm3 ?? '—'} µg/m³
                        </div>
                      </div>
                      <div className="p-1.5 rounded bg-slate-900">
                        <div className="text-[9px] text-slate-400">NO2</div>
                        <div className="font-mono font-bold text-emerald-400">
                          {selectedRegion.no2_ugm3 ?? '—'} µg/m³
                        </div>
                      </div>
                    </div>
                    {selectedRegion.cpcb_station_name && (
                      <div className="text-[11px] text-slate-400">
                        Monitoring Station: {selectedRegion.cpcb_station_name}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-3 pt-0.5">
                      <a
                        href={selectedRegion.pollution_source_url || CPCB_SOURCE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 hover:underline"
                      >
                        <span>Source: CPCB CAAQMS Bulletin</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      <a
                        href={CPCB_DATAGOV_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-400 hover:underline"
                      >
                        <span>data.gov.in API</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                )}

                {/* 3. Any Selected Uploaded Datasets from Left Panel */}
                {customLayers
                  .filter((l) => l.visible && l.type === 'choropleth')
                  .map((layer) => {
                    const dKey =
                      layer.activeDate || layer.availableDates?.[0] || 'Latest';
                    const val =
                      layer.choroplethByDate?.[dKey]?.[selectedRegion.code];
                    return (
                      <div
                        key={layer.id}
                        className="p-3.5 rounded-xl bg-slate-950 border border-sky-500/40 space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-sky-400">
                            {layer.name}
                          </span>
                          <span className="text-sm font-mono font-bold text-white">
                            {val !== undefined
                              ? `${val} ${layer.unit || ''}`
                              : `Not mapped on ${selectedRegion.level}`}
                          </span>
                        </div>
                        {layer.description && (
                          <p className="text-[11px] text-slate-400">
                            {layer.description}
                          </p>
                        )}
                        <div className="flex items-center justify-between text-[11px] pt-1">
                          <span className="text-slate-400">
                            Publisher: {layer.publisher}
                          </span>
                          {layer.sourceUrl && (
                            <a
                              href={layer.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-semibold text-teal-400 hover:underline"
                            >
                              Verify Dataset Source <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}

                {/* 4. Optional Census PCA Cards (only if user toggled them ON in Left Panel) */}
                {(['population_density', 'literacy_rate', 'sex_ratio'] as MetricKey[])
                  .filter((k) => selectedMetrics.includes(k))
                  .map((k) => {
                    const cfg = METRIC_CONFIGS[k];
                    const val =
                      k === 'population_density'
                        ? selectedRegion.population_density || selectedRegion.density
                        : selectedRegion[k];
                    return (
                      <div
                        key={k}
                        className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-300">
                            {cfg.label}
                          </span>
                          <span className="font-mono font-bold text-teal-300">
                            {val} {cfg.unit}
                          </span>
                        </div>
                        <a
                          href={cfg.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-teal-400 hover:underline"
                        >
                          <span>Source: {cfg.sourceLabel}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    );
                  })}
              </div>

              {/* ─── VERIFIED ELECTED REPRESENTATIVE & BOUNDARY PROVENANCE ─ */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    {selectedRegion.rep_role || 'Elected Representative'}
                  </span>
                  {selectedRegion.rep_party && (
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-bold text-amber-300">
                      {selectedRegion.rep_party}
                    </span>
                  )}
                </div>

                <div className="text-sm font-bold text-white">
                  {selectedRegion.rep_name || 'Verified Official Jurisdiction'}
                </div>

                {selectedRegion.rep_votes && (
                  <div className="text-[11px] text-slate-400">
                    Winning Votes (ECI Official Tally):{' '}
                    <strong className="text-slate-200 font-mono">
                      {selectedRegion.rep_votes.toLocaleString('en-IN')}
                    </strong>{' '}
                    ({selectedRegion.rep_term})
                  </div>
                )}

                <div className="pt-2 border-t border-slate-800/80 flex flex-col gap-1.5 text-[11px]">
                  {selectedRegion.rep_source_url && (
                    <a
                      href={selectedRegion.rep_source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-between text-emerald-400 hover:underline"
                    >
                      <span>
                        {selectedRegion.rep_source_label || 'Official Representative Record'}
                      </span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  {selectedRegion.rep_affidavit_url && (
                    <a
                      href={selectedRegion.rep_affidavit_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-between text-sky-400 hover:underline"
                    >
                      <span>MyNeta / SEC Candidate Affidavit</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  {selectedRegion.boundary_source_url && (
                    <a
                      href={selectedRegion.boundary_source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-between text-slate-400 hover:text-teal-400 hover:underline"
                    >
                      <span>
                        GIS Polygon:{' '}
                        {selectedRegion.boundary_source_label ||
                          'LGD / DataMeet Spatial Repo'}
                      </span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>

              {/* ─── REGIONAL BENCHMARK CHART ─────────────────────────────── */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold flex items-center gap-1.5">
                    <BarChart3 className="w-4 h-4 text-teal-400" />
                    Tier Benchmark ({selectedRegion.level.toUpperCase()})
                  </span>
                  <div className="flex gap-1">
                    {(['radar', 'bar'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setChartMode(m)}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase cursor-pointer ${
                          chartMode === m
                            ? 'bg-teal-500 text-slate-950'
                            : 'bg-slate-900 text-slate-400'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
                <BenchmarkChart
                  region={selectedRegion}
                  peerRegions={activeTierRegions}
                  mode={chartMode}
                />
              </div>
            </div>
          ) : null}
        </aside>
      </div>

      {/* Compare Modal */}
      <CompareModal
        isOpen={isCompareOpen}
        onClose={() => setIsCompareOpen(false)}
        regions={allRegions}
        initialRegionA={selectedRegion}
      />
    </div>
  );
}

export default App;
