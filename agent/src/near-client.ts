import { KeyPair, Near, keyStores, type Account } from "near-api-js";

import type { CallOutcome, ContractCall, GameClient } from "./game-client.js";

/** `GameClient` over near-api-js; same pattern as scripts/src/near-signer.ts. */
export class NearGameClient implements GameClient {
  private readonly accountPromise: Promise<Account>;

  public constructor(
    private readonly input: {
      rpcUrl: string;
      networkId: string;
      contractId: string;
      accountId: string;
      /** Without a key the client is read-only (dry runs). */
      privateKey: string | null;
    },
  ) {
    const keyStore = new keyStores.InMemoryKeyStore();
    this.accountPromise = (async () => {
      if (input.privateKey !== null) {
        // KeyPair.fromString expects the `ed25519:...` template-literal type.
        await keyStore.setKey(input.networkId, input.accountId, KeyPair.fromString(input.privateKey as `ed25519:${string}`));
      }
      const near = new Near({ networkId: input.networkId, nodeUrl: input.rpcUrl, deps: { keyStore }, headers: {} });
      return near.account(input.accountId);
    })();
  }

  public async view<T>(methodName: string, args: Record<string, unknown>): Promise<T> {
    const account = await this.accountPromise;
    return (await account.viewFunction({ contractId: this.input.contractId, methodName, args })) as T;
  }

  public async call(call: ContractCall): Promise<CallOutcome> {
    if (this.input.privateKey === null) {
      throw new Error("NearGameClient: cannot sign without BOT_PRIVATE_KEY");
    }
    const account = await this.accountPromise;
    const outcome = await account.functionCall({
      contractId: this.input.contractId,
      methodName: call.methodName,
      args: call.args,
      gas: call.gas,
      attachedDeposit: 0n,
    });

    const status = outcome.status;
    const successValue = typeof status === "object" && "SuccessValue" in status ? status.SuccessValue : undefined;
    let result: unknown = null;
    if (typeof successValue === "string" && successValue.length > 0) {
      const decoded = Buffer.from(successValue, "base64").toString("utf8");
      try {
        result = JSON.parse(decoded) as unknown;
      } catch {
        result = decoded;
      }
    }
    return { txHash: outcome.transaction_outcome.id, result };
  }
}
