export interface BackendConfig {
  port: number;
  networkName: string;
  signerAccountId: string;
  contractAccountId: string;
  nearMpcContractId: string;
  mpcAdminAccountId: string;
  mpcDerivationPrefix: string;
  mpcPublicKeyMethod: string;
  mpcSignGas: string;
  mpcSignDeposit: string;
  prepaidGas: string;
  attachedDeposit: string;
  implicitAccountFundingNear: string;
  faucetGameCoins: string;
  faucetStablecoins: string;
}

function parsePort(raw: string | undefined): number {
  if (!raw) {
    return 8787;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("PORT must be a positive integer");
  }

  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  const signerAccountId = env.SIGNER_ACCOUNT_ID ?? "nearena.testnet";

  return {
    port: parsePort(env.PORT),
    networkName: env.NETWORK_NAME ?? "testnet",
    signerAccountId,
    contractAccountId: env.CONTRACT_ACCOUNT_ID ?? "nearena-v1.testnet",
    nearMpcContractId: env.NEAR_MPC_CONTRACT_ID ?? "v1.signer-prod.testnet",
    mpcAdminAccountId: env.MPC_ADMIN_ACCOUNT_ID ?? signerAccountId,
    mpcDerivationPrefix: env.MPC_DERIVATION_PREFIX ?? "solana",
    mpcPublicKeyMethod: env.MPC_PUBLIC_KEY_METHOD ?? "derived_public_key",
    mpcSignGas: env.MPC_SIGN_GAS ?? "120 Tgas",
    mpcSignDeposit: env.MPC_SIGN_DEPOSIT ?? "1 yoctonear",
    prepaidGas: env.PREPAID_GAS ?? "100 Tgas",
    attachedDeposit: env.ATTACHED_DEPOSIT ?? "0 NEAR",
    implicitAccountFundingNear: env.IMPLICIT_ACCOUNT_FUNDING_NEAR ?? "0.2 NEAR",
    faucetGameCoins: env.FAUCET_GAME_COINS ?? "500000000",
    faucetStablecoins: env.FAUCET_STABLECOINS ?? "500000000"
  };
}
