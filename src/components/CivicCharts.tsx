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
      label: 'Green Cover %',
      val: Number(region.green_cover_pct || 0),
      mean:
        safePeers.reduce((s, r) => s + Number(r.green_cover_pct || 0), 0) /
        safePeers.length,
      max: 35,
    },
    {
      label: 'CPCB AQI',
      val: Number(region.aqi_pm25 || 0),
      mean:
        safePeers.reduce((s, r) => s + Number(r.aqi_pm25 || 0), 0) /
        safePeers.length,
      max: 400,
    },
    {
      label: 'PM2.5 (µg/m³)',
      val: Number(region.pm25_ugm3 || 0),
      mean:
        safePeers.reduce((s, r) => s + Number(r.pm25_ugm3 || 0), 0) /
        safePeers.length,
      max: 300,
    },
    {
      label: 'Area (km²)',
      val: Number(region.area_sq_km || 0),
      mean:
        safePeers.reduce((s, r) => s + Number(r.area_sq_km || 0), 0) /
        safePeers.length,
      max: Math.max(...safePeers.map((r) => Number(r.area_sq_km || 1)), 1),
    },
    {
      label: 'Literacy %',
      val: Number(region.literacy_rate || 0),
      mean:
        safePeers.reduce((s, r) => s + Number(r.literacy_rate || 0), 0) /
        safePeers.length,
      max: 100,
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
