import DOMPurify from 'dompurify';
import { RiskBadge } from './RiskBadge.js';

const COUNTRY_FLAGS: Record<string, string> = {
  ad: '🇦🇩', ae: '🇦🇪', af: '🇦🇫', ag: '🇦🇬', al: '🇦🇱', am: '🇦🇲', ao: '🇦🇴', ar: '🇦🇷',
  at: '🇦🇹', au: '🇦🇺', az: '🇦🇿', ba: '🇧🇦', bb: '🇧🇧', bd: '🇧🇩', be: '🇧🇪', bf: '🇧🇫',
  bg: '🇧🇬', bh: '🇧🇭', bi: '🇧🇮', bj: '🇧🇯', bn: '🇧🇳', bo: '🇧🇴', br: '🇧🇷', bs: '🇧🇸',
  bt: '🇧🇹', bw: '🇧🇼', by: '🇧🇾', bz: '🇧🇿', ca: '🇨🇦', cd: '🇨🇩', cf: '🇨🇫', cg: '🇨🇬',
  ch: '🇨🇭', ci: '🇨🇮', cl: '🇨🇱', cm: '🇨🇲', cn: '🇨🇳', co: '🇨🇴', cr: '🇨🇷', cu: '🇨🇺',
  cy: '🇨🇾', cz: '🇨🇿', de: '🇩🇪', dk: '🇩🇰', do: '🇩🇴', dz: '🇩🇿', ec: '🇪🇨', ee: '🇪🇪',
  eg: '🇪🇬', es: '🇪🇸', et: '🇪🇹', fi: '🇫🇮', fj: '🇫🇯', fr: '🇫🇷', ga: '🇬🇦', gb: '🇬🇧',
  ge: '🇬🇪', gh: '🇬🇭', gm: '🇬🇲', gn: '🇬🇳', gr: '🇬🇷', gt: '🇬🇹', gw: '🇬🇼', gy: '🇬🇾',
  hk: '🇭🇰', hn: '🇭🇳', hr: '🇭🇷', ht: '🇭🇹', hu: '🇭🇺', id: '🇮🇩', ie: '🇮🇪', il: '🇮🇱',
  in: '🇮🇳', iq: '🇮🇶', ir: '🇮🇷', is: '🇮🇸', it: '🇮🇹', jm: '🇯🇲', jo: '🇯🇴', jp: '🇯🇵',
  ke: '🇰🇪', kg: '🇰🇬', kh: '🇰🇭', kr: '🇰🇷', kw: '🇰🇼', kz: '🇰🇿', la: '🇱🇦', lb: '🇱🇧',
  lk: '🇱🇰', lr: '🇱🇷', ls: '🇱🇸', lt: '🇱🇹', lu: '🇱🇺', lv: '🇱🇻', ly: '🇱🇾', ma: '🇲🇦',
  md: '🇲🇩', me: '🇲🇪', mg: '🇲🇬', mk: '🇲🇰', ml: '🇲🇱', mm: '🇲🇲', mn: '🇲🇳', mo: '🇲🇴',
  mr: '🇲🇷', mt: '🇲🇹', mu: '🇲🇺', mv: '🇲🇻', mw: '🇲🇼', mx: '🇲🇽', my: '🇲🇾', mz: '🇲🇿',
  na: '🇳🇦', ne: '🇳🇪', ng: '🇳🇬', ni: '🇳🇮', nl: '🇳🇱', no: '🇳🇴', np: '🇳🇵', nz: '🇳🇿',
  om: '🇴🇲', pa: '🇵🇦', pe: '🇵🇪', pg: '🇵🇬', ph: '🇵🇭', pk: '🇵🇰', pl: '🇵🇱', pr: '🇵🇷',
  pt: '🇵🇹', py: '🇵🇾', qa: '🇶🇦', ro: '🇷🇴', rs: '🇷🇸', ru: '🇷🇺', rw: '🇷🇼', sa: '🇸🇦',
  sc: '🇸🇨', sd: '🇸🇩', se: '🇸🇪', sg: '🇸🇬', si: '🇸🇮', sk: '🇸🇰', sl: '🇸🇱', sn: '🇸🇳',
  so: '🇸🇴', sr: '🇸🇷', sv: '🇸🇻', sy: '🇸🇾', sz: '🇸🇿', td: '🇹🇩', tg: '🇹🇬', th: '🇹🇭',
  tj: '🇹🇯', tm: '🇹🇲', tn: '🇹🇳', to: '🇹🇴', tr: '🇹🇷', tt: '🇹🇹', tw: '🇹🇼', tz: '🇹🇿',
  ua: '🇺🇦', ug: '🇺🇬', uk: '🇬🇧', us: '🇺🇸', uy: '🇺🇾', uz: '🇺🇿', ve: '🇻🇪', vn: '🇻🇳',
  za: '🇿🇦', zm: '🇿🇲', zw: '🇿🇼',
};

function prepareOcHtml(raw: string): string {
  let html = DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: ['li', 'a', 'span', 'br'],
    ALLOWED_ATTR: ['class', 'href', 'title'],
  });

  // Replace jurisdiction_filter links + flag images with emoji flags
  html = html.replace(
    /<a\s+class="jurisdiction_filter\s+(\w+)"[^>]*>(?:<img[^>]*>)?<\/a>/gi,
    (_match, code: string) => {
      const flag = COUNTRY_FLAGS[code.toLowerCase()] ?? '🏳️';
      return `<span class="oc-flag">${flag}</span>`;
    },
  );

  // Catch any remaining <img> flag tags not inside jurisdiction_filter
  html = html.replace(
    /<img[^>]*class="flag"[^>]*alt="([^"]*)"[^>]*\/?>/gi,
    (_match, alt: string) => {
      const code = alt.toLowerCase().replace(/\s*flag\s*/, '').trim();
      const mapped = Object.entries(COUNTRY_FLAGS).find(([, v]) =>
        code.includes(v),
      );
      return mapped ? `<span class="oc-flag">${mapped[1]}</span>` : '🏳️';
    },
  );

  // Add FA-style map marker before address spans
  html = html.replace(
    /<span class="address">/gi,
    '<svg class="oc-pin" viewBox="0 0 384 512" fill="currentColor"><path d="M172.3 501.7C27 291 0 269.4 0 192 0 86 86 0 192 0s192 86 192 192c0 77.4-27 99-172.3 309.7-9.5 13.8-29.9 13.8-39.5 0zM192 272c44.2 0 80-35.8 80-80s-35.8-80-80-80-80 35.8-80 80 35.8 80 80 80z"/></svg><span class="address">',
  );

  // Rewrite relative OC links to absolute
  html = html.replace(
    /href="\/companies\//g,
    'href="https://opencorporates.com/companies/',
  );

  return html;
}

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
      {rawSourceData && typeof rawSourceData.rawHtml === 'string' && (() => {
        const ocUrl = typeof rawSourceData.openCorporatesUrl === 'string'
          ? rawSourceData.openCorporatesUrl
          : undefined;
        return (
          <div className="p-4 bg-slate-850 border border-slate-800 rounded-lg">
            <p className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-3">
              Source Record Preview
              {ocUrl && (
                <a href={ocUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-accent hover:text-accent-hover transition-colors">
                  ↗
                </a>
              )}
            </p>
            <a
              href={ocUrl ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="block no-underline hover:opacity-80 transition-opacity cursor-pointer"
            >
              <div
                className="oc-preview"
                dangerouslySetInnerHTML={{
                  __html: prepareOcHtml(rawSourceData.rawHtml as string),
                }}
              />
            </a>
          </div>
        );
      })()}

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