import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadConfig, parseFlags } from "./config.js";
import { runLoop } from "./loop.js";
import { NearAiLlm } from "./near-ai-llm.js";
import { NearGameClient } from "./near-client.js";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const config = loadConfig(process.env, parseFlags(process.argv.slice(2)));

const game = new NearGameClient({
  rpcUrl: config.rpcUrl,
  networkId: config.networkId,
  contractId: config.contractId,
  accountId: config.accountId,
  privateKey: config.privateKey,
});
const llm = config.nearAi === null ? null : new NearAiLlm(config.nearAi);

const records = await runLoop({
  game,
  llm,
  accountId: config.accountId,
  turns: config.turns,
  turnDelayMs: config.turnDelayMs,
  dryRun: config.dryRun,
  log: (line) => console.log(line),
});

const byLlm = records.filter((record) => record.source === "llm").length;
console.log(`done: ${records.length} turns (${byLlm} decided by NEAR AI, ${records.length - byLlm} by fallback rules)`);
