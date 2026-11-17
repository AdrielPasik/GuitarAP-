# Auditoría previa a v0.4

Punto de partida real: v0.3 (commit `be6a54a`). Se leyó el código antes de tocar el modelo.

## Lo que se reutilizó

- Cuadernos de bloques (`notebook.ts`), `NotebookBlocks`, `BlockFrame`, historial, papelera, backup y transporte de
  sincronización (`content` es `jsonb`: un tipo de bloque nuevo viaja sin cambios de esquema; se probó la
  serialización ida y vuelta con mocks).
- `harmony.ts` y los colores por función; `FretboardCanvas` (el explorador de acordes dibuja sobre el mismo mástil).
- Preferencias por dispositivo (`usePref`), `Popover/Menu/Segmented`, exportación (`planExport` → hoja → PNG/PDF).

## Lo que había y se cambió

- **Dos motores de audio posibles:** el metrónomo creaba su propio `AudioContext`. Ahora comparte el contexto y
  se aparta cuando suena música. Un único transporte.
- **`usePref` no se sincronizaba entre componentes:** cambiar el instrumento en un bloque no se veía en otro hasta
  recargar. Ahora todos los consumidores de una clave siguen los cambios.
- La entrada de BPM aplicaba cada tecla (escribir «120» pasaba por «1» → 30). En los bloques se confirma con Enter
  o al salir del campo.
- No había teoría reutilizable (solo nombres y escalas). Se creó `core/theory` (altura, acordes, tonalidades).

## Riesgos identificados

- Cliente v0.3 recibiendo bloques nuevos: no los conoce (ver ADR 0008).
- Las capturas y pruebas de audio verifican lo *programado*, no lo *escuchado*.
- Sincronización real sin validar (solo mocks).

## Qué quedó fuera por decisión de producto

Pentagramas y vistas de partitura (ni como opción); editor de piano; multipista.
