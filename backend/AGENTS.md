# AGENTS.md (backend)

## Especialidad

Node.js + TypeScript para watcher Solana devnet y relayer a NEAR testnet.

## Reglas

- Idempotencia estricta por `tx_ref`.
- Confirmaciones explícitas antes de acreditar depósitos.
- Reintentos acotados con backoff y logging estructurado.
- No usar `any`; validar payloads de entrada.

## Testing

- Unit tests para parseo de eventos y deduplicación.
- Integration tests con mocks de RPC NEAR/Solana.
