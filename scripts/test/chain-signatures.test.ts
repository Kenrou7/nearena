import bs58 from "bs58";
import nacl from "tweetnacl";
import { describe, expect, it, vi } from "vitest";

import {
  createSpikeMessage,
  decodeNearEd25519Key,
  deriveAndSignMessage,
  deriveSolanaPath,
  parsePublicKeyResponse,
  parseSignatureResponse,
  verifyEd25519Signature,
  type ChainSigner
} from "../src/chain-signatures.js";

describe("chain-signatures helpers", () => {
  it("derives deterministic solana path", () => {
    expect(deriveSolanaPath("demo.testnet")).toBe("solana:demo.testnet");
  });

  it("fails when accountId is empty", () => {
    expect(() => deriveSolanaPath("  ")).toThrow("accountId must not be empty");
  });

  it("creates 32-byte sha256 message", () => {
    const message = createSpikeMessage("alice.testnet", 42);
    expect(message).toHaveLength(32);
  });

  it("parses ed25519 public key responses", () => {
    const pair = nacl.sign.keyPair();
    const encoded = `ed25519:${bs58.encode(pair.publicKey)}`;

    const parsed = parsePublicKeyResponse({ public_key: encoded });
    expect(parsed.publicKey).toEqual(pair.publicKey);
  });

  it("rejects malformed near public key prefix", () => {
    expect(() => decodeNearEd25519Key("secp256k1:abc")).toThrow(
      "Expected ed25519: prefixed public key"
    );
  });

  it("parses signature response in base64", () => {
    const pair = nacl.sign.keyPair();
    const msg = createSpikeMessage("bob.testnet", 7);
    const sig = nacl.sign.detached(msg, pair.secretKey);

    const parsed = parseSignatureResponse({ signature: Buffer.from(sig).toString("base64") });
    expect(parsed.signature).toEqual(sig);
  });

  it("parses signature response in hex", () => {
    const pair = nacl.sign.keyPair();
    const msg = createSpikeMessage("hex.testnet", 8);
    const sig = nacl.sign.detached(msg, pair.secretKey);

    const parsed = parseSignatureResponse({ signature: Buffer.from(sig).toString("hex") });
    expect(parsed.signature).toEqual(sig);
  });

  it("parses signature response in base58", () => {
    const pair = nacl.sign.keyPair();
    const msg = createSpikeMessage("base58.testnet", 9);
    const sig = nacl.sign.detached(msg, pair.secretKey);

    const parsed = parseSignatureResponse({ signature: bs58.encode(sig) });
    expect(parsed.signature).toEqual(sig);
  });

  it("parses signature from numeric array", () => {
    const pair = nacl.sign.keyPair();
    const msg = createSpikeMessage("array.testnet", 10);
    const sig = nacl.sign.detached(msg, pair.secretKey);

    const parsed = parseSignatureResponse({ signature: Array.from(sig) });
    expect(parsed.signature).toEqual(sig);
  });

  it("parses signature from uint8array", () => {
    const pair = nacl.sign.keyPair();
    const msg = createSpikeMessage("bytes.testnet", 11);
    const sig = nacl.sign.detached(msg, pair.secretKey);

    const parsed = parseSignatureResponse({ signature: new Uint8Array(sig) });
    expect(parsed.signature).toEqual(sig);
  });

  it("rejects missing public key in response", () => {
    expect(() => parsePublicKeyResponse({})).toThrow("public key not found in response");
  });

  it("parses public key response with publicKey field", () => {
    const pair = nacl.sign.keyPair();
    const parsed = parsePublicKeyResponse({ publicKey: `ed25519:${bs58.encode(pair.publicKey)}` });
    expect(parsed.publicKey).toEqual(pair.publicKey);
  });

  it("parses public key response as direct string", () => {
    const pair = nacl.sign.keyPair();
    const parsed = parsePublicKeyResponse(`ed25519:${bs58.encode(pair.publicKey)}`);
    expect(parsed.publicKey).toEqual(pair.publicKey);
  });

  it("rejects invalid signature size", () => {
    expect(() => parseSignatureResponse({ signature: "abcd" })).toThrow("Invalid signature size");
  });

  it("rejects empty signature string", () => {
    expect(() => parseSignatureResponse({ signature: "  " })).toThrow("Empty signature string");
  });

  it("rejects unsupported signature encoding", () => {
    expect(() => parseSignatureResponse({ signature: { bad: true } })).toThrow(
      "Unsupported signature encoding"
    );
  });

  it("verifies detached signatures", () => {
    const pair = nacl.sign.keyPair();
    const msg = createSpikeMessage("carol.testnet", 1);
    const sig = nacl.sign.detached(msg, pair.secretKey);

    expect(
      verifyEd25519Signature({
        message: msg,
        signature: sig,
        publicKey: pair.publicKey
      })
    ).toBe(true);
  });

  it("executes deriveAndSignMessage with mocked signer", async () => {
    const pair = nacl.sign.keyPair();
    const msg = createSpikeMessage("dani.testnet", 5);

    const signer: ChainSigner = {
      async viewPublicKey() {
        return {
          public_key: `ed25519:${bs58.encode(pair.publicKey)}`
        };
      },
      async callSign() {
        return {
          signature: Buffer.from(nacl.sign.detached(msg, pair.secretKey)).toString("base64")
        };
      }
    };

    const result = await deriveAndSignMessage({
      signer,
      mpcContractId: "v1.signer.testnet",
      publicKeyMethod: "public_key",
      signMethod: "sign",
      accountId: "dani.testnet",
      message: msg
    });

    expect(result.verified).toBe(true);
    expect(result.derivationPath).toBe("solana:dani.testnet");
  });

  it("sends request wrapper with domain_id and eddsa payload", async () => {
    const pair = nacl.sign.keyPair();
    const msg = createSpikeMessage("versioned.testnet", 13);

    const callSignSpy = vi.fn(async () => ({
      signature: Buffer.from(nacl.sign.detached(msg, pair.secretKey)).toString("base64")
    }));

    const signer: ChainSigner = {
      async viewPublicKey() {
        return {
          public_key: `ed25519:${bs58.encode(pair.publicKey)}`
        };
      },
      callSign: callSignSpy
    };

    await deriveAndSignMessage({
      signer,
      mpcContractId: "v1.signer.testnet",
      publicKeyMethod: "public_key",
      signMethod: "sign",
      accountId: "versioned.testnet",
      message: msg,
      domainId: 1
    });

    expect(callSignSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          request: expect.objectContaining({
            domain_id: 1,
            path: "solana:versioned.testnet",
            payload_v2: expect.objectContaining({
              Eddsa: expect.any(String)
            })
          })
        })
      })
    );
  });
});
