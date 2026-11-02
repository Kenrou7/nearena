import { Near, keyStores, KeyPair } from "near-api-js";

import type { ChainSigner } from "./chain-signatures.js";

export class NearChainSigner implements ChainSigner {
  private readonly accountPromise: Promise<import("near-api-js").Account>;

  public constructor(input: {
    rpcUrl: string;
    networkId: string;
    signerAccountId: string;
    signerPrivateKey: string;
  }) {
    const keyStore = new keyStores.InMemoryKeyStore();
    const keyPair = KeyPair.fromString(input.signerPrivateKey);

    this.accountPromise = (async () => {
      await keyStore.setKey(input.networkId, input.signerAccountId, keyPair);
      const near = new Near({
        networkId: input.networkId,
        nodeUrl: input.rpcUrl,
        deps: { keyStore },
        headers: {}
      });
      return near.account(input.signerAccountId);
    })();
  }

  public async viewPublicKey(input: {
    contractId: string;
    methodName: string;
    args: Record<string, unknown>;
  }): Promise<unknown> {
    const account = await this.accountPromise;

    return account.viewFunction({
      contractId: input.contractId,
      methodName: input.methodName,
      args: input.args
    });
  }

  public async callSign(input: {
    contractId: string;
    methodName: string;
    args: Record<string, unknown>;
  }): Promise<unknown> {
    const account = await this.accountPromise;

    const outcome = await account.functionCall({
      contractId: input.contractId,
      methodName: input.methodName,
      args: input.args,
      gas: BigInt("120000000000000"),
      attachedDeposit: BigInt(1)
    });

    const successValueBase64 = outcome.status.SuccessValue;
    if (typeof successValueBase64 === "string" && successValueBase64.length > 0) {
      const decoded = Buffer.from(successValueBase64, "base64").toString("utf8");
      try {
        return JSON.parse(decoded) as unknown;
      } catch {
        return decoded;
      }
    }

    return outcome;
  }
}
