# game contract

Estado inicial del contrato principal del juego.

Incluye en esta iteracion:

- inicializacion con owner y relayer
- configuracion de balance centralizada
- registro de jugador con stats iniciales
- monedas iniciales: todo jugador humano empieza con 150 GC (`HUMAN_STARTING_GAME_COINS`), tanto al registrarse como si lo crea un `credit_deposit`; los fantasmas siguen con 500 GC
  - `grant_starting_game_coins()` (owner, idempotente): suma 150 GC a los humanos que todavía no los recibieron (registrados antes de este cambio) y devuelve cuántos acreditó; la marca por jugador vive en claves `g{account_id}` fuera del estado, así que es deploy solo de código
- credit_deposit con control de acceso e idempotencia por tx_ref
- catalogo de items basicos administrado por owner
- compra de item con moneda del juego (`buy_item_with_game_coin`)
- compra de item con stablecoin (`buy_item`) con split 90/10 a pozo/tesoreria
- compra múltiple en una sola transacción (`buy_items`): líneas `{ item_id, quantity, currency: "Stablecoin" | "GameCoin" }`, hasta 20 unidades, todo-o-nada (valida todas las líneas y ambos saldos antes de mutar estado); devuelve los token ids minteados
- acciones de inventario en lote (`apply_inventory_actions`): `[{ "type": "Equip", "token_id" } | { "type": "Unequip", "slot" } | { "type": "Consume", "token_id" }]`, hasta 20, aplicadas en orden y todo-o-nada; `equip`, `unequip` y `consume` delegan en la misma lógica
- mint interno de token por item comprado
- `equip(token_id)` y `unequip(slot)`
- vistas base de jugador y configuracion
- historial de combates on-chain: cada `challenge` guarda un resumen compacto (resultado, GC robado, pozo, ranks previos, HP) más la semilla, el nonce inicial, la `combat_config` y los stats iniciales; `challenge` devuelve `combat_id`
  - `get_combat_history(account_id, role: "Attacks" | "Defenses", from_index?, limit?)` → `{ total, items }`, más nuevo primero, de a 10 por defecto (máx. 50)
  - `get_combat(combat_id)` → resumen
  - `replay_combat(combat_id)` → `ChallengeResult` completo (10 rondas) recalculado con la misma función pura `simulate_combat` que usa `challenge`; falla si el combate es de otra `rules_version` o si el replay no coincide con el resultado guardado
  - tope de 50 ataques y 50 defensas por jugador; un registro se borra cuando ya no lo referencia ningún participante
- orden de turnos (reglas de combate v2): en cada ronda pega primero el de más DEX (empate: el atacante); los combates guardados con v1 (atacante siempre primero) se siguen pudiendo reproducir con sus reglas
- expediciones PvE (`start_expedition(creature_id)`): las criaturas son datos en `src/creatures.rs` (id, nombre, stats base, puntos por nivel, recompensas por resultado y tabla de drops en bps); agregar una criatura es sumar una entrada
  - la criatura tiene el nivel del jugador; sus puntos (`points_per_level` × nivel) se reparten al azar en cada pelea con el mismo azar del combate (semilla del bloque + cuenta + id de criatura + nonce)
  - mismas reglas de combate que la arena; consume HP; requiere ≥ 20% del HP máximo efectivo; no da puntos de torneo; drops solo en victoria y como máximo uno
  - `get_creatures()`, `get_expedition_history(account_id, from_index?, limit?)` y `replay_expedition(expedition_id)`; se guardan las últimas 50 por jugador con los stats que sacó la criatura
- torneo: cada contrato es un torneo. `new(owner_id, relayer_account_id, stable_token_contract_id, combat_config?, tournament_start_sec?, tournament_end_sec?)`; sin fechas, empieza al inicializar y dura 28 días
  - fuera de `[inicio, fin)` fallan todas las escrituras de jugador y relayer (registro, stats, compras, inventario, claim del 1.º, arena, expediciones, depósitos, donaciones) con un único guard; el mantenimiento del owner sigue disponible y las vistas siempre funcionan
  - puntos: victoria 3 × m (m = Nr/Np entre 0,25 y 2), empate 1, derrota 0, 1.º de cada tier 1 por hora (perezoso); expediciones y fantasmas no suman
  - `get_tournament_view()`: inicio, fin, hora del bloque, si terminó, pozo (grand pot) y reparto de premios en bps (5000/2500/1333/667/500)
  - `get_leaderboard(limit?, account_id?)`: humanos ordenados por puntos efectivos (acreditados + ingreso pendiente del 1.º hasta el fin), desempate por quien llegó primero al puntaje y luego por account_id; incluye el puesto de `account_id` aunque esté fuera del top

## tests

Ejecutar:

cargo test -p gladiator-game
