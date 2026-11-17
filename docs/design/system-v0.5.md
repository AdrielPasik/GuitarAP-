# Sistema v0.5: una sola identidad, reglas de herencia y de movimiento

## Jerarquía de acciones (en toda la aplicación)

| Nivel | Aspecto | Uso | Clase |
|---|---|---|---|
| Primario | tinta sólida, texto papel | La acción principal de una pantalla o diálogo (Crear canción, Crear enlace) | `.btn-primary` |
| Secundario | borde fino sobre papel | Acciones comunes (Compartir, Exportar, Armonía) | `.btn` |
| Terciario | sin borde | Acciones auxiliares (Actualizar, Cancelar, Cerrar esta vista) | `.btn-ghost` |
| Enlace | subrayado de acento | Dentro de texto (Volver a 92, Editar) | `.btn-link` |
| Destructivo | rojo, siempre con consecuencia explicada | Revocar, Quitar acceso, Eliminar sección y su contenido | `.btn-danger` |
| Contextual | iconos de 28–32 px en la fila del bloque | Mover, duplicar, comentar, eliminar una nota | `.icon-btn` |

Los diálogos usan Fraunces para el título; los menús describen la consecuencia en una segunda línea; las acciones
destructivas piden confirmación o ofrecen «Deshacer».

## Continuidad artística

- **Decoración que inspira cuando llegás:** biblioteca, estados vacíos, cabecera de Configuración, pantallas de
  invitación y de enlace (compartir) llevan la escena (guitarras, cuerdas, notas, anillo de quintas).
- **Se vuelve discreta cuando trabajás:** cuadernos, práctica y editores no dibujan escena detrás de la música.
- **Identidad en el trabajo:** encabezados de sección editoriales (Fraunces, filete), bloques con icono y título en
  cursiva, colores armónicos como único código de color musical, etiquetas de procedencia del tempo, vista «Letra +
  melodía» con un velo de acento muy tenue.
- Movimiento solo con `transform`/`opacity`; se detiene con `prefers-reduced-motion`, con la pestaña oculta y con los
  interruptores de Configuración → Apariencia.

## Herencia de valores (se resuelven, no se copian)

| Valor | Orden (de más fuerte a más débil) |
|---|---|
| BPM efectivo | práctica temporal → BPM propio del bloque → BPM de la canción → preferencia del usuario → 96 |
| Tonalidad | contexto elegido en Armonía (solo exploración) → tonalidad de la canción |
| Instrumento | del bloque → preferencia del usuario → piano |
| Nombres de notas | preferencia del dispositivo (no se guarda en la canción) |

Las preferencias son **valores iniciales**: crear una canción copia el BPM predeterminado al formulario (editable),
pero un bloque nuevo no escribe ningún tempo. Cambiar la tonalidad **no** transpone nada; el tempo de práctica
**nunca** se guarda.

## Mover y copiar

| Acción | Dónde | Garantía |
|---|---|---|
| Reordenar | arrastrar el asa, Alt+↑/↓ sobre el asa, Subir/Bajar del menú | un solo paso deshacible |
| Mover a otra sección | menú del bloque | un solo paso deshacible |
| Mover/copiar texto seleccionado | menú de Letra y de Nota | un solo paso deshacible; sin selección avisa |
| Mover/copiar a otra canción | menú del bloque → selector con ruta y búsqueda | destino escrito primero en una transacción de IndexedDB; el origen se quita solo si el destino quedó guardado; «Deshacer movimiento» desde el aviso |
| Copiar | cualquiera | ids nuevos (también de notas, acordes y columnas); los comentarios viajan apuntando a los ids nuevos; un vínculo letra↔melodía solo sobrevive si ambos se copian |
