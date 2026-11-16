# ADR 0006: Vista armónica opcional, plantillas y exportación desde el contenido

**Estado:** aceptado (v0.3)

## Decisiones

1. **Vista armónica dentro del mapa, opcional.** `FretboardContent.view?: { labels, emphasis, legend, extensions }`.
   Todos los campos son opcionales; `notation` se sigue escribiendo para que versiones anteriores lean notas o
   intervalos. No hay migración. Un mapa sin `view` se ve como siempre, ahora con los colores de función.
2. **Plantillas, no tipos nuevos.** «Mapa de escala», «Acorde o tríada», «Riff o tablatura», «Cuaderno vacío»,
   «Escala y frase» solo deciden qué bloques existen al empezar. Las escalas y riffs se guardan en la forma
   compatible de siempre (`type` de SQL sin cambios); los cuadernos, como `NotebookContent`.
3. **Mover carpetas** con prevención de ciclos en el repositorio (no solo en la interfaz).
4. **Exportación desde el contenido.** `planExport` convierte una selección (bloques + alcance de cada mapa) en
   figuras; `ExportSheet` las dibuja con el tema elegido; `export-render` congela los SVG con colores resueltos
   y produce PNG o PDF. La vista previa es la misma hoja escalada. No se usa la pantalla como fuente.
5. **PDF con jsPDF por páginas.** Se pagina por unidades (título, figura, renglón de tablatura): una figura nunca
   se parte; solo una unidad más alta que una página se reduce. Es un PDF de imágenes (vector pendiente).

## Consecuencias

- Los cuadernos de v0.2 y los materiales de v0.1 abren sin cambios y se guardan en su forma original mientras no
  se les agregue estructura (probado en `compat.spec.ts`).
- Cambiar la lectura de un mapa genera un autoguardado (es una preferencia del documento). A cambio, Práctica
  muestra lo mismo que el editor sin escribir nunca.
- Sin migraciones SQL ni cambios de RLS: `content` viaja como `jsonb`.
