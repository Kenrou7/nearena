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

### D-010: Acciones de inventario en lote (`apply_inventory_actions`) y cola de acciones en web

- **Decisión:** agregar `apply_inventory_actions(actions)` al contrato (Equip/Unequip/Consume, hasta 20, en orden, todo-o-nada). Los tokens consumidos se queman recién al final del lote. `equip`, `unequip` y `consume` delegan en esta lógica. Al cerrar el lote se recorta el HP al máximo vigente (antes solo lo hacía `unequip`; ahora también aplica si un `equip` reemplaza gear con más VIT). En web, una cola global de acciones pendientes (inventario + pociones en arena) se aplica con una sola firma; los cambios de equipo se envían antes que los consumos para que las pociones curen hasta el nuevo máximo.
- **Motivo:** equipar y tomar varias pociones requería una firma por acción.
- **Impacto:** el layout de storage no cambia; se redeployó solo el código sobre `nearena-v1.testnet`. La cola vive solo en memoria (no se persiste) y se vacía al cambiar de sesión, porque los token ids quedan obsoletos rápido.

### D-011: Relayer de acciones para jugadores Solana (chain signatures)

- **Decisión:** los jugadores Solana juegan con la cuenta NEAR implícita derivada vía MPC de `(mpcAdminAccountId, "solana:<address>")`. Como esa cuenta la controla el backend (no la clave de Phantom), cada acción se autoriza con un mensaje firmado por Phantom (`NEARena action\n{v, contract, method, args, nonce, issuedAt}`) y el backend la firma vía `sign-with-mpc` en `POST /v1/solana/actions`. Se valida firma ed25519, contrato, allowlist de métodos (`buy_items`, `apply_inventory_actions`, `challenge`, `assign_stat_points`), antigüedad ≤ 5 min y nonce único; las transacciones de una misma cuenta se serializan.
- **Motivo:** Phantom no puede firmar transacciones NEAR; con chain signatures el firmante efectivo es quien llama al contrato MPC.
- **Impacto:** cada acción Solana tarda unos segundos más (firma MPC) y la cuenta derivada paga gas de su fondeo inicial (0.2 NEAR); el gas de lotes bajó a 100 Tgas (medido ~10 Tgas por compra de 2 ítems). Los nonces viven en memoria: un reinicio del backend acepta un mensaje ya usado si aún no venció (ventana de 5 min).

### D-012: Al ganar un desafío, el atacante toma el puesto del defensor y el resto baja uno

- **Decisión:** reemplazar el `swap(attacker, defender)` del ladder por una rotación del tramo `[defender_rank..=attacker_rank]`: el atacante queda en el puesto del defensor y el defensor y todos los intermedios bajan exactamente un puesto. Los puestos fuera de ese tramo no cambian.
- **Motivo:** con el swap, el defensor caía hasta el puesto del atacante (hasta 5 lugares) mientras los intermedios no se movían; la rotación premia al ganador sin castigar de más al perdedor.
- **Impacto:** `challenge` sigue siendo atómico (sin llamadas cross-contract) y recalcula los ranks al ejecutarse, así que no hay problemas de concurrencia: si dos desafíos se cruzan, el segundo opera sobre el ladder ya actualizado o falla por "target must be above attacker / top 5". Hasta 5 jugadores intermedios pueden bajar un puesto sin haber peleado. El storage no cambia; deploy solo de código.

### D-013: Historial de combates on-chain con replay determinístico

- **Decisión:** cada `challenge` guarda un `CombatRecord` compacto: resumen (resultado, GC robado, pozo reclamado, ranks previos, HP inicial/final) más las entradas del combate (`env::random_seed()`, nonce inicial, `combat_config` y stats iniciales de ambos). Las rondas no se guardan: `replay_combat(id)` las recalcula con `simulate_combat`, la misma función pura que usa `challenge`. Cada registro lleva `COMBAT_RULES_VERSION`; si cambian las reglas del combate se sube la versión y los combates viejos quedan como "no replayable", sin perder el resumen. Índice por jugador con ataques y defensas separados, tope de 50 cada uno; un registro se borra cuando ningún participante lo referencia. La web lee el historial del contrato (pestañas Attacks/Defenses, paginado de a 10) y deja de usar `localStorage`; el overlay muestra el combate desde la perspectiva del jugador aunque haya sido el defensor.
- **Motivo:** el historial vivía solo en el navegador del atacante; el defensor nunca se enteraba de que lo habían atacado. Guardar las 10 rondas costaría unos 1 kB por combate (~0.01 NEAR de storage) contra unos 350 bytes (~0.0035 NEAR) con replay. Recuperar el valor de retorno por tx hash no sirve: los nodos no archival lo descartan a los pocos días.
- **Impacto:** las colecciones nuevas usan prefijos propios (`c` registros, `h` índice, `q` contador) fuera de los campos de `GameContract`, así que el layout del estado no cambia: deploy solo de código, sin migración. El storage lo paga el contrato; con el tope por jugador, el crecimiento queda acotado. Los combates previos al deploy no existen on-chain.

### D-014: Expediciones PvE con criaturas como datos y turnos por DEX

- **Decisión:** `start_expedition(creature_id)` enfrenta al jugador con una criatura generada para esa pelea. Las criaturas son datos en `contracts/game/src/creatures.rs` (id, nombre, stats base, puntos por nivel, recompensas por victoria/derrota/empate y tabla de drops en bps). El lobo: nivel del jugador, 4/4/4 + 3 puntos al azar por nivel, HP con la fórmula del jugador, victoria 10 GC + 20 XP, derrota y empate 0 GC + 10 XP, drops 15% / 4% / 1% de poción pequeña / mediana / grande (máximo uno). Sin puntos de torneo. Cada expedición se guarda (últimas 50 por jugador) con los stats que sacó la criatura y se reproduce ronda por ronda con `replay_expedition`. En paralelo, las reglas de combate pasan a v2: en cada ronda pega primero el de más DEX (empate: atacante o jugador), también en la arena.
- **Motivo:** fuente de GC y potions sin depender de otros jugadores, extensible a nuevas criaturas (p. ej. medusa) sin código especial. El orden por DEX se aplica igual en PvP y PvE para que las reglas sean una sola.
- **Impacto:** `simulate_fight` es la única simulación (PvP, PvE, en vivo y en replay); recibe la versión de reglas, así que los combates PvP guardados con v1 siguen reproduciéndose con "atacante primero". El balance estadístico (`long_statistical_combat_sanity`) sigue dentro de su rango con v2. Storage con prefijos propios (`x` registros, `e` índice, `y` contador): deploy solo de código. `start_expedition` se agregó a la allowlist del relayer Solana. Pendiente: el bloqueo "no puede salir mientras trabaja" queda para cuando exista el sistema de trabajo.
