import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useRecords } from '../useRecords.js';

vi.mock('../../api/client.js', () => ({
  fetchRecords: vi.fn(),
}));

import { fetchRecords } from '../../api/client.js';

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

describe('useRecords', () => {
  it('fetches records with no filters', async () => {
    vi.mocked(fetchRecords).mockResolvedValue({
      records: [{ companyName: 'Clinic A', riskLevel: 'LOW' }],
      total: 1,
    });
    const { result } = renderHook(() => useRecords({}), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.data?.records).toHaveLength(1);
      expect(result.current.data?.total).toBe(1);
    });
    expect(fetchRecords).toHaveBeenCalledWith({});
  });

  it('passes risk level filter', async () => {
    vi.mocked(fetchRecords).mockResolvedValue({
      records: [],
      total: 0,
    });
    const { result } = renderHook(
      () => useRecords({ riskLevel: 'HIGH', limit: 25 }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(fetchRecords).toHaveBeenCalledWith({ riskLevel: 'HIGH', limit: 25 });
  });

  it('passes cursor for pagination', async () => {
    vi.mocked(fetchRecords).mockResolvedValue({
      records: [{ companyName: 'Clinic B' }],
      total: 50,
      nextCursor: 'cursor-2',
    });
    const { result } = renderHook(
      () => useRecords({ cursor: 'cursor-1' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => {
      expect(result.current.data?.nextCursor).toBe('cursor-2');
    });
    expect(fetchRecords).toHaveBeenCalledWith({ cursor: 'cursor-1' });
  });

  it('returns empty records array', async () => {
    vi.mocked(fetchRecords).mockResolvedValue({
      records: [],
      total: 0,
    });
    const { result } = renderHook(
      () => useRecords({ riskLevel: 'UNKNOWN' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => {
      expect(result.current.data?.records).toEqual([]);
    });
  });
});