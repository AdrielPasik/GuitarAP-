# ADR 0007: Reproducción musical con Web Audio nativo y un único transporte

**Estado:** aceptado (v0.4)

## Contexto

GuitarAP debe permitir escuchar melodías, tablaturas y progresiones, sin ruido de DAW, sin descargar sonidos ni
mandar música a terceros, y funcionando sin conexión (PWA). Se evaluaron las opciones antes de elegir.

| Opción | Hallazgos | Decisión |
|---|---|---|
| **Tone.js** | v15.1.22, MIT, ~5.4 MB desempaquetado. Buen scheduler, pero el scheduler es lo único que no podemos delegar sin acoplar el modelo, y el costo de bundle es desproporcionado para dos timbres sintéticos. | Descartada. |
| **Web Audio API nativa** | Sin dependencias, sin licencia, offline por definición, reloj de audio preciso. Exige escribir el planificador (≈150 líneas, probadas). | **Elegida.** |
| **SoundFonts / samples** | Las bibliotecas libres con licencia clara pesan megas, se descargan al primer uso (rompe el offline si no se empaquetan) y su licencia hay que verificar archivo por archivo. | Descartada por ahora. Cambiar de timbre no toca los documentos. |
| **VexFlow / abcjs** | Son notación de partitura. Decisión de producto definitiva: **no hay pentagramas**, ni siquiera opcionales. | Fuera de alcance. |

## Decisión

Tres capas separadas (`src/audio`):

1. **Datos musicales** (en el documento): alturas MIDI, duraciones en pulsos, acordes como símbolos, tablatura
   con afinación. No conocen ninguna biblioteca de audio.
2. **Planificador** (`plan.ts`): convierte esos datos en una `Sequence` neutra (eventos con inicio, duración y
   alturas). Regla visible de tiempo: un paso de tablatura dura un pulso salvo que el bloque diga otra cosa.
3. **Instrumento** (`webaudio-backend.ts`): síntesis local.
   - *Piano:* parciales aditivos, ataque rápido, decaimiento según la altura. Es una **síntesis**, no un piano
     muestreado.
   - *Guitarra:* cuerda pulsada Karplus–Strong renderizada en un buffer. Es una **aproximación** a cuerda de
     nailon/acero, no una emulación realista.

**Un solo `Transport`** (`transport.ts`) para toda la aplicación:

- Planifica con una ventana de anticipación sobre el reloj del `AudioContext` (180 ms, refrescada cada 25 ms).
  React solo observa (`useSyncExternalStore`); nunca está en el camino del sonido.
- Estados `idle | playing | paused`, play, pause, resume, stop, desde una nota, repetir, cambio de BPM sin perder
  el lugar, clic opcional **en el mismo reloj**.
- Empezar otra fuente detiene la anterior. Desmontar un bloque o cambiar de documento detiene lo suyo. Editar la
  secuencia mientras suena la detiene (nunca suena un dato viejo).
- `stopAll` hace un fundido de 8 ms, detiene las fuentes y desconecta nodos; las voces se liberan solas al
  terminar. No quedan voces colgadas (verificado: `voices === 0` tras detener, pausar o navegar).
- **Un solo `AudioContext`** (`getAudioContext`), creado en el primer Play (gesto del usuario). Nunca se
  reproduce nada al abrir un documento (probado).

**Metrónomo.** Usa el mismo `AudioContext`. Al empezar música el metrónomo se apaga (`transport.onStart`): nunca
hay dos relojes. Si se quiere clic mientras suena, el transporte lo programa en su propio reloj.

**Tempo: una regla explícita.** BPM del bloque → BPM del cuaderno → BPM del metrónomo. La interfaz muestra de dónde
sale («tempo del bloque / del cuaderno / del metrónomo»).

## Verificabilidad

- `Transport` recibe un `AudioBackend` inyectable: las pruebas unitarias usan un reloj virtual y verifican orden,
  separación temporal por BPM, pausa/reanudar, parar, desde una nota, polifonía, reemplazo y bucle.
- En el navegador, con `window.__GUITARAP_AUDIO_TEST__`, el backend registra cada nota programada (altura, instante,
  duración) y las pruebas E2E comparan contra lo esperado. **No se graba ni se escucha el audio**: se verifica lo
  programado, y la calidad sonora la juzga una persona.

## Consecuencias

- Offline y sin dependencias nuevas para el audio. Las fuentes tipográficas sí son dependencias (OFL), empaquetadas.
- Limitaciones documentadas: las técnicas de tablatura (bend, slide, vibrato, hammer-on, pull-off) **no se
  interpretan**: suena la altura de cada nota (el apagado `x` suena como nota corta). Un mapa de escala **no se
  reproduce**: no tiene orden temporal.
- Exportar **MIDI** (`midi.ts`) es un archivo SMF real (formato 0, 480 PPQ) con tempo, alturas y duraciones; se
  verifica la cabecera y los eventos. WAV/MP3 quedan fuera: requieren renderizado offline y codificación (≈ cientos
  de kB de codificador o `OfflineAudioContext` + encabezado WAV propio) y no son prioridad.
