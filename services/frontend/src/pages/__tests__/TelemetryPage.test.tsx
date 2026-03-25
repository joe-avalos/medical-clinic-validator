import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TelemetryPage } from '../TelemetryPage.js';

// jsdom doesn't have IntersectionObserver
beforeAll(() => {
  globalThis.IntersectionObserver = class {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
});

vi.mock('../../hooks/useTelemetry.js', () => ({
  useTelemetry: vi.fn(),
}));

import { useTelemetry } from '../../hooks/useTelemetry.js';

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/telemetry']}>
        <Routes>
          <Route path="/telemetry" element={<TelemetryPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const mockTelemetry = (overrides: Record<string, unknown> = {}) => ({
  jobId: 'job-001',
  companyName: 'MAYO HEALTH SYSTEM',
  normalizedName: 'mayo health system',
  scraperProvider: 'opencorporates',
  aiProvider: 'anthropic',
  cacheHit: false,
  companiesFound: 3,
  pipelinePath: 'scrape→validate→store',
  validationOutcomes: { success: 3, fallback: 0, empty: 0 },
  errorMessage: null,
  durationMs: 4523,
  createdAt: '2026-03-24T22:00:00Z',
  ...overrides,
});

describe('TelemetryPage', () => {
  it('shows loading skeleton while fetching', () => {
    vi.mocked(useTelemetry).mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useTelemetry>);

    renderPage();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows empty state when no records', () => {
    vi.mocked(useTelemetry).mockReturnValue({
      data: { pages: [{ records: [], total: 0 }], pageParams: [] },
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useTelemetry>);

    renderPage();
    expect(screen.getByText('No telemetry records found')).toBeInTheDocument();
  });

  it('renders telemetry records in table', () => {
    vi.mocked(useTelemetry).mockReturnValue({
      data: {
        pages: [{ records: [mockTelemetry()], total: 1 }],
        pageParams: [],
      },
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useTelemetry>);

    renderPage();
    expect(screen.getByText('mayo health system')).toBeInTheDocument();
    expect(screen.getAllByText('Success').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('opencorporates')).toBeInTheDocument();
    expect(screen.getByText('anthropic')).toBeInTheDocument();
  });

  it('shows pipeline path filter dropdown', () => {
    vi.mocked(useTelemetry).mockReturnValue({
      data: { pages: [{ records: [], total: 0 }], pageParams: [] },
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useTelemetry>);

    renderPage();
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    expect(screen.getByText('All Paths')).toBeInTheDocument();
  });

  it('renders empty result path with red companiesFound', () => {
    vi.mocked(useTelemetry).mockReturnValue({
      data: {
        pages: [{
          records: [mockTelemetry({
            pipelinePath: 'scrape→empty→store',
            companiesFound: 0,
            validationOutcomes: { success: 0, fallback: 0, empty: 1 },
          })],
          total: 1,
        }],
        pageParams: [],
      },
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useTelemetry>);

    renderPage();
    expect(screen.getByText('Empty')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('1 empty')).toBeInTheDocument();
  });
});
