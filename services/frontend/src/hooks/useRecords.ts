import { useInfiniteQuery } from '@tanstack/react-query';
import type { RiskLevel } from '@medical-validator/shared';
import { fetchRecords } from '../api/client.js';

export function useRecords(params: {
  riskLevel?: RiskLevel;
  limit?: number;
}) {
  return useInfiniteQuery({
    queryKey: ['records', params.riskLevel, params.limit],
    queryFn: ({ pageParam }) => fetchRecords({ ...params, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}