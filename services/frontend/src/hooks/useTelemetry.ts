import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchTelemetry } from '../api/client.js';

export function useTelemetry(params: {
  pipelinePath?: string;
  limit?: number;
}) {
  return useInfiniteQuery({
    queryKey: ['telemetry', params.pipelinePath, params.limit],
    queryFn: ({ pageParam }) => fetchTelemetry({ ...params, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}
