import { afterEach, describe, expect, it, vi } from "vitest";

import type { BackendConfig } from "../src/config.js";
import { viewFunctionWithRpcFallback } from "../src/near-rpc.js";

const baseConfig: BackendConfig = {
  port: 8787,
  networkName: "testnet",
  nearRpcUrls: ["https://rpc-a.test", "https://rpc-b.test"],
  signerAccountId: "nearena.testnet",
  contractAccountId: "nearena-v1.testnet",
  nearMpcContractId: "v1.signer-prod.testnet",
  mpcAdminAccountId: "nearena.testnet",
  mpcDerivationPrefix: "solana",
  mpcPublicKeyMethod: "derived_public_key",
  mpcSignGas: "120 Tgas",
  mpcSignDeposit: "1 yoctonear",
  prepaidGas: "100 Tgas",
  attachedDeposit: "0 NEAR",
  implicitAccountFundingNear: "0.2 NEAR",
  faucetGameCoins: "500000000",
  faucetStablecoins: "500000000",
  stableTokenContractId: "stable.testnet"
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("viewFunctionWithRpcFallback", () => {
  it("falls back to the next RPC endpoint when the first one is rate-limited", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: "rate limit" } })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          result: {
            result: Array.from(Buffer.from('{"level":2}', "utf8"))
          }
        })
      });

    vi.stubGlobal("fetch", mockFetch);

    const result = await viewFunctionWithRpcFallback(baseConfig, "get_player_view", {
      account_id: "k-investment.testnet"
    });

    expect(result).toEqual({ level: 2 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});