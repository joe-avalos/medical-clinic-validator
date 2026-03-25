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
  it('fetches first page of records', async () => {
    vi.mocked(fetchRecords).mockResolvedValue({
      records: [{ companyName: 'Clinic A', riskLevel: 'LOW' }],
      total: 1,
    });
    const { result } = renderHook(() => useRecords({}), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.data?.pages[0].records).toHaveLength(1);
      expect(result.current.data?.pages[0].total).toBe(1);
    });
    expect(fetchRecords).toHaveBeenCalledWith({ cursor: undefined });
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
    expect(fetchRecords).toHaveBeenCalledWith({ riskLevel: 'HIGH', limit: 25, cursor: undefined });
  });

  it('reports hasNextPage when nextCursor is present', async () => {
    vi.mocked(fetchRecords).mockResolvedValue({
      records: [{ companyName: 'Clinic B' }],
      total: 50,
      nextCursor: 'cursor-2',
    });
    const { result } = renderHook(
      () => useRecords({}),
      { wrapper: createWrapper() },
    );
    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(true);
    });
  });

  it('reports no next page when nextCursor is absent', async () => {
    vi.mocked(fetchRecords).mockResolvedValue({
      records: [],
      total: 0,
    });
    const { result } = renderHook(
      () => useRecords({ riskLevel: 'UNKNOWN' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(false);
    });
  });

  it('accumulates pages on fetchNextPage', async () => {
    vi.mocked(fetchRecords)
      .mockResolvedValueOnce({
        records: [{ companyName: 'Clinic A' }],
        total: 2,
        nextCursor: 'cursor-2',
      })
      .mockResolvedValueOnce({
        records: [{ companyName: 'Clinic B' }],
        total: 2,
      });

    const { result } = renderHook(() => useRecords({}), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.hasNextPage).toBe(true));

    result.current.fetchNextPage();

    await waitFor(() => {
      expect(result.current.data?.pages).toHaveLength(2);
    });

    const allRecords = result.current.data!.pages.flatMap((p) => p.records);
    expect(allRecords).toHaveLength(2);
    expect(allRecords[0].companyName).toBe('Clinic A');
    expect(allRecords[1].companyName).toBe('Clinic B');
  });
});