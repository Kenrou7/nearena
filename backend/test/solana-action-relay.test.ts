import { generateKeyPairSync, sign } from "node:crypto";

import bs58 from "bs58";
import { describe, expect, it } from "vitest";

import type { BackendConfig } from "../src/config.js";
import type { CommandRunner } from "../src/command-runner.js";
import {
  SOLANA_ACTION_MESSAGE_HEADER,
  SolanaActionRelay,
  type SolanaActionPayload
} from "../src/solana-action-relay.js";

const config: BackendConfig = {
  port: 8787,
  corsAllowedOrigins: ["*"],
  networkName: "testnet",
  nearRpcUrls: ["https://rpc.testnet.near.org"],
  nearRpcProxyTimeoutMs: 2500,
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

const IMPLICIT = "612bcf50ef4ce34ddee0506b87680fbddeb96b8abbe9168eb652f03168c5acb2";
const NOW = new Date("2026-11-11T12:00:00.000Z");

function makeWallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  const address = bs58.encode(Buffer.from(jwk.x ?? "", "base64url"));
  return {
    address,
    signMessage(message: string): string {
      return bs58.encode(sign(null, Buffer.from(message, "utf8"), privateKey));
    }
  };
}

function payload(overrides: Partial<SolanaActionPayload> = {}): SolanaActionPayload {
  return {
    v: 1,
    contract: "nearena-v1.testnet",
    method: "buy_items",
    args: { lines: [{ item_id: "potion_small", quantity: 2, currency: "GameCoin" }] },
    nonce: "nonce-0001",
    issuedAt: NOW.toISOString(),
    ...overrides
  };
}

function messageFor(body: SolanaActionPayload): string {
  return `${SOLANA_ACTION_MESSAGE_HEADER}\n${JSON.stringify(body)}`;
}

function makeRunner(calls: string[][], options: { panic?: string; failOutput?: string } = {}): CommandRunner {
  return async (_command, args) => {
    calls.push(args);
    const full = args.join(" ");
    if (full.includes("derived_public_key")) {
      return { exitCode: 0, output: "ed25519:7YKHxMeDWh2pkKAWmeExQyP7hWhmmcUUK8RDFmjonScR" };
    }
    if (full.includes("as-transaction")) {
      if (options.failOutput) {
        return { exitCode: 1, output: options.failOutput };
      }
      if (options.panic) {
        return {
          exitCode: 1,
          output: `Error: ExecutionError("Smart contract panicked: ${options.panic}")`
        };
      }
      return { exitCode: 0, output: "Transaction ID: RELAYTX123" };
    }
    return { exitCode: 1, output: `unexpected: ${full}` };
  };
}

describe("SolanaActionRelay", () => {
  it("verifies the Phantom signature and sends the call via MPC as the derived account", async () => {
    const wallet = makeWallet();
    const calls: string[][] = [];
    const relay = new SolanaActionRelay(config, makeRunner(calls), () => NOW);
    const message = messageFor(payload());

    const result = await relay.relay({
      solanaAddress: wallet.address,
      message,
      signature: wallet.signMessage(message)
    });

    expect(result).toEqual({ txHash: "RELAYTX123", signerId: IMPLICIT, method: "buy_items" });
    const tx = calls.find((args) => args.includes("as-transaction"));
    expect(tx).toBeDefined();
    const joined = (tx ?? []).join(" ");
    expect(joined).toContain("nearena-v1.testnet buy_items");
    expect(joined).toContain(`sign-as ${IMPLICIT}`);
    expect(joined).toContain(`sign-with-mpc nearena.testnet ed25519 derivation-path solana:${wallet.address}`);
    expect(joined).toContain("prepaid-gas 100 Tgas");
  });

  it("rejects a signature from another wallet", async () => {
    const wallet = makeWallet();
    const impostor = makeWallet();
    const relay = new SolanaActionRelay(config, makeRunner([]), () => NOW);
    const message = messageFor(payload());

    await expect(
      relay.relay({ solanaAddress: wallet.address, message, signature: impostor.signMessage(message) })
    ).rejects.toThrow(/Invalid signature/);
  });

  it("rejects methods outside the allowlist and other contracts", async () => {
    const wallet = makeWallet();
    const relay = new SolanaActionRelay(config, makeRunner([]), () => NOW);

    const adminMessage = messageFor(payload({ method: "dev_set_player_game_coin" }));
    await expect(
      relay.relay({ solanaAddress: wallet.address, message: adminMessage, signature: wallet.signMessage(adminMessage) })
    ).rejects.toThrow(/not allowed/);

    const otherContract = messageFor(payload({ contract: "evil.testnet", nonce: "nonce-0002" }));
    await expect(
      relay.relay({ solanaAddress: wallet.address, message: otherContract, signature: wallet.signMessage(otherContract) })
    ).rejects.toThrow(/contract/);
  });

  it("rejects stale messages and replayed nonces", async () => {
    const wallet = makeWallet();
    const relay = new SolanaActionRelay(config, makeRunner([]), () => NOW);

    const stale = messageFor(payload({ issuedAt: new Date(NOW.getTime() - 10 * 60_000).toISOString() }));
    await expect(
      relay.relay({ solanaAddress: wallet.address, message: stale, signature: wallet.signMessage(stale) })
    ).rejects.toThrow(/expired/);

    const fresh = messageFor(payload({ nonce: "nonce-replay" }));
    const signature = wallet.signMessage(fresh);
    await relay.relay({ solanaAddress: wallet.address, message: fresh, signature });
    await expect(relay.relay({ solanaAddress: wallet.address, message: fresh, signature })).rejects.toThrow(
      /already used/
    );
  });

  it("surfaces the contract panic message", async () => {
    const wallet = makeWallet();
    const relay = new SolanaActionRelay(
      config,
      makeRunner([], { panic: "Insufficient game coin balance" }),
      () => NOW
    );
    const message = messageFor(payload());

    await expect(
      relay.relay({ solanaAddress: wallet.address, message, signature: wallet.signMessage(message) })
    ).rejects.toThrow("Insufficient game coin balance");
  });

  it("reports RPC rate limiting as a retryable error instead of a generic failure", async () => {
    const wallet = makeWallet();
    const relay = new SolanaActionRelay(
      config,
      makeRunner([], {
        failOutput:
          "Error: \n   0: Failed to fetch query ViewAccessKey for account <x> on network <testnet>\n   1: this client has exceeded the rate limit"
      }),
      () => NOW
    );
    const message = messageFor(payload({ method: "apply_inventory_actions", args: { actions: [] } }));

    await expect(
      relay.relay({ solanaAddress: wallet.address, message, signature: wallet.signMessage(message) })
    ).rejects.toThrow("NEAR RPC is rate limiting requests; wait a minute and retry");
  });
});
