import { Fragment, useState, useRef, useEffect, useCallback } from 'react';
import { useTelemetry } from '../hooks/useTelemetry.js';
import type { TelemetryRecord } from '../api/client.js';

const PATH_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Paths' },
  { value: 'scrape→validate→store', label: 'Success' },
  { value: 'scrape→empty→store', label: 'Empty (0 companies)' },
  { value: 'scrape→fallback→store', label: 'Fallback (AI failed)' },
  { value: 'scrape→partial-fallback→store', label: 'Partial Fallback' },
];

function PathBadge({ path }: { path: string }) {
  const config: Record<string, { color: string; label: string }> = {
    'scrape→validate→store': { color: 'bg-risk-low/15 text-risk-low', label: 'Success' },
    'scrape→empty→store': { color: 'bg-risk-high/15 text-risk-high', label: 'Empty' },
    'scrape→fallback→store': { color: 'bg-risk-high/15 text-risk-high', label: 'Fallback' },
    'scrape→partial-fallback→store': { color: 'bg-risk-medium/15 text-risk-medium', label: 'Partial' },
  };
  const c = config[path] ?? { color: 'bg-slate-700 text-slate-400', label: path };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono ${c.color}`}>
      {c.label}
    </span>
  );
}

function OutcomePills({ outcomes }: { outcomes: TelemetryRecord['validationOutcomes'] }) {
  return (
    <div className="flex items-center gap-1.5">
      {outcomes.success > 0 && (
        <span className="text-xs font-mono text-risk-low bg-risk-low/10 px-1.5 py-0.5 rounded">
          {outcomes.success} ok
        </span>
      )}
      {outcomes.fallback > 0 && (
        <span className="text-xs font-mono text-risk-high bg-risk-high/10 px-1.5 py-0.5 rounded">
          {outcomes.fallback} fail
        </span>
      )}
      {outcomes.empty > 0 && (
        <span className="text-xs font-mono text-risk-unknown bg-risk-unknown/10 px-1.5 py-0.5 rounded">
          {outcomes.empty} empty
        </span>
      )}
      {outcomes.success === 0 && outcomes.fallback === 0 && outcomes.empty === 0 && (
        <span className="text-xs text-slate-600">—</span>
      )}
    </div>
  );
}

function TelemetryDetailRow({ record, colSpan }: { record: TelemetryRecord; colSpan: number }) {
  return (
    <tr className="animate-fade-in">
      <td colSpan={colSpan} className="p-0">
        <div className="bg-slate-900/80 border-t border-accent/20 px-6 py-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Pipeline Path" value={<PathBadge path={record.pipelinePath} />} />
            <Field label="Duration" value={`${record.durationMs.toLocaleString()}ms`} />
            <Field label="Scraper" value={record.scraperProvider} />
            <Field label="AI Provider" value={record.aiProvider} />
            <Field label="Cache Hit" value={record.cacheHit ? 'Yes' : 'No'} />
            <Field label="Companies Found" value={String(record.companiesFound)} />
            <Field label="Outcomes" value={<OutcomePills outcomes={record.validationOutcomes} />} />
            <Field label="Created" value={new Date(record.createdAt).toLocaleString()} />
          </div>

          {record.errorMessage && (
            <div className="mt-4 p-3 bg-risk-high/10 border border-risk-high/20 rounded-lg">
              <p className="text-xs font-mono text-risk-high">{record.errorMessage}</p>
            </div>
          )}

          <p className="text-xs font-mono text-slate-600 mt-3">Job ID: {record.jobId}</p>
        </div>
      </td>
    </tr>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-mono text-slate-500 uppercase tracking-wider">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-300">
        {typeof value === 'string' ? value : value}
      </dd>
    </div>
  );
}

export function TelemetryPage() {
  const [pathFilter, setPathFilter] = useState('');
  const [selectedJob, setSelectedJob] = useState<TelemetryRecord | null>(null);

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useTelemetry({
    pipelinePath: pathFilter || undefined,
    limit: 50,
  });

  const sentinelRef = useRef<HTMLDivElement>(null);

  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(handleIntersect, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleIntersect]);

  const allRecords = (data?.pages.flatMap((p) => p.records) ?? []) as TelemetryRecord[];
  const total = data?.pages[0]?.total ?? 0;

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-sans font-bold text-slate-100">Pipeline Telemetry</h1>
          <p className="text-sm text-slate-500 mt-1">
            {data ? `${total} job${total !== 1 ? 's' : ''} traced` : 'Loading...'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {isFetchingNextPage && (
            <span className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-[spin_0.6s_linear_infinite]" />
          )}
          <select
            value={pathFilter}
            onChange={(e) => {
              setPathFilter(e.target.value);
              setSelectedJob(null);
            }}
            className="px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-300 font-mono focus:outline-none focus:border-accent cursor-pointer"
          >
            {PATH_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-850 border border-slate-800 rounded-xl">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 bg-slate-900 rounded-lg animate-pulse" style={{ animationDelay: `${i * 100}ms` }} />
            ))}
          </div>
        ) : allRecords.length === 0 ? (
          <div className="text-center py-16 animate-fade-in">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-slate-800 flex items-center justify-center">
              <svg className="w-6 h-6 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <p className="text-slate-500 text-sm">No telemetry records found</p>
            <p className="text-slate-600 text-xs mt-1">Submit a verification to generate telemetry</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left py-3 px-4 text-xs font-mono text-slate-500 uppercase tracking-wider">Search Query</th>
                <th className="text-left py-3 px-4 text-xs font-mono text-slate-500 uppercase tracking-wider">Path</th>
                <th className="text-left py-3 px-4 text-xs font-mono text-slate-500 uppercase tracking-wider">Scraper</th>
                <th className="text-left py-3 px-4 text-xs font-mono text-slate-500 uppercase tracking-wider">AI</th>
                <th className="text-right py-3 px-4 text-xs font-mono text-slate-500 uppercase tracking-wider">Found</th>
                <th className="text-left py-3 px-4 text-xs font-mono text-slate-500 uppercase tracking-wider">Outcomes</th>
                <th className="text-right py-3 px-4 text-xs font-mono text-slate-500 uppercase tracking-wider">Duration</th>
                <th className="text-left py-3 px-4 text-xs font-mono text-slate-500 uppercase tracking-wider">Date</th>
              </tr>
            </thead>
            <tbody>
              {allRecords.map((record, i) => {
                const isExpanded = selectedJob?.jobId === record.jobId;
                return (
                  <Fragment key={record.jobId}>
                    <tr
                      onClick={() => setSelectedJob(isExpanded ? null : record)}
                      className={`border-b border-slate-800/50 transition-colors cursor-pointer animate-fade-in ${
                        isExpanded
                          ? 'bg-accent/5 border-b-0'
                          : 'hover:bg-slate-900/60'
                      }`}
                      style={{ animationDelay: `${i * 30}ms` }}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className={`text-slate-500 text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
                          <span className="text-sm font-semibold text-slate-200">{record.normalizedName}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <PathBadge path={record.pipelinePath} />
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-xs font-mono text-slate-400">{record.scraperProvider}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-xs font-mono text-slate-400">{record.aiProvider}</span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className={`text-sm font-mono ${record.companiesFound === 0 ? 'text-risk-high' : 'text-slate-300'}`}>
                          {record.companiesFound}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <OutcomePills outcomes={record.validationOutcomes} />
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className={`text-xs font-mono ${record.durationMs > 10000 ? 'text-risk-medium' : 'text-slate-400'}`}>
                          {record.durationMs > 1000 ? `${(record.durationMs / 1000).toFixed(1)}s` : `${record.durationMs}ms`}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-slate-500">
                        {new Date(record.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                    {isExpanded && <TelemetryDetailRow record={record} colSpan={8} />}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Scroll sentinel */}
      <div ref={sentinelRef} className="h-1" />

      {isFetchingNextPage && (
        <div className="mt-4 flex justify-center animate-fade-in">
          <span className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-[spin_0.6s_linear_infinite]" />
        </div>
      )}

      {!isLoading && !hasNextPage && allRecords.length > 0 && (
        <p className="mt-4 text-center text-xs text-slate-600">
          All {total} records loaded
        </p>
      )}
    </div>
  );
}
