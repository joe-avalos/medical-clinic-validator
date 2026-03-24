import { useQuery } from '@tanstack/react-query';
import { checkHealth } from '../api/client.js';

export function useHealthCheck() {
  const { data: isConnected = false } = useQuery({
    queryKey: ['health'],
    queryFn: checkHealth,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
    retry: false,
  });

  return isConnected;
}
