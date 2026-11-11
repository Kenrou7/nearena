# BUGS RESUELTOS

Formato:

- ID:
- Fecha:
- Causa raíz:
- Arreglo aplicado:
- Test que lo cubre:
- Riesgo de regresión:

---

- ID: B-001
- Fecha: 2026-11-02
- Causa raíz: el parser de firmas intentaba base64 antes de base58; algunas firmas base58 válidas quedaban mal decodificadas y resultaban en longitud inválida.
- Arreglo aplicado: ajuste en `decodeSignatureLike` para detectar patrón base58 y priorizar esa decodificación; fallback controlado a base64.
- Test que lo cubre: `parses signature response in base58` en scripts/test/chain-signatures.test.ts
- Riesgo de regresión: bajo, queda cubierto además por casos hex/base64/array/bytes y errores de formato.

- ID: B-002
- Fecha: 2026-11-06
- Causa raíz: `near account delete-account` falla con `whose state is large is temporarily banned` en cuentas con estado acumulado, bloqueando el flujo reset.
- Arreglo aplicado: hardening de `scripts/ops/reset-deploy-game-testnet.sh` con política `ON_DELETE_BAN` y modo `cleanup`; agregado de cleanup on-chain por lotes con `empty_state_delete_keys` y `empty_state_finalize`, y script operativo `scripts/ops/empty-state-testnet.sh`.
- Test que lo cubre: validación manual en testnet con dry-run de llaves, deploy sin delete para habilitar métodos, cleanup real, delete exitoso y recreación de cuenta.
- Riesgo de regresión: medio; depende de rate limits RPC y del ownership correcto para ejecutar mantenimiento.

- ID: B-003
- Fecha: 2026-11-11
- Causa raíz: `owned_item_ids` contiene una entrada por unidad comprada (el contrato hace `push` en cada mint), pero la tienda renderizaba un chip por entrada usando `item-${itemId}` como key; al comprar dos veces el mismo item React reportaba keys duplicadas. El inventario mostraba una tarjeta por token, duplicando items repetidos.
- Arreglo aplicado: helper `countOwnedItems` en `web/lib/owned-items.ts`; la tienda muestra un chip por item con `×N`, y el inventario agrupa tokens por `item_id` en una sola tarjeta con badge `×N` (consumir usa cualquier unidad, equipar prefiere una no equipada).
- Test que lo cubre: pendiente; `web` aún no tiene test runner (`"test": "echo \"web tests pending\""`). Validación manual comprando dos Large Potion.
- Riesgo de regresión: bajo; la agrupación es solo de presentación y las acciones siguen operando sobre token IDs reales.
