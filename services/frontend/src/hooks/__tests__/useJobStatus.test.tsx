import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useJobStatus } from '../useJobStatus.js';

vi.mock('../../api/client.js', () => ({
  fetchJobStatus: vi.fn(),
}));

import { fetchJobStatus } from '../../api/client.js';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useJobStatus', () => {
  it('fetches job status for a given jobId', async () => {
    vi.mocked(fetchJobStatus).mockResolvedValue({
      jobId: 'job-123',
      status: 'queued',
    });
    const { result } = renderHook(() => useJobStatus('job-123'), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.data).toEqual({ jobId: 'job-123', status: 'queued' });
    });
    expect(fetchJobStatus).toHaveBeenCalledWith('job-123');
  });

  it('returns completed status with results', async () => {
    vi.mocked(fetchJobStatus).mockResolvedValue({
      jobId: 'job-456',
      status: 'completed',
      results: [{ companyName: 'Test', riskLevel: 'LOW' }],
    });
    const { result } = renderHook(() => useJobStatus('job-456'), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.data?.status).toBe('completed');
      expect(result.current.data?.results).toHaveLength(1);
    });
  });

  it('returns failed status with error message', async () => {
    vi.mocked(fetchJobStatus).mockResolvedValue({
      jobId: 'job-789',
      status: 'failed',
      errorMessage: 'Scraper timeout',
    });
    const { result } = renderHook(() => useJobStatus('job-789'), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.data?.status).toBe('failed');
      expect(result.current.data?.errorMessage).toBe('Scraper timeout');
    });
  });

  it('does not fetch when jobId is empty', () => {
    // Clear any calls from previous tests
    vi.mocked(fetchJobStatus).mockClear();
    vi.mocked(fetchJobStatus).mockResolvedValue({
      jobId: '',
      status: 'queued',
    });
    renderHook(() => useJobStatus(''), { wrapper: createWrapper() });
    // enabled: !!jobId prevents fetch for empty string
    expect(fetchJobStatus).not.toHaveBeenCalled();
  });
});