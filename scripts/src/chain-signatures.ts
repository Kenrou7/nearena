import { createHash, randomBytes } from "node:crypto";

import bs58 from "bs58";
import nacl from "tweetnacl";

export interface SpikeConfig {
  nearRpcUrl: string;
  nearNetworkId: string;
  mpcContractId: string;
  signerAccountId: string;
  signerPrivateKey: string;
  publicKeyMethod: string;
  signMethod: string;
  domainId: number;
}

export interface PublicKeyResponse {
  raw: unknown;
  publicKey: Uint8Array;
  publicKeyBase58: string;
}

export interface SignatureResponse {
  raw: unknown;
  signature: Uint8Array;
  signatureBase58: string;
}

export interface ChainSigner {
  viewPublicKey(input: {
    contractId: string;
    methodName: string;
    args: Record<string, unknown>;
  }): Promise<unknown>;
  callSign(input: {
    contractId: string;
    methodName: string;
    args: Record<string, unknown>;
  }): Promise<unknown>;
}

export function deriveSolanaPath(accountId: string): string {
  const normalized = accountId.trim();
  if (normalized.length === 0) {
    throw new Error("accountId must not be empty");
  }

  return `solana:${normalized}`;
}

export function createSpikeMessage(accountId: string, nonce?: number): Uint8Array {
  const effectiveNonce = nonce ?? Date.now();
  const payload = `gladiator-chain-signatures-spike:${accountId}:${effectiveNonce}`;
  return createHash("sha256").update(payload).digest();
}

export function generateTxRef(prefix = "spike"): string {
  const randomPart = randomBytes(8).toString("hex");
  return `${prefix}-${Date.now()}-${randomPart}`;
}

export function decodeNearEd25519Key(value: string): Uint8Array {
  const trimmed = value.trim();
  if (!trimmed.startsWith("ed25519:")) {
    throw new Error("Expected ed25519: prefixed public key");
  }

  const base58Key = trimmed.slice("ed25519:".length);
  const bytes = bs58.decode(base58Key);
  if (bytes.length !== 32) {
    throw new Error(`Invalid public key size: ${bytes.length}`);
  }

  return bytes;
}

function decodeSignatureLike(value: unknown): Uint8Array {
  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed.length === 0) {
      throw new Error("Empty signature string");
    }

    if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
      return Uint8Array.from(Buffer.from(trimmed, "hex"));
    }

    const looksBase58 = /^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed);
    if (looksBase58) {
      try {
        return bs58.decode(trimmed);
      } catch {
        // Fallback to base64 below.
      }
    }

    try {
      return Uint8Array.from(Buffer.from(trimmed, "base64"));
    } catch {
      if (!looksBase58) {
        return bs58.decode(trimmed);
      }
    }

    throw new Error("Unsupported signature encoding");
  }

  if (Array.isArray(value) && value.every((entry) => typeof entry === "number")) {
    return Uint8Array.from(value);
  }

  if (value instanceof Uint8Array) {
    return value;
  }

  throw new Error("Unsupported signature encoding");
}

export function parsePublicKeyResponse(raw: unknown): PublicKeyResponse {
  const publicKeyRaw =
    typeof raw === "string"
      ? raw
      : typeof raw === "object" && raw !== null && "public_key" in raw
        ? (raw as { public_key: unknown }).public_key
        : typeof raw === "object" && raw !== null && "publicKey" in raw
          ? (raw as { publicKey: unknown }).publicKey
          : undefined;

  if (typeof publicKeyRaw !== "string") {
    throw new Error("public key not found in response");
  }

  const publicKey = decodeNearEd25519Key(publicKeyRaw);
  return {
    raw,
    publicKey,
    publicKeyBase58: bs58.encode(publicKey)
  };
}

export function parseSignatureResponse(raw: unknown): SignatureResponse {
  const signatureRaw =
    typeof raw === "string"
      ? raw
      : typeof raw === "object" && raw !== null && "signature" in raw
        ? (raw as { signature: unknown }).signature
        : typeof raw === "object" && raw !== null && "sig" in raw
          ? (raw as { sig: unknown }).sig
          : typeof raw === "object" && raw !== null && "Ed25519" in raw
            ? (raw as { Ed25519: { signature?: unknown } }).Ed25519.signature
            : typeof raw === "object" && raw !== null && "Secp256k1" in raw
              ? (raw as { Secp256k1: { big_r?: { affine_point?: unknown }; s?: { scalar?: unknown } } })
                  .Secp256k1.big_r?.affine_point
              : undefined;

  const signature = decodeSignatureLike(signatureRaw);
  if (signature.length !== 64) {
    throw new Error(`Invalid signature size: ${signature.length}`);
  }

  return {
    raw,
    signature,
    signatureBase58: bs58.encode(signature)
  };
}

export function verifyEd25519Signature(input: {
  message: Uint8Array;
  signature: Uint8Array;
  publicKey: Uint8Array;
}): boolean {
  return nacl.sign.detached.verify(input.message, input.signature, input.publicKey);
}

export async function deriveAndSignMessage(input: {
  signer: ChainSigner;
  mpcContractId: string;
  publicKeyMethod: string;
  signMethod: string;
  accountId: string;
  message: Uint8Array;
  keyVersion?: number;
  domainId?: number;
  predecessorAccountId?: string;
}): Promise<{
  derivationPath: string;
  publicKey: PublicKeyResponse;
  signature: SignatureResponse;
  verified: boolean;
}> {
  const derivationPath = deriveSolanaPath(input.accountId);

  const publicKeyRaw = await input.signer.viewPublicKey({
    contractId: input.mpcContractId,
    methodName: input.publicKeyMethod,
    args: {
      path: derivationPath,
      predecessor: input.predecessorAccountId ?? input.accountId,
      domain_id: input.domainId ?? 1,
      chain: "solana"
    }
  });

  const publicKey = parsePublicKeyResponse(publicKeyRaw);

  const signatureRaw = await input.signer.callSign({
    contractId: input.mpcContractId,
    methodName: input.signMethod,
    args: {
      request: {
        path: derivationPath,
        domain_id: input.domainId ?? 1,
        payload_v2: {
          Eddsa: Buffer.from(input.message).toString("hex")
        }
      }
    }
  });

  const signature = parseSignatureResponse(signatureRaw);
  const verified = verifyEd25519Signature({
    message: input.message,
    signature: signature.signature,
    publicKey: publicKey.publicKey
  });

  return {
    derivationPath,
    publicKey,
    signature,
    verified
  };
}
