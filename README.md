# NEARena · Blood and Glory

An on-chain gladiator game built for the NEAR Hackathon. All game logic lives in a Rust contract on **NEAR testnet**: players, stats, combat, tournament, economy and NFT items. You can play with a NEAR wallet or with **Phantom** (Solana devnet), thanks to NEAR Chain Signatures. There is also a **NEAR AI bot** that plays on its own through the same public API that human players use.

- Deployed contract: `nearena-v1.testnet` (owner `nearena.testnet`)
- Web: Next.js, "Blood and Gold" visual style
- Status: end-to-end playable MVP on testnet/devnet

## What you can do

- **Register** a gladiator. Every human player starts with 150 GC.
- **Gladiator:** spend stat points on STR / DEX / VIT.
- **Shop and inventory:** buy weapons, shields, armor and potions with GameCoin (GC) or stablecoin (SC), then equip or consume them. Purchases and inventory actions are batched.
- **Arena (PvP):** challenge rivals in your tier. Fights are stored on-chain and can be replayed round by round.
- **Expeditions (PvE):** fight creatures (currently the wolf) for GC, XP and item drops.
- **Tournament:** each contract deployment is one tournament, with points, a leaderboard and a prize pool split among the top 5.
- **NEAR AI bot:** an agent that reads the game state, decides with an LLM from NEAR AI Cloud and signs transactions with its own account.

## Architecture

```
                ┌──────────────────────────┐
  NEAR wallet ─▶│  web/ (Next.js, :3300)   │── reads ─▶ /api/near-rpc or backend /v1/near-rpc ─▶ NEAR RPC
  Phantom ─────▶│                          │── NEAR writes: signed by the player's wallet
                └────────────┬─────────────┘
                             │ Solana players: sign a message with Phantom
                             ▼
                ┌──────────────────────────┐   sign-with-mpc   ┌──────────────────────────┐
                │ backend/ (Node, :8787)   │ ────────────────▶ │ contracts/game (Rust)    │
                │ relayer + faucet + proxy │                   │ nearena-v1.testnet       │
                └──────────────────────────┘                   └──────────────────────────┘
                                                                            ▲
                ┌──────────────────────────┐   txs signed by the bot account
                │ agent/ (NEAR AI bot)     │ ───────────────────────────┘
                └──────────────────────────┘
```

| Folder | What it is | Docs |
| --- | --- | --- |
| `contracts/game` | Main contract (near-sdk 5, Rust): state, combat, tournament, economy, NFTs and expeditions | [contracts/game/README.md](contracts/game/README.md) |
| `web/` | Next.js 15 + React 19 frontend. Login with NEAR wallet selector or Phantom | [web/README.md](web/README.md) |
| `backend/` | Node server: relayer for Solana players (chain signatures), testnet faucet and RPC proxy | [backend/README.md](backend/README.md) |
| `agent/` | Bot that plays with NEAR AI Cloud: LLM tool calling, validator and rule-based fallback | [agent/README.md](agent/README.md) |
| `scripts/` | Chain Signatures spike and ops scripts (testnet deploy and reset) | [scripts/README.md](scripts/README.md) |
| `packages/shared-types/` | Shared TypeScript types | — |

Design decisions are logged in [DECISIONS.md](DECISIONS.md) and fixed bugs in [BUGS.md](BUGS.md).

## Requirements

