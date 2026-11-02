export type SupportedChain = "near" | "solana";

export interface CreditDepositInput {
  accountId: string;
  amountAtomic: string;
  chain: SupportedChain;
  txRef: string;
}

export interface ChainSignatureRequest {
  accountId: string;
  derivationPath: string;
  payloadHex: string;
}
