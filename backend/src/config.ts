export interface BackendConfig {
  port: number;
  networkName: string;
  nearRpcUrls: string[];
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

function parseCsv(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function defaultRpcUrlsForNetwork(networkName: string): string[] {
  if (networkName === "testnet") {
    return [
      "https://near-testnet.drpc.org",
      "https://rpc.testnet.near.org",
      "https://test.rpc.fastnear.com",
      "https://archival-rpc.testnet.near.org"
    ];
  }

  return [
    "https://near.drpc.org",
    "https://rpc.mainnet.near.org",
    "https://free.rpc.fastnear.com",
    "https://archival-rpc.mainnet.near.org"
  ];
}

function resolveNearRpcUrls(env: NodeJS.ProcessEnv, networkName: string): string[] {
  const fromNetworkList =
    networkName === "testnet" ? parseCsv(env.NEAR_RPC_URLS_TESTNET) : parseCsv(env.NEAR_RPC_URLS_MAINNET);
  const fromGlobalList = parseCsv(env.NEAR_RPC_URLS);
  const fromSingle = parseCsv(env.NEAR_RPC_URL);
  const withDefaults = defaultRpcUrlsForNetwork(networkName);

  return Array.from(new Set([...fromNetworkList, ...fromGlobalList, ...fromSingle, ...withDefaults]));
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
  const networkName = env.NETWORK_NAME ?? "testnet";
  const signerAccountId = env.SIGNER_ACCOUNT_ID ?? "nearena.testnet";

  return {
    port: parsePort(env.PORT),
    networkName,
    nearRpcUrls: resolveNearRpcUrls(env, networkName),
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
