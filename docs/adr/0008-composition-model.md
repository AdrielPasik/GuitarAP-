# ADR 0008: Modelo de composición (melodía, letra, acordes, comentarios, datos de la canción)

**Estado:** aceptado (v0.4)

## Decisiones

1. **Todo sigue siendo un cuaderno.** Se amplía `NotebookBlock` con `melody`, `lyrics` y `chords`. No hay
   aplicaciones separadas: una canción es un cuaderno con los bloques que la persona quiera, en cualquier orden.
2. **Melodía.** `MelodyContent { version: 1, events[], bpm?, instrument?, phrase? }`. Cada evento tiene `id` estable,
   `type: 'note' | 'rest'`, `midi` (C4 = 60; la altura **nunca** es un texto), `accidental?` (solo cómo se *escribe*
   una nota negra), `beats` (duración en pulsos) y `lyric?` (sílaba). Do4 = C4 = 60 está cubierto por pruebas, y
   cambiar entre «Do Re Mi» y «C D E» es una preferencia del dispositivo, sin efecto sobre los datos.
3. **Duración por niveles.** Nivel sencillo: Corta ½, Normal 1, Larga 2, Sostener 4 (un pulso por defecto). Avanzado y
   opcional: cualquier múltiplo de ¼ de pulso y silencios. Sin figuras de partitura.
4. **Letra.** `LyricsContent { text, showChords? }`: texto plano. `# Verso 1` abre una sección; `[Am]` marca un acorde
   sobre la palabra siguiente. Un corchete que no es un acorde real queda como texto. La letra no se mezcla con las
   notas.
5. **Relación melodía–letra.** Dos niveles: `phrase` (texto libre) y `lyric` por nota, repartido a pedido. Las
   sílabas pertenecen al *id* de una nota: insertar, borrar o reordenar notas nunca mueve una sílaba a otra
   nota. Repartir es una acción explícita; no hay asociación automática. Melismas: `lyric: '_'` marca la sílaba que
   continúa (modelo preparado; la interfaz de alineación avanzada queda pendiente).
6. **Acordes.** `ChordsContent { items: { id, symbol, beats }[] }`. Los símbolos (`Cmaj7`, `Am`) son otra cosa que
   las notas (`C4`): `parseNote` rechaza símbolos y `parseChord` rechaza notas con octava.
7. **Comentarios.** `NotebookContent.comments[]` con `id, text, createdAt, updatedAt, blockId?, eventId?`. Tres
   niveles: cuaderno, bloque, evento (nota o acorde). Referencias por **id**, nunca por índice. `pruneComments` se
   aplica al actualizar o quitar un bloque: borrar un bloque o una nota se lleva sus comentarios y **deshacer
   restaura ambos** (viven en el mismo documento). Nunca quedan referencias huérfanas.
8. **Datos de la canción.** `NotebookContent.meta { key?, bpm?, timeSignature?, status?, tags? }`, todo opcional.
   Cambiar la tonalidad es contexto, **no transpone** nada; transponer es una acción explícita con deshacer.
9. **Tablatura.** `TablatureContent` gana `bpm?`, `stepBeats?`, `instrument?` (opcionales). Sin ellos, un paso dura
   un pulso.

## Compatibilidad y sincronización

- Sin migraciones SQL: `content` viaja como `jsonb` y `documents.type` sigue siendo `'tablature' | 'fretboard'`.
- Un cuaderno con `meta` o `comments` no se reduce a la forma heredada de un solo bloque (`fromNotebook`); los
  documentos v0.1, v0.2 y v0.3 abren sin cambios y solo mirarlos no escribe nada (probado).
- **Versión hacia adelante:** un bloque de tipo desconocido (de una versión más nueva) se muestra como marcador, se
  conserva intacto al guardar y se omite al exportar (probado).
- **Versión hacia atrás (riesgo real):** un cliente v0.3 que reciba por sincronización un cuaderno con bloques
  `melody/lyrics/chords` no los conoce y puede fallar al mostrarlo. Mitigación: actualizar los dispositivos antes de
  sincronizar contenido nuevo (la PWA ofrece la actualización). No se modificó el modelo remoto.
- Historial: el autoguardado conserva, como mucho, una versión cada dos minutos (probado con una letra larga).
- Backup: incluye los bloques nuevos, `meta` y `comments` (probado: descarga, importación aislada y lectura).
- Sincronización: se probó **solo con mocks** (serialización ida y vuelta). No se validó contra el servicio real.
