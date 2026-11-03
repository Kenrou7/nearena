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
- mint interno de token por item comprado
- `equip(token_id)` y `unequip(slot)`
- vistas base de jugador y configuracion

## tests

Ejecutar:

cargo test -p gladiator-game
