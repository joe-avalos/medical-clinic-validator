import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SearchBar } from '../SearchBar.js';

vi.mock('../../api/client.js', () => ({
  submitVerification: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

import { submitVerification } from '../../api/client.js';

function renderSearchBar() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SearchBar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SearchBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders company name and jurisdiction inputs', () => {
    renderSearchBar();
    expect(screen.getByPlaceholderText('e.g. Mayo Health System')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. us_mn')).toBeInTheDocument();
  });

  it('renders a Verify submit button', () => {
    renderSearchBar();
    expect(screen.getByRole('button', { name: 'Verify' })).toBeInTheDocument();
  });

  it('disables submit when company name is too short', () => {
    renderSearchBar();
    const button = screen.getByRole('button', { name: 'Verify' });
    expect(button).toBeDisabled();
  });

  it('enables submit when company name has 2+ chars', async () => {
    const user = userEvent.setup();
    renderSearchBar();
    await user.type(screen.getByPlaceholderText('e.g. Mayo Health System'), 'Ab');
    expect(screen.getByRole('button', { name: 'Verify' })).toBeEnabled();
  });

  it('does not submit when company name is only 1 char', async () => {
    const user = userEvent.setup();
    renderSearchBar();
    await user.type(screen.getByPlaceholderText('e.g. Mayo Health System'), 'A');
    await user.click(screen.getByRole('button'));
    expect(submitVerification).not.toHaveBeenCalled();
  });

  it('calls submitVerification on submit with trimmed values', async () => {
    const user = userEvent.setup();
    vi.mocked(submitVerification).mockResolvedValue({
      jobId: 'job-123',
      status: 'queued',
      pollUrl: '/verify/job-123/status',
    });
    renderSearchBar();
    await user.type(screen.getByPlaceholderText('e.g. Mayo Health System'), '  Mayo Clinic  ');
    await user.type(screen.getByPlaceholderText('e.g. us_mn'), 'us_mn');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => {
      expect(submitVerification).toHaveBeenCalledWith('Mayo Clinic', 'us_mn', undefined, 'anthropic');
    });
  });

  it('navigates to progress page on success', async () => {
    const user = userEvent.setup();
    vi.mocked(submitVerification).mockResolvedValue({
      jobId: 'job-456',
      status: 'queued',
      pollUrl: '/verify/job-456/status',
    });
    renderSearchBar();
    await user.type(screen.getByPlaceholderText('e.g. Mayo Health System'), 'Test Clinic');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/verify/job-456', { state: undefined });
    });
  });

  it('passes cached state when response includes cached flag', async () => {
    const user = userEvent.setup();
    vi.mocked(submitVerification).mockResolvedValue({
      jobId: 'job-789',
      status: 'completed',
      pollUrl: '/verify/job-789/status',
      cached: true,
      cachedAt: '2026-03-20T10:00:00Z',
    });
    renderSearchBar();
    await user.type(screen.getByPlaceholderText('e.g. Mayo Health System'), 'Test Clinic');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/verify/job-789', {
        state: {
          cached: true,
          cachedAt: '2026-03-20T10:00:00Z',
          companyName: 'Test Clinic',
          jurisdiction: undefined,
        },
      });
    });
  });

  it('shows error message on mutation failure', async () => {
    const user = userEvent.setup();
    vi.mocked(submitVerification).mockRejectedValue(new Error('Network error'));
    renderSearchBar();
    await user.type(screen.getByPlaceholderText('e.g. Mayo Health System'), 'Test Clinic');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('shows generic error for non-Error rejections', async () => {
    const user = userEvent.setup();
    vi.mocked(submitVerification).mockRejectedValue('something');
    renderSearchBar();
    await user.type(screen.getByPlaceholderText('e.g. Mayo Health System'), 'Test Clinic');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => {
      expect(screen.getByText('Verification request failed')).toBeInTheDocument();
    });
  });

  it('omits jurisdiction when empty', async () => {
    const user = userEvent.setup();
    vi.mocked(submitVerification).mockResolvedValue({
      jobId: 'job-abc',
      status: 'queued',
      pollUrl: '/verify/job-abc/status',
    });
    renderSearchBar();
    await user.type(screen.getByPlaceholderText('e.g. Mayo Health System'), 'Test Clinic');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => {
      expect(submitVerification).toHaveBeenCalledWith('Test Clinic', undefined, undefined, 'anthropic');
    });
  });
});