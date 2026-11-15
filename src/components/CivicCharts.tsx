import { Region, MetricKey, METRIC_CONFIGS } from '../types';

interface BenchmarkProps {
  region: Region;
  peerRegions: Region[];
  mode: 'radar' | 'bar';
  activeMetrics?: MetricKey[];
}

const DEFAULT_BENCHMARK_KEYS: MetricKey[] = [
  'green_cover_pct',
  'aqi_pm25',
  'groundwater_extraction_pct',
  'hospital_beds_per_10k',
  'pupil_teacher_ratio',
  'literacy_rate',
];

export function BenchmarkChart({
  region,
  peerRegions,
  mode,
  activeMetrics,
}: BenchmarkProps) {
  const safePeers = peerRegions.length > 0 ? peerRegions : [region];

  // Build dynamic list of metrics (active checked metrics + core civic balance, 5 to 7 axes for radar)
  const chosenKeys: MetricKey[] = (() => {
    const merged = new Set<MetricKey>(activeMetrics || []);
    for (const k of DEFAULT_BENCHMARK_KEYS) {
      if (merged.size >= 6) break;
      merged.add(k);
    }
    return Array.from(merged).slice(0, 7);
  })();

  const metrics = chosenKeys.map((key) => {
    const cfg = METRIC_CONFIGS[key];
    const getVal = (r: Region) =>
      key === 'population_density'
        ? Number(r.population_density || r.density || 0)
        : Number(r[key] ?? 0);

    const val = getVal(region);
    const mean =
      safePeers.reduce((s, r) => s + getVal(r), 0) / Math.max(1, safePeers.length);
    const peerMax = Math.max(...safePeers.map(getVal), cfg.benchmarkMax || 100, 1);

    return {
      key,
      label: cfg.shortLabel,
      unit: cfg.unit,
      val,
      mean,
      max: peerMax,
    };
  });

  if (mode === 'bar') {
    return (
      <div className="space-y-2.5 pt-1">
        {metrics.map((m) => {
          const rPct = Math.min(100, Math.max(8, Math.round((m.val / m.max) * 100)));
          const mPct = Math.min(100, Math.max(8, Math.round((m.mean / m.max) * 100)));
          return (
            <div key={m.key} className="space-y-1">
              <div className="flex justify-between text-[11px] tabular-nums">
                <span className="text-slate-300 font-medium">{m.label}</span>
                <span>
                  <strong className="text-emerald-400">
                    {m.val.toLocaleString('en-IN', { maximumFractionDigits: 1 })}{' '}
                    {m.unit}
                  </strong>{' '}
                  <span className="text-slate-500">
                    vs avg {m.mean.toLocaleString('en-IN', { maximumFractionDigits: 1 })}
                  </span>
                </span>
              </div>
              <div className="space-y-1">
                <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 rounded-full transition-all"
                    style={{ width: `${rPct}%` }}
                  />
                </div>
                <div className="h-1 bg-slate-900 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-slate-500 rounded-full transition-all"
                    style={{ width: `${mPct}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Multi-Axis SVG Radar Chart
  const cx = 115;
  const cy = 95;
  const radius = 62;
  const count = metrics.length;

  const getPoint = (idx: number, norm: number) => {
    const angle = (Math.PI * 2 * idx) / count - Math.PI / 2;
    const r = Math.min(1, Math.max(0.12, norm)) * radius;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  };

  const regionPoly = metrics
    .map((m, i) => getPoint(i, m.val / m.max).join(','))
    .join(' ');
  const meanPoly = metrics
    .map((m, i) => getPoint(i, m.mean / m.max).join(','))
    .join(' ');

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 230 190" className="w-full max-w-[240px] h-46 overflow-visible">
        {[0.33, 0.66, 1].map((step) => (
          <polygon
            key={step}
            points={metrics.map((_, i) => getPoint(i, step).join(',')).join(' ')}
            fill="none"
            stroke="#334155"
            strokeWidth="0.8"
            strokeDasharray={step < 1 ? '2 2' : undefined}
          />
        ))}
        {metrics.map((m, i) => {
          const [x, y] = getPoint(i, 1);
          const [lx, ly] = getPoint(i, 1.25);
          return (
            <g key={m.key}>
              <line
                x1={cx}
                y1={cy}
                x2={x}
                y2={y}
                stroke="#334155"
                strokeWidth="0.8"
              />
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-slate-400 text-[8.5px] font-medium"
              >
                {m.label}
              </text>
            </g>
          );
        })}
        <polygon
          points={meanPoly}
          fill="rgba(148, 163, 184, 0.18)"
          stroke="#94a3b8"
          strokeWidth="1.5"
          strokeDasharray="3 2"
        />
        <polygon
          points={regionPoly}
          fill="rgba(16, 185, 129, 0.28)"
          stroke="#10b981"
          strokeWidth="2"
        />
      </svg>
      <div className="flex items-center gap-4 text-[10px] text-slate-400 -mt-1">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
          {region.name}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-0.5 bg-slate-400 inline-block" />
          Tier Average ({safePeers.length})
        </span>
      </div>
    </div>
  );
}
