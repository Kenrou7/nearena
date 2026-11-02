# AGENTS.md (scripts)

## Especialidad

Scripts operativos para deploy, verificaciones y spikes técnicos.

## Reglas

- Scripts idempotentes cuando sea posible.
- Validar env vars al inicio y fallar rápido.
- Mensajes de consola claros y accionables.

## Objetivo actual

- Spike de Chain Signatures:
  - derivar dirección de Solana por cuenta NEAR,
  - solicitar firma al contrato MPC testnet,
  - validar formato de salida y serialización de transacción.
