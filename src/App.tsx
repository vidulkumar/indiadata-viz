import { useEffect, useState, FormEvent } from 'react';
import { supabase } from './lib/supabase';
import {
  Database,
  Globe,
  GitBranch,
  MapPin,
  PlusCircle,
  RefreshCw,
  CheckCircle2,
  Activity,
  Building2,
  Users,
} from 'lucide-react';

interface Region {
  id: number;
  code: string;
  name: string;
  state: string;
  level: string;
  population: number;
  density: number;
  literacy_rate: number;
  aqi_pm25: number | null;
  hospitals_count: number;
}

interface Insight {
  id: number;
  region_code: string;
  title: string;
  summary: string;
  author: string;
  created_at: string;
}

export default function App() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<string>('dl-nct');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [newTitle, setNewTitle] = useState('');
  const [newSummary, setNewSummary] = useState('');
  const [newAuthor, setNewAuthor] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const [regionsRes, insightsRes] = await Promise.all([
        supabase.from('regions').select('*').order('population', { ascending: false }),
        supabase.from('insights').select('*').order('created_at', { ascending: false }),
      ]);

      if (regionsRes.error) throw regionsRes.error;
      if (insightsRes.error) throw insightsRes.error;

      setRegions(regionsRes.data || []);
      setInsights(insightsRes.data || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load data from Supabase Postgres');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  async function handleAddInsight(e: FormEvent) {
    e.preventDefault();
    if (!newTitle.trim() || !newSummary.trim()) return;
    setSubmitting(true);
    try {
      const { error: insertError } = await supabase.from('insights').insert([
        {
          region_code: selectedRegion,
          title: newTitle.trim(),
          summary: newSummary.trim(),
          author: newAuthor.trim() || 'Civic Researcher',
        },
      ]);
      if (insertError) throw insertError;
      setNewTitle('');
      setNewSummary('');
      await fetchData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to insert insight');
    } finally {
      setSubmitting(false);
    }
  }

  const activeRegionObj = regions.find((r) => r.code === selectedRegion) || regions[0];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight text-white">
                IndiaData<span className="text-emerald-400">.viz</span>
                <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  Infra & DB Pipeline Ready
                </span>
              </h1>
              <p className="text-xs text-slate-400">
                GitHub Actions CI/CD &rarr; Cloudflare Edge &rarr; Supabase PostgreSQL 17 + PostGIS 3.3
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300">
              <GitBranch className="w-3.5 h-3.5 text-sky-400" /> GitHub Pipeline
            </span>
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300">
              <Database className="w-3.5 h-3.5 text-emerald-400" /> Postgres + PostGIS Live
            </span>
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300">
              <Globe className="w-3.5 h-3.5 text-amber-400" /> Cloudflare Edge
            </span>
            <button
              onClick={fetchData}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Sync DB
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto w-full px-6 py-8 flex-1 space-y-8">
        {error && (
          <div className="p-4 rounded-xl bg-red-950/60 border border-red-800 text-red-200 text-sm">
            <strong>Database Error:</strong> {error}
          </div>
        )}

        {/* Pipeline Status Banner */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                1. GitHub Repository & CI/CD
              </div>
              <div className="text-sm font-medium text-white mt-0.5">
                Auto-deploy on push to <code className="text-emerald-400">main</code>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Every commit triggers GitHub Actions to build & publish directly to Cloudflare.
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                2. Supabase PostgreSQL + PostGIS
              </div>
              <div className="text-sm font-medium text-white mt-0.5">
                Connected ({regions.length} NCR Regions, {insights.length} Insights)
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Project <code className="text-emerald-400">vdcxpatuospplgpcsonn</code> with RLS & PostGIS 3.3 enabled.
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                3. Cloudflare Custom Domain
              </div>
              <div className="text-sm font-medium text-white mt-0.5">
                <code className="text-amber-400">indiadata.orosant.com</code>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Served globally on Cloudflare Workers with automatic DNS &amp; SSL on <code className="text-slate-300">orosant.com</code>.
              </p>
            </div>
          </div>
        </section>

        {/* Live NCR Regions Table + Inspector */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Regions List */}
          <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-base text-white">
                  Live NCR Regions (`public.regions`)
                </h2>
                <p className="text-xs text-slate-400">
                  Fetched directly from Supabase PostgreSQL. Click any row to filter insights.
                </p>
              </div>
              <span className="text-xs px-2.5 py-1 rounded bg-slate-800 text-emerald-400 font-mono">
                SELECT * FROM public.regions
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs uppercase text-slate-400 bg-slate-950/50">
                    <th className="py-3 px-4">Region</th>
                    <th className="py-3 px-4">State</th>
                    <th className="py-3 px-4">Population</th>
                    <th className="py-3 px-4">Density (/km²)</th>
                    <th className="py-3 px-4">Literacy</th>
                    <th className="py-3 px-4">AQI (PM2.5)</th>
                    <th className="py-3 px-4">Hospitals</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {regions.map((r) => {
                    const isSelected = r.code === selectedRegion;
                    return (
                      <tr
                        key={r.id}
                        onClick={() => setSelectedRegion(r.code)}
                        className={`cursor-pointer transition ${
                          isSelected
                            ? 'bg-emerald-500/10 text-white'
                            : 'hover:bg-slate-800/60 text-slate-300'
                        }`}
                      >
                        <td className="py-3 px-4 font-medium text-white flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              isSelected ? 'bg-emerald-400' : 'bg-slate-600'
                            }`}
                          />
                          {r.name}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-400">{r.state}</td>
                        <td className="py-3 px-4 font-mono">
                          {Number(r.population).toLocaleString('en-IN')}
                        </td>
                        <td className="py-3 px-4 font-mono">
                          {Number(r.density).toLocaleString('en-IN')}
                        </td>
                        <td className="py-3 px-4 text-emerald-400 font-mono">
                          {r.literacy_rate}%
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-semibold ${
                              (r.aqi_pm25 || 0) > 250
                                ? 'bg-red-500/20 text-red-300'
                                : 'bg-amber-500/20 text-amber-300'
                            }`}
                          >
                            {r.aqi_pm25 ?? 'N/A'}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono">{r.hospitals_count}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Column: Selected Region Summary & Add Insight Form */}
          <div className="space-y-6">
            {activeRegionObj && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                    Active Region ({activeRegionObj.code})
                  </span>
                  <span className="text-xs text-slate-400">{activeRegionObj.state}</span>
                </div>
                <h3 className="text-lg font-bold text-white">{activeRegionObj.name}</h3>
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                    <div className="text-[11px] text-slate-400 flex items-center gap-1">
                      <Users className="w-3 h-3 text-sky-400" /> Pop
                    </div>
                    <div className="text-sm font-bold text-white mt-0.5">
                      {(activeRegionObj.population / 1_000_000).toFixed(2)}M
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                    <div className="text-[11px] text-slate-400 flex items-center gap-1">
                      <Activity className="w-3 h-3 text-amber-400" /> PM2.5
                    </div>
                    <div className="text-sm font-bold text-amber-400 mt-0.5">
                      {activeRegionObj.aqi_pm25}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                    <div className="text-[11px] text-slate-400 flex items-center gap-1">
                      <Building2 className="w-3 h-3 text-emerald-400" /> Hospitals
                    </div>
                    <div className="text-sm font-bold text-emerald-400 mt-0.5">
                      {activeRegionObj.hospitals_count}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Add Insight to Postgres */}
            <form
              onSubmit={handleAddInsight}
              className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3"
            >
              <div className="flex items-center gap-2 text-white font-semibold text-sm">
                <PlusCircle className="w-4 h-4 text-emerald-400" />
                Test Write to Postgres (`public.insights`)
              </div>
              <p className="text-xs text-slate-400">
                Insert a new civic data finding for{' '}
                <strong className="text-slate-200">{activeRegionObj?.name || selectedRegion}</strong>:
              </p>
              <input
                type="text"
                required
                minLength={3}
                placeholder="Insight title (e.g. Ward 14 AQI Spike)"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
              <textarea
                required
                minLength={5}
                rows={3}
                placeholder="Describe finding or data layer correlation..."
                value={newSummary}
                onChange={(e) => setNewSummary(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
              <input
                type="text"
                placeholder="Author name (optional)"
                value={newAuthor}
                onChange={(e) => setNewAuthor(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold py-2 rounded-lg transition cursor-pointer"
              >
                {submitting ? 'Saving to Supabase Postgres...' : 'Save Finding to Database'}
              </button>
            </form>
          </div>
        </div>

        {/* Insights Feed from Postgres */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-base text-white">
                Published Civic Insights (`public.insights`)
              </h2>
              <p className="text-xs text-slate-400">
                Live records stored in Supabase PostgreSQL
              </p>
            </div>
            <span className="text-xs text-slate-400">{insights.length} total records</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {insights.map((item) => (
              <div
                key={item.id}
                className="p-4 rounded-lg bg-slate-950 border border-slate-800 flex flex-col justify-between gap-2"
              >
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                    <span className="font-mono text-emerald-400 uppercase">{item.region_code}</span>
                    <span>{new Date(item.created_at).toLocaleString()}</span>
                  </div>
                  <h4 className="font-semibold text-sm text-white">{item.title}</h4>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">{item.summary}</p>
                </div>
                <div className="text-[11px] text-slate-500 pt-2 border-t border-slate-900">
                  By {item.author}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
