# ADR 0005: Materiales como cuadernos de bloques, sin migración de base de datos

**Estado:** aceptado (v0.2)

## Contexto

Había dos tipos de documento incompatibles entre sí (`tablature`, `fretboard`). Para mostrar una escala junto a
una frase había que crear dos documentos. La columna `documents.type` en Supabase tiene un `CHECK` que solo
admite esos dos valores, y no se debe ejecutar una migración sobre producción sin autorización.

## Decisión

1. Un material es un **cuaderno**: una lista ordenada de bloques `tablature | map | text`. Los bloques de
   tablatura y mapa **reutilizan sin cambios** `TablatureContent` y `FretboardContent`.
2. `type` sigue siendo una categoría gruesa (`tablature`/`fretboard`) para el `CHECK` de SQL. La forma real
   vive en `content`. El tipo que se muestra en la biblioteca se deriva con `documentKind()`.
3. **Compatibilidad hacia atrás y hacia adelante:** los documentos antiguos se envuelven al abrirlos y, mientras
   sean un único bloque sin título, **se guardan en su forma original**. Solo al agregar un segundo bloque o un
   título se escriben como `NotebookContent`. Abrir sin editar no reescribe nada.
4. Guardar escribe únicamente título y contenido: la ubicación, la papelera y los metadatos de sincronización se
   leen del registro almacenado, de modo que un editor abierto con datos viejos no puede pisarlos.
5. Los autoguardados conservan como máximo una versión de recuperación cada 2 minutos; los guardados manuales
   siempre crean una. Antes se creaba una versión en cada autoguardado.

## Consecuencias

- No hay migración SQL ni cambio de RPC: `content` ya viaja como `jsonb` sin validación de forma.
- Un dispositivo con la versión anterior que reciba un cuaderno de varios bloques no lo entenderá; los
  materiales de un solo bloque siguen siendo legibles por cualquier versión.
- Si más adelante se quiere un tipo `notebook` en SQL, bastará con una migración que amplíe el `CHECK`
  (aditiva, no destructiva) y cambiar el `type` con el que se crean los materiales nuevos.
