import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JobResultsPage } from '../JobResultsPage.js';

vi.mock('../../hooks/useJobStatus.js', () => ({
  useJobStatus: vi.fn(),
}));

import { useJobStatus } from '../../hooks/useJobStatus.js';

function renderPage(jobId = 'job-123') {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/verify/${jobId}/results`]}>
        <Routes>
          <Route path="/verify/:jobId/results" element={<JobResultsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const mockResult = (overrides: Record<string, unknown> = {}) => ({
  companyNumber: 'C001',
  companyName: 'Test Clinic',
  jurisdiction: 'us_ca',
  legalStatus: 'Active',
  registrationNumber: 'REG-001',
  riskLevel: 'LOW',
  riskFlags: [],
  aiSummary: 'Entity is active.',
  ...overrides,
});

describe('JobResultsPage', () => {
  it('shows loading spinner while fetching', () => {
    vi.mocked(useJobStatus).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as ReturnType<typeof useJobStatus>);

    renderPage();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows error message on fetch failure', () => {
    vi.mocked(useJobStatus).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as ReturnType<typeof useJobStatus>);

    renderPage();
    expect(screen.getByText('Failed to load results')).toBeInTheDocument();
  });

  it('shows empty state when no results', () => {
    vi.mocked(useJobStatus).mockReturnValue({
      data: { jobId: 'job-123', status: 'completed', results: [] },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useJobStatus>);

    renderPage();
    expect(screen.getByText('No results found for this job')).toBeInTheDocument();
  });

  it('renders results sorted by risk level (HIGH first)', () => {
    vi.mocked(useJobStatus).mockReturnValue({
      data: {
        jobId: 'job-123',
        status: 'completed',
        results: [
          mockResult({ companyNumber: 'A', companyName: 'Low Risk Co', riskLevel: 'LOW' }),
          mockResult({ companyNumber: 'B', companyName: 'High Risk Co', riskLevel: 'HIGH' }),
          mockResult({ companyNumber: 'C', companyName: 'Medium Risk Co', riskLevel: 'MEDIUM' }),
        ],
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useJobStatus>);

    renderPage();

    const names = screen.getAllByText(/Risk Co/).map((el) => el.textContent);
    expect(names).toEqual(['High Risk Co', 'Medium Risk Co', 'Low Risk Co']);
  });

  it('shows entity count in subtitle', () => {
    vi.mocked(useJobStatus).mockReturnValue({
      data: {
        jobId: 'job-123',
        status: 'completed',
        results: [mockResult(), mockResult({ companyNumber: 'C002' })],
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useJobStatus>);

    renderPage();
    expect(screen.getByText(/2 entities found/)).toBeInTheDocument();
  });

  it('shows singular entity label for one result', () => {
    vi.mocked(useJobStatus).mockReturnValue({
      data: {
        jobId: 'job-123',
        status: 'completed',
        results: [mockResult()],
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useJobStatus>);

    renderPage();
    expect(screen.getByText(/1 entity found/)).toBeInTheDocument();
  });

  it('displays risk flags as tags for flagged results', () => {
    vi.mocked(useJobStatus).mockReturnValue({
      data: {
        jobId: 'job-123',
        status: 'completed',
        results: [
          mockResult({
            riskLevel: 'HIGH',
            riskFlags: ['Dissolved in 2022', 'No officers'],
          }),
        ],
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useJobStatus>);

    renderPage();
    expect(screen.getByText('Dissolved in 2022')).toBeInTheDocument();
    expect(screen.getByText('No officers')).toBeInTheDocument();
  });

  it('shows AI summary preview for each result', () => {
    vi.mocked(useJobStatus).mockReturnValue({
      data: {
        jobId: 'job-123',
        status: 'completed',
        results: [mockResult({ aiSummary: 'Entity is actively registered in California.' })],
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useJobStatus>);

    renderPage();
    expect(screen.getByText('Entity is actively registered in California.')).toBeInTheDocument();
  });

  it('links each result to its detail page', () => {
    vi.mocked(useJobStatus).mockReturnValue({
      data: {
        jobId: 'job-123',
        status: 'completed',
        results: [mockResult({ companyNumber: 'C999' })],
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useJobStatus>);

    renderPage();
    const link = screen.getByText('Test Clinic').closest('a');
    expect(link?.getAttribute('href')).toBe('/records/job-123/C999');
  });

  it('shows risk badge for each result', () => {
    vi.mocked(useJobStatus).mockReturnValue({
      data: {
        jobId: 'job-123',
        status: 'completed',
        results: [mockResult({ riskLevel: 'HIGH' })],
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useJobStatus>);

    renderPage();
    expect(screen.getByText('High Risk')).toBeInTheDocument();
  });
});