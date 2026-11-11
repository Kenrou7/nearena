Bugs

- Si en un combate mi vida llega a 0, sigue peleando y compara por daño hecho. Incluso reporta "Skipped (combat already resolved)" teniendo yo 0 de vida y me la da por ganada
- Al llegar al puesto 1, no obtuve lo que había en el pozo

Mejoras

- El combate tiene que quedan en la blockchain. Me da la sensación de que está guardandose en localStorage o algo así. Que al tener un combate, que se agregue en un objeto por los participantes, en dos arrays distintos y que se traigan de a 10 o lo que una llamada diga
- Registro Solana más robusto: antes de fondear la cuenta derivada, chequear su saldo y fondear solo si hace falta (hoy un reintento tras fallar `register_player` vuelve a mandar 0.2 NEAR); serializar registros por dirección; botón "Retry" en el navbar cuando falla el setup del jugador Solana (hoy hay que recargar o reconectar Phantom)

Pendientes

- Incluir PvE contra lobo. El lobo tiene stats aleatorias. Uno siempre pelea contra un lobo de su propio nivel. El lobo de propio nivel es como un gladiador de 1 nivel superior sin equipamiento con stats aleatorias y 1/4 de la vida del gladiador de esos stats. Si en 10 rondas no se lleva al lobo a 0 de vida, se pierde
- Implementar ranking. Verificar que se otorgan puntos como corresponde.
