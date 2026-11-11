import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import bs58 from "bs58";
import type {
  CreateSolanaDerivedPlayerRequest,
  CreateSolanaDerivedPlayerResponse,
  DerivationProof
} from "@gladiator/shared-types";

import type { BackendConfig } from "./config.js";
import { defaultCommandRunner, runOrThrow, type CommandRunner } from "./command-runner.js";

interface TxRpcResult {
  signerId: string;
}

function extractFirstEd25519(output: string): string {
  const match = output.match(/ed25519:[1-9A-HJ-NP-Za-km-z]+/);
  if (!match) {
    throw new Error(`Could not find ed25519 key in output:\n${output}`);
  }

  return match[0];
}

function extractTxHash(output: string): string {
  const match = output.match(/Transaction ID:\s*([A-Za-z0-9]+)/);
  if (!match || !match[1]) {
    throw new Error(`Could not find transaction hash in output:\n${output}`);
  }

  return match[1];
}

export function deriveImplicitAccountFromPublicKey(publicKey: string): string {
  if (!publicKey.startsWith("ed25519:")) {
    throw new Error(`Expected ed25519 public key, got: ${publicKey}`);
  }

  const raw = bs58.decode(publicKey.slice("ed25519:".length));
  if (raw.length !== 32) {
    throw new Error(`Invalid public key length: ${raw.length}`);
  }

  return Buffer.from(raw).toString("hex");
}

/**
 * True when a near-cli view call returned `null`. near-cli prints the value on stdout and its
 * labels (plus the command it ran, args included) on stderr; the command runner merges them as
 * stdout first. So the value is the first line after the label, or else the first line overall.
 * Searching the whole output for the account id is unreliable because of that command echo.
 */
export function isNullViewResult(output: string): boolean {
  const clean = output.replace(/\u001b\[[0-9;]*m/g, "");
  const firstNonEmpty = (text: string): string | undefined =>
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);

  const marker = "Function execution return value (printed to stdout):";
  const markerIndex = clean.indexOf(marker);
  const afterMarker =
    markerIndex === -1 ? undefined : firstNonEmpty(clean.slice(markerIndex + marker.length));
  const value =
    afterMarker !== undefined && !afterMarker.startsWith("Here is your console command")
      ? afterMarker
      : firstNonEmpty(markerIndex === -1 ? clean : clean.slice(0, markerIndex));

  if (value === undefined) {
    throw new Error(`Could not read view result from near-cli output:\n${output}`);
  }
  return value === "null";
}

function parseTxSigner(json: unknown): TxRpcResult {
  if (typeof json !== "object" || json === null || !("result" in json)) {
    throw new Error("Invalid RPC response: missing result");
  }

  const result = (json as { result: unknown }).result;
  if (typeof result !== "object" || result === null || !("transaction" in result)) {
    throw new Error("Invalid RPC response: missing transaction");
  }

  const transaction = (result as { transaction: unknown }).transaction;
  if (typeof transaction !== "object" || transaction === null || !("signer_id" in transaction)) {
    throw new Error("Invalid RPC response: missing signer_id");
  }

  const signerId = (transaction as { signer_id: unknown }).signer_id;
  if (typeof signerId !== "string" || signerId.length === 0) {
    throw new Error("Invalid signer_id type in RPC response");
  }

  return { signerId };
}

