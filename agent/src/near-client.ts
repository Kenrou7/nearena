import { KeyPair, Near, keyStores, transactions, utils, type Account } from "near-api-js";

import type { CallOutcome, ContractCall, GameClient } from "./game-client.js";
import { createJsonRpc, sendAndConfirm, type JsonRpc } from "./tx-sender.js";

type FunctionCallAction = ReturnType<typeof transactions.functionCall>;
type SignedTx = { encode(): Uint8Array };

/**
 * near-api-js signing (nonce cache, recent block hash) without its blocking send. The method
 * exists at runtime but is `protected` in the typings, hence the narrow structural cast.
 */
function signFunctionCall(account: Account, receiverId: string, action: FunctionCallAction): Promise<[Uint8Array, SignedTx]> {
  const signer = account as unknown as {
    signTransaction(receiverId: string, actions: FunctionCallAction[]): Promise<[Uint8Array, SignedTx]>;
  };
  return signer.signTransaction(receiverId, [action]);
}

/**
 * `GameClient` over NEAR RPC. Views go through near-api-js; calls are signed locally and sent
 * with `sendAndConfirm`, which survives RPC proxies that time out long `send_tx` requests.
 */
export class NearGameClient implements GameClient {
  private readonly accountPromise: Promise<Account>;
  private readonly rpc: JsonRpc;

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
    this.rpc = createJsonRpc(input.rpcUrl);
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
    const [hash, signedTx] = await signFunctionCall(
      account,
      this.input.contractId,
      transactions.functionCall(call.methodName, call.args, call.gas, 0n),
    );
    return sendAndConfirm({
      rpc: this.rpc,
      signedTxBase64: Buffer.from(signedTx.encode()).toString("base64"),
      txHash: utils.serialize.base_encode(hash),
      signerId: this.input.accountId,
    });
  }
}
