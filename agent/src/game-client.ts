/** What the bot needs from NEAR: read views and sign calls as the bot account. */
export interface GameClient {
  view<T>(methodName: string, args: Record<string, unknown>): Promise<T>;
  call(input: ContractCall): Promise<CallOutcome>;
}

export type ContractCall = {
  methodName: string;
  args: Record<string, unknown>;
  gas: bigint;
};

export type CallOutcome = {
  txHash: string;
  /** Decoded JSON return value of the method, or null if it returned nothing. */
  result: unknown;
};

export const DEFAULT_GAS = 30_000_000_000_000n;
/** Same budget as the web for batches and fights (web/lib/game-actions.ts). */
export const HEAVY_GAS = 100_000_000_000_000n;
