Bugs

- Si en un combate mi vida llega a 0, sigue peleando y compara por daño hecho. Incluso reporta "Skipped (combat already resolved)" teniendo yo 0 de vida y me la da por ganada
- Cuando se vence a un rival, se hace un swap. Si no es mucho problema, debería ponerme en su lugar y bajar a los correspondientes 1 puesto
- Al llegar al puesto 1, no obtuve lo que había en el pozo

Mejoras

- Hacer que en la arena, las otras cuentas muestren las stats cuando se le hace click o al menos tener una comparativa
- El combate tiene que quedan en la blockchain. Me da la sensación de que está guardandose en localStorage o algo así. Que al tener un combate, que se agregue en un objeto por los participantes, en dos arrays distintos y que se traigan de a 10 o lo que una llamada diga
- Cuando hay un overlay de combate, cerrar el overlay al clickear afuera. Asegurarse que el Close esté siempre visible y no haya que scrollean
- Asignarle a los ghosts 500 gc al crearse para poder probar el robo de tokens
- En la arena, permitir hacer click sobre un usuario y ver sus stats
- Tener en algún lado una vista reducida de la arena y pociones para poder consumirlas y luchar más rápidamente

Pendientes

- Incluir PvE contra lobo. El lobo tiene stats aleatorias. Uno siempre pelea contra un lobo de su propio nivel. El lobo de propio nivel es como un gladiador de 1 nivel superior sin equipamiento con stats aleatorias y 1/4 de la vida del gladiador de esos stats. Si en 10 rondas no se lleva al lobo a 0 de vida, se pierde
- Implementar ranking. Verificar que se otorgan puntos como corresponde.
