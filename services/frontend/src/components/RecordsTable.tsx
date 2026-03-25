import { Link } from 'react-router-dom';
import { RiskBadge } from './RiskBadge.js';

interface RecordsTableProps {
  records: Record<string, unknown>[];
  isLoading: boolean;
}

export function RecordsTable({ records, isLoading }: RecordsTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-14 bg-slate-900 rounded-lg animate-pulse" style={{ animationDelay: `${i * 100}ms` }} />
        ))}
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="text-center py-16 animate-fade-in">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-slate-800 flex items-center justify-center">
          <svg className="w-6 h-6 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <p className="text-slate-500 text-sm">No verification records found</p>
        <p className="text-slate-600 text-xs mt-1">Submit a verification to get started</p>
      </div>
    );
  }

  return (
    <div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-800">
            <th className="text-left py-3 px-4 text-xs font-mono text-slate-500 uppercase tracking-wider">Company</th>
            <th className="text-left py-3 px-4 text-xs font-mono text-slate-500 uppercase tracking-wider">Jurisdiction</th>
            <th className="text-left py-3 px-4 text-xs font-mono text-slate-500 uppercase tracking-wider">Status</th>
            <th className="text-left py-3 px-4 text-xs font-mono text-slate-500 uppercase tracking-wider">Provider</th>
            <th className="text-left py-3 px-4 text-xs font-mono text-slate-500 uppercase tracking-wider">Risk</th>
            <th className="text-left py-3 px-4 text-xs font-mono text-slate-500 uppercase tracking-wider">Verified</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record, i) => {
            const jobId = record.jobId as string;
            const companyNumber = record.companyNumber as string;
            const detailPath = jobId && companyNumber
              ? `/records/${jobId}/${companyNumber}`
              : '#';

            return (
              <tr
                key={`${jobId}-${companyNumber}-${i}`}
                className="border-b border-slate-800/50 hover:bg-slate-900/60 transition-colors group animate-fade-in"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <td className="py-3 px-4">
                  <Link
                    to={detailPath}
                    className="text-sm font-semibold text-slate-200 group-hover:text-accent-hover transition-colors"
                  >
                    {record.companyName as string}
                  </Link>
                </td>
                <td className="py-3 px-4">
                  <span className="text-xs font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                    {(record.jurisdiction as string)?.toUpperCase()}
                  </span>
                </td>
                <td className="py-3 px-4">
                  <span className={`text-sm ${
                    record.legalStatus === 'Active' ? 'text-risk-low' :
                    record.legalStatus === 'Dissolved' ? 'text-risk-high' :
                    'text-slate-400'
                  }`}>
                    {record.legalStatus as string}
                  </span>
                </td>
                <td className="py-3 px-4 text-sm text-slate-400">
                  {record.providerType as string}
                </td>
                <td className="py-3 px-4">
                  <RiskBadge level={record.riskLevel as string} />
                </td>
                <td className="py-3 px-4 text-xs font-mono text-slate-500">
                  {record.validatedAt ? new Date(record.validatedAt as string).toLocaleDateString() : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}