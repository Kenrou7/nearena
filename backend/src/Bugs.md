Bugs

- Al llegar al puesto 1, no obtuve lo que había en el pozo

Mejoras

- El combate tiene que quedan en la blockchain. Me da la sensación de que está guardandose en localStorage o algo así. Que al tener un combate, que se agregue en un objeto por los participantes, en dos arrays distintos y que se traigan de a 10 o lo que una llamada diga
- Registro Solana más robusto: antes de fondear la cuenta derivada, chequear su saldo y fondear solo si hace falta (hoy un reintento tras fallar `register_player` vuelve a mandar 0.2 NEAR); serializar registros por dirección; botón "Retry" en el navbar cuando falla el setup del jugador Solana (hoy hay que recargar o reconectar Phantom)
- Gas de jugadores Solana pagado en SOL: hoy la cuenta NEAR derivada recibe 0.2 NEAR del backend al registrarse (~70-200 acciones) y nadie la recarga; si se queda sin saldo, las acciones fallan con "insufficient balance to cover TX cost". A futuro: cuando el saldo de la cuenta derivada baje de un umbral, pedirle al jugador una transferencia de SOL firmada con Phantom a una treasury, verificarla en el backend (watcher, idempotente por tx) y usar ese SOL para comprar NEAR y recargar la cuenta derivada. Definir tipo de cambio SOL/NEAR (fijo o por oráculo/precio de mercado) y un margen

Pendientes

- Incluir PvE contra lobo. El lobo tiene stats aleatorias. Uno siempre pelea contra un lobo de su propio nivel. El lobo de propio nivel es como un gladiador de 1 nivel superior sin equipamiento con stats aleatorias y 1/4 de la vida del gladiador de esos stats. Si en 10 rondas no se lleva al lobo a 0 de vida, se pierde
- Implementar ranking. Verificar que se otorgan puntos como corresponde.
