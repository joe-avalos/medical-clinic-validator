import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RecordsTable } from '../RecordsTable.js';

function renderTable(props: { records: Record<string, unknown>[]; isLoading: boolean }) {
  return render(
    <MemoryRouter>
      <RecordsTable {...props} />
    </MemoryRouter>,
  );
}

const mockRecord = (overrides: Record<string, unknown> = {}) => ({
  jobId: 'job-001',
  companyNumber: 'C12345',
  companyName: 'Mayo Health System',
  jurisdiction: 'us_mn',
  legalStatus: 'Active',
  providerType: 'Health System',
  riskLevel: 'LOW',
  validatedAt: '2026-03-20T10:00:00Z',
  ...overrides,
});

describe('RecordsTable', () => {
  it('renders loading skeletons when isLoading is true', () => {
    const { container } = renderTable({ records: [], isLoading: true });
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBe(5);
  });

  it('renders empty state when no records', () => {
    renderTable({ records: [], isLoading: false });
    expect(screen.getByText('No verification records found')).toBeInTheDocument();
    expect(screen.getByText('Submit a verification to get started')).toBeInTheDocument();
  });

  it('renders table headers', () => {
    renderTable({ records: [mockRecord()], isLoading: false });
    expect(screen.getByText('Company')).toBeInTheDocument();
    expect(screen.getByText('Jurisdiction')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Provider')).toBeInTheDocument();
    expect(screen.getByText('Risk')).toBeInTheDocument();
    // "Verified" is both a table header and the RiskBadge label for LOW
    expect(screen.getAllByText('Verified').length).toBeGreaterThanOrEqual(1);
  });

  it('renders record data correctly', () => {
    renderTable({ records: [mockRecord()], isLoading: false });
    expect(screen.getByText('Mayo Health System')).toBeInTheDocument();
    expect(screen.getByText('US_MN')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Health System')).toBeInTheDocument();
  });

  it('links company name to detail page', () => {
    renderTable({ records: [mockRecord()], isLoading: false });
    const link = screen.getByText('Mayo Health System').closest('a');
    expect(link?.getAttribute('href')).toBe('/records/job-001/C12345');
  });

  it('renders multiple records', () => {
    const records = [
      mockRecord({ companyName: 'Clinic A', companyNumber: 'A1' }),
      mockRecord({ companyName: 'Clinic B', companyNumber: 'B2' }),
    ];
    renderTable({ records, isLoading: false });
    expect(screen.getByText('Clinic A')).toBeInTheDocument();
    expect(screen.getByText('Clinic B')).toBeInTheDocument();
  });

  it('applies green color for Active status', () => {
    renderTable({ records: [mockRecord({ legalStatus: 'Active' })], isLoading: false });
    const status = screen.getByText('Active');
    expect(status.className).toContain('text-risk-low');
  });

  it('applies red color for Dissolved status', () => {
    renderTable({ records: [mockRecord({ legalStatus: 'Dissolved' })], isLoading: false });
    const status = screen.getByText('Dissolved');
    expect(status.className).toContain('text-risk-high');
  });

  it('falls back to "#" href when no companyNumber or jobId', () => {
    renderTable({ records: [mockRecord({ jobId: undefined, companyNumber: undefined })], isLoading: false });
    const link = screen.getByText('Mayo Health System').closest('a');
    // MemoryRouter may resolve '#' differently; check that it does not link to a detail page
    const href = link?.getAttribute('href') ?? '';
    expect(href).not.toContain('/records/');
  });

  it('shows dash when validatedAt is missing', () => {
    renderTable({ records: [mockRecord({ validatedAt: undefined })], isLoading: false });
    const cells = screen.getAllByRole('cell');
    const lastCell = cells[cells.length - 1];
    expect(lastCell.textContent).toBe('—');
  });
});