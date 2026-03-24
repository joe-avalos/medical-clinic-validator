import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DetailView } from '../DetailView.js';

const baseRecord = {
  companyName: 'Test Clinic',
  jurisdiction: 'us_ca',
  registrationNumber: 'REG-999',
  riskLevel: 'LOW',
  aiSummary: 'Entity is actively registered with no anomalies.',
  legalStatus: 'Active',
  providerType: 'Clinic',
  confidence: '0.95',
  incorporationDate: '2010-05-15',
  validatedAt: '2026-03-20T10:00:00Z',
  standardizedAddress: '123 Main St, Los Angeles, CA',
  riskFlags: [],
  cachedResult: false,
  rawSourceData: {},
};

describe('DetailView', () => {
  it('renders company name and risk badge', () => {
    render(<DetailView record={baseRecord} />);
    expect(screen.getByText('Test Clinic')).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument(); // LOW → Verified
  });

  it('renders jurisdiction and registration number in header', () => {
    render(<DetailView record={baseRecord} />);
    expect(screen.getByText(/US_CA/)).toBeInTheDocument();
    // REG-999 appears in both header and detail grid
    const matches = screen.getAllByText(/REG-999/);
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('renders AI assessment summary', () => {
    render(<DetailView record={baseRecord} />);
    expect(screen.getByText('AI Assessment')).toBeInTheDocument();
    expect(screen.getByText('Entity is actively registered with no anomalies.')).toBeInTheDocument();
  });

  it('renders registration detail fields', () => {
    render(<DetailView record={baseRecord} />);
    expect(screen.getByText('Legal Status')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Provider Type')).toBeInTheDocument();
    expect(screen.getByText('Clinic')).toBeInTheDocument();
    expect(screen.getByText('Confidence')).toBeInTheDocument();
    expect(screen.getByText('0.95')).toBeInTheDocument();
  });

  it('renders standardized address', () => {
    render(<DetailView record={baseRecord} />);
    expect(screen.getByText('Standardized Address')).toBeInTheDocument();
    expect(screen.getByText('123 Main St, Los Angeles, CA')).toBeInTheDocument();
  });

  it('shows N/A for missing field values', () => {
    render(<DetailView record={{ ...baseRecord, standardizedAddress: null }} />);
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);
  });

  it('renders risk flags when present', () => {
    const record = { ...baseRecord, riskFlags: ['Dissolved entity', 'Jurisdiction mismatch'] };
    render(<DetailView record={record} />);
    expect(screen.getByText('Risk Flags')).toBeInTheDocument();
    expect(screen.getByText('Dissolved entity')).toBeInTheDocument();
    expect(screen.getByText('Jurisdiction mismatch')).toBeInTheDocument();
  });

  it('hides risk flags section when empty', () => {
    render(<DetailView record={baseRecord} />);
    expect(screen.queryByText('Risk Flags')).not.toBeInTheDocument();
  });

  it('shows cache indicator when cachedResult is true', () => {
    render(<DetailView record={{ ...baseRecord, cachedResult: true }} />);
    expect(screen.getByText(/Cached result/)).toBeInTheDocument();
  });

  it('hides cache indicator when cachedResult is false', () => {
    render(<DetailView record={baseRecord} />);
    expect(screen.queryByText(/Cached result/)).not.toBeInTheDocument();
  });

  it('shows cached from job ID when present', () => {
    render(<DetailView record={{ ...baseRecord, cachedResult: true, cachedFromJobId: 'job-old' }} />);
    expect(screen.getByText('job-old')).toBeInTheDocument();
  });

  it('renders raw audit data in collapsible section', () => {
    const record = { ...baseRecord, rawSourceData: { source: 'opencorporates', score: 85 } };
    render(<DetailView record={record} />);
    expect(screen.getByText('Raw Audit Data')).toBeInTheDocument();
    expect(screen.getByText(/"source": "opencorporates"/)).toBeInTheDocument();
  });

  it('hides raw audit data when empty', () => {
    render(<DetailView record={baseRecord} />);
    expect(screen.queryByText('Raw Audit Data')).not.toBeInTheDocument();
  });

  it('shows "No reg. number" when registrationNumber is empty', () => {
    render(<DetailView record={{ ...baseRecord, registrationNumber: '' }} />);
    expect(screen.getByText(/No reg. number/)).toBeInTheDocument();
  });

  it('renders sanitized HTML preview when rawHtml is present', () => {
    const record = {
      ...baseRecord,
      rawSourceData: {
        rawHtml: '<li class="search-result"><a class="company_search_result" href="/companies/us_ca/REG-999">Test Clinic</a></li>',
        source: 'opencorporates',
      },
    };
    render(<DetailView record={record} />);
    expect(screen.getByText('Source Record Preview')).toBeInTheDocument();
    const preview = screen.getByText('Test Clinic', { selector: '.oc-preview a' });
    expect(preview).toBeInTheDocument();
  });

  it('strips disallowed tags from rawHtml', () => {
    const record = {
      ...baseRecord,
      rawSourceData: {
        rawHtml: '<li><script>alert("xss")</script><a href="/test">Safe Link</a></li>',
      },
    };
    const { container } = render(<DetailView record={record} />);
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('Safe Link')).toBeInTheDocument();
  });

  it('strips disallowed attributes from rawHtml', () => {
    const record = {
      ...baseRecord,
      rawSourceData: {
        rawHtml: '<li><a href="/test" onclick="alert(1)" style="color:red">Link</a></li>',
      },
    };
    const { container } = render(<DetailView record={record} />);
    const link = container.querySelector('.oc-preview a');
    expect(link?.getAttribute('onclick')).toBeNull();
    expect(link?.getAttribute('style')).toBeNull();
    expect(link?.getAttribute('href')).toBe('/test');
  });

  it('hides source preview when rawHtml is not present', () => {
    const record = { ...baseRecord, rawSourceData: { source: 'opencorporates' } };
    render(<DetailView record={record} />);
    expect(screen.queryByText('Source Record Preview')).not.toBeInTheDocument();
  });

  it('replaces flag images with emoji flags', () => {
    const record = {
      ...baseRecord,
      rawSourceData: {
        rawHtml: '<li><a class="jurisdiction_filter us" href="/companies/us_mn"><img class="flag" src="/assets/flags/us.gif" alt="US flag"></a><a class="company_search_result" href="/test">Company</a></li>',
      },
    };
    const { container } = render(<DetailView record={record} />);
    const flag = container.querySelector('.oc-flag');
    expect(flag).not.toBeNull();
    expect(flag?.textContent).toBe('🇺🇸');
    // img should be stripped
    expect(container.querySelector('img')).toBeNull();
  });

  it('adds map marker SVG before address spans', () => {
    const record = {
      ...baseRecord,
      rawSourceData: {
        rawHtml: '<li><a class="company_search_result" href="/test">Company</a><span class="address">123 Main St</span></li>',
      },
    };
    const { container } = render(<DetailView record={record} />);
    const pin = container.querySelector('svg.oc-pin');
    expect(pin).not.toBeNull();
    expect(pin?.tagName.toLowerCase()).toBe('svg');
  });
});