interface Step {
  label: string;
  description: string;
}

const STEPS: Step[] = [
  { label: 'Queued', description: 'Job submitted to processing queue' },
  { label: 'Scraping', description: 'Searching OpenCorporates registry' },
  { label: 'Analyzing', description: 'AI validation and risk assessment' },
  { label: 'Complete', description: 'Results persisted to database' },
];

type Status = 'queued' | 'processing' | 'completed' | 'failed';

function getActiveStep(status: Status): number {
  switch (status) {
    case 'queued': return 0;
    case 'processing': return 1;
    case 'completed': return 3;
    case 'failed': return -1;
  }
}

function StepIcon({ state }: { state: 'done' | 'active' | 'pending' | 'failed' }) {
  if (state === 'done') {
    return (
      <div className="w-8 h-8 rounded-full bg-risk-low/15 border-2 border-risk-low flex items-center justify-center animate-fade-in">
        <svg className="w-4 h-4 text-risk-low" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
    );
  }
  if (state === 'active') {
    return (
      <div className="w-8 h-8 rounded-full bg-accent/15 border-2 border-accent flex items-center justify-center animate-pulse-glow">
        <span className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-[spin_0.8s_linear_infinite]" />
      </div>
    );
  }
  if (state === 'failed') {
    return (
      <div className="w-8 h-8 rounded-full bg-risk-high/15 border-2 border-risk-high flex items-center justify-center animate-fade-in">
        <svg className="w-4 h-4 text-risk-high" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-slate-800 border-2 border-slate-700 flex items-center justify-center">
      <div className="w-2 h-2 rounded-full bg-slate-600" />
    </div>
  );
}

export function ProgressTracker({
  status,
  errorMessage,
}: {
  status: Status;
  errorMessage?: string;
}) {
  const activeStep = getActiveStep(status);

  return (
    <div className="space-y-1">
      {STEPS.map((step, i) => {
        let state: 'done' | 'active' | 'pending' | 'failed';
        if (status === 'failed') {
          state = i <= Math.max(activeStep, 0) ? 'failed' : 'pending';
          if (i === 0 && activeStep === -1) state = 'failed';
        } else if (i < activeStep) {
          state = 'done';
        } else if (i === activeStep) {
          state = status === 'completed' ? 'done' : 'active';
        } else if (status === 'processing' && i === 2) {
          state = 'active';
        } else {
          state = 'pending';
        }

        return (
          <div key={step.label} className={`flex items-start gap-4 p-3 rounded-lg transition-colors ${state === 'active' ? 'bg-slate-900/60' : ''}`}>
            <div className="flex flex-col items-center">
              <StepIcon state={state} />
              {i < STEPS.length - 1 && (
                <div
                  className={`w-0.5 h-6 mt-1 rounded-full transition-colors ${
                    state === 'done' ? 'bg-risk-low/40' : state === 'failed' ? 'bg-risk-high/40' : 'bg-slate-700'
                  }`}
                />
              )}
            </div>
            <div className="pt-1">
              <p
                className={`text-sm font-semibold ${
                  state === 'done'
                    ? 'text-risk-low'
                    : state === 'active'
                      ? 'text-accent-hover'
                      : state === 'failed'
                        ? 'text-risk-high'
                        : 'text-slate-500'
                }`}
              >
                {step.label}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">{step.description}</p>
            </div>
          </div>
        );
      })}

      {status === 'failed' && errorMessage && (
        <div className="mt-4 px-4 py-3 bg-risk-high-bg border border-risk-high/20 rounded-lg animate-fade-in">
          <p className="text-xs font-mono text-risk-high uppercase tracking-wider mb-1">Error</p>
          <p className="text-sm text-slate-300 font-mono">
            {errorMessage.replace(/^STALE_COOKIES:\s*/, '')}
          </p>
        </div>
      )}
    </div>
  );
}