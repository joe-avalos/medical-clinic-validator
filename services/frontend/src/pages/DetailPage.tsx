import { useParams, Link } from 'react-router-dom';
import { useJobStatus } from '../hooks/useJobStatus.js';
import { DetailView } from '../components/DetailView.js';

export function DetailPage() {
  const { jobId, companyNumber } = useParams<{ jobId: string; companyNumber: string }>();
  const { data, isLoading, isError } = useJobStatus(jobId ?? '');

  const record = data?.results?.find(
    (r) => (r.companyNumber as string) === companyNumber || (r.registrationNumber as string) === companyNumber,
  );

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <div className="mb-6 flex items-center gap-3">
        <Link to="/records" className="text-xs font-mono text-slate-500 hover:text-slate-400 transition-colors">
          &larr; Records
        </Link>
        <span className="text-slate-700">/</span>
        <span className="text-xs font-mono text-slate-600">{jobId?.slice(0, 8)}.../{companyNumber}</span>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <span className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-[spin_0.8s_linear_infinite]" />
        </div>
      )}

      {isError && (
        <div className="px-4 py-3 bg-risk-high-bg border border-risk-high/20 rounded-lg text-sm text-risk-high font-mono">
          Failed to load record details
        </div>
      )}

      {data && !record && !isLoading && (
        <div className="text-center py-16">
          <p className="text-slate-500 text-sm">Record not found</p>
          <p className="text-slate-600 text-xs mt-1 font-mono">
            Job {jobId} / Company {companyNumber}
          </p>
        </div>
      )}

      {record && (
        <div className="p-6 bg-slate-850 border border-slate-800 rounded-xl">
          <DetailView record={record} />
        </div>
      )}
    </div>
  );
}