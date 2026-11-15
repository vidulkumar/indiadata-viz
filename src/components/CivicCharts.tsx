import { Region } from '../types';

interface BenchmarkProps {
  region: Region;
  peerRegions: Region[];
  mode: 'radar' | 'bar';
}

export function BenchmarkChart({ region, peerRegions, mode }: BenchmarkProps) {
  const safePeers = peerRegions.length > 0 ? peerRegions : [region];

  const metrics = [
    {
      label: 'Density',
      val: Number(region.population_density || region.density || 0),
      mean:
        safePeers.reduce(
          (s, r) => s + Number(r.population_density || r.density || 0),
          0
        ) / safePeers.length,
      max: Math.max(
        ...safePeers.map((r) => Number(r.population_density || r.density || 1)),
        1
      ),
    },
    {
      label: 'Literacy',
      val: Number(region.literacy_rate || 0),
      mean:
        safePeers.reduce((s, r) => s + Number(r.literacy_rate || 0), 0) /
        safePeers.length,
      max: 100,
    },
    {
      label: 'Sex Ratio',
      val: Number(region.sex_ratio || 865),
      mean:
        safePeers.reduce((s, r) => s + Number(r.sex_ratio || 865), 0) /
        safePeers.length,
      max: 960,
    },
    {
      label: 'Green %',
      val: Number(region.green_cover_pct || 15),
      mean:
        safePeers.reduce((s, r) => s + Number(r.green_cover_pct || 15), 0) /
        safePeers.length,
      max: 40,
    },
    {
      label: 'Schools',
      val: Number(region.schools_count || 20),
      mean:
        safePeers.reduce((s, r) => s + Number(r.schools_count || 20), 0) /
        safePeers.length,
      max: Math.max(...safePeers.map((r) => Number(r.schools_count || 1)), 1),
    },
  ];

  if (mode === 'bar') {
    return (
      <div className="space-y-2.5 pt-1">
        {metrics.map((m) => {
          const rPct = Math.min(100, Math.max(8, Math.round((m.val / m.max) * 100)));
          const mPct = Math.min(100, Math.max(8, Math.round((m.mean / m.max) * 100)));
          return (
            <div key={m.label} className="space-y-1">
              <div className="flex justify-between text-[11px] tabular-nums">
                <span className="text-slate-300 font-medium">{m.label}</span>
                <span>
                  <strong className="text-emerald-400">
                    {m.val.toLocaleString('en-IN', { maximumFractionDigits: 1 })}
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

  // 5-Axis SVG Radar Chart
  const cx = 110;
  const cy = 92;
  const radius = 64;
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
      <svg viewBox="0 0 220 185" className="w-full max-w-[230px] h-44 overflow-visible">
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
          const [lx, ly] = getPoint(i, 1.24);
          return (
            <g key={m.label}>
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
                className="fill-slate-400 text-[9px] font-medium"
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

interface TrendProps {
  title: string;
  unit: string;
  series: Array<{ date: string; value: number }>;
}

export function TimeSeriesTrendChart({ title, unit, series }: TrendProps) {
  if (!series || series.length < 2) return null;

  const vals = series.map((s) => s.value);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals, minV + 1);
  const pad = (maxV - minV) * 0.15 || 10;
  const lo = Math.max(0, minV - pad);
  const hi = maxV + pad;

  const w = 240;
  const h = 84;
  const pts = series.map((s, i) => {
    const x = 16 + (i / Math.max(series.length - 1, 1)) * (w - 32);
    const y = h - 18 - ((s.value - lo) / (hi - lo)) * (h - 32);
    return { ...s, x, y };
  });

  const polyline = pts.map((p) => `${p.x},${p.y}`).join(' ');
  const first = series[0].value;
  const last = series[series.length - 1].value;
  const deltaPct = first !== 0 ? (((last - first) / first) * 100).toFixed(1) : '0.0';

  return (
    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-slate-300">{title}</span>
        <span
          className={`font-mono font-semibold tabular-nums px-1.5 py-0.5 rounded text-[10px] ${
            Number(deltaPct) > 0
              ? 'bg-amber-500/15 text-amber-300'
              : 'bg-emerald-500/15 text-emerald-300'
          }`}
        >
          {Number(deltaPct) > 0 ? `+${deltaPct}%` : `${deltaPct}%`} Δ
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-22 overflow-visible">
        <polyline
          fill="none"
          stroke="#14b8a6"
          strokeWidth="2.2"
          points={polyline}
        />
        {pts.map((p) => (
          <g key={p.date}>
            <circle
              cx={p.x}
              cy={p.y}
              r="3.5"
              className="fill-emerald-400 stroke-slate-950"
              strokeWidth="1.5"
            />
            <text
              x={p.x}
              y={p.y - 7}
              textAnchor="middle"
              className="fill-slate-200 text-[8.5px] font-mono"
            >
              {p.value}
            </text>
            <text
              x={p.x}
              y={h - 4}
              textAnchor="middle"
              className="fill-slate-500 text-[8px] font-mono"
            >
              {p.date.slice(5)}
            </text>
          </g>
        ))}
      </svg>
      <div className="text-[10px] text-slate-500 flex justify-between tabular-nums">
        <span>Start: {first} {unit}</span>
        <span>Latest: {last} {unit}</span>
      </div>
    </div>
  );
}
