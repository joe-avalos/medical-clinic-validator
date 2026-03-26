import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { submitVerification } from '../api/client.js';
import type { AIProviderOption } from '../api/client.js';

export function SearchBar() {
  const [companyName, setCompanyName] = useState('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [aiProvider, setAiProvider] = useState<AIProviderOption>('anthropic');
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: () => submitVerification(companyName.trim(), jurisdiction.trim() || undefined, undefined, aiProvider),
    onSuccess: (data) => {
      const state = data.cached
        ? { cached: true, cachedAt: data.cachedAt, companyName: companyName.trim(), jurisdiction: jurisdiction.trim() || undefined }
        : undefined;
      navigate(`/verify/${data.jobId}`, { state });
      setCompanyName('');
      setJurisdiction('');
    },
  });

  const handleSubmit = (e: React.SubmitEvent) => {
    e.preventDefault();
    if (companyName.trim().length < 2) return;
    mutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 min-w-0">
            <label htmlFor="companyName" className="block text-xs font-mono text-slate-300 uppercase tracking-wider mb-1.5">
              Company Name
            </label>
            <input
              id="companyName"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Mayo Health System"
              className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors font-sans"
              disabled={mutation.isPending}
            />
          </div>

          <div className="sm:w-44">
            <label htmlFor="jurisdiction" className="block text-xs font-mono text-slate-300 uppercase tracking-wider mb-1.5">
              Jurisdiction
            </label>
            <input
              id="jurisdiction"
              type="text"
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              placeholder="e.g. us_mn"
              className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors font-mono text-sm"
              disabled={mutation.isPending}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="sm:w-48">
            <label htmlFor="aiProvider" className="block text-xs font-mono text-slate-300 uppercase tracking-wider mb-1.5">
              AI Model
            </label>
            <select
              id="aiProvider"
              value={aiProvider}
              onChange={(e) => setAiProvider(e.target.value as AIProviderOption)}
              className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors font-mono text-sm appearance-none cursor-pointer"
              disabled={mutation.isPending}
            >
              <option value="anthropic">Claude (API)</option>
              <option value="qwen">Qwen (local)</option>
            </select>
          </div>

          {aiProvider === 'qwen' && (
            <p className="text-xs text-slate-500 font-mono sm:pb-3">
              Requires local Ollama — slower on CPU
            </p>
          )}

          <div className="sm:ml-auto">
            <button
              type="submit"
              disabled={mutation.isPending || companyName.trim().length < 2}
              className="px-6 py-3 bg-accent hover:bg-accent-hover disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-all duration-200 cursor-pointer disabled:cursor-not-allowed whitespace-nowrap shadow-lg shadow-accent/10 hover:shadow-accent/20"
            >
              {mutation.isPending ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-[spin_0.6s_linear_infinite]" />
                  Submitting
                </span>
              ) : (
                'Verify'
              )}
            </button>
          </div>
        </div>
      </div>

      {mutation.isError && (
        <div className="mt-3 px-4 py-2.5 bg-risk-high-bg border border-risk-high/20 rounded-lg text-risk-high text-sm font-mono animate-fade-in">
          {mutation.error instanceof Error ? mutation.error.message : 'Verification request failed'}
        </div>
      )}
    </form>
  );
}