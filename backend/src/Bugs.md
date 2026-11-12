Bugs

- Al llegar al puesto 1, no obtuve lo que había en el pozo
- En /gladiator, la sección de inventory se ve fea. Hacer mejor o eliminar. Fijarse si tiene sentido reemplazarla con algo o como dejar /gladiator para que se vea bien

Mejoras

- Registro Solana más robusto: antes de fondear la cuenta derivada, chequear su saldo y fondear solo si hace falta (hoy un reintento tras fallar `register_player` vuelve a mandar 0.2 NEAR); serializar registros por dirección; botón "Retry" en el navbar cuando falla el setup del jugador Solana (hoy hay que recargar o reconectar Phantom)
- Gas de jugadores Solana pagado en SOL: hoy la cuenta NEAR derivada recibe 0.2 NEAR del backend al registrarse (~70-200 acciones) y nadie la recarga; si se queda sin saldo, las acciones fallan con "insufficient balance to cover TX cost". A futuro: cuando el saldo de la cuenta derivada baje de un umbral, pedirle al jugador una transferencia de SOL firmada con Phantom a una treasury, verificarla en el backend (watcher, idempotente por tx) y usar ese SOL para comprar NEAR y recargar la cuenta derivada. Definir tipo de cambio SOL/NEAR (fijo o por oráculo/precio de mercado) y un margen

Pendientes

- Implementar ranking. Verificar que se otorgan puntos como corresponde.
