import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from '../Layout.js';

vi.mock('../../hooks/useHealthCheck.js', () => ({
  useHealthCheck: vi.fn(),
}));

import { useHealthCheck } from '../../hooks/useHealthCheck.js';

function renderLayout() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Layout />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Layout', () => {
  it('renders MedVerify brand name', () => {
    vi.mocked(useHealthCheck).mockReturnValue(true);
    renderLayout();
    expect(screen.getByText('MedVerify')).toBeInTheDocument();
  });

  it('renders Search and Records nav links', () => {
    vi.mocked(useHealthCheck).mockReturnValue(true);
    renderLayout();
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Records')).toBeInTheDocument();
  });

  it('shows "Connected" when health check passes', () => {
    vi.mocked(useHealthCheck).mockReturnValue(true);
    renderLayout();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('shows "Disconnected" when health check fails', () => {
    vi.mocked(useHealthCheck).mockReturnValue(false);
    renderLayout();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('renders footer with version', () => {
    vi.mocked(useHealthCheck).mockReturnValue(true);
    renderLayout();
    expect(screen.getByText('Medical Provider Verifier v1.0')).toBeInTheDocument();
  });

  it('renders footer with internal use notice', () => {
    vi.mocked(useHealthCheck).mockReturnValue(true);
    renderLayout();
    expect(screen.getByText('Internal Use Only')).toBeInTheDocument();
  });

  it('shows green pulse indicator when connected', () => {
    vi.mocked(useHealthCheck).mockReturnValue(true);
    const { container } = renderLayout();
    // Find the health status container by text, then look for the dot indicator inside its parent
    const connectedEl = screen.getByText('Connected');
    const wrapper = connectedEl.closest('div');
    const dot = wrapper?.querySelector('span.bg-risk-low');
    expect(dot).not.toBeNull();
    expect(dot?.className).toContain('animate-pulse');
  });

  it('shows red indicator when disconnected', () => {
    vi.mocked(useHealthCheck).mockReturnValue(false);
    renderLayout();
    const disconnectedEl = screen.getByText('Disconnected');
    const wrapper = disconnectedEl.closest('div');
    const dot = wrapper?.querySelector('span.bg-risk-high');
    expect(dot).not.toBeNull();
  });
});