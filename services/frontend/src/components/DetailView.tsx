import DOMPurify from 'dompurify';
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

      {/* Scraped HTML Preview — styled to match OpenCorporates */}
      {rawSourceData && typeof rawSourceData.rawHtml === 'string' && (
        <div className="p-4 bg-slate-850 border border-slate-800 rounded-lg">
          <p className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-3">Source Record Preview</p>
          <div
            className={[
              'oc-preview',
              'p-4 bg-[#f7f7f7] border border-[#e0e0e0] rounded-md text-[13px] text-[#333] overflow-x-auto font-[Helvetica,Arial,sans-serif] leading-relaxed',
              // list item — remove bullet, add left border accent
              '[&_li]:list-none [&_li]:border-l-[3px] [&_li]:border-l-[#4a9] [&_li]:pl-3 [&_li]:py-1',
              // company name link — OC teal, bold
              '[&_a.company_search_result]:text-[#1a7a7a] [&_a.company_search_result]:font-bold [&_a.company_search_result]:text-[15px] [&_a.company_search_result]:no-underline [&_a.company_search_result]:hover:text-[#145f5f] [&_a.company_search_result]:hover:underline',
              // jurisdiction filter link — hide (redundant, jurisdiction shown in text)
              '[&_a.jurisdiction_filter]:hidden',
              // status badges
              '[&_.status.label]:inline-block [&_.status.label]:text-[10px] [&_.status.label]:font-bold [&_.status.label]:uppercase [&_.status.label]:tracking-wider [&_.status.label]:px-[6px] [&_.status.label]:py-[2px] [&_.status.label]:rounded-sm [&_.status.label]:mr-1.5 [&_.status.label]:align-middle [&_.status.label]:relative [&_.status.label]:top-[-1px]',
              // dates
              '[&_.start_date]:text-[#666] [&_.start_date]:text-[12px]',
              '[&_.end_date]:text-[#666] [&_.end_date]:text-[12px]',
              // address
              '[&_.address]:block [&_.address]:text-[12px] [&_.address]:text-[#888] [&_.address]:mt-0.5',
              // previous names
              '[&_.slight_highlight]:text-[12px] [&_.slight_highlight]:text-[#999] [&_.slight_highlight]:italic',
              // images (flags) — show as small inline
              '[&_img.flag]:inline [&_img.flag]:w-4 [&_img.flag]:h-3 [&_img.flag]:mr-1.5 [&_img.flag]:align-middle [&_img.flag]:border [&_img.flag]:border-[#ccc] [&_img.flag]:rounded-sm',
              // hide non-flag images
              '[&_img:not(.flag)]:hidden',
            ].join(' ')}
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(rawSourceData.rawHtml as string, {
                ALLOWED_TAGS: ['li', 'a', 'span', 'br', 'img'],
                ALLOWED_ATTR: ['class', 'href', 'title', 'alt', 'src'],
              }),
            }}
          />
        </div>
      )}

      {/* Raw Audit Data (JSON) */}
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