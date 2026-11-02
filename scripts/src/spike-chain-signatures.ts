import { parseArgs } from "node:util";

import {
  createSpikeMessage,
  deriveAndSignMessage,
  generateTxRef,
  type SpikeConfig
} from "./chain-signatures.js";
import { NearChainSigner } from "./near-signer.js";

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function readConfig(): SpikeConfig {
  const rawDomainId = process.env.CHAIN_SIGNATURES_DOMAIN_ID?.trim();
  const domainId = rawDomainId ? Number(rawDomainId) : 1;
  if (!Number.isInteger(domainId) || domainId < 0) {
    throw new Error("CHAIN_SIGNATURES_DOMAIN_ID must be a non-negative integer");
  }

  return {
    nearRpcUrl: process.env.NEAR_RPC_URL?.trim() || "https://rpc.testnet.near.org",
    nearNetworkId: process.env.NEAR_NETWORK_ID?.trim() || "testnet",
    mpcContractId: readRequiredEnv("NEAR_MPC_CONTRACT_ID"),
    signerAccountId: readRequiredEnv("NEAR_SIGNER_ACCOUNT_ID"),
    signerPrivateKey: readRequiredEnv("NEAR_SIGNER_PRIVATE_KEY"),
    publicKeyMethod: process.env.CHAIN_SIGNATURES_PUBLIC_KEY_METHOD?.trim() || "public_key",
    signMethod: process.env.CHAIN_SIGNATURES_SIGN_METHOD?.trim() || "sign",
    domainId
  };
}

async function main(): Promise<void> {
  const args = parseArgs({
    options: {
      account: { type: "string", short: "a" },
      nonce: { type: "string", short: "n" }
    }
  });

  const accountId = args.values.account?.trim();
  if (!accountId) {
    throw new Error("Missing --account <near-account-id>");
  }

  const nonce = args.values.nonce ? Number(args.values.nonce) : undefined;
  if (typeof nonce === "number" && Number.isNaN(nonce)) {
    throw new Error("--nonce must be a number");
  }

  const config = readConfig();
  const signer = new NearChainSigner({
    rpcUrl: config.nearRpcUrl,
    networkId: config.nearNetworkId,
    signerAccountId: config.signerAccountId,
    signerPrivateKey: config.signerPrivateKey
  });

  const txRef = generateTxRef("chain-signatures-spike");
  const message = createSpikeMessage(accountId, nonce);

  const result = await deriveAndSignMessage({
    signer,
    mpcContractId: config.mpcContractId,
    publicKeyMethod: config.publicKeyMethod,
    signMethod: config.signMethod,
    domainId: config.domainId,
    predecessorAccountId: config.signerAccountId,
    accountId,
    message
  });

  if (!result.verified) {
    throw new Error("MPC signature could not be verified against derived public key");
  }

  const summary = {
    txRef,
    nearAccount: accountId,
    derivationPath: result.derivationPath,
    solanaDepositAddress: result.publicKey.publicKeyBase58,
    messageHex: Buffer.from(message).toString("hex"),
    signatureBase58: result.signature.signatureBase58,
    verified: result.verified
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[chain-signatures-spike] ${reason}`);
  process.exitCode = 1;
});
