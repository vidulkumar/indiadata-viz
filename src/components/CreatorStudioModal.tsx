import { useState } from 'react';
import { Insight, Region } from '../types';
import {
  X,
  TrendingUp,
  Share2,
  Download,
  IndianRupee,
  Eye,
  Award,
} from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  insights: Insight[];
  regions: Region[];
}

export default function CreatorStudioModal({
  isOpen,
  onClose,
  insights,
  regions,
}: Props) {
  const [monthlyViews, setMonthlyViews] = useState<number>(25000);
  const [proDownloads, setProDownloads] = useState<number>(40);

  if (!isOpen) return null;

  // Hybrid monetization calculation from AI Studio spec
  const adRevenueInr = Math.round((monthlyViews / 1000) * 110 * 0.6); // 60% creator cut of ₹110 RPM
  const exportRevenueInr = Math.round(proDownloads * 249 * 0.5); // 50% creator share of ₹249 dataset download
  const totalCreatorMonthlyInr = adRevenueInr + exportRevenueInr;

  function exportRegionsCsv() {
    const headers = [
      'code',
      'name',
      'state',
      'level',
      'population',
      'density',
      'literacy_rate',
      'aqi_pm25',
      'hospitals_count',
      'sex_ratio',
      'green_cover_pct',
      'schools_count',
      'avg_circle_rate',
    ];
    const csvRows = [
      headers.join(','),
      ...regions.map((r) =>
        headers.map((h) => JSON.stringify(r[h as keyof Region] ?? '')).join(',')
      ),
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'indiadata-ncr-cleaned-dataset.csv';
    a.click();
  }

  function handleShareInsight(item: Insight) {
    const shareUrl = `${window.location.origin}/?region=${encodeURIComponent(
      item.region_code
    )}&insight=${item.id}`;
    navigator.clipboard?.writeText(shareUrl);
    alert(`Copied shareable Data Story link:\n${shareUrl}`);
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Award className="w-5 h-5 text-amber-400" />
              Creator Data Stories &amp; Hybrid Monetization Studio
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Community researchers publish geo-verified findings to Supabase Postgres &amp; earn
              from page traffic + cleaned dataset exports
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6 text-sm">
          {/* Monetization Simulator */}
          <div className="p-5 rounded-xl bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950/30 border border-emerald-500/30 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                  Phase 4 Creator Economy Model
                </span>
                <h3 className="text-sm font-bold text-white mt-1">
                  Creator Revenue Share Estimator (Ad RPM + Cleaned GeoJSON/CSV Exports)
                </h3>
              </div>
              <button
                onClick={exportRegionsCsv}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" /> Export Cleaned NCR Dataset (.CSV)
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-3.5 rounded-lg bg-slate-950/90 border border-slate-800">
                <label className="text-xs text-slate-400 flex justify-between">
                  <span>Monthly Insight Page Views</span>
                  <span className="text-white font-mono">
                    {monthlyViews.toLocaleString('en-IN')}
                  </span>
                </label>
                <input
                  type="range"
                  min={1000}
                  max={250000}
                  step={1000}
                  value={monthlyViews}
                  onChange={(e) => setMonthlyViews(Number(e.target.value))}
                  className="w-full accent-emerald-500 mt-2 cursor-pointer"
                />
                <div className="text-[11px] text-slate-400 mt-1">
                  60% Ad Revenue Share: <strong className="text-emerald-400">₹{adRevenueInr.toLocaleString('en-IN')}/mo</strong>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-950/90 border border-slate-800">
                <label className="text-xs text-slate-400 flex justify-between">
                  <span>Cleaned Dataset Downloads</span>
                  <span className="text-white font-mono">{proDownloads}/mo</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={300}
                  step={5}
                  value={proDownloads}
                  onChange={(e) => setProDownloads(Number(e.target.value))}
                  className="w-full accent-sky-500 mt-2 cursor-pointer"
                />
                <div className="text-[11px] text-slate-400 mt-1">
                  50% Pro Export Share: <strong className="text-sky-400">₹{exportRevenueInr.toLocaleString('en-IN')}/mo</strong>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex flex-col justify-center">
                <div className="text-xs text-emerald-300 flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" /> Estimated Creator Payout
                </div>
                <div className="text-2xl font-bold text-white flex items-center mt-1">
                  <IndianRupee className="w-5 h-5 text-emerald-400" />
                  {totalCreatorMonthlyInr.toLocaleString('en-IN')}
                  <span className="text-xs font-normal text-slate-400 ml-1">/ month</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Paid via UPI / Bank Transfer on verified data stories
                </div>
              </div>
            </div>
          </div>

          {/* Live Published Data Stories from Supabase */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-white">
                Published Data Stories in Supabase PostgreSQL ({insights.length})
              </h3>
              <span className="text-xs text-slate-400">
                Click any Region on the map to publish a new Data Story
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {insights.map((item) => {
                const reg = regions.find((r) => r.code === item.region_code);
                return (
                  <div
                    key={item.id}
                    className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                        <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-medium">
                          {reg?.name || item.region_code}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="flex items-center gap-1">
                            <Eye className="w-3 h-3 text-sky-400" /> {item.views_count || 120}
                          </span>
                          <span>{new Date(item.created_at).toLocaleDateString()}</span>
                        </span>
                      </div>
                      <h4 className="font-semibold text-sm text-white mt-1">{item.title}</h4>
                      <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                        {item.summary}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-slate-900 flex items-center justify-between text-xs">
                      <span className="text-slate-400">By {item.author}</span>
                      <button
                        onClick={() => handleShareInsight(item)}
                        className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-medium cursor-pointer"
                      >
                        <Share2 className="w-3.5 h-3.5" /> Share Story Link
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
