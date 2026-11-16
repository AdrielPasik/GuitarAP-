# Auditoría de v0.2 (noviembre 2026)

Método: lectura del código, reproducción en el navegador con contenido realista (Escalas → Do jónico),
inspección de los datos guardados en IndexedDB y de los archivos exportados. Capturas en
[`docs/evidence/v0.2`](evidence/v0.2) (antes) y [`docs/evidence/v0.3`](evidence/v0.3) (después).

## 1. La tablatura inicial que no se podía eliminar

**Lo que encontré, con honestidad:** no pude reproducir que v0.2 *imponga* una tablatura. Probé las dos vías:

| Camino | Contenido guardado |
|---|---|
| Nuevo → Material de estudio, luego «Mapa del mástil» | `notebook` con `["map"]` |
| Nuevo → Tablatura, luego agregar mapa, luego eliminar la tablatura | `["map"]`; no reaparece al recargar |

La eliminación sí era estructural (`removeBlock` quita el bloque del documento y el autoguardado lo persiste), y un
cuaderno sin bloques ya era válido. Lo que sí encontré, y que explica la experiencia descripta:

1. **La eliminación era casi indescubrible.** Los controles de bloque eran cuatro íconos de 28 px en una columna lateral
   que solo aparecía al pasar el mouse, fuera del contenido, y sin etiqueta visible.
2. **Los puntos de creación eran ambiguos.** «Material de estudio», «Nueva tablatura» y «Mapa de escala» producían
   documentos distintos, y las tablaturas de v0.1 (y las creadas con «Tablatura») nacen con 16 columnas vacías: se ve
   «una tablatura vacía» aunque nadie la haya pedido.
3. **No había plantillas con intención.** No existía «empezar solo con un mapa» ni «cuaderno vacío» como elección
   explícita al crear.

**Resolución estructural (no visual):** cada bloque tiene un encabezado siempre visible con un menú de acciones
(subir, bajar, duplicar, exportar, **eliminar**) y plegado; el cuaderno vacío es un estado válido y mínimo;
la creación ofrece plantillas que producen exactamente los bloques prometidos (probado contra IndexedDB).

## 2. Defecto grave de exportación

La exportación PNG de v0.2 capturaba el DOM de la pantalla con `html-to-image`. Resultado real
(`docs/evidence/v0.2/v02-export-png-resultado.png`): **el mástil salía como un rectángulo negro**, y la imagen
incluía los chips y pestañas de la interfaz. Causa: los SVG se dibujaban sin las variables CSS de la página.
v0.3 no captura la pantalla: dibuja una hoja de exportación independiente desde el contenido musical y congela
cada SVG con los colores ya resueltos.

## 3. Otros hallazgos

- Los intervalos eran números en puntos iguales: no había lectura por función armónica ni forma de aislar
  tónica, tríada o séptima.
- El color de acento (brasa) servía para botones primarios, selección, cursor y tónica: competía con el contenido.
- La vista «Completa» coloreaba por posición, lo que impedía usar color para la armonía.
- Mover carpetas no existía (solo documentos).
- El nuevo material se creaba bien dentro de la carpeta abierta, pero la ruta «Volver» y la ubicación eran difíciles
  de verificar: ahora la ubicación vive en la URL y se muestra como migas de pan.

## 4. Lo que funcionaba y se conservó

Carpetas anidadas, mapas con varias notas por cuerda, posiciones, vistas individual/conjunta/completa,
generador de escalas como propuesta, entrada de tablatura por teclado y mástil, historial, papelera, backup,
cuenta y sincronización. Los 35 tests E2E de v0.2 siguen pasando sin modificar su intención.
