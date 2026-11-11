# game contract

Estado inicial del contrato principal del juego.

Incluye en esta iteracion:

- inicializacion con owner y relayer
- configuracion de balance centralizada
- registro de jugador con stats iniciales
- credit_deposit con control de acceso e idempotencia por tx_ref
- catalogo de items basicos administrado por owner
- compra de item con moneda del juego (`buy_item_with_game_coin`)
- compra de item con stablecoin (`buy_item`) con split 90/10 a pozo/tesoreria
- compra múltiple en una sola transacción (`buy_items`): líneas `{ item_id, quantity, currency: "Stablecoin" | "GameCoin" }`, hasta 20 unidades, todo-o-nada (valida todas las líneas y ambos saldos antes de mutar estado); devuelve los token ids minteados
- acciones de inventario en lote (`apply_inventory_actions`): `[{ "type": "Equip", "token_id" } | { "type": "Unequip", "slot" } | { "type": "Consume", "token_id" }]`, hasta 20, aplicadas en orden y todo-o-nada; `equip`, `unequip` y `consume` delegan en la misma lógica
- mint interno de token por item comprado
- `equip(token_id)` y `unequip(slot)`
- vistas base de jugador y configuracion

## tests

Ejecutar:

cargo test -p gladiator-game
