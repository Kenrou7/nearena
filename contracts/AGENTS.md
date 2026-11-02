# AGENTS.md (contracts)

## Especialidad

Rust + `near-sdk-rs` para lógica del juego y Chain Signatures.

## Reglas

- Fail-fast con `require!` y `panic_str` cuando corresponda.
- Modelar estado explícito y serializable con Borsh/JSON.
- Aislar fórmulas de combate en funciones puras testeables.
- Evitar magia: parámetros de balance en config mutable por owner.

## Testing

- Unit tests de cálculos (hit chance, daño, XP, vida, puntos torneo).
- Tests de integración para métodos públicos clave.
- Cada bug nuevo debe entrar primero como test rojo.
