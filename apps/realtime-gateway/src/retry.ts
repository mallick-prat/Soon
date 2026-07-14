export interface BackoffOptions {
  /** total attempts including the first (default 3) */
  attempts?: number;
  /** delay before the second attempt; doubles each retry (default 250ms) */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** return false to stop retrying for this error */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** injectable sleep for tests */
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** run `fn` with exponential backoff. `fn` receives the 1-based attempt number. */
export async function withBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  options: BackoffOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 5_000;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const isLast = attempt === attempts;
      if (isLast || (options.shouldRetry && !options.shouldRetry(error, attempt))) break;
      const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      options.onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

/** error that aborts retries immediately (e.g. command expired) */
export class AbortRetryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AbortRetryError";
  }
}