async function fetchTxSigner(txHash: string, signerId: string): Promise<string> {
  const response = await fetch("https://rpc.testnet.near.org", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "dontcare",
      method: "tx",
      params: [txHash, signerId]
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to query tx from RPC: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as unknown;
  return parseTxSigner(payload).signerId;
}

async function resolveSolanaAddress(
  request: CreateSolanaDerivedPlayerRequest,
  run: CommandRunner
): Promise<{ address: string; generatedKeypairPath: string | null }> {
  if (request.solanaAddress && request.solanaAddress.trim().length > 0) {
    return { address: request.solanaAddress.trim(), generatedKeypairPath: null };
  }

  const tempDir = await mkdtemp(join(tmpdir(), "gladiator-solana-"));
  const keypairPath = join(tempDir, "player.json");

  await runOrThrow(run, "solana-keygen", ["new", "--no-bip39-passphrase", "--force", "--outfile", keypairPath]);
  const output = await runOrThrow(run, "solana", ["address", "-k", keypairPath]);

  const address = output.trim().split(/\s+/).find((token) => token.length > 20);
  if (!address) {
    throw new Error(`Could not parse Solana address from output:\n${output}`);
  }

  return { address, generatedKeypairPath: keypairPath };
}

export interface MpcDerivedAccount {
  derivationPath: string;
  mpcDerivedPublicKey: string;
  implicitNearAccountId: string;
}

/**
 * The NEAR account controlled via chain signatures for a Solana address: the MPC key derived
 * from (mpcAdminAccountId, "<prefix>:<solanaAddress>"). Only the backend's admin can sign for it.
 */
export async function resolveMpcDerivedAccount(
  config: BackendConfig,
  run: CommandRunner,
  solanaAddress: string
): Promise<MpcDerivedAccount> {
  const derivationPath = `${config.mpcDerivationPrefix}:${solanaAddress}`;
  const mpcArgs = JSON.stringify({
    path: derivationPath,
    predecessor: config.mpcAdminAccountId,
    domain_id: 1,
    chain: "solana"
  });

  const mpcOutput = await runOrThrow(run, "near", [
    "contract",
    "call-function",
    "as-read-only",
    config.nearMpcContractId,
    config.mpcPublicKeyMethod,
    "json-args",
    mpcArgs,
    "network-config",
    config.networkName,
    "now"
  ]);

  const mpcDerivedPublicKey = extractFirstEd25519(mpcOutput);
  return {
    derivationPath,
    mpcDerivedPublicKey,
    implicitNearAccountId: deriveImplicitAccountFromPublicKey(mpcDerivedPublicKey)
  };
}

export class SolanaDerivedPlayerService {
  constructor(
    private readonly config: BackendConfig,
    private readonly run: CommandRunner = defaultCommandRunner
  ) {}

  async createPlayer(
    request: CreateSolanaDerivedPlayerRequest
  ): Promise<CreateSolanaDerivedPlayerResponse> {
    const resolved = await resolveSolanaAddress(request, this.run);

    try {
      const { derivationPath, mpcDerivedPublicKey, implicitNearAccountId } = await resolveMpcDerivedAccount(
        this.config,
        this.run,
        resolved.address
      );

      const playerViewOutput = await runOrThrow(this.run, "near", [
        "contract",
        "call-function",
        "as-read-only",
        this.config.contractAccountId,
        "get_player",
        "json-args",
        JSON.stringify({ account_id: implicitNearAccountId }),
        "network-config",
        this.config.networkName,
        "now"
      ]);

      const alreadyRegistered = !isNullViewResult(playerViewOutput);

      let fundingTxHash: string | null = null;
      let registerPlayerTxHash: string | null = null;

      if (!alreadyRegistered) {
        const fundOutput = await runOrThrow(this.run, "near", [
          "tokens",
          this.config.signerAccountId,
          "send-near",
          implicitNearAccountId,
          this.config.implicitAccountFundingNear,
          "network-config",
          this.config.networkName,
          "sign-with-keychain",
          "send"
        ]);
        fundingTxHash = extractTxHash(fundOutput);

        const registerOutput = await runOrThrow(this.run, "near", [
          "contract",
          "call-function",
          "as-transaction",
          this.config.contractAccountId,
          "register_player",
          "json-args",
          "{}",
          "prepaid-gas",
          this.config.prepaidGas,
          "attached-deposit",
          this.config.attachedDeposit,
          "sign-as",
          implicitNearAccountId,
          "network-config",
          this.config.networkName,
          "sign-with-mpc",
          this.config.mpcAdminAccountId,
          "ed25519",
          "derivation-path",
          derivationPath,
          "prepaid-gas",
          this.config.mpcSignGas,
          "attached-deposit",
          this.config.mpcSignDeposit,
          "sign-mpc-with-keychain",
          "send"
        ]);
        registerPlayerTxHash = extractTxHash(registerOutput);
      }

      const txSigner = registerPlayerTxHash
        ? await fetchTxSigner(registerPlayerTxHash, implicitNearAccountId)
        : implicitNearAccountId;

      const proof: DerivationProof = {
        solanaAddress: resolved.address,
        derivationPath,
        mpcDerivedPublicKey,
        implicitNearAccountId,
        txSigner,
        match: txSigner === implicitNearAccountId
      };

      return {
        contractAccountId: this.config.contractAccountId,
        playerAccountId: implicitNearAccountId,
        alreadyRegistered,
        fundingTxHash,
        registerPlayerTxHash,
        proof
      };
    } finally {
      if (resolved.generatedKeypairPath) {
        const tempDir = dirname(resolved.generatedKeypairPath);
        await rm(tempDir, { force: true, recursive: true });
      }
    }
  }
}
