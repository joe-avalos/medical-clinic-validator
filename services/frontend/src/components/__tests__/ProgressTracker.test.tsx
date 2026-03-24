import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressTracker } from '../ProgressTracker.js';

describe('ProgressTracker', () => {
  it('renders all 4 pipeline steps', () => {
    render(<ProgressTracker status="queued" />);
    expect(screen.getByText('Queued')).toBeInTheDocument();
    expect(screen.getByText('Scraping')).toBeInTheDocument();
    expect(screen.getByText('Analyzing')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });

  it('shows step descriptions', () => {
    render(<ProgressTracker status="queued" />);
    expect(screen.getByText('Job submitted to processing queue')).toBeInTheDocument();
    expect(screen.getByText('Searching OpenCorporates registry')).toBeInTheDocument();
  });

  it('marks Queued as active when status is queued', () => {
    render(<ProgressTracker status="queued" />);
    const queuedLabel = screen.getByText('Queued');
    expect(queuedLabel.className).toContain('text-accent-hover');
  });

  it('marks steps as done for completed status', () => {
    render(<ProgressTracker status="completed" />);
    const queuedLabel = screen.getByText('Queued');
    expect(queuedLabel.className).toContain('text-risk-low');
    const completeLabel = screen.getByText('Complete');
    expect(completeLabel.className).toContain('text-risk-low');
  });

  it('shows error message when status is failed', () => {
    render(<ProgressTracker status="failed" errorMessage="OpenCorporates timeout" />);
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('OpenCorporates timeout')).toBeInTheDocument();
  });

  it('does not show error section when no errorMessage', () => {
    render(<ProgressTracker status="failed" />);
    expect(screen.queryByText('Error')).not.toBeInTheDocument();
  });

  it('marks failed steps with red styling', () => {
    render(<ProgressTracker status="failed" errorMessage="err" />);
    const queuedLabel = screen.getByText('Queued');
    expect(queuedLabel.className).toContain('text-risk-high');
  });

  it('shows processing steps as active during processing', () => {
    render(<ProgressTracker status="processing" />);
    const scrapingLabel = screen.getByText('Scraping');
    const analyzingLabel = screen.getByText('Analyzing');
    expect(scrapingLabel.className).toContain('text-accent-hover');
    expect(analyzingLabel.className).toContain('text-accent-hover');
  });
});