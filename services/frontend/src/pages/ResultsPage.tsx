import { useState, useRef, useEffect, useCallback } from 'react';
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

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useRecords({
    riskLevel: riskFilter || undefined,
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

  const allRecords = data?.pages.flatMap((p) => p.records) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-sans font-bold text-slate-100">Verification Records</h1>
          <p className="text-sm text-slate-500 mt-1">
            {data ? `${total} record${total !== 1 ? 's' : ''}` : 'Loading...'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {isFetchingNextPage && (
            <span className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-[spin_0.6s_linear_infinite]" />
          )}
          <select
            value={riskFilter}
            onChange={(e) => {
              setRiskFilter(e.target.value as RiskLevel | '');
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
      <div className="bg-slate-850 border border-slate-800 rounded-xl">
        <RecordsTable
          records={allRecords}
          isLoading={isLoading}
        />
      </div>

      {/* Scroll sentinel for infinite loading */}
      <div ref={sentinelRef} className="h-1" />

      {/* Loading indicator */}
      {isFetchingNextPage && (
        <div className="mt-4 flex justify-center animate-fade-in">
          <span className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-[spin_0.6s_linear_infinite]" />
        </div>
      )}

      {/* End of results */}
      {!isLoading && !hasNextPage && allRecords.length > 0 && (
        <p className="mt-4 text-center text-xs text-slate-600">
          All {total} records loaded
        </p>
      )}
    </div>
  );
}