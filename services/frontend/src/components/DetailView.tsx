import { RiskBadge } from './RiskBadge.js';

interface DetailViewProps {
  record: Record<string, unknown>;
}

function Field({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-0.5">{label}</dt>
      <dd className={`text-sm text-slate-200 ${mono ? 'font-mono' : ''}`}>
        {value || <span className="text-slate-600 italic">N/A</span>}
      </dd>
    </div>
  );
}

export function DetailView({ record }: DetailViewProps) {
  const riskFlags = (record.riskFlags as string[]) ?? [];
  const rawSourceData = record.rawSourceData as Record<string, unknown> | undefined;
  const cachedResult = record.cachedResult as boolean | undefined;
  const cachedFromJobId = record.cachedFromJobId as string | null | undefined;
  const originalValidatedAt = record.originalValidatedAt as string | null | undefined;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-sans font-bold text-slate-100">
            {record.companyName as string}
          </h2>
          <p className="text-sm text-slate-500 font-mono mt-1">
            {(record.jurisdiction as string)?.toUpperCase()} &middot; {record.registrationNumber as string || 'No reg. number'}
          </p>
        </div>
        <RiskBadge level={record.riskLevel as string} />
      </div>

      {/* AI Summary */}
      <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg">
        <p className="text-xs font-mono text-accent uppercase tracking-wider mb-2">AI Assessment</p>
        <p className="text-sm text-slate-300 leading-relaxed">
          {record.aiSummary as string}
        </p>
      </div>

      {/* Cache indicator */}
      {cachedResult && (
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs">
          <svg className="w-3.5 h-3.5 text-risk-medium" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-slate-400">
            Cached result
            {cachedFromJobId && <> from job <span className="font-mono text-slate-500">{cachedFromJobId}</span></>}
            {originalValidatedAt && <> &middot; originally validated {new Date(originalValidatedAt).toLocaleString()}</>}
          </span>
        </div>
      )}

      {/* Registration Details */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4 bg-slate-850 border border-slate-800 rounded-lg">
        <Field label="Legal Status" value={record.legalStatus as string} />
        <Field label="Provider Type" value={record.providerType as string} />
        <Field label="Confidence" value={record.confidence as string} mono />
        <Field label="Registration #" value={record.registrationNumber as string} mono />
        <Field label="Incorporation" value={record.incorporationDate as string} mono />
        <Field label="Validated At" value={record.validatedAt ? new Date(record.validatedAt as string).toLocaleString() : undefined} mono />
      </div>

      {/* Address */}
      <div className="p-4 bg-slate-850 border border-slate-800 rounded-lg">
        <Field label="Standardized Address" value={record.standardizedAddress as string} />
      </div>

      {/* Risk Flags */}
      {riskFlags.length > 0 && (
        <div className="p-4 bg-slate-850 border border-slate-800 rounded-lg">
          <p className="text-xs font-mono text-risk-high uppercase tracking-wider mb-2">Risk Flags</p>
          <ul className="space-y-1.5">
            {riskFlags.map((flag, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-risk-high shrink-0" />
                {flag}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Raw Source Data */}
      {rawSourceData && Object.keys(rawSourceData).length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs font-mono text-slate-500 uppercase tracking-wider hover:text-slate-400 transition-colors flex items-center gap-1.5">
            <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            Raw Audit Data
          </summary>
          <pre className="mt-2 p-4 bg-slate-900 border border-slate-800 rounded-lg text-xs font-mono text-slate-400 overflow-x-auto leading-relaxed">
            {JSON.stringify(rawSourceData, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}