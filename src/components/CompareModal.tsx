import { useState, useEffect } from 'react';
import { Region, METRIC_CONFIGS, MetricKey, BoundaryLevel } from '../types';
import { X, ArrowLeftRight, ShieldCheck, ExternalLink } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  regions: Region[];
  initialRegionA?: Region | null;
}

const COMPARE_METRICS: MetricKey[] = [
  'green_cover_pct',
  'aqi_pm25',
  'population_density',
  'literacy_rate',
  'sex_ratio',
];

export default function CompareModal({
  isOpen,
  onClose,
  regions,
  initialRegionA,
}: Props) {
  const [tierFilter, setTierFilter] = useState<BoundaryLevel | 'all'>('all');
  const [codeA, setCodeA] = useState<string>('dl-nct');
  const [codeB, setCodeB] = useState<string>('hr-ggn');

  useEffect(() => {
    if (initialRegionA) {
      setCodeA(initialRegionA.code);
      const sameTierPeer = regions.find(
        (r) => r.level === initialRegionA.level && r.code !== initialRegionA.code
      );
      if (sameTierPeer) setCodeB(sameTierPeer.code);
    }
  }, [initialRegionA, regions]);

  if (!isOpen) return null;

  const filteredPool =
    tierFilter === 'all' ? regions : regions.filter((r) => r.level === tierFilter);

  const regionA = regions.find((r) => r.code === codeA) || filteredPool[0] || regions[0];
  const regionB =
    regions.find((r) => r.code === codeB) ||
    filteredPool[1] ||
    regions[1] ||
    regions[0];

  function handleSwap() {
    if (!regionA || !regionB) return;
    setCodeA(regionB.code);
    setCodeB(regionA.code);
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <ArrowLeftRight className="w-5 h-5 text-sky-400" />
              Side-by-Side Verified Civic Comparison
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Compare ISFR 2023 Green Cover, CPCB Air Quality, Census PCA, and Elected Representatives across Districts, PCs, ACs, or Wards
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5 text-sm">
          {/* Tier Filter Pills + Swap */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400">Filter Tier:</span>
              {(['all', 'district', 'constituency', 'assembly', 'ward'] as const).map(
                (t) => (
                  <button
                    key={t}
                    onClick={() => setTierFilter(t)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer ${
                      tierFilter === t
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    {t === 'all' ? 'All Tiers' : t.toUpperCase()}
                  </button>
                )
              )}
            </div>

            <button
              onClick={handleSwap}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 font-medium cursor-pointer"
            >
              <ArrowLeftRight className="w-3.5 h-3.5 text-sky-400" /> Swap Area A &harr; Area B
            </button>
          </div>

          {/* Selectors + Elected Representative Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              {
                label: 'Area A',
                reg: regionA,
                setCode: setCodeA,
                border: 'border-emerald-500/40',
                accent: 'text-emerald-400',
              },
              {
                label: 'Area B',
                reg: regionB,
                setCode: setCodeB,
                border: 'border-sky-500/40',
                accent: 'text-sky-400',
              },
            ].map((side) => (
              <div
                key={side.label}
                className={`p-4 rounded-xl bg-slate-950 border ${side.border} space-y-3`}
              >
                <div>
                  <label
                    className={`text-[10px] uppercase tracking-wider font-semibold ${side.accent} block mb-1`}
                  >
                    {side.label} ({side.reg?.level.toUpperCase()})
                  </label>
                  <select
                    value={side.reg?.code || ''}
                    onChange={(e) => side.setCode(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-medium"
                  >
                    {filteredPool.slice(0, 300).map((r) => (
                      <option key={r.code} value={r.code}>
                        [{r.level.toUpperCase()}] {r.name} ({r.state})
                      </option>
                    ))}
                  </select>
                </div>

                {side.reg && (
                  <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        {side.reg.rep_role || 'Governance'}
                      </span>
                      {side.reg.rep_party && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-semibold text-amber-300">
                          {side.reg.rep_party}
                        </span>
                      )}
                    </div>
                    <div className="font-semibold text-white">
                      {side.reg.rep_name || 'Official Administrative Jurisdiction'}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                      {side.reg.rep_source_url && (
                        <a
                          href={side.reg.rep_source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
                        >
                          {side.reg.rep_source_label || 'Official Portal'}{' '}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {side.reg.rep_affidavit_url && (
                        <a
                          href={side.reg.rep_affidavit_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sky-400 hover:underline"
                        >
                          MyNeta / SEC Roll <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Metrics Comparison Bars with % Delta & Source Link */}
          {regionA && regionB && (
            <div className="space-y-2.5">
              {COMPARE_METRICS.map((key) => {
                const cfg = METRIC_CONFIGS[key];
                const valA = Number(
                  key === 'population_density'
                    ? regionA.population_density || regionA.density || 0
                    : regionA[key] ?? 0
                );
                const valB = Number(
                  key === 'population_density'
                    ? regionB.population_density || regionB.density || 0
                    : regionB[key] ?? 0
                );
                const maxVal = Math.max(valA, valB, 1);
                const pctA = Math.round((valA / maxVal) * 100);
                const pctB = Math.round((valB / maxVal) * 100);
                const deltaPct =
                  valB > 0 ? (((valA - valB) / valB) * 100).toFixed(1) : '0.0';

                return (
                  <div
                    key={key}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-xs tabular-nums">
                      <span className="font-semibold text-emerald-400 font-mono">
                        {valA.toLocaleString('en-IN')} {cfg.unit}
                      </span>
                      <div className="flex items-center gap-2">
                        <a
                          href={cfg.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-slate-300 hover:text-teal-400 inline-flex items-center gap-1"
                        >
                          {cfg.label}
                          <ExternalLink className="w-3 h-3 text-slate-500" />
                        </a>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-slate-400">
                          {Number(deltaPct) > 0 ? `+${deltaPct}%` : `${deltaPct}%`} Δ
                        </span>
                      </div>
                      <span className="font-semibold text-sky-400 font-mono">
                        {valB.toLocaleString('en-IN')} {cfg.unit}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 items-center">
                      <div className="h-2 bg-slate-900 rounded-full overflow-hidden flex justify-end">
                        <div
                          className="h-full bg-emerald-500 rounded-full"
                          style={{ width: `${pctA}%` }}
                        />
                      </div>
                      <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-sky-500 rounded-full"
                          style={{ width: `${pctB}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
