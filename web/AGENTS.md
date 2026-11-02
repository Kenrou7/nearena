# AGENTS.md (web)

## Especialidad

Next.js + TypeScript + wallet selector (NEAR) + Phantom adapter.

## Guía de diseño

- Base: Tailwind + shadcn/ui + Framer Motion.
- Estilo: moderno, divertido y legible; priorizar claridad funcional.
- Evitar botones muertos: ocultar o marcar como "Proximamente".

## Reglas técnicas

- UI reactiva a estado on-chain real.
- Manejo de errores visible al usuario (toasts/alerts).
- Mantener tipado estricto de contratos y API.

## Testing

- Unit tests para hooks de estado y utilidades de formato.
- Integration tests para flujos de compra/equip/combate con mocks.