- Node.js ≥ 20 (22 is used) and npm. This is a monorepo with npm workspaces.
- For the contract:
  - stable Rust with the `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`);
  - [`near-cli-rs`](https://github.com/near/near-cli-rs) (`near`) to deploy and call the contract.
- To play:
  - a NEAR testnet wallet (e.g. Meteor);
  - or Phantom on Solana devnet.

## Running locally

```bash
npm install
```

### 1. Web only (enough to play with a NEAR wallet)

```bash
cp web/.env.example web/.env.local
# To run without the backend, comment out NEXT_PUBLIC_NEAR_RPC_PROXY_PATH:
# the web then uses its own /api/near-rpc proxy.
npm run dev --workspace @gladiator/web     # http://localhost:3300
```

`npm run dev:safe --workspace @gladiator/web` does the same, but if port 3300 is already taken by this project it reuses that server instead of starting another one.

### 2. Backend (needed for Phantom/Solana, the faucet and the external RPC proxy)

The backend **does not load `.env` by itself**: export the variables before starting it.

```bash
cp .env.example .env          # fill in accounts and keys
set -a; source .env; set +a
npm run dev --workspace @gladiator/backend   # http://localhost:8787 (GET /health)
```

It signs with the `near-cli-rs` keychain, so the `SIGNER_ACCOUNT_ID` account must be imported on that machine. On a server, run it with PM2 (`npm run pm2:start`), which does read `.env`. More details in [backend/README.md](backend/README.md).

### 3. NEAR AI bot

```bash
cp agent/.env.example agent/.env   # NEAR_AI_API_KEY, BOT_ACCOUNT_ID, BOT_PRIVATE_KEY
npm run start -w agent -- --dry-run --turns 3   # decides without signing
npm run start -w agent -- --turns 10            # plays for real
```

How to create the bot account and the API key: [agent/README.md](agent/README.md).

### 4. Contract

```bash
cargo test --manifest-path contracts/Cargo.toml -p gladiator-game
cargo build --manifest-path contracts/Cargo.toml -p gladiator-game --target wasm32-unknown-unknown --release
# → contracts/target/wasm32-unknown-unknown/release/gladiator_game.wasm
```

There are two ways to deploy:

- **Code only, keeps the state.** This is the usual path for compatible changes:
  ```bash
  near contract deploy nearena-v1.testnet use-file contracts/target/wasm32-unknown-unknown/release/gladiator_game.wasm \
    without-init-call network-config testnet sign-with-keychain send
  ```
- **Full reset:** `npm run testnet:reset-deploy-game --workspace @gladiator/scripts`.
  - ⚠️ **Wipes all game state**: players, inventories and the tournament.
  - Recreates the contract, initializes it, loads the item catalog and runs a smoke test.

## Quality and CI

```bash
npm run lint            # tsc --noEmit / next lint across all workspaces
npm run test            # vitest (backend, agent, scripts)
npm run test:coverage
cargo test --manifest-path contracts/Cargo.toml -p gladiator-game
cargo clippy --manifest-path contracts/Cargo.toml -p gladiator-game
cargo fmt --manifest-path contracts/Cargo.toml --check
```

- **CI** ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs lint, test and coverage on pushes to `dev` and on PRs to `dev` and `main`.
- **Web deploy** ([deploy-gh-pages.yml](.github/workflows/deploy-gh-pages.yml)): on pushes to `main`, exports the static web to GitHub Pages. It uses the `NEXT_PUBLIC_*` and `GH_PAGES_BASE_PATH` repository variables.

## Environment variables

| File | Used by | Main keys |
| --- | --- | --- |
| `.env` (from [.env.example](.env.example)) | backend, PM2 and ops scripts | `NETWORK_NAME`, `CONTRACT_ACCOUNT_ID`, `SIGNER_ACCOUNT_ID`, `NEAR_MPC_CONTRACT_ID`, `NEAR_RPC_URLS*`, `BACKEND_CORS_ALLOWED_ORIGINS`, `PORT` |
| `web/.env.local` (from [web/.env.example](web/.env.example)) | web | `NEXT_PUBLIC_NEAR_NETWORK_ID`, `NEXT_PUBLIC_NEAR_CONTRACT_ID`, `NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_NEAR_RPC_PROXY_PATH`, `NEAR_RPC_URLS` (server-side proxy) |
| `agent/.env` (from [agent/.env.example](agent/.env.example)) | bot | `NEAR_AI_API_KEY`, `NEAR_AI_MODEL`, `GAME_CONTRACT_ID`, `BOT_ACCOUNT_ID`, `BOT_PRIVATE_KEY`, `NEAR_RPC_URL` |
| `scripts/.env` (from [scripts/.env.example](scripts/.env.example)) | chain signatures spike | `NEAR_SIGNER_ACCOUNT_ID`, `NEAR_SIGNER_PRIVATE_KEY`, `NEAR_MPC_CONTRACT_ID` |

The real `.env` files hold private keys and are never committed.

## Out of scope for the MVP

Auctions, advanced item burning and trading, item upgrades, commit-reveal (only the interface is in place), NEAR Intents, prize pool staking and mainnet.

---

## For AI agents

Before touching code, read `AGENTS.md` (root) and the `AGENTS.md` in the folder you will work in. Operational summary:

**Verified commands**, all from the repo root:

| Goal | Command |
| --- | --- |
| Install | `npm install` |
| Typecheck and lint everything | `npm run lint` |
| TS tests | `npm run test` (or `npm test -w agent`, `-w @gladiator/backend`, `-w @gladiator/scripts`) |
| Web typecheck | `npx tsc --noEmit -p web` |
| Web build | `npm run build --workspace @gladiator/web` |
| Web dev server | `npm run dev --workspace @gladiator/web` (port 3300; run it in the background and stop it when done) |
| Contract tests | `cargo test --manifest-path contracts/Cargo.toml -p gladiator-game` |
| Contract wasm | `cargo build --manifest-path contracts/Cargo.toml -p gladiator-game --target wasm32-unknown-unknown --release` |
| Bot without signing | `npm run start -w agent -- --dry-run --turns 1` (reads testnet; does not need `BOT_PRIVATE_KEY`) |
| Bot without LLM | `npm run start -w agent -- --no-llm --dry-run` |

**Rules:**
- **Commits:** do not commit or push unless explicitly asked. When a block of work is done, propose commits in Conventional Commits format.
- **Bugs:** first write a failing test that reproduces the bug, then fix it. Log bugs in `BUGS.md` and decisions in `DECISIONS.md`.
- **TypeScript:** strict, no `any`, fail-fast.
- **Rust:** must pass `clippy` and `rustfmt`. Some fmt and clippy warnings already exist: do not reformat whole files, only what you change.
- **UI:** never show frontend buttons for features that are not implemented. The web has no tests (`npm test` in web is a placeholder), so validate it with typecheck, lint, build and the dev server.
- **Visual changes:** `web/AGENTS.md` says not to make them without the user's explicit go-ahead and not to copy assets from reference games.

**Dangerous operations: ask for confirmation first.**
- `scripts/ops/reset-deploy-game-testnet.sh` and `empty-state-testnet.sh` **wipe the on-chain state** of the running tournament.
- Deploying the contract or calling owner methods signs with real accounts: it needs the owner account and the user's confirmation.
- `.env`, `agent/.env` and `~/.near-credentials` hold private keys: never print them or send them to external services.

**Useful to know:**
- **Contract changes:** a change to the state layout breaks a code-only deploy. New data uses raw storage keys with their own prefixes (see `is_managed_storage_key` in `contracts/game/src/lib.rs`).
- **Amounts:** fixed point with `SCALE = 1_000_000` (150 GC = `150000000`).
- **Web types:** the contract view types are in `web/lib/near-rpc.ts`. The UI item catalog is in `web/lib/item-catalog.ts`, and the bot keeps a copy of the item ids in `agent/src/game-state.ts`.
- **Web assets:** they go in `web/public/assets/{items,creatures,battle,currency,wallets}`.
  - For a creature's art, add an entry in `web/components/creature-art.tsx`.
  - For its battle video, add an entry in `web/lib/battle-videos.ts`.
- **RPC:** public testnet RPCs sometimes return 429 or 500. The backend and the web rotate through `NEAR_RPC_URLS`, and the bot confirms transactions by hash.
