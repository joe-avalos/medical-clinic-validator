import { useQuery } from '@tanstack/react-query';
import { fetchJobStatus } from '../api/client.js';

export function useJobStatus(jobId: string) {
  return useQuery({
    queryKey: ['jobStatus', jobId],
    queryFn: () => fetchJobStatus(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'completed' || status === 'failed') return false;
      return 2000;
    },
    enabled: !!jobId,
  });
}