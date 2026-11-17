# Auditoría previa a v0.5

Punto de partida real: v0.4 (`762bcde`, publicada y verificada en Cloudflare).

## Fricciones encontradas (y qué se hizo)

| Fricción | Evidencia | Solución |
|---|---|---|
| Escribir en el bloque equivocado obliga a copiar, abrir otro bloque, pegar y borrar | Pedido del usuario («Arreglos» → «Letra») | «Mover/Copiar el texto seleccionado a…» (un solo paso, deshacible); mover/copiar bloques entre canciones con transacción |
| El tempo vivía en tres lugares (bloque, cuaderno, metrónomo) y editar uno guardaba datos | `useBlockPlayer` escribía `bpm` en el bloque al tocar el stepper | Herencia resuelta (práctica → bloque → canción → preferencia → sistema); el stepper edita un tempo de práctica **temporal**; el tempo propio es una excepción explícita |
| El metrónomo ignoraba la canción | Estado global fijo | Sigue el BPM de la canción abierta; cambiar de canción lo reinicia |
| Letra y melodía eran dos bloques lejanos | Scroll constante | Vínculo por referencia + vista «Letra + melodía» (las dos mitades son los mismos bloques) |
| No había forma de agrupar ni navegar una canción larga | — | Secciones editoriales, índice plegable, mover bloques entre secciones, reordenar arrastrando **y** con teclado/menú |
| Crear una canción exigía elegir tipo de documento | Menú «Nuevo» | Formulario mínimo (nombre, BPM y tonalidad opcionales, cómo empezar) |
| `usePref`/estado: el tempo «de práctica» no existía | — | Nuevo, no persistente, con «Volver a N» |
| Dock del mástil tapaba la barra con la cabecera más alta | E2E de v0.2 falló al agregar el reproductor | El mástil acoplado limita su alto a ~34 % de la pantalla (se respetó la exigencia original de verlo acoplado) |
| Compartir no existía; la sincronización asume una sola cuenta por documento | `sync_library` rechaza ids de otro dueño | Modelo de colaboración aparte (ADR 0009) sin tocar las políticas existentes |

## Revisión de la sincronización antes de colaborar

- Propiedad: `documents.owner_id` + `library_nodes.owner_id`; las políticas «own …» se conservan.
- `sync_library` bloquea el cursor del propietario y luego el documento; `collab_save_document` toma los bloqueos en el
  mismo orden (no hay interbloqueo) y escribe en `sync_changes` del propietario para que `pull_library` lo entregue.
- Idempotencia: `sync_operations` (privada) y `collab_ops` (colaboración).
- Conflictos privados: devuelve el estado remoto y el cliente lo conserva pendiente (sin pérdida silenciosa).
- Riesgo detectado: dos escritores sobre un mismo documento hacen que el push privado del propietario caiga en
  conflicto; es seguro, pero requiere una resolución. Fusión automática del lado del propietario: pendiente.

## Qué ya estaba bien y se conservó

Mover bloques con Subir/Bajar, duplicar, deshacer de bloques, comentarios por id, historial, backup, PWA, el contexto
de audio único, el círculo de quintas.
