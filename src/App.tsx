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
  Sun,
  Moon,
  ArrowLeftRight,
  ExternalLink,
  CheckCircle2,
  ShieldCheck,
  LocateFixed,
  BarChart3,
  Info,
  Sliders,
  Filter,
  Check,
  X,
  Sparkles,
} from 'lucide-react';

declare global {
  interface Window {
    maplibregl: any;
  }
}

const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const LIGHT_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

type LayerCategoryFilter = 'all' | 'environment' | 'demographics' | 'uploaded';

interface UnifiedCatalogItem {
  id: string;
  kind: 'builtin' | 'custom';
  metricKey?: MetricKey;
  customLayer?: CustomLayer;
  title: string;
  shortTitle: string;
  category: 'environment' | 'demographics' | 'uploaded';
  categoryLabel: string;
  geometryLabel: string;
  unit: string;
  publisher: string;
  sourceUrl: string;
  checked: boolean;
  opacity: number;
  color: string;
}

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
  const [metricOpacities, setMetricOpacities] = useState<Record<MetricKey, number>>({
    green_cover_pct: 0.68,
    aqi_pm25: 0.78,
    population_density: 0.68,
    literacy_rate: 0.68,
    sex_ratio: 0.68,
  });

  const [showAqiLayer, setShowAqiLayer] = useState<boolean>(true);
  const [aqiDisplayMode, setAqiDisplayMode] = useState<AqiDisplayMode>('both');

  // Left Panel Search & Category Filter
  const [layerSearchQuery, setLayerSearchQuery] = useState<string>('');
  const [layerCategoryFilter, setLayerCategoryFilter] =
    useState<LayerCategoryFilter>('all');

  // Region Search & Selection
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
  const allRegionsRef = useRef<Region[]>([]);

  // ─── 1. Load Verified GIS Boundaries ───────────────────────────────────────
  const fetchTierBoundaries = useCallback(
    async (tier: BoundaryLevel): Promise<Region[]> => {
      if (isLocalhost) {
        try {
          const localRes = await fetch(`/api/local/boundaries?level=${tier}`);
          if (localRes.ok) {
            const fc = await localRes.json();
            if (Array.isArray(fc.features) && fc.features.length > 0) {
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

      if (supabase) {
        try {
          const { data, error } = await supabase
            .from('boundary_features')
            .select('*')
            .eq('level', tier)
            .order('code', { ascending: true });

          if (!error && data && data.length > 0) {
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
          // fallback to static GeoJSON
        }
      }

      const fileMap: Record<BoundaryLevel, string> = {
        district: '/boundaries/districts.geojson',
        constituency: '/boundaries/constituencies.geojson',
        assembly: '/boundaries/assemblies.geojson',
        ward: '/boundaries/wards.geojson',
      };
      const res = await fetch(fileMap[tier]);
      const fc = await res.json();
      return (fc.features || []).map((f: any) => ({
        ...f.properties,
        geojson: f.geometry,
      }));
    },
    []
  );

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

  // Load user-uploaded layers
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
              opacity: 0.75,
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

  // Detect user's current district via GPS + Point-in-Polygon check
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

  useEffect(() => {
    allRegionsRef.current = allRegions;
  }, [allRegions]);

  // Filter current tier regions by Focus Hub (Current Location District by default)
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

  // Active Custom Choropleth Layer
  const activeCustomChoropleth = useMemo(() => {
    if (activeCustomChoroplethId) {
      const found = customLayers.find(
        (l) => l.id === activeCustomChoroplethId && l.visible && l.type === 'choropleth'
      );
      if (found) return found;
    }
    return customLayers.find((l) => l.visible && l.type === 'choropleth') || null;
  }, [customLayers, activeCustomChoroplethId]);

  // Active Choropleth Fill Opacity
  const activeChoroplethOpacity = useMemo(() => {
    if (activeCustomChoropleth) {
      return activeCustomChoropleth.opacity ?? 0.72;
    }
    if (selectedMetrics.includes(activeMetric)) {
      return metricOpacities[activeMetric] ?? 0.68;
    }
    const firstCheckedChoropleth = selectedMetrics.find((m) => m !== 'aqi_pm25') || selectedMetrics[0];
    if (firstCheckedChoropleth) {
      return metricOpacities[firstCheckedChoropleth] ?? 0.68;
    }
    return 0.08;
  }, [activeCustomChoropleth, selectedMetrics, activeMetric, metricOpacities]);

  // Effective Metric Key coloring the polygons
  const effectiveChoroplethMetric = useMemo<MetricKey | null>(() => {
    if (activeCustomChoropleth) return null;
    if (selectedMetrics.includes(activeMetric)) return activeMetric;
    const fallback = selectedMetrics.find((k) => k !== 'aqi_pm25') || selectedMetrics[0];
    return fallback || null;
  }, [activeCustomChoropleth, selectedMetrics, activeMetric]);

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
      const mKey = effectiveChoroplethMetric || 'green_cover_pct';
      if (mKey === 'population_density') {
        return Number(region.population_density || region.density || 0);
      }
      return Number(region[mKey] ?? 0);
    },
    [activeCustomChoropleth, effectiveChoroplethMetric]
  );

  // ─── Unified Left-Panel Catalog (Checked on Top, then Alphabetical A→Z) ────
  const unifiedCatalogItems = useMemo<UnifiedCatalogItem[]>(() => {
    const builtinKeys: MetricKey[] = [
      'green_cover_pct',
      'aqi_pm25',
      'literacy_rate',
      'population_density',
      'sex_ratio',
    ];

    const builtins: UnifiedCatalogItem[] = builtinKeys.map((key) => {
      const cfg = METRIC_CONFIGS[key];
      const isEnv = key === 'green_cover_pct' || key === 'aqi_pm25';
      const checked =
        key === 'aqi_pm25'
          ? selectedMetrics.includes('aqi_pm25') || showAqiLayer
          : selectedMetrics.includes(key);

      return {
        id: `builtin-${key}`,
        kind: 'builtin',
        metricKey: key,
        title: cfg.label,
        shortTitle: cfg.shortLabel,
        category: isEnv ? 'environment' : 'demographics',
        categoryLabel: isEnv ? 'Environment' : 'Demographics',
        geometryLabel: key === 'aqi_pm25' ? 'Stations + IDW + Fill' : 'Polygon Choropleth',
        unit: cfg.unit,
        publisher: cfg.sourceLabel,
        sourceUrl: cfg.sourceUrl,
        checked,
        opacity: metricOpacities[key] ?? 0.68,
        color: key === 'aqi_pm25' ? '#f59e0b' : '#10b981',
      };
    });

    const uploaded: UnifiedCatalogItem[] = customLayers.map((layer) => ({
      id: layer.id,
      kind: 'custom',
      customLayer: layer,
      title: layer.name,
      shortTitle: layer.metricLabel || layer.name,
      category: 'uploaded',
      categoryLabel: `Uploaded (${layer.boundaryLevel?.toUpperCase() || 'GPS'})`,
      geometryLabel:
        layer.type === 'point'
          ? `GPS Points (${layer.featureCount})`
          : `${layer.boundaryLevel?.toUpperCase()} Polygons (${layer.featureCount})`,
      unit: layer.unit || '',
      publisher: layer.publisher || 'Verified Contributor',
      sourceUrl: layer.sourceUrl || '',
      checked: Boolean(layer.visible),
      opacity: layer.opacity ?? 0.75,
      color: layer.color || '#14b8a6',
    }));

    const combined = [...builtins, ...uploaded];

    // Filter by category pill and search input
    const q = layerSearchQuery.toLowerCase().trim();
    const filtered = combined.filter((item) => {
      if (layerCategoryFilter !== 'all' && item.category !== layerCategoryFilter) {
        return false;
      }
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.shortTitle.toLowerCase().includes(q) ||
        item.publisher.toLowerCase().includes(q) ||
        item.categoryLabel.toLowerCase().includes(q) ||
        item.geometryLabel.toLowerCase().includes(q)
      );
    });

    // Sort: Checked items on TOP (alphabetical A→Z), then Unchecked items below (alphabetical A→Z)
    return filtered.sort((a, b) => {
      if (a.checked !== b.checked) {
        return a.checked ? -1 : 1;
      }
      return a.title.localeCompare(b.title);
    });
  }, [
    selectedMetrics,
    showAqiLayer,
    metricOpacities,
    customLayers,
    layerSearchQuery,
    layerCategoryFilter,
  ]);

  // Toggle any layer cleanly (no sticky/buggy lock)
  const handleToggleLayerCheck = (item: UnifiedCatalogItem) => {
    if (item.kind === 'builtin' && item.metricKey) {
      const key = item.metricKey;
      const currentlyChecked = item.checked;

      if (key === 'aqi_pm25') {
        const nextChecked = !currentlyChecked;
        setShowAqiLayer(nextChecked);
        setSelectedMetrics((prev) =>
          nextChecked
            ? prev.includes('aqi_pm25')
              ? prev
              : [...prev, 'aqi_pm25']
            : prev.filter((k) => k !== 'aqi_pm25')
        );
        return;
      }

      setSelectedMetrics((prev) => {
        const next = currentlyChecked
          ? prev.filter((k) => k !== key)
          : [...prev, key];
        if (!currentlyChecked) {
          setActiveMetric(key);
          setActiveCustomChoroplethId(null);
        } else if (activeMetric === key) {
          const remaining = next.find((k) => k !== 'aqi_pm25') || next[0];
          if (remaining) setActiveMetric(remaining);
        }
        return next;
      });
    } else if (item.kind === 'custom' && item.customLayer) {
      const targetId = item.customLayer.id;
      const nextVisible = !item.checked;
      setCustomLayers((prev) =>
        prev.map((l) => (l.id === targetId ? { ...l, visible: nextVisible } : l))
      );
      if (nextVisible && item.customLayer.type === 'choropleth') {
        setActiveCustomChoroplethId(targetId);
        if (item.customLayer.boundaryLevel) {
          setBoundaryLevel(item.customLayer.boundaryLevel);
        }
      } else if (!nextVisible && activeCustomChoroplethId === targetId) {
        setActiveCustomChoroplethId(null);
      }
    }
  };

  // Change opacity for any layer
  const handleLayerOpacityChange = (item: UnifiedCatalogItem, newOpacity: number) => {
    if (item.kind === 'builtin' && item.metricKey) {
      setMetricOpacities((prev) => ({
        ...prev,
        [item.metricKey!]: newOpacity,
      }));
    } else if (item.kind === 'custom' && item.customLayer) {
      const targetId = item.customLayer.id;
      setCustomLayers((prev) =>
        prev.map((l) => (l.id === targetId ? { ...l, opacity: newOpacity } : l))
      );
    }
  };

  // ─── Render High-Detail GIS Polygons on MapLibre (Dark & Light Mode Safe) ──
  const renderBoundariesOnMap = useCallback(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;

    const mKey = effectiveChoroplethMetric || 'green_cover_pct';
    const cfg = METRIC_CONFIGS[mKey];
    let stops = cfg.stops;

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

    const hasActiveChoropleth =
      Boolean(activeCustomChoropleth) || Boolean(effectiveChoroplethMetric);

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

    // Parent district backdrop outline when viewing Municipal Wards
    const districtBackdropFeatures =
      boundaryLevel === 'ward'
        ? (regionsByTier.district || [])
            .filter((d) => d.geojson)
            .map((d) => ({
              type: 'Feature',
              properties: { code: d.code, name: d.name },
              geometry: d.geojson,
            }))
        : [];
    const backdropFc = {
      type: 'FeatureCollection',
      features: districtBackdropFeatures,
    };

    try {
      if (map.getSource('ncr-district-backdrop')) {
        map.getSource('ncr-district-backdrop').setData(backdropFc);
      } else {
        map.addSource('ncr-district-backdrop', {
          type: 'geojson',
          data: backdropFc,
        });
        map.addLayer({
          id: 'ncr-district-backdrop-line',
          type: 'line',
          source: 'ncr-district-backdrop',
          paint: {
            'line-color': isDarkMode ? '#64748b' : '#475569',
            'line-width': 1.5,
            'line-dasharray': [3, 2],
            'line-opacity': 0.55,
          },
        });
      }

      if (map.getLayer('ncr-district-backdrop-line')) {
        map.setPaintProperty(
          'ncr-district-backdrop-line',
          'line-color',
          isDarkMode ? '#64748b' : '#475569'
        );
      }

      const baseFillOpacity = hasActiveChoropleth ? activeChoroplethOpacity : 0.04;
      const selectedFillOpacity = hasActiveChoropleth
        ? Math.min(0.92, activeChoroplethOpacity + 0.16)
        : 0.15;

      const baseStrokeColor = isDarkMode ? '#475569' : '#334155';
      const selectedStrokeColor = isDarkMode ? '#2dd4bf' : '#0f766e';

      if (map.getSource('ncr-boundaries')) {
        map.getSource('ncr-boundaries').setData(fc);
        if (map.getLayer('ncr-boundaries-fill')) {
          map.setPaintProperty('ncr-boundaries-fill', 'fill-opacity', [
            'case',
            ['==', ['get', 'isSelected'], 1],
            selectedFillOpacity,
            baseFillOpacity,
          ]);
        }
        if (map.getLayer('ncr-boundaries-line')) {
          map.setPaintProperty('ncr-boundaries-line', 'line-color', [
            'case',
            ['==', ['get', 'isSelected'], 1],
            selectedStrokeColor,
            baseStrokeColor,
          ]);
          map.setPaintProperty('ncr-boundaries-line', 'line-width', [
            'case',
            ['==', ['get', 'isSelected'], 1],
            2.8,
            boundaryLevel === 'ward' ? 0.75 : 1.25,
          ]);
        }
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
              selectedFillOpacity,
              baseFillOpacity,
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
              selectedStrokeColor,
              baseStrokeColor,
            ],
            'line-width': [
              'case',
              ['==', ['get', 'isSelected'], 1],
              2.8,
              boundaryLevel === 'ward' ? 0.75 : 1.25,
            ],
          },
        });
      }
    } catch {
      // style transition in progress
    }
  }, [
    searchedRegions,
    effectiveChoroplethMetric,
    activeCustomChoropleth,
    activeChoroplethOpacity,
    boundaryLevel,
    selectedRegion,
    isDarkMode,
    regionsByTier.district,
    getRegionChoroplethValue,
  ]);

  // ─── Render IDW Continuous Pollution Field ─────────────────────────────────
  const renderIdwCanvasOverlay = useCallback(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;

    const showField =
      showAqiLayer && (aqiDisplayMode === 'blended' || aqiDisplayMode === 'both');

    try {
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

      const aqiLayerOpacity = metricOpacities.aqi_pm25 ?? 0.78;

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
          data[idx + 3] = Math.round(fade * 95);
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
        paint: { 'raster-opacity': aqiLayerOpacity },
      });
    } catch {
      // style transition in progress
    }
  }, [showAqiLayer, aqiDisplayMode, aqiStations, metricOpacities.aqi_pm25]);

  // ─── Initialize MapLibre GL Map & Event Listeners ──────────────────────────
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

    map.on('mousemove', 'ncr-boundaries-fill', (e: any) => {
      map.getCanvas().style.cursor = 'pointer';
      const code = e.features?.[0]?.properties?.code;
      if (!code) return;
      const found = allRegionsRef.current.find((r) => r.code === code);
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
      const found = allRegionsRef.current.find((r) => r.code === code);
      if (found) {
        setSelectedStation(null);
        setSelectedRegion(found);
        if (found.center) {
          map.flyTo({ center: found.center, duration: 650 });
        }
      }
    });

    return () => {
      mapReadyRef.current = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [currentPage]);

  // Handle Dark / Light Mode Basemap Switch Cleanly (Wait for style.load!)
  const prevDarkModeRef = useRef<boolean>(isDarkMode);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (prevDarkModeRef.current === isDarkMode) return;
    prevDarkModeRef.current = isDarkMode;

    mapReadyRef.current = false;
    map.setStyle(isDarkMode ? DARK_STYLE : LIGHT_STYLE);
    map.once('style.load', () => {
      mapReadyRef.current = true;
      renderBoundariesOnMap();
      renderIdwCanvasOverlay();
    });
  }, [isDarkMode, renderBoundariesOnMap, renderIdwCanvasOverlay]);

  useEffect(() => {
    renderBoundariesOnMap();
  }, [renderBoundariesOnMap]);

  useEffect(() => {
    renderIdwCanvasOverlay();
  }, [renderIdwCanvasOverlay]);

  // Render CPCB Station HTML Markers (with live opacity support)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    stationMarkersRef.current.forEach((m) => m.remove());
    stationMarkersRef.current = [];

    const showDots =
      showAqiLayer && (aqiDisplayMode === 'stations' || aqiDisplayMode === 'both');
    if (!showDots) return;

    const aqiOpacity = metricOpacities.aqi_pm25 ?? 0.78;

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
      el.style.opacity = String(Math.max(0.25, Math.min(1, aqiOpacity + 0.15)));
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
  }, [showAqiLayer, aqiDisplayMode, aqiStations, metricOpacities.aqi_pm25, currentPage]);

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
          el.style.opacity = String(layer.opacity ?? 0.85);
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

  // Publish layer from Dedicated Upload Page (`/upload`)
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

  const activeMetricCfg = METRIC_CONFIGS[effectiveChoroplethMetric || 'green_cover_pct'];
  const checkedCount = unifiedCatalogItems.filter((i) => i.checked).length;

  return (
    <div
      className={`h-screen w-screen overflow-hidden flex flex-col select-none transition-colors ${
        isDarkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'
      }`}
    >
      {/* ─── TOP HEADER BAR (No Tech Stack Mentions) ───────────────────────── */}
      <header
        className={`h-14 shrink-0 border-b px-4 flex items-center justify-between z-20 ${
          isDarkMode
            ? 'bg-slate-900/95 border-slate-800'
            : 'bg-white/95 border-slate-200 shadow-xs'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-teal-500/20 border border-teal-500/40 flex items-center justify-center">
            <MapIcon className="w-4 h-4 text-teal-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-tight">IndiaData.viz</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-500 font-semibold border border-teal-500/30">
                Verified Civic GIS
              </span>
            </div>
            <p
              className={`text-[10px] hidden sm:block ${
                isDarkMode ? 'text-slate-400' : 'text-slate-500'
              }`}
            >
              Official Administrative Boundaries • Forest Survey of India (ISFR) • CPCB Air Quality
            </p>
          </div>
        </div>

        {/* Administrative Boundary Tier Switcher */}
        <div
          className={`flex items-center gap-1 p-1 rounded-xl border ${
            isDarkMode
              ? 'bg-slate-950/80 border-slate-800'
              : 'bg-slate-100 border-slate-200'
          }`}
        >
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
                  ? 'bg-teal-500 text-slate-950 shadow-xs'
                  : isDarkMode
                    ? 'text-slate-400 hover:text-white'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Right Actions: Compare + Dedicated Upload Page + Theme Toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsCompareOpen(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border cursor-pointer transition-colors ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
            }`}
          >
            <ArrowLeftRight className="w-3.5 h-3.5 text-sky-500" />
            <span className="hidden sm:inline">Compare</span>
          </button>

          <button
            onClick={() => navigateTo('upload')}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-teal-500 hover:bg-teal-400 text-slate-950 shadow-md shadow-teal-500/20 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Data</span>
          </button>

          <button
            onClick={() => setIsDarkMode((d) => !d)}
            className={`p-2 rounded-xl border cursor-pointer transition-colors ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
            }`}
            title="Toggle Dark / Light Basemap"
          >
            {isDarkMode ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-slate-700" />
            )}
          </button>
        </div>
      </header>

      {/* ─── FOCUS DISTRICT HUB BAR + REGION SEARCH ────────────────────────── */}
      <div
        className={`h-11 shrink-0 border-b px-4 flex items-center justify-between gap-3 overflow-x-auto z-10 ${
          isDarkMode ? 'bg-slate-900/75 border-slate-800' : 'bg-slate-100/90 border-slate-200'
        }`}
      >
        <div className="flex items-center gap-1.5">
          <span
            className={`text-[11px] font-semibold flex items-center gap-1 mr-1 ${
              isDarkMode ? 'text-slate-400' : 'text-slate-600'
            }`}
          >
            <LocateFixed className="w-3.5 h-3.5 text-teal-500" />
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
                    ? 'bg-teal-500/20 text-teal-500 border border-teal-500/40'
                    : isDarkMode
                      ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Region / MP / MLA Filter Input */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative w-52">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Filter ${boundaryLevel} or MP/MLA…`}
              className={`w-full pl-8 pr-6 py-1 rounded-lg text-[11px] border ${
                isDarkMode
                  ? 'bg-slate-950 border-slate-800 text-slate-100 placeholder:text-slate-500'
                  : 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400'
              }`}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <span
            className={`text-[11px] hidden xl:inline ${
              isDarkMode ? 'text-slate-400' : 'text-slate-600'
            }`}
          >
            <strong>{searchedRegions.length}</strong> areas
          </span>
        </div>
      </div>

      {/* ─── MAIN WORKSPACE: LEFT LAYER CATALOG + MAP + RIGHT INSIGHTS ─────── */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* ─── REDESIGNED LEFT PANEL: SEARCHABLE, SORTED LAYER CATALOG ─────── */}
        <aside
          className={`w-84 shrink-0 border-r flex flex-col overflow-hidden z-10 ${
            isDarkMode ? 'bg-slate-900/95 border-slate-800' : 'bg-white border-slate-200'
          }`}
        >
          {/* Left Panel Sticky Header: Title + Search + Category Filter Pills */}
          <div
            className={`p-3.5 border-b space-y-3 shrink-0 ${
              isDarkMode ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-slate-50/70'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-teal-500" />
                <span className="text-xs font-bold tracking-tight">
                  Data Layer Catalog
                </span>
              </div>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                  isDarkMode
                    ? 'bg-teal-500/15 text-teal-300 border border-teal-500/30'
                    : 'bg-teal-50 text-teal-700 border border-teal-200'
                }`}
              >
                {checkedCount} Active on Hover/Click
              </span>
            </div>

            {/* Search through available data layers */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={layerSearchQuery}
                onChange={(e) => setLayerSearchQuery(e.target.value)}
                placeholder="Search layers (e.g. Green Cover, AQI, Literacy)…"
                className={`w-full pl-8 pr-7 py-2 rounded-xl text-xs border transition-colors ${
                  isDarkMode
                    ? 'bg-slate-950 border-slate-800 text-slate-100 focus:border-teal-500/60'
                    : 'bg-white border-slate-300 text-slate-900 focus:border-teal-600'
                } outline-none`}
              />
              {layerSearchQuery && (
                <button
                  type="button"
                  onClick={() => setLayerSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Filter by Category / Type Pills */}
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
              <Filter className="w-3 h-3 text-slate-400 shrink-0 mr-0.5" />
              {(
                [
                  { id: 'all', label: 'All Layers' },
                  { id: 'environment', label: 'Environment' },
                  { id: 'demographics', label: 'Census' },
                  { id: 'uploaded', label: `Uploaded (${customLayers.length})` },
                ] as const
              ).map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setLayerCategoryFilter(cat.id)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold whitespace-nowrap transition-all cursor-pointer ${
                    layerCategoryFilter === cat.id
                      ? 'bg-teal-500 text-slate-950 shadow-2xs'
                      : isDarkMode
                        ? 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
                        : 'bg-slate-200/70 text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Scrollable Layer List (Checked on Top -> Unchecked Alphabetical) */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {unifiedCatalogItems.length === 0 ? (
              <div
                className={`p-5 rounded-xl border text-center text-xs space-y-2 ${
                  isDarkMode
                    ? 'bg-slate-950/50 border-slate-800 text-slate-400'
                    : 'bg-slate-50 border-slate-200 text-slate-500'
                }`}
              >
                <p>No layers match your search or category filter.</p>
                <button
                  type="button"
                  onClick={() => {
                    setLayerSearchQuery('');
                    setLayerCategoryFilter('all');
                  }}
                  className="text-teal-500 font-semibold hover:underline cursor-pointer"
                >
                  Reset layer filters
                </button>
              </div>
            ) : (
              unifiedCatalogItems.map((item, idx) => {
                const prevItem = idx > 0 ? unifiedCatalogItems[idx - 1] : null;
                const showSectionHeader =
                  idx === 0 || (prevItem && prevItem.checked !== item.checked);

                const isColoringMap =
                  item.kind === 'custom'
                    ? activeCustomChoropleth?.id === item.id
                    : !activeCustomChoropleth &&
                      effectiveChoroplethMetric === item.metricKey;

                return (
                  <div key={item.id} className="space-y-2">
                    {showSectionHeader && (
                      <div className="flex items-center justify-between pt-1 px-1">
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider ${
                            item.checked
                              ? 'text-teal-500'
                              : isDarkMode
                                ? 'text-slate-500'
                                : 'text-slate-400'
                          }`}
                        >
                          {item.checked
                            ? '✓ Selected Layers (Pinned on Top)'
                            : 'Available Layers (A – Z)'}
                        </span>
                      </div>
                    )}

                    <div
                      className={`rounded-xl border transition-all ${
                        item.checked
                          ? isDarkMode
                            ? 'bg-slate-950 border-teal-500/50 shadow-md shadow-teal-950/20'
                            : 'bg-teal-50/40 border-teal-500/50 shadow-xs'
                          : isDarkMode
                            ? 'bg-slate-950/40 border-slate-800/80 hover:border-slate-700'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {/* Top Row: Checkbox + Title + Category Badge */}
                      <div className="p-3 flex items-start gap-2.5">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={item.checked}
                          onClick={() => handleToggleLayerCheck(item)}
                          className={`mt-0.5 w-4 h-4 rounded-md flex items-center justify-center border transition-all cursor-pointer shrink-0 ${
                            item.checked
                              ? 'bg-teal-500 border-teal-500 text-slate-950'
                              : isDarkMode
                                ? 'bg-slate-900 border-slate-600 hover:border-teal-400'
                                : 'bg-white border-slate-300 hover:border-teal-600'
                          }`}
                        >
                          {item.checked && <Check className="w-3 h-3 stroke-[3]" />}
                        </button>

                        <div
                          onClick={() => handleToggleLayerCheck(item)}
                          className="flex-1 min-w-0 cursor-pointer"
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span
                              className={`text-xs font-bold leading-snug truncate ${
                                item.checked
                                  ? isDarkMode
                                    ? 'text-white'
                                    : 'text-slate-900'
                                  : isDarkMode
                                    ? 'text-slate-300'
                                    : 'text-slate-700'
                              }`}
                            >
                              {item.title}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <span
                              className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${
                                item.category === 'environment'
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : item.category === 'uploaded'
                                    ? 'bg-sky-500/15 text-sky-400'
                                    : 'bg-purple-500/15 text-purple-400'
                              }`}
                            >
                              {item.categoryLabel}
                            </span>
                            <span
                              className={`text-[10px] ${
                                isDarkMode ? 'text-slate-400' : 'text-slate-500'
                              }`}
                            >
                              • {item.geometryLabel}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Expanded Controls When Checked: Opacity Slider + Map Fill Switch + Source */}
                      {item.checked && (
                        <div
                          className={`px-3 pb-3 pt-2 border-t space-y-2.5 text-[11px] ${
                            isDarkMode ? 'border-slate-800/80' : 'border-slate-200/80'
                          }`}
                        >
                          {/* Opacity Slider */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span
                                className={`text-[10px] font-medium flex items-center gap-1 ${
                                  isDarkMode ? 'text-slate-400' : 'text-slate-600'
                                }`}
                              >
                                <Sliders className="w-3 h-3 text-teal-500" />
                                Layer Opacity
                              </span>
                              <span className="font-mono text-[10px] font-bold text-teal-500">
                                {Math.round(item.opacity * 100)}%
                              </span>
                            </div>
                            <input
                              type="range"
                              min={0.1}
                              max={1}
                              step={0.05}
                              value={item.opacity}
                              onChange={(e) =>
                                handleLayerOpacityChange(item, Number(e.target.value))
                              }
                              className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-teal-500"
                            />
                          </div>

                          {/* CPCB Air Quality Mode Switcher inside the Air Pollution Card */}
                          {item.metricKey === 'aqi_pm25' && (
                            <div className="space-y-1.5 pt-0.5">
                              <div className="flex items-center justify-between text-[10px]">
                                <span
                                  className={
                                    isDarkMode ? 'text-slate-400' : 'text-slate-600'
                                  }
                                >
                                  Overlay Mode ({aqiStations.length} CPCB Stations):
                                </span>
                                <button
                                  type="button"
                                  onClick={handleSyncLiveCpcb}
                                  disabled={syncingLiveAqi}
                                  className="text-sky-500 hover:underline font-semibold cursor-pointer"
                                >
                                  {syncingLiveAqi ? 'Syncing…' : 'Sync Live API'}
                                </button>
                              </div>
                              <div
                                className={`grid grid-cols-3 gap-1 p-1 rounded-lg ${
                                  isDarkMode ? 'bg-slate-900' : 'bg-slate-200/70'
                                }`}
                              >
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
                                    className={`py-1 rounded text-[10px] font-semibold cursor-pointer transition-colors ${
                                      aqiDisplayMode === m.id
                                        ? 'bg-amber-500 text-slate-950'
                                        : isDarkMode
                                          ? 'text-slate-400 hover:text-white'
                                          : 'text-slate-600 hover:text-slate-900'
                                    }`}
                                  >
                                    {m.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Bottom Row: Color Map Button + Direct Source Link */}
                          <div className="flex items-center justify-between pt-0.5">
                            {item.sourceUrl ? (
                              <a
                                href={item.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] font-semibold text-teal-500 hover:underline inline-flex items-center gap-1 truncate max-w-[165px]"
                                title={item.publisher}
                              >
                                <span>{item.publisher}</span>
                                <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                              </a>
                            ) : (
                              <span className="text-[10px] text-slate-400">
                                {item.publisher}
                              </span>
                            )}

                            {(item.kind === 'builtin' ||
                              item.customLayer?.type === 'choropleth') && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (item.kind === 'custom' && item.customLayer) {
                                    setActiveCustomChoroplethId(item.customLayer.id);
                                    if (item.customLayer.boundaryLevel) {
                                      setBoundaryLevel(item.customLayer.boundaryLevel);
                                    }
                                  } else if (item.metricKey) {
                                    setActiveCustomChoroplethId(null);
                                    setActiveMetric(item.metricKey);
                                  }
                                }}
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold cursor-pointer transition-colors ${
                                  isColoringMap
                                    ? 'bg-teal-500 text-slate-950'
                                    : isDarkMode
                                      ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                                      : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                                }`}
                              >
                                {isColoringMap ? 'Active Map Fill' : 'Set Map Fill'}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {/* Upload Call-to-Action Footer Card */}
            <div
              className={`p-3.5 rounded-xl border text-xs space-y-2 mt-3 ${
                isDarkMode
                  ? 'bg-slate-950/70 border-slate-800 text-slate-300'
                  : 'bg-slate-50 border-slate-200 text-slate-700'
              }`}
            >
              <div className="font-bold flex items-center gap-1.5 text-teal-500">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Add State / Assembly / Ward Dataset</span>
              </div>
              <p
                className={`text-[11px] leading-relaxed ${
                  isDarkMode ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                Upload CSV, JSON, or Open API tables on the Upload Page. Explain your dataset once and it will appear right here as a selected layer.
              </p>
              <button
                type="button"
                onClick={() => navigateTo('upload')}
                className="w-full py-2 rounded-lg bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs cursor-pointer transition-colors"
              >
                Go to Upload Data Page &rarr;
              </button>
            </div>
          </div>
        </aside>

        {/* ─── CENTER INTERACTIVE MAPLIBRE CANVAS ─────────────────────────── */}
        <main className="flex-1 relative overflow-hidden">
          <div ref={mapContainerRef} className="w-full h-full" />

          {/* Ward Rural / Industrial Gap Notice Banner */}
          {boundaryLevel === 'ward' && (
            <div
              className={`absolute top-3 left-3 right-3 md:right-auto md:max-w-md z-10 p-2.5 rounded-xl border backdrop-blur-md text-[11px] flex items-start gap-2 shadow-lg ${
                isDarkMode
                  ? 'bg-slate-900/90 border-slate-700 text-slate-300'
                  : 'bg-white/95 border-slate-300 text-slate-700'
              }`}
            >
              <Info className="w-4 h-4 text-teal-500 shrink-0 mt-0.5" />
              <span>
                Showing <strong>612 digitized Urban Local Body (ULB) wards</strong> across MCD, NDMC, Delhi Cantt, MCF, MCG, GMC &amp; Sonipat MC with parent district outlines. Unfilled gaps between cities represent rural Gram Panchayats or Industrial Authorities.
              </span>
            </div>
          )}

          {/* ─── DYNAMIC HOVER TOOLTIP (Shows ALL Selected Layers from Left Panel) ── */}
          {hoveredFeature && (
            <div
              className={`pointer-events-none absolute z-30 w-76 p-3.5 rounded-2xl border shadow-2xl text-xs space-y-2 backdrop-blur-md ${
                isDarkMode
                  ? 'bg-slate-950/95 border-teal-500/40 text-slate-100'
                  : 'bg-white/95 border-teal-600/40 text-slate-900'
              }`}
              style={{
                left: Math.min(hoveredFeature.x + 16, window.innerWidth - 680),
                top: Math.max(12, hoveredFeature.y - 20),
              }}
            >
              <div
                className={`border-b pb-1.5 ${
                  isDarkMode ? 'border-slate-800' : 'border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-teal-500">
                    {hoveredFeature.region.level} • {hoveredFeature.region.state}
                  </span>
                  <span
                    className={`text-[10px] font-mono ${
                      isDarkMode ? 'text-slate-400' : 'text-slate-500'
                    }`}
                  >
                    {hoveredFeature.region.area_sq_km} km²
                  </span>
                </div>
                <div className="font-bold text-sm mt-0.5">
                  {hoveredFeature.region.name}
                </div>
              </div>

              {/* All Checked Layers from Left Panel */}
              <div className="space-y-1.5">
                <div
                  className={`text-[10px] font-semibold uppercase tracking-wider ${
                    isDarkMode ? 'text-slate-400' : 'text-slate-500'
                  }`}
                >
                  Selected Layers ({checkedCount}):
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
                      <span className={isDarkMode ? 'text-slate-300' : 'text-slate-600'}>
                        {mCfg.shortLabel}:
                      </span>
                      <span className="font-mono font-bold text-teal-500">
                        {val ?? '—'} {mCfg.unit}
                      </span>
                    </div>
                  );
                })}

                {showAqiLayer && hoveredFeature.region.pm25_ugm3 && (
                  <div
                    className={`flex items-center justify-between text-[11px] pt-0.5 border-t ${
                      isDarkMode
                        ? 'text-amber-300 border-slate-800/70'
                        : 'text-amber-700 border-slate-200'
                    }`}
                  >
                    <span>
                      CPCB PM2.5 ({hoveredFeature.region.cpcb_station_name?.split(',')[0]}):
                    </span>
                    <span className="font-mono font-bold">
                      {hoveredFeature.region.pm25_ugm3} µg/m³
                    </span>
                  </div>
                )}

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
                        className={`flex items-center justify-between text-xs py-0.5 border-t ${
                          isDarkMode ? 'border-slate-800/70' : 'border-slate-200'
                        }`}
                      >
                        <span className="text-sky-500 truncate max-w-[150px] font-medium">
                          {layer.metricLabel || layer.name}:
                        </span>
                        <span className="font-mono font-bold text-sky-500">
                          {val !== undefined ? `${val} ${layer.unit || ''}` : 'N/A'}
                        </span>
                      </div>
                    );
                  })}
              </div>

              <div
                className={`pt-1 border-t text-[10px] flex items-center justify-between ${
                  isDarkMode
                    ? 'border-slate-800 text-slate-400'
                    : 'border-slate-200 text-slate-500'
                }`}
              >
                <span className="truncate max-w-[160px]">
                  Rep: {hoveredFeature.region.rep_name || 'Verified'}
                </span>
                <span className="text-teal-500 font-semibold">
                  Click for Source Links &rarr;
                </span>
              </div>
            </div>
          )}

          {/* Hover Tooltip for CPCB Air Quality Station Marker */}
          {hoveredStation && (
            <div
              className={`pointer-events-none absolute z-30 w-68 p-3 rounded-2xl border shadow-2xl text-xs space-y-1.5 ${
                isDarkMode
                  ? 'bg-slate-950/95 border-amber-500/50 text-slate-100'
                  : 'bg-white/95 border-amber-500 text-slate-900'
              }`}
              style={{
                left: Math.min(hoveredStation.x + 14, window.innerWidth - 650),
                top: Math.max(12, hoveredStation.y - 20),
              }}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-500">
                CPCB CAAQMS Monitoring Station
              </div>
              <div className="font-bold">{hoveredStation.station.station}</div>
              <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                <div
                  className={`p-1.5 rounded ${
                    isDarkMode ? 'bg-slate-900' : 'bg-slate-100'
                  }`}
                >
                  <div className="text-[9px] text-slate-400">AQI</div>
                  <div className="font-mono font-bold text-amber-500">
                    {hoveredStation.station.aqi}
                  </div>
                </div>
                <div
                  className={`p-1.5 rounded ${
                    isDarkMode ? 'bg-slate-900' : 'bg-slate-100'
                  }`}
                >
                  <div className="text-[9px] text-slate-400">PM2.5</div>
                  <div className="font-mono font-bold text-rose-500">
                    {hoveredStation.station.pm25}
                  </div>
                </div>
                <div
                  className={`p-1.5 rounded ${
                    isDarkMode ? 'bg-slate-900' : 'bg-slate-100'
                  }`}
                >
                  <div className="text-[9px] text-slate-400">PM10</div>
                  <div className="font-mono font-bold text-sky-500">
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
          <div
            className={`absolute bottom-4 left-4 z-10 p-3 rounded-2xl border shadow-xl text-xs space-y-2 min-w-[235px] backdrop-blur-md ${
              isDarkMode
                ? 'bg-slate-900/95 border-slate-800 text-slate-100'
                : 'bg-white/95 border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-bold">
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
                  <span
                    className={`text-[9px] font-mono ${
                      isDarkMode ? 'text-slate-400' : 'text-slate-500'
                    }`}
                  >
                    {val}
                  </span>
                </div>
              ))}
            </div>
            <div
              className={`pt-1 border-t flex items-center justify-between text-[10px] ${
                isDarkMode ? 'border-slate-800' : 'border-slate-200'
              }`}
            >
              <a
                href={
                  activeCustomChoropleth?.sourceUrl || activeMetricCfg.sourceUrl
                }
                target="_blank"
                rel="noopener noreferrer"
                className="text-teal-500 hover:underline inline-flex items-center gap-1 font-semibold"
              >
                Verify Legend Source <ExternalLink className="w-2.5 h-2.5" />
              </a>
              <span
                className={`font-mono ${
                  isDarkMode ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                Opacity: {Math.round(activeChoroplethOpacity * 100)}%
              </span>
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
                  <span className="text-[10px] uppercase tracking-wider font-bold text-amber-500">
                    Verified CPCB Air Quality Station
                  </span>
                  <h2 className="text-base font-bold mt-0.5">
                    {selectedStation.station}
                  </h2>
                  <p
                    className={`text-xs ${
                      isDarkMode ? 'text-slate-400' : 'text-slate-500'
                    }`}
                  >
                    {selectedStation.city}, {selectedStation.state} • (
                    {selectedStation.lat.toFixed(4)}, {selectedStation.lon.toFixed(4)})
                  </p>
                </div>
                <button
                  onClick={() => setSelectedStation(null)}
                  className="text-xs text-teal-500 hover:underline cursor-pointer font-semibold"
                >
                  Back to Region
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div
                  className={`p-3 rounded-xl border ${
                    isDarkMode
                      ? 'bg-slate-950 border-slate-800'
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="text-[10px] text-slate-400">National AQI</div>
                  <div className="text-xl font-mono font-bold text-amber-500 mt-0.5">
                    {selectedStation.aqi}
                  </div>
                </div>
                <div
                  className={`p-3 rounded-xl border ${
                    isDarkMode
                      ? 'bg-slate-950 border-slate-800'
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="text-[10px] text-slate-400">PM2.5 Concentration</div>
                  <div className="text-xl font-mono font-bold text-rose-500 mt-0.5">
                    {selectedStation.pm25} <span className="text-xs">µg/m³</span>
                  </div>
                </div>
                <div
                  className={`p-3 rounded-xl border ${
                    isDarkMode
                      ? 'bg-slate-950 border-slate-800'
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="text-[10px] text-slate-400">PM10 Concentration</div>
                  <div className="text-lg font-mono font-bold text-sky-500 mt-0.5">
                    {selectedStation.pm10} <span className="text-xs">µg/m³</span>
                  </div>
                </div>
                <div
                  className={`p-3 rounded-xl border ${
                    isDarkMode
                      ? 'bg-slate-950 border-slate-800'
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="text-[10px] text-slate-400">NO2 Concentration</div>
                  <div className="text-lg font-mono font-bold text-emerald-500 mt-0.5">
                    {selectedStation.no2 ?? '—'} <span className="text-xs">µg/m³</span>
                  </div>
                </div>
              </div>

              <div
                className={`p-4 rounded-xl border space-y-2 text-xs ${
                  isDarkMode
                    ? 'bg-slate-950 border-slate-800'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  Official Data Source Verification Links
                </div>
                <p
                  className={`text-[11px] ${
                    isDarkMode ? 'text-slate-400' : 'text-slate-600'
                  }`}
                >
                  Measurements sourced from Continuous Ambient Air Quality Monitoring Stations (CAAQMS) operated by CPCB, DPCC, HSPCB, and UPPCB.
                </p>
                <div className="flex flex-col gap-1.5 pt-1">
                  <a
                    href={selectedStation.sourceUrl || CPCB_SOURCE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center justify-between px-3 py-2 rounded-lg font-semibold ${
                      isDarkMode
                        ? 'bg-slate-900 hover:bg-slate-800 text-amber-400'
                        : 'bg-white hover:bg-slate-100 text-amber-600 border border-slate-200'
                    }`}
                  >
                    <span>Open CPCB CAAQMS Live Portal</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <a
                    href={CPCB_DATAGOV_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center justify-between px-3 py-2 rounded-lg font-semibold ${
                      isDarkMode
                        ? 'bg-slate-900 hover:bg-slate-800 text-teal-400'
                        : 'bg-white hover:bg-slate-100 text-teal-600 border border-slate-200'
                    }`}
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
              <div
                className={`border-b pb-3 ${
                  isDarkMode ? 'border-slate-800' : 'border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-teal-500">
                    {selectedRegion.level} • {selectedRegion.state}
                  </span>
                  <span
                    className={`text-[11px] font-mono ${
                      isDarkMode ? 'text-slate-400' : 'text-slate-500'
                    }`}
                  >
                    GIS Area: {selectedRegion.area_sq_km} km²
                  </span>
                </div>
                <h2 className="text-lg font-bold mt-0.5">{selectedRegion.name}</h2>
                {selectedRegion.pc_name && (
                  <p
                    className={`text-xs ${
                      isDarkMode ? 'text-slate-400' : 'text-slate-500'
                    }`}
                  >
                    Lok Sabha PC: {selectedRegion.pc_name} • District:{' '}
                    {selectedRegion.district_name || selectedRegion.parent_region}
                  </p>
                )}
              </div>

              {/* ─── ACTIVE SELECTED LAYERS WITH DIRECT SOURCE LINKS ──────── */}
              <div className="space-y-3">
                <div className="text-xs font-bold uppercase tracking-wider text-teal-500 flex items-center justify-between">
                  <span>Selected Layers &amp; Source Links</span>
                  <span
                    className={`text-[10px] font-normal ${
                      isDarkMode ? 'text-slate-400' : 'text-slate-500'
                    }`}
                  >
                    Click any link to verify
                  </span>
                </div>

                {/* 1. Green Cover Card */}
                {selectedMetrics.includes('green_cover_pct') && (
                  <div
                    className={`p-3.5 rounded-xl border space-y-2 ${
                      isDarkMode
                        ? 'bg-slate-950 border-emerald-500/30'
                        : 'bg-emerald-50/40 border-emerald-500/30'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-emerald-500">
                        Green &amp; Forest Cover (ISFR 2023)
                      </span>
                      <span className="text-base font-mono font-bold">
                        {selectedRegion.green_cover_pct}%
                      </span>
                    </div>
                    {selectedRegion.isfr_benchmark_region && (
                      <div
                        className={`text-[11px] ${
                          isDarkMode ? 'text-slate-400' : 'text-slate-600'
                        }`}
                      >
                        Benchmark Zone: {selectedRegion.isfr_benchmark_region}
                      </div>
                    )}
                    <a
                      href={
                        selectedRegion.green_source_url || 'https://fsi.nic.in/isfr-2023'
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-teal-500 hover:underline pt-0.5"
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

                {/* 2. Pollution Data Card */}
                {(selectedMetrics.includes('aqi_pm25') || showAqiLayer) && (
                  <div
                    className={`p-3.5 rounded-xl border space-y-2 ${
                      isDarkMode
                        ? 'bg-slate-950 border-amber-500/30'
                        : 'bg-amber-50/40 border-amber-500/30'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-amber-500">
                        CPCB Air Pollution (CAAQMS)
                      </span>
                      <span className="text-base font-mono font-bold text-amber-500">
                        {selectedRegion.aqi_pm25} AQI
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center text-[11px] pt-1">
                      <div
                        className={`p-1.5 rounded ${
                          isDarkMode ? 'bg-slate-900' : 'bg-white border border-slate-200'
                        }`}
                      >
                        <div className="text-[9px] text-slate-400">PM2.5</div>
                        <div className="font-mono font-bold text-rose-500">
                          {selectedRegion.pm25_ugm3 ?? '—'} µg/m³
                        </div>
                      </div>
                      <div
                        className={`p-1.5 rounded ${
                          isDarkMode ? 'bg-slate-900' : 'bg-white border border-slate-200'
                        }`}
                      >
                        <div className="text-[9px] text-slate-400">PM10</div>
                        <div className="font-mono font-bold text-sky-500">
                          {selectedRegion.pm10_ugm3 ?? '—'} µg/m³
                        </div>
                      </div>
                      <div
                        className={`p-1.5 rounded ${
                          isDarkMode ? 'bg-slate-900' : 'bg-white border border-slate-200'
                        }`}
                      >
                        <div className="text-[9px] text-slate-400">NO2</div>
                        <div className="font-mono font-bold text-emerald-500">
                          {selectedRegion.no2_ugm3 ?? '—'} µg/m³
                        </div>
                      </div>
                    </div>
                    {selectedRegion.cpcb_station_name && (
                      <div
                        className={`text-[11px] ${
                          isDarkMode ? 'text-slate-400' : 'text-slate-600'
                        }`}
                      >
                        Monitoring Station: {selectedRegion.cpcb_station_name}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-3 pt-0.5">
                      <a
                        href={selectedRegion.pollution_source_url || CPCB_SOURCE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-500 hover:underline"
                      >
                        <span>Source: CPCB CAAQMS Bulletin</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      <a
                        href={CPCB_DATAGOV_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-500 hover:underline"
                      >
                        <span>data.gov.in API</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                )}

                {/* 3. Any Selected Uploaded Datasets */}
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
                        className={`p-3.5 rounded-xl border space-y-1.5 ${
                          isDarkMode
                            ? 'bg-slate-950 border-sky-500/40'
                            : 'bg-sky-50/40 border-sky-500/40'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-sky-500">
                            {layer.name}
                          </span>
                          <span className="text-sm font-mono font-bold">
                            {val !== undefined
                              ? `${val} ${layer.unit || ''}`
                              : `Not mapped on ${selectedRegion.level}`}
                          </span>
                        </div>
                        {layer.description && (
                          <p
                            className={`text-[11px] ${
                              isDarkMode ? 'text-slate-400' : 'text-slate-600'
                            }`}
                          >
                            {layer.description}
                          </p>
                        )}
                        <div className="flex items-center justify-between text-[11px] pt-1">
                          <span
                            className={
                              isDarkMode ? 'text-slate-400' : 'text-slate-500'
                            }
                          >
                            Publisher: {layer.publisher}
                          </span>
                          {layer.sourceUrl && (
                            <a
                              href={layer.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-semibold text-teal-500 hover:underline"
                            >
                              Verify Dataset Source <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}

                {/* 4. Optional Census PCA Cards (when checked) */}
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
                        className={`p-3 rounded-xl border space-y-1 ${
                          isDarkMode
                            ? 'bg-slate-950 border-slate-800'
                            : 'bg-slate-50 border-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold">{cfg.label}</span>
                          <span className="font-mono font-bold text-teal-500">
                            {val} {cfg.unit}
                          </span>
                        </div>
                        <a
                          href={cfg.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-teal-500 hover:underline"
                        >
                          <span>Source: {cfg.sourceLabel}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    );
                  })}
              </div>

              {/* ─── VERIFIED ELECTED REPRESENTATIVE & BOUNDARY PROVENANCE ─ */}
              <div
                className={`p-4 rounded-xl border space-y-2.5 text-xs ${
                  isDarkMode
                    ? 'bg-slate-950 border-slate-800'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[10px] uppercase tracking-wider font-bold flex items-center gap-1 ${
                      isDarkMode ? 'text-slate-400' : 'text-slate-500'
                    }`}
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                    {selectedRegion.rep_role || 'Elected Representative'}
                  </span>
                  {selectedRegion.rep_party && (
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        isDarkMode
                          ? 'bg-slate-800 text-amber-300'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {selectedRegion.rep_party}
                    </span>
                  )}
                </div>

                <div className="text-sm font-bold">
                  {selectedRegion.rep_name || 'Verified Official Jurisdiction'}
                </div>

                {selectedRegion.rep_votes && (
                  <div
                    className={`text-[11px] ${
                      isDarkMode ? 'text-slate-400' : 'text-slate-600'
                    }`}
                  >
                    Winning Votes (ECI Official Tally):{' '}
                    <strong className="font-mono">
                      {selectedRegion.rep_votes.toLocaleString('en-IN')}
                    </strong>{' '}
                    ({selectedRegion.rep_term})
                  </div>
                )}

                <div
                  className={`pt-2 border-t flex flex-col gap-1.5 text-[11px] ${
                    isDarkMode ? 'border-slate-800/80' : 'border-slate-200'
                  }`}
                >
                  {selectedRegion.rep_source_url && (
                    <a
                      href={selectedRegion.rep_source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-between text-emerald-500 hover:underline font-medium"
                    >
                      <span>
                        {selectedRegion.rep_source_label ||
                          'Official Representative Record'}
                      </span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  {selectedRegion.rep_affidavit_url && (
                    <a
                      href={selectedRegion.rep_affidavit_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-between text-sky-500 hover:underline font-medium"
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
                      className={`inline-flex items-center justify-between hover:text-teal-500 hover:underline ${
                        isDarkMode ? 'text-slate-400' : 'text-slate-500'
                      }`}
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
              <div
                className={`p-4 rounded-xl border space-y-3 ${
                  isDarkMode
                    ? 'bg-slate-950 border-slate-800'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold flex items-center gap-1.5">
                    <BarChart3 className="w-4 h-4 text-teal-500" />
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
                            : isDarkMode
                              ? 'bg-slate-900 text-slate-400'
                              : 'bg-slate-200 text-slate-600'
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
