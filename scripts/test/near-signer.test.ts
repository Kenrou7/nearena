import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSetKey = vi.fn(async () => undefined);
const mockViewFunction = vi.fn(async () => ({ public_key: "ed25519:abc" }));
const mockFunctionCall = vi.fn(async () => ({ status: { SuccessValue: "" } }));

const mockAccount = {
  viewFunction: mockViewFunction,
  functionCall: mockFunctionCall
};

const mockNearAccountMethod = vi.fn(async () => mockAccount);

vi.mock("near-api-js", () => {
  class MockNear {
    public async account(): Promise<typeof mockAccount> {
      return mockNearAccountMethod();
    }
  }

  return {
    Near: MockNear,
    keyStores: {
      InMemoryKeyStore: class {
        public async setKey(): Promise<void> {
          await mockSetKey();
        }
      }
    },
    KeyPair: {
      fromString: vi.fn(() => ({ secretKey: "mock" }))
    }
  };
});

import { NearChainSigner } from "../src/near-signer.js";

describe("NearChainSigner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls view function with contract method and args", async () => {
    const signer = new NearChainSigner({
      rpcUrl: "https://rpc.testnet.near.org",
      networkId: "testnet",
      signerAccountId: "relayer.testnet",
      signerPrivateKey: "ed25519:private"
    });

    const result = await signer.viewPublicKey({
      contractId: "mpc.testnet",
      methodName: "public_key",
      args: { path: "solana:alice.testnet" }
    });

    expect(mockSetKey).toHaveBeenCalledTimes(1);
    expect(mockNearAccountMethod).toHaveBeenCalledTimes(1);
    expect(mockViewFunction).toHaveBeenCalledWith({
      contractId: "mpc.testnet",
      methodName: "public_key",
      args: { path: "solana:alice.testnet" }
    });
    expect(result).toEqual({ public_key: "ed25519:abc" });
  });

  it("parses json from SuccessValue", async () => {
    mockFunctionCall.mockResolvedValueOnce({
      status: {
        SuccessValue: Buffer.from(JSON.stringify({ signature: "sig-base64" }), "utf8").toString(
          "base64"
        )
      }
    });

    const signer = new NearChainSigner({
      rpcUrl: "https://rpc.testnet.near.org",
      networkId: "testnet",
      signerAccountId: "relayer.testnet",
      signerPrivateKey: "ed25519:private"
    });

    const result = await signer.callSign({
      contractId: "mpc.testnet",
      methodName: "sign",
      args: { payload: "deadbeef" }
    });

    expect(result).toEqual({ signature: "sig-base64" });
  });

  it("returns raw decoded string when SuccessValue is not json", async () => {
    mockFunctionCall.mockResolvedValueOnce({
      status: {
        SuccessValue: Buffer.from("plain-text", "utf8").toString("base64")
      }
    });

    const signer = new NearChainSigner({
      rpcUrl: "https://rpc.testnet.near.org",
      networkId: "testnet",
      signerAccountId: "relayer.testnet",
      signerPrivateKey: "ed25519:private"
    });

    const result = await signer.callSign({
      contractId: "mpc.testnet",
      methodName: "sign",
      args: { payload: "bead" }
    });

    expect(result).toBe("plain-text");
  });

  it("returns full outcome when SuccessValue is empty", async () => {
    const outcome = { status: { SuccessValue: "" }, transaction: { hash: "abc" } };
    mockFunctionCall.mockResolvedValueOnce(outcome);

    const signer = new NearChainSigner({
      rpcUrl: "https://rpc.testnet.near.org",
      networkId: "testnet",
      signerAccountId: "relayer.testnet",
      signerPrivateKey: "ed25519:private"
    });

    const result = await signer.callSign({
      contractId: "mpc.testnet",
      methodName: "sign",
      args: { payload: "cafe" }
    });

    expect(result).toEqual(outcome);
  });
});
