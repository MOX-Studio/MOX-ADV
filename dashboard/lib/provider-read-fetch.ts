export const PROVIDER_READ_TIMEOUT_MS = 60_000;

/** Bound each provider read, including its response body, while preserving caller cancellation. */
export function providerReadFetcher(input: {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
} = {}): typeof fetch {
  const timeoutMs = input.timeoutMs ?? PROVIDER_READ_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("Provider read timeout must be a positive integer.");
  const fetcher = input.fetcher ?? fetch;
  return (request, init) => {
    const requestSignal = init?.signal ?? (request instanceof Request ? request.signal : undefined);
    const signals = [input.signal, requestSignal].filter((signal): signal is AbortSignal => Boolean(signal));
    for (const signal of signals) signal.throwIfAborted();
    const signal = AbortSignal.any([...signals, AbortSignal.timeout(timeoutMs)]);
    return fetcher(request, { ...init, signal });
  };
}
