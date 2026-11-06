# DECISIONS

## 2026-11-02

### D-001: Monorepo con npm workspaces

- **Decisión:** usar npm workspaces para `web`, `backend`, `agent`, `scripts`, `packages/shared-types`.
- **Motivo:** setup simple y rápido para MVP; evita sobrecarga de tooling adicional.
- **Impacto:** comandos de lint/test centralizados en raíz.

### D-002: Priorizar spike Chain Signatures antes del contrato game

- **Decisión:** implementar primero scripts de derivación de dirección Solana y firma vía MPC testnet.
- **Motivo:** es el riesgo técnico principal del alcance multichain.
- **Impacto:** valida viabilidad antes de invertir en features dependientes.

### D-003: NFT integrado en el contrato game (MVP)

- **Decisión:** para el MVP, iniciar con NFT integrado lógicamente dentro de `game` (sin separar contrato adicional), con posibilidad de extraer luego.
- **Motivo:** reduce complejidad operativa y de despliegue en hackathon.
- **Impacto:** implementación más rápida; posible refactor futuro hacia NEP-171 desacoplado.

## 2026-11-03

### D-004: Onboarding Solana->MPC expuesto desde backend

- **Decisión:** exponer `POST /v1/players/solana-derived` en backend para derivar cuenta implícita NEAR desde address Solana y ejecutar `register_player` vía `sign-with-mpc`.
- **Motivo:** mantener custodias y operaciones sensibles fuera del frontend, y centralizar retries/backoff/idempotencia.
- **Impacto:** frontend consume una API simple con respuesta verificable (`proof.match`) y hashes de tx on-chain.

## 2026-11-04

### D-005: Evaluación de estilos visuales NEARena (pendiente de elección)

- **Decisión:** se abren tres estilos en evaluación para la interfaz de NEARena: `Grim Arena` (A), `Clean Spire` (B) y `Blood and Gold` (C).
- **Estado:** pendiente de elección final por Dani antes de implementar cambios visuales en código.
- **Motivo:** validar dirección artística antes de invertir en implementación de temas/tokens y evitar retrabajo.
- **Impacto:** hasta confirmación explícita, se mantiene el estilo actual y solo se conserva guía de diseño en documentación.
