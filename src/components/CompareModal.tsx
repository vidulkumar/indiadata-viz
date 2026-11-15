import { useState } from 'react';
import { Region, METRIC_CONFIGS, MetricKey } from '../types';
import { X, ArrowLeftRight } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  regions: Region[];
}

const COMPARE_METRICS: MetricKey[] = [
  'population',
  'density',
  'literacy_rate',
  'aqi_pm25',
  'hospitals_count',
  'schools_count',
  'green_cover_pct',
  'sex_ratio',
  'avg_circle_rate',
];

export default function CompareModal({ isOpen, onClose, regions }: Props) {
  const [codeA, setCodeA] = useState<string>('dl-nct');
  const [codeB, setCodeB] = useState<string>('hr-ggn');

  if (!isOpen) return null;

  const regionA = regions.find((r) => r.code === codeA) || regions[0];
  const regionB = regions.find((r) => r.code === codeB) || regions[1] || regions[0];

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <ArrowLeftRight className="w-5 h-5 text-sky-400" />
              Compare Two NCR Regions Side-by-Side
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Compare Census, Air Quality, Infrastructure &amp; Property Metrics across Districts,
              Constituencies, or Wards
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
          {/* Selectors */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-3.5 rounded-xl bg-slate-950 border border-emerald-500/40">
              <label className="text-[11px] uppercase tracking-wider font-semibold text-emerald-400 block mb-1">
                Region A
              </label>
              <select
                value={regionA?.code || ''}
                onChange={(e) => setCodeA(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-medium"
              >
                {regions.map((r) => (
                  <option key={r.code} value={r.code}>
                    [{r.level.toUpperCase()}] {r.name} ({r.state})
                  </option>
                ))}
              </select>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-sky-500/40">
              <label className="text-[11px] uppercase tracking-wider font-semibold text-sky-400 block mb-1">
                Region B
              </label>
              <select
                value={regionB?.code || ''}
                onChange={(e) => setCodeB(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-medium"
              >
                {regions.map((r) => (
                  <option key={r.code} value={r.code}>
                    [{r.level.toUpperCase()}] {r.name} ({r.state})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Metrics Comparison Bars */}
          {regionA && regionB && (
            <div className="space-y-3">
              {COMPARE_METRICS.map((key) => {
                const cfg = METRIC_CONFIGS[key];
                const valA = Number(regionA[key] ?? 0);
                const valB = Number(regionB[key] ?? 0);
                const maxVal = Math.max(valA, valB, 1);
                const pctA = Math.round((valA / maxVal) * 100);
                const pctB = Math.round((valB / maxVal) * 100);

                return (
                  <div
                    key={key}
                    className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-emerald-400 font-mono">
                        {valA.toLocaleString('en-IN')} {cfg.unit}
                      </span>
                      <span className="font-medium text-slate-300">{cfg.label}</span>
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
