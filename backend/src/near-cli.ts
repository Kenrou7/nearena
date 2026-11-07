import { runOrThrow, type CommandRunner } from "./command-runner.js";

type NearRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
};

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 300;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isNearRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /rate limit|exceeded the rate limit/i.test(message);
}

export async function runNearWithRetry(
  run: CommandRunner,
  args: string[],
  options: NearRetryOptions = {}
): Promise<string> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await runOrThrow(run, "near", args);
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < maxAttempts && isNearRateLimitError(error);
      if (!shouldRetry) {
        throw error;
      }

      const backoffMs = baseDelayMs * 2 ** (attempt - 1);
      await delay(backoffMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function runNearReadOnlyWithRetry(
  run: CommandRunner,
  args: string[],
  options: NearRetryOptions = {}
): Promise<string> {
  return runNearWithRetry(run, args, options);
}