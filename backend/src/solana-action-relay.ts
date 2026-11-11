import { createPublicKey, verify } from "node:crypto";

import bs58 from "bs58";

import type { BackendConfig } from "./config.js";
import { defaultCommandRunner, type CommandRunner } from "./command-runner.js";
import { resolveMpcDerivedAccount } from "./solana-derived-player-service.js";

/** First line of every message a Solana wallet signs to authorize a game action. */
export const SOLANA_ACTION_MESSAGE_HEADER = "NEARena action";

const MESSAGE_MAX_AGE_MS = 5 * 60_000;
const MESSAGE_MAX_CLOCK_SKEW_MS = 60_000;
/**
 * Game methods a Solana player may call through the relayer. All use `config.prepaidGas`
 * (100 Tgas by default): a relayed 2-item purchase burns ~10 Tgas in total, and the derived
 * account must hold the full prepaid gas upfront (it is funded with only 0.2 NEAR).
 */
const RELAYABLE_METHODS = new Set(["buy_items", "apply_inventory_actions", "challenge", "assign_stat_points"]);

export interface SolanaActionPayload {
  v: 1;
  contract: string;
  method: string;
  args: Record<string, unknown>;
  nonce: string;
  issuedAt: string;
}

export interface SolanaActionRequest {
  solanaAddress: string;
  /** `${SOLANA_ACTION_MESSAGE_HEADER}\n${JSON.stringify(payload)}`, exactly as signed. */
  message: string;
  /** Base58 ed25519 signature of `message` (UTF-8) by `solanaAddress`. */
  signature: string;
}

export interface SolanaActionResult {
  txHash: string;
  signerId: string;
  method: string;
}

export function parseSolanaActionRequest(body: unknown): SolanaActionRequest {
  if (typeof body !== "object" || body === null) {
    throw new Error("Request body must be an object");
  }

  const { solanaAddress, message, signature } = body as Record<string, unknown>;
  if (typeof solanaAddress !== "string" || solanaAddress.trim().length === 0) {
    throw new Error("solanaAddress is required");
  }
  if (typeof message !== "string" || message.length === 0) {
    throw new Error("message is required");
  }
  if (typeof signature !== "string" || signature.length === 0) {
    throw new Error("signature is required");
  }

  return { solanaAddress: solanaAddress.trim(), message, signature };
}

function parsePayload(message: string): SolanaActionPayload {
  const newline = message.indexOf("\n");
  if (newline === -1 || message.slice(0, newline) !== SOLANA_ACTION_MESSAGE_HEADER) {
    throw new Error("Message is not a NEARena action");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(message.slice(newline + 1));
  } catch {
    throw new Error("Message payload is not valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Message payload must be an object");
  }

  const { v, contract, method, args, nonce, issuedAt } = parsed as Record<string, unknown>;
  if (v !== 1) {
    throw new Error("Unsupported message version");
  }
  if (typeof contract !== "string" || typeof method !== "string") {
    throw new Error("Message must include contract and method");
  }
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new Error("Message args must be an object");
  }
  if (typeof nonce !== "string" || nonce.length < 8 || nonce.length > 128) {
    throw new Error("Message nonce is invalid");
  }
  if (typeof issuedAt !== "string" || Number.isNaN(Date.parse(issuedAt))) {
    throw new Error("Message issuedAt is invalid");
  }

  return { v, contract, method, args: args as Record<string, unknown>, nonce, issuedAt };
}

function verifySolanaSignature(solanaAddress: string, message: string, signature: string): boolean {
  let publicKeyBytes: Uint8Array;
  let signatureBytes: Uint8Array;
  try {
    publicKeyBytes = bs58.decode(solanaAddress);
    signatureBytes = bs58.decode(signature);
  } catch {
    return false;
  }

  if (publicKeyBytes.length !== 32 || signatureBytes.length !== 64) {
    return false;
  }

  const publicKey = createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(publicKeyBytes).toString("base64url") },
    format: "jwk"
  });
  return verify(null, Buffer.from(message, "utf8"), publicKey, signatureBytes);
}

function extractTxHash(output: string): string {
  const match = output.match(/Transaction ID:\s*([A-Za-z0-9]+)/);
  if (!match?.[1]) {
    throw new Error(`Could not find transaction hash in output:\n${output}`);
  }
  return match[1];
}

