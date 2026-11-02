# AGENTS.md (root)

## Objetivo del repositorio

Construir un MVP jugable de gladiadores para la NEAR Hackathon (testnet/devnet), priorizando demo end-to-end funcional.

## Arquitectura

- `contracts/`: lógica on-chain principal (estado de jugadores, combate, torneo, economía, NFTs).
- `backend/`: watcher de depósitos SPL en Solana devnet + relayer autorizado a NEAR.
- `web/`: experiencia del jugador con login NEAR/Phantom y acciones sobre `game`.
- `agent/`: bot NEAR AI que juega usando la misma API del contrato.
- `scripts/`: tooling operativo y spikes de riesgo.
- `packages/shared-types/`: tipos compartidos TS para web/backend/agent/scripts.

## Convenciones clave

- Fail-fast: validar temprano y fallar explícito.
- TypeScript estricto (`strict: true`, sin `any`).
- Rust con `clippy` y `rustfmt` obligatorios.
- Tests primero para bugs: reproducir en test rojo, arreglar, test verde.
- No exponer en frontend botones de funciones no implementadas.

## Flujo de trabajo

1. Implementar por iteraciones verticales (contract + backend + web para una capacidad completa).
2. Cerrar cada bloque con:
   - tests verdes,
   - pasos de prueba manual,
   - propuesta de commits Conventional Commits (no commitear automático).
3. Registrar decisiones en `DECISIONS.md`.
4. Registrar bugs resueltos en `BUGS.md`.

## CI

Corre en:

- push a `dev`
- PRs hacia `dev` y `main`

Incluye lint, tests y cobertura mínima; si falla algo, falla CI.
