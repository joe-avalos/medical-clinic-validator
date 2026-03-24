import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useHealthCheck } from '../useHealthCheck.js';

vi.mock('../../api/client.js', () => ({
  checkHealth: vi.fn(),
}));

import { checkHealth } from '../../api/client.js';

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

describe('useHealthCheck', () => {
  it('returns true when health check succeeds', async () => {
    vi.mocked(checkHealth).mockResolvedValue(true);
    const { result } = renderHook(() => useHealthCheck(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it('returns false when health check fails', async () => {
    vi.mocked(checkHealth).mockResolvedValue(false);
    const { result } = renderHook(() => useHealthCheck(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current).toBe(false);
    });
  });

  it('defaults to false before data loads', () => {
    vi.mocked(checkHealth).mockImplementation(() => new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useHealthCheck(), { wrapper: createWrapper() });
    expect(result.current).toBe(false);
  });
});