Bugs

- Al pedir tokens no da del stable
- El costo de stable tiene que ser menor que el de game coin
- Si en un combate mi vida llega a 0, sigue peleando y compara por daño hecho
- Unificar la fuente de verdad de los tokens. En el navbar se ve un valor y en el shop otro. El de shop es correcto. Incluso reporta "Skipped (combat already resolved)" teniendo yo 0 de vida y me la da por ganada
- Cuando se vence a un rival, se hace un swap. Si no es mucho problema, debería ponerme en su lugar y bajar a los correspondientes 1 puesto
- Al llegar al puesto 1, no obtuve lo que había en el pozo

Mejoras

- Permitir comprar varias cosas al mismo tiempo, incluido un objeto repetido
- Permitir consumir y equipar varios objetos en una sola transacción
- Hacer que los colores de las 3 pociones sean iguales y cambie el tamaño
- Hacer que los objetos se vean mejor. No se ve muy bien porque el espacio para la imagen es horizontal y la imagen es más vertical. A su vez, si llegan a haber más elementos, crece mucho.
- El combate tiene que quedan en la blockchain. Me da la sensación de que está guardandose en localStorage o algo así. Que al tener un combate, que se agregue en un objeto por los participantes, en dos arrays distintos y que se traigan de a 10 o lo que una llamada diga
- Cuando hay un overlay de combate, cerrar el overlay al clickear afuera. Asegurarse que el Close esté siempre visible y no haya que scrollean
- Asignarle a los ghosts 500 gc al crearse para poder probar el robo de tokens
- En la arena, permitir hacer click sobre un usuario y ver sus stats
- Tener en algún lado una vista reducida de la arena y pociones para poder consumirlas y luchar más rápidamente
- Poner xp_actual / xp_necesaria_para_siguiente_nivel
- Mover el request tokens a shop

Pendientes

- Incluir PvE contra lobo. El lobo tiene stats aleatorias. Uno siempre pelea contra un lobo de su propio nivel. El lobo de propio nivel es como un gladiador de 1 nivel superior sin equipamiento con stats aleatorias y 1/4 de la vida del gladiador de esos stats. Si en 10 rondas no se lleva al lobo a 0 de vida, se pierde
- Implementar ranking. Verificar que se otorgan puntos como corresponde.
