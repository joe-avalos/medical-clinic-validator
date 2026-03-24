import { useParams, Link } from 'react-router-dom';
import { useJobStatus } from '../hooks/useJobStatus.js';
import { RiskBadge } from '../components/RiskBadge.js';

const RISK_ORDER: Record<string, number> = {
  HIGH: 0,
  MEDIUM: 1,
  UNKNOWN: 2,
  LOW: 3,
};

function sortByRisk(results: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...results].sort((a, b) => {
    const aOrder = RISK_ORDER[a.riskLevel as string] ?? 2;
    const bOrder = RISK_ORDER[b.riskLevel as string] ?? 2;
    return aOrder - bOrder;
  });
}

export function JobResultsPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { data, isLoading, isError } = useJobStatus(jobId ?? '');

  const sorted = data?.results ? sortByRisk(data.results) : [];

  return (
    <div className="max-w-3xl mx-auto pt-8 animate-fade-in">
      <div className="mb-6 flex items-center gap-3">
        <Link to="/" className="text-xs font-mono text-slate-500 hover:text-slate-400 transition-colors">
          &larr; New search
        </Link>
        <span className="text-slate-700">/</span>
        <span className="text-xs font-mono text-slate-600">{jobId?.slice(0, 8)}...</span>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-sans font-bold text-slate-100">Verification Results</h1>
        <p className="text-sm text-slate-500 mt-1">
          {isLoading
            ? 'Loading...'
            : `${sorted.length} entit${sorted.length !== 1 ? 'ies' : 'y'} found — sorted by risk level`}
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <span className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-[spin_0.8s_linear_infinite]" />
        </div>
      )}

      {isError && (
        <div className="px-4 py-3 bg-risk-high-bg border border-risk-high/20 rounded-lg text-sm text-risk-high font-mono">
          Failed to load results
        </div>
      )}

      {!isLoading && sorted.length === 0 && data && (
        <div className="text-center py-16">
          <p className="text-slate-500 text-sm">No results found for this job</p>
        </div>
      )}

      <div className="space-y-3">
        {sorted.map((record, i) => {
          const companyNumber = record.companyNumber as string;
          const detailPath = companyNumber
            ? `/records/${jobId}/${companyNumber}`
            : '#';

          return (
            <Link
              key={`${companyNumber}-${i}`}
              to={detailPath}
              className="block p-4 bg-slate-850 border border-slate-800 rounded-xl hover:border-slate-700 hover:bg-slate-900/60 transition-all group animate-fade-in"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-200 group-hover:text-accent-hover transition-colors truncate">
                    {record.companyName as string}
                  </p>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-xs font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                      {(record.jurisdiction as string)?.toUpperCase()}
                    </span>
                    <span className={`text-xs ${
                      record.legalStatus === 'Active' ? 'text-risk-low'
                        : record.legalStatus === 'Dissolved' ? 'text-risk-high'
                          : 'text-slate-400'
                    }`}>
                      {record.legalStatus as string}
                    </span>
                    {record.registrationNumber && (
                      <span className="text-xs font-mono text-slate-500">
                        #{record.registrationNumber as string}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-2 line-clamp-2 leading-relaxed">
                    {record.aiSummary as string}
                  </p>
                </div>
                <div className="shrink-0">
                  <RiskBadge level={record.riskLevel as string} />
                </div>
              </div>

              {(record.riskFlags as string[])?.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-800/50">
                  <div className="flex flex-wrap gap-2">
                    {(record.riskFlags as string[]).map((flag, j) => (
                      <span
                        key={j}
                        className="text-[10px] font-mono text-risk-high bg-risk-high-bg px-2 py-0.5 rounded-full border border-risk-high/20"
                      >
                        {flag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}