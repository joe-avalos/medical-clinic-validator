import { useEffect } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useJobStatus } from '../hooks/useJobStatus.js';
import { ProgressTracker } from '../components/ProgressTracker.js';
import { submitVerification } from '../api/client.js';

interface CachedState {
  cached: boolean;
  cachedAt?: string;
  companyName: string;
  jurisdiction?: string;
}

function formatCachedDate(iso?: string): string {
  if (!iso) return 'recently';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return d.toLocaleDateString();
}

export function ProgressPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const cachedState = location.state as CachedState | null;
  const isCached = cachedState?.cached === true;

  const { data, isLoading, isError } = useJobStatus(jobId ?? '');

  const refreshMutation = useMutation({
    mutationFn: () =>
      submitVerification(cachedState!.companyName, cachedState?.jurisdiction, true),
    onSuccess: (newData) => {
      navigate(`/verify/${newData.jobId}`, { replace: true });
    },
  });

  // Auto-redirect for fresh (non-cached) completed jobs
  useEffect(() => {
    if (isCached) return; // Don't auto-redirect cached results
    if (data?.status === 'completed' && data.results && data.results.length > 0) {
      const timer = setTimeout(() => {
        navigate(`/verify/${jobId}/results`);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [data, jobId, navigate, isCached]);

  const handleViewResults = () => {
    navigate(`/verify/${jobId}/results`);
  };

  return (
    <div className="max-w-lg mx-auto pt-8 animate-fade-in">
      <div className="mb-6">
        <Link to="/" className="text-xs font-mono text-slate-500 hover:text-slate-400 transition-colors">
          &larr; New search
        </Link>
      </div>

      <div className="p-6 bg-slate-850 border border-slate-800 rounded-xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-sans font-bold text-slate-100">
            {isCached ? 'Cached Result' : 'Verification Progress'}
          </h2>
          <span className="text-xs font-mono text-slate-600 bg-slate-800 px-2 py-1 rounded">
            {jobId?.slice(0, 8)}...
          </span>
        </div>

        {/* Cached result banner */}
        {isCached && data?.status === 'completed' && (
          <div className="mb-6 animate-fade-in">
            <div className="px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-sm text-amber-200 font-medium">
                    Showing cached result from {formatCachedDate(cachedState?.cachedAt)}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    This result was retrieved from cache. You can view it or re-run the verification with fresh data.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-4">
              <button
                onClick={handleViewResults}
                className="flex-1 px-4 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer shadow-lg shadow-accent/10"
              >
                View Results
              </button>
              <button
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending}
                className="flex-1 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-800 disabled:text-slate-600 text-slate-300 text-sm font-semibold rounded-lg transition-colors cursor-pointer border border-slate-700"
              >
                {refreshMutation.isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-3.5 h-3.5 border-2 border-slate-500/30 border-t-slate-400 rounded-full animate-[spin_0.6s_linear_infinite]" />
                    Re-verifying...
                  </span>
                ) : (
                  'Re-verify'
                )}
              </button>
            </div>

            {refreshMutation.isError && (
              <div className="mt-3 px-4 py-2.5 bg-risk-high-bg border border-risk-high/20 rounded-lg text-risk-high text-sm font-mono animate-fade-in">
                {refreshMutation.error instanceof Error ? refreshMutation.error.message : 'Re-verification failed'}
              </div>
            )}
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <span className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-[spin_0.8s_linear_infinite]" />
          </div>
        )}

        {isError && (
          <div className="px-4 py-3 bg-risk-high-bg border border-risk-high/20 rounded-lg text-sm text-risk-high font-mono">
            Failed to fetch job status
          </div>
        )}

        {/* Progress tracker — only show for non-cached or still-loading cached */}
        {data && !isCached && (
          <>
            <ProgressTracker
              status={data.status}
              errorMessage={data.errorMessage}
            />

            {data.status === 'completed' && (
              <div className="mt-6 pt-4 border-t border-slate-800 animate-fade-in">
                <p className="text-xs text-slate-500 mb-3">
                  {data.results?.length ?? 0} result{(data.results?.length ?? 0) !== 1 ? 's' : ''} found &middot; redirecting...
                </p>
                <div className="flex gap-2">
                  <Link
                    to="/records"
                    className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition-colors"
                  >
                    View All Records
                  </Link>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
