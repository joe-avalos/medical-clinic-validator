import { useState } from 'react';
import { useRecords } from '../hooks/useRecords.js';
import { RecordsTable } from '../components/RecordsTable.js';
import type { RiskLevel } from '@medical-validator/shared';

const RISK_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Risk Levels' },
  { value: 'LOW', label: 'Low Risk' },
  { value: 'MEDIUM', label: 'Medium Risk' },
  { value: 'HIGH', label: 'High Risk' },
  { value: 'UNKNOWN', label: 'Unknown' },
];

export function ResultsPage() {
  const [riskFilter, setRiskFilter] = useState<RiskLevel | ''>('');
  const [cursor, setCursor] = useState<string | undefined>();

  const { data, isLoading, isFetching } = useRecords({
    riskLevel: riskFilter || undefined,
    limit: 50,
    cursor,
  });

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-sans font-bold text-slate-100">Verification Records</h1>
          <p className="text-sm text-slate-500 mt-1">
            {data ? `${data.total} record${data.total !== 1 ? 's' : ''}` : 'Loading...'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {isFetching && !isLoading && (
            <span className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-[spin_0.6s_linear_infinite]" />
          )}
          <select
            value={riskFilter}
            onChange={(e) => {
              setRiskFilter(e.target.value as RiskLevel | '');
              setCursor(undefined);
            }}
            className="px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-300 font-mono focus:outline-none focus:border-accent cursor-pointer"
          >
            {RISK_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-850 border border-slate-800 rounded-xl overflow-hidden">
        <RecordsTable
          records={data?.records ?? []}
          isLoading={isLoading}
        />
      </div>

      {/* Pagination */}
      {data?.nextCursor && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => setCursor(data.nextCursor)}
            className="px-4 py-2 text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors cursor-pointer"
          >
            Load More
          </button>
        </div>
      )}
    </div>
  );
}