import { afterEach, describe, expect, it, vi } from "vitest";

import type { BackendConfig } from "../src/config.js";
import type { CommandRunner } from "../src/command-runner.js";
import {
  SolanaDerivedPlayerService,
  deriveImplicitAccountFromPublicKey
} from "../src/solana-derived-player-service.js";

const baseConfig: BackendConfig = {
  port: 8787,
  networkName: "testnet",
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
  faucetStablecoins: "500000000"
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deriveImplicitAccountFromPublicKey", () => {
  it("converts an ed25519 public key into implicit account id", () => {
    const actual = deriveImplicitAccountFromPublicKey("ed25519:7YKHxMeDWh2pkKAWmeExQyP7hWhmmcUUK8RDFmjonScR");
    expect(actual).toBe("612bcf50ef4ce34ddee0506b87680fbddeb96b8abbe9168eb652f03168c5acb2");
  });

  it("throws for non-ed25519 public key prefixes", () => {
    expect(() => deriveImplicitAccountFromPublicKey("secp256k1:abc")).toThrow(/Expected ed25519/);
  });
});

describe("SolanaDerivedPlayerService", () => {
  it("creates a solana-derived player and returns objective proof", async () => {
    const fakeRunner: CommandRunner = async (_command, args) => {
      const full = args.join(" ");

      if (full.includes("as-read-only v1.signer-prod.testnet derived_public_key")) {
        return {
          exitCode: 0,
          output: "Function execution return value (printed to stdout):\ned25519:7YKHxMeDWh2pkKAWmeExQyP7hWhmmcUUK8RDFmjonScR"
        };
      }

      if (full.includes("as-read-only nearena-v1.testnet get_player")) {
        return {
          exitCode: 0,
          output: "Function execution return value (printed to stdout):\nnull"
        };
      }

      if (full.includes("tokens nearena.testnet send-near")) {
        return {
          exitCode: 0,
          output: "Transaction ID: FUNDTXHASH123"
        };
      }

      if (full.includes("as-transaction nearena-v1.testnet register_player")) {
        return {
          exitCode: 0,
          output: "Transaction ID: REGISTERTXHASH456"
        };
      }

      return {
        exitCode: 1,
        output: `Unexpected command args: ${full}`
      };
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          result: {
            transaction: {
              signer_id: "612bcf50ef4ce34ddee0506b87680fbddeb96b8abbe9168eb652f03168c5acb2"
            }
          }
        })
      }))
    );

    const service = new SolanaDerivedPlayerService(baseConfig, fakeRunner);
    const result = await service.createPlayer({ solanaAddress: "C2jKTLDFrZw9sMPRUKeK4Trc3QWeeoWh3YofaC5thJi5" });

    expect(result.alreadyRegistered).toBe(false);
    expect(result.fundingTxHash).toBe("FUNDTXHASH123");
    expect(result.registerPlayerTxHash).toBe("REGISTERTXHASH456");
    expect(result.playerAccountId).toBe("612bcf50ef4ce34ddee0506b87680fbddeb96b8abbe9168eb652f03168c5acb2");
    expect(result.proof.match).toBe(true);
    expect(result.proof.txSigner).toBe(result.playerAccountId);
  });
});
