const RISK_STYLES: Record<string, string> = {
  LOW: 'bg-risk-low-bg text-risk-low border-risk-low/30',
  MEDIUM: 'bg-risk-medium-bg text-risk-medium border-risk-medium/30',
  HIGH: 'bg-risk-high-bg text-risk-high border-risk-high/30',
  UNKNOWN: 'bg-risk-unknown-bg text-risk-unknown border-risk-unknown/30',
};

const RISK_LABELS: Record<string, string> = {
  LOW: 'Verified',
  MEDIUM: 'Caution',
  HIGH: 'High Risk',
  UNKNOWN: 'Unknown',
};

export function RiskBadge({ level }: { level: string }) {
  const style = RISK_STYLES[level] ?? RISK_STYLES.UNKNOWN;
  const label = RISK_LABELS[level] ?? level;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold font-mono uppercase tracking-wider border rounded ${style}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          level === 'LOW'
            ? 'bg-risk-low'
            : level === 'MEDIUM'
              ? 'bg-risk-medium'
              : level === 'HIGH'
                ? 'bg-risk-high'
                : 'bg-risk-unknown'
        }`}
      />
      {label}
    </span>
  );
}