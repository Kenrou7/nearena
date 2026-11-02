# AGENTS.md (agent)

## Especialidad

Bot NEAR AI que juega usando la misma interfaz del contrato `game`.

## Reglas

- El bot nunca usa métodos privilegiados.
- Logs legibles por paso: comprar, equipar, pelear, subir nivel.
- Estrategia simple y determinista para MVP.

## Testing

- Unit tests de decisiones de estrategia.
- Smoke test que ejecute un ciclo corto completo con mocks.
