import type { RawCompanyRecord, ValidationResult } from '@medical-validator/shared';

export const TTL_DAYS = Number(process.env.RECORD_TTL_DAYS) || 90;

export function buildFallbackResult(company: RawCompanyRecord): ValidationResult {
  return {
    companyName: company.name ?? 'Unknown',
    jurisdiction: company.jurisdiction ?? 'unknown',
    registrationNumber: company.companyNumber ?? 'unknown',
    incorporationDate: company.incorporationDate ?? null,
    legalStatus: 'Unknown',
    standardizedAddress: company.address ?? 'unknown',
    providerType: 'Unknown',
    riskLevel: 'UNKNOWN',
    riskFlags: ['AI validation unavailable'],
    aiSummary: 'AI validation unavailable — manual review required.',
    confidence: 'LOW',
  };
}