import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RiskBadge } from '../RiskBadge.js';

describe('RiskBadge', () => {
  it('renders "Verified" label for LOW risk', () => {
    render(<RiskBadge level="LOW" />);
    expect(screen.getByText('Verified')).toBeInTheDocument();
  });

  it('renders "Caution" label for MEDIUM risk', () => {
    render(<RiskBadge level="MEDIUM" />);
    expect(screen.getByText('Caution')).toBeInTheDocument();
  });

  it('renders "High Risk" label for HIGH risk', () => {
    render(<RiskBadge level="HIGH" />);
    expect(screen.getByText('High Risk')).toBeInTheDocument();
  });

  it('renders "Unknown" label for UNKNOWN risk', () => {
    render(<RiskBadge level="UNKNOWN" />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('falls back to raw level string for unrecognized values', () => {
    render(<RiskBadge level="CRITICAL" />);
    expect(screen.getByText('CRITICAL')).toBeInTheDocument();
  });

  it('uses UNKNOWN styling for unrecognized values', () => {
    const { container } = render(<RiskBadge level="CRITICAL" />);
    const badge = container.querySelector('span');
    expect(badge?.className).toContain('bg-risk-unknown-bg');
  });
});