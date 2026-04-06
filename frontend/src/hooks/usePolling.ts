import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

/** Wrapper around useQuery with automatic polling at `intervalMs`. */
export function usePolling<T>(
  key: string[],
  fetcher: () => Promise<T>,
  intervalMs: number = 30_000,
  options?: Omit<UseQueryOptions<T, Error>, "queryKey" | "queryFn">,
) {
  return useQuery<T, Error>({
    queryKey: key,
    queryFn: fetcher,
    refetchInterval: intervalMs,
    staleTime: intervalMs / 2,
    retry: 2,
    ...options,
  });
}
