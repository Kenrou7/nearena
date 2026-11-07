import { describe, expect, it, vi } from "vitest";

import type { CommandRunner } from "../src/command-runner.js";
import { isNearRateLimitError, runNearReadOnlyWithRetry, runNearWithRetry } from "../src/near-cli.js";

describe("isNearRateLimitError", () => {
  it("returns true for NEAR CLI rate-limit messages", () => {
    expect(isNearRateLimitError(new Error("this client has exceeded the rate limit"))).toBe(true);
  });

  it("returns false for unrelated failures", () => {
    expect(isNearRateLimitError(new Error("account does not exist"))).toBe(false);
  });
});

describe("runNearReadOnlyWithRetry", () => {
  it("retries on rate-limit errors and eventually succeeds", async () => {
    let attempts = 0;
    const run: CommandRunner = vi.fn(async () => {
      attempts += 1;

      if (attempts < 3) {
        return {
          exitCode: 1,
          output: "Failed to fetch query: this client has exceeded the rate limit"
        };
      }

      return {
        exitCode: 0,
        output: '{"ok":true}'
      };
    });

    const output = await runNearReadOnlyWithRetry(run, ["contract"], {
      maxAttempts: 4,
      baseDelayMs: 0
    });

    expect(output).toBe('{"ok":true}');
    expect(attempts).toBe(3);
  });

  it("does not retry non-rate-limit errors", async () => {
    let attempts = 0;
    const run: CommandRunner = vi.fn(async () => {
      attempts += 1;
      return {
        exitCode: 1,
        output: "some permanent failure"
      };
    });

    await expect(
      runNearReadOnlyWithRetry(run, ["contract"], {
        maxAttempts: 4,
        baseDelayMs: 0
      })
    ).rejects.toThrow("some permanent failure");

    expect(attempts).toBe(1);
  });
});

describe("runNearWithRetry", () => {
  it("retries transaction command on rate-limit errors and eventually succeeds", async () => {
    let attempts = 0;
    const run: CommandRunner = vi.fn(async () => {
      attempts += 1;

      if (attempts < 2) {
        return {
          exitCode: 1,
          output: "Cannot sign a transaction: this client has exceeded the rate limit"
        };
      }

      return {
        exitCode: 0,
        output: "Transaction ID: abc123"
      };
    });

    const output = await runNearWithRetry(run, ["contract"], {
      maxAttempts: 3,
      baseDelayMs: 0
    });

    expect(output).toContain("Transaction ID: abc123");
    expect(attempts).toBe(2);
  });
});