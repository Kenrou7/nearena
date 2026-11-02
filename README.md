# Gladiator (NEAR Hackathon MVP)

Juego de gladiadores on-chain para NEAR testnet con depósitos desde Solana devnet.

## Estado actual

- [x] Estructura de monorepo
- [x] Reglas de arquitectura y desarrollo (AGENTS.md)
- [x] Spike inicial de Chain Signatures (derivación + firma en Solana)
- [ ] Contrato `game` + NFT y tests
- [ ] Backend watcher/relayer
- [ ] Frontend Next.js
- [ ] Bot NEAR AI

## Estructura

- `contracts/`: contratos Rust (`near-sdk-rs`)
- `web/`: frontend Next.js + TypeScript
- `backend/`: watcher Solana + relayer NEAR
- `agent/`: bot NEAR AI
- `scripts/`: scripts operativos y spikes
- `packages/shared-types/`: tipos compartidos

## Roadmap MVP

1. Spike Chain Signatures (riesgo principal)
2. Contrato game + NFT
3. Backend watcher/relayer
4. Frontend
5. Agent
6. Demo script + deploy

## Fuera de alcance del MVP

- Subastas
- Burn/canje avanzado de items
- Upgrades de items
- Commit-reveal (solo interfaz preparada)
- NEAR Intents
- Staking del pozo
- Mainnet

## Desarrollo

```bash
npm install
npm run lint
npm run test
npm run test:coverage
```

## Spike Chain Signatures

Ver `scripts/README.md`.