function extractContractError(output: string): string | null {
  const panic = output.match(/Smart contract panicked: ([^"\n)]+)/);
  return panic?.[1]?.trim() ?? null;
}

const RATE_LIMIT_PATTERN = /exceeded the rate limit|too many requests|\b429\b/i;

/** Turns a failed near-cli run into the most specific message we can give the player. */
function describeCliFailure(method: string, output: string): string {
  const contractError = extractContractError(output);
  if (contractError) {
    return contractError;
  }
  if (RATE_LIMIT_PATTERN.test(output)) {
    return "NEAR RPC is rate limiting requests; wait a minute and retry";
  }
  return `NEAR transaction failed for ${method}`;
}

/**
 * Relays game actions for Solana players. Phantom proves ownership of the Solana address by
 * signing the action; the backend then signs the NEAR transaction with chain signatures (MPC)
 * as the player's derived implicit account.
 */
export class SolanaActionRelay {
  private readonly usedNonces = new Map<string, number>();
  private readonly derivedAccounts = new Map<string, Promise<{ derivationPath: string; implicitNearAccountId: string }>>();
  /** Per-account queue: concurrent MPC transactions from one account would clash on the NEAR nonce. */
  private readonly accountQueues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly config: BackendConfig,
    private readonly run: CommandRunner = defaultCommandRunner,
    private readonly now: () => Date = () => new Date()
  ) {}

  async relay(request: SolanaActionRequest): Promise<SolanaActionResult> {
    const payload = parsePayload(request.message);

    if (payload.contract !== this.config.contractAccountId) {
      throw new Error(`Action targets contract ${payload.contract}, expected ${this.config.contractAccountId}`);
    }
    if (!RELAYABLE_METHODS.has(payload.method)) {
      throw new Error(`Method ${payload.method} is not allowed through the relayer`);
    }

    const nowMs = this.now().getTime();
    const issuedAtMs = Date.parse(payload.issuedAt);
    if (nowMs - issuedAtMs > MESSAGE_MAX_AGE_MS || issuedAtMs - nowMs > MESSAGE_MAX_CLOCK_SKEW_MS) {
      throw new Error("Signed action expired; please retry");
    }

    if (!verifySolanaSignature(request.solanaAddress, request.message, request.signature)) {
      throw new Error("Invalid signature for this Solana address");
    }

    this.pruneNonces(nowMs);
    const nonceKey = `${request.solanaAddress}:${payload.nonce}`;
    if (this.usedNonces.has(nonceKey)) {
      throw new Error("This signed action was already used");
    }
    this.usedNonces.set(nonceKey, issuedAtMs + MESSAGE_MAX_AGE_MS + MESSAGE_MAX_CLOCK_SKEW_MS);

    const account = await this.derivedAccount(request.solanaAddress);
    const txHash = await this.enqueue(account.implicitNearAccountId, () =>
      this.sendViaMpc(account, payload.method, payload.args, this.config.prepaidGas)
    );

    return { txHash, signerId: account.implicitNearAccountId, method: payload.method };
  }

  private derivedAccount(solanaAddress: string) {
    let cached = this.derivedAccounts.get(solanaAddress);
    if (!cached) {
      cached = resolveMpcDerivedAccount(this.config, this.run, solanaAddress);
      cached.catch(() => this.derivedAccounts.delete(solanaAddress));
      this.derivedAccounts.set(solanaAddress, cached);
    }
    return cached;
  }

  private enqueue<T>(accountId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.accountQueues.get(accountId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.accountQueues.set(accountId, next);
    return next;
  }

  private async sendViaMpc(
    account: { derivationPath: string; implicitNearAccountId: string },
    method: string,
    args: Record<string, unknown>,
    gas: string
  ): Promise<string> {
    const result = await this.run("near", [
      "contract",
      "call-function",
      "as-transaction",
      this.config.contractAccountId,
      method,
      "json-args",
      JSON.stringify(args),
      "prepaid-gas",
      gas,
      "attached-deposit",
      "0 NEAR",
      "sign-as",
      account.implicitNearAccountId,
      "network-config",
      this.config.networkName,
      "sign-with-mpc",
      this.config.mpcAdminAccountId,
      "ed25519",
      "derivation-path",
      account.derivationPath,
      "prepaid-gas",
      this.config.mpcSignGas,
      "attached-deposit",
      this.config.mpcSignDeposit,
      "sign-mpc-with-keychain",
      "send"
    ]);

    if (result.exitCode !== 0) {
      console.error(`[backend.solana-action-relay] status=cli_failed method=${method} output=${JSON.stringify(result.output)}`);
      throw new Error(describeCliFailure(method, result.output));
    }
    return extractTxHash(result.output);
  }

  private pruneNonces(nowMs: number): void {
    for (const [key, expiresAt] of this.usedNonces) {
      if (expiresAt < nowMs) {
        this.usedNonces.delete(key);
      }
    }
  }
}
