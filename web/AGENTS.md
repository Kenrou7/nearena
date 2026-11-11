# AGENTS.md (web)

## Especialidad

Next.js + TypeScript + wallet selector (NEAR) + Phantom adapter.

## Guía de diseño

- Base: Tailwind + shadcn/ui + Framer Motion.
- Estilo: moderno, divertido y legible; priorizar claridad funcional.
- Evitar botones muertos: ocultar o marcar como "Proximamente".

## Reglas técnicas

- UI reactiva a estado on-chain real.
- Manejo de errores visible al usuario (toasts/alerts).
- Mantener tipado estricto de contratos y API.

## Testing

- Unit tests para hooks de estado y utilidades de formato.
- Integration tests para flujos de compra/equip/combate con mocks.

## Guía de Diseño Visual NEARena

### Alcance actual

- **Estilo elegido: C (Blood and Gold)** — ver `DECISIONS.md` D-008. Los estilos A y B y el selector de tema ya fueron removidos; quedan como referencia histórica.
- Mantener esta guía como referencia de producto y dirección artística.
- No implementar cambios visuales/código hasta indicación explícita de Dani.
- Inspiración permitida: rasgos de estilo de Darkest Dungeon y Slay the Spire.
- Prohibido copiar personajes, ilustraciones, logos, íconos o assets de referencia.

### Estilo A: Grim Arena (inspiración Darkest Dungeon)

- Tono: oscuro, brutal, gótico. Coliseo sucio y peligroso.
- Paleta: negros y marrones profundos, piedra gris, rojo sangre como acento, pergamino envejecido para paneles.
- Trazo: cómic con tinta gruesa y sombras duras.
- Tipografía: serif gótica/grabada para títulos, serif legible para textos.
- Interfaz: marcos de hierro y madera, texturas gastadas, viñeteado en bordes.
- Animaciones: golpes con sacudida de pantalla y salpicaduras, números de daño pesados.

### Estilo B: Clean Spire (inspiración Slay the Spire)

- Tono: claro, legible, con humor ligero.
- Paleta: fondos azul oscuro o púrpura, colores saturados por stat/item (rojo fuerza, verde destreza, azul vitalidad), dorado para recompensas.
- Trazo: ilustración pintada simple, formas definidas, poca textura.
- Tipografía: sans o serif redondeada, números grandes y nítidos.
- Interfaz: íconos claros por stat, tooltips con info completa de ítem, jerarquía visual marcada.
- Animaciones: cortas y precisas para informar (subida de stats, daño, recompensa).

### Estilo C: Blood and Gold (fusión)

- Idea: clima de A en ilustraciones/fondos/peleas + claridad de B en UI de datos.
- Paleta: base oscura de A, rojo sangre para combate, dorado brillante para pozo/premios/recompensas.
- Ilustraciones: tinta marcada y sombras de A.
- UI de datos (stats, ítems, pozo, ranking): íconos, números grandes y tooltips de B sobre paneles oscuros con bordes sutiles.
- Tipografía: grabada para títulos/marca, sans nítida para datos.
- Animaciones: golpes con peso en pelea; pozo y recompensas con brillo/celebración.

### Cuando Dani lo pida

- Implementar los 3 estilos como temas intercambiables con tokens centralizados (colores, tipografías, radios, sombras) sobre Tailwind + shadcn/ui.
- Agregar selector de tema temporal solo en desarrollo para comparar las mismas pantallas: portada con pozo, gladiador, tienda, pelea y ranking.
- Mientras no haya assets propios, usar placeholders prolijos coherentes con cada estilo.
- Cuando Dani elija uno, remover selector y dejar solo tokens del estilo elegido.
- Registrar la elección final en DECISIONS.md.
