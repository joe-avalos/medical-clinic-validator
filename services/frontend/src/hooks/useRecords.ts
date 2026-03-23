import { useQuery } from '@tanstack/react-query';
import type { RiskLevel } from '@medical-validator/shared';
import { fetchRecords } from '../api/client.js';

export function useRecords(params: {
  riskLevel?: RiskLevel;
  limit?: number;
  cursor?: string;
}) {
  return useQuery({
    queryKey: ['records', params],
    queryFn: () => fetchRecords(params),
  });
}