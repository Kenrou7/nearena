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

## 2026-11-06

### D-006: Estrategia de reset en testnet con cleanup previo a delete

- **Decisión:** mantener el flujo `delete + redeploy` en testnet, pero cuando NEAR bloquee delete por estado grande, ejecutar cleanup on-chain por lotes y reintentar delete.
- **Motivo:** evitar migraciones durante iteración rápida de MVP y reducir bloqueos operativos por políticas de red.
- **Impacto:** se agregan métodos de mantenimiento en contrato (`empty_state_delete_keys`, `empty_state_finalize`) con guardas estrictas (owner + cuenta `.testnet`) y soporte en script `ON_DELETE_BAN=cleanup`.

## 2026-11-07

### D-007: Pot real on-chain + metadata centralizada de ítems en frontend

- **Decisión:** exponer `get_grand_pot` en contrato para obtener el grand pot global en stables (USD), separado del pot por tiers; centralizar nombres/imagenes/rol de ítems en un catálogo compartido del frontend.
- **Motivo:** evitar divergencia entre UI y estado real on-chain, y separar claramente economía global (stables) de economía competitiva por tier (game coin).
- **Impacto:** home muestra grand pot real en stables, equipamiento muestra nombre legible de objeto (no solo token id), y shop/inventory comparten visualización de stats de ítems.

## 2026-11-11

### D-008: Estilo visual definitivo "Blood and Gold"

- **Decisión:** adoptar el Estilo C (Blood and Gold) como único tema; sus tokens pasan a `:root` en `web/app/globals.css` y se eliminan los temas Grim Arena y Clean Spire junto con el selector de tema de desarrollo.
- **Motivo:** elección de Dani tras comparar los tres estilos en las mismas pantallas.
- **Impacto:** un solo set de tokens (colores, tipografías, radios, sombras); el header se simplifica a una barra única (marca → home, links, balances + wallet).

### D-009: Compra múltiple (`buy_items`) y carrito global en web

- **Decisión:** agregar `buy_items(lines)` al contrato, con líneas `{ item_id, quantity, currency }` que pueden mezclar Stablecoin y GameCoin en la misma transacción, con tope de 20 unidades (`MAX_ITEMS_PER_PURCHASE`). `buy_item` y `buy_item_with_game_coin` pasan a delegar en la misma lógica interna. En web, un carrito global (persistido en `localStorage`) reemplaza la compra inmediata en shop y arena.
- **Motivo:** comprar varias pociones/ítems requería una firma por unidad; con el carrito se firma una sola vez.
- **Impacto:** la compra es todo-o-nada (se validan líneas y saldos antes de mutar estado). El cambio no altera el layout de storage, así que se redeployó solo el código sobre `nearena-v1.testnet` sin borrar la cuenta ni migrar.
