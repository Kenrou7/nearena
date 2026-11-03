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

export interface CreateSolanaDerivedPlayerRequest {
  solanaAddress?: string;
}

export interface DerivationProof {
  solanaAddress: string;
  derivationPath: string;
  mpcDerivedPublicKey: string;
  implicitNearAccountId: string;
  txSigner: string;
  match: boolean;
}

export interface CreateSolanaDerivedPlayerResponse {
  contractAccountId: string;
  playerAccountId: string;
  alreadyRegistered: boolean;
  fundingTxHash: string | null;
  registerPlayerTxHash: string | null;
  proof: DerivationProof;
}
