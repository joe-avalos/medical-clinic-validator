import { useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useJobStatus } from '../hooks/useJobStatus.js';
import { ProgressTracker } from '../components/ProgressTracker.js';

export function ProgressPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useJobStatus(jobId ?? '');

  useEffect(() => {
    if (data?.status === 'completed' && data.results && data.results.length > 0) {
      const timer = setTimeout(() => {
        const first = data.results![0];
        const companyNumber = first.companyNumber ?? first.registrationNumber;
        if (companyNumber) {
          navigate(`/records/${jobId}/${companyNumber}`);
        } else {
          navigate('/records');
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [data, jobId, navigate]);

  return (
    <div className="max-w-lg mx-auto pt-8 animate-fade-in">
      <div className="mb-6">
        <Link to="/" className="text-xs font-mono text-slate-500 hover:text-slate-400 transition-colors">
          &larr; New search
        </Link>
      </div>

      <div className="p-6 bg-slate-850 border border-slate-800 rounded-xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-sans font-bold text-slate-100">Verification Progress</h2>
          <span className="text-xs font-mono text-slate-600 bg-slate-800 px-2 py-1 rounded">
            {jobId?.slice(0, 8)}...
          </span>
        </div>

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

        {data && (
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