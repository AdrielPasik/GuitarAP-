# Auditoría v0.6.1 — experiencia del músico

Basada solo en el código, los flujos y los tests del repositorio (sin estadísticas inventadas). Perspectivas: guitarrista que practica, compositor, usuario habitual, diseño de producto, arquitectura técnica.

## Causas reales de lo reportado

| Problema | Causa real | Arreglo |
|---|---|---|
| «Arreglos» sonaba como piano | La preferencia global heredada `sound.instrument` (que además escribía el interruptor de Práctica en v0.5) tenía prioridad sobre el valor por tipo de bloque, así que un valor viejo ganaba a guitarra/melodía. | Se eliminó la capa heredada: ahora manda temporal > elección del bloque > preferencia por tipo > predeterminado (melodía piano; tablatura y acordes guitarra). |
| Armonía solo en el cuaderno | El panel vivía dentro de `NotebookEditor`. | `HarmonyProvider` global, un solo panel y motor; cada pantalla registra su tonalidad y sus acciones explícitas. |
| Metrónomo flojo y sin volumen propio | El clic usaba un oscilador simple y el volumen no se recordaba. | Bus propio de clic (techo 0,85 + limitador compartido), clic con transitorio de ruido, primer tiempo acentuado, volumen y acento persistentes. |
| No había teclado «libre» | Toda tecla escribía. | Modo Tocar libremente: solo suena; no toca documento, versiones ni sincronización. |

## Oportunidades (ordenadas)

| # | Prio | Problema | Mejora | Solución | Impacto | Dificultad | Riesgo | Estado |
|---|---|---|---|---|---|---|---|---|
| 1 | P0 | Armonía solo en cuadernos | Consultar teoría desde cualquier pantalla | Host global + tecla H | Alto | Media | Medio (layout) | Hecho |
| 2 | P0 | Instrumento oculto en un popover | Probar otro sonido sin buscar ajustes | Selector junto a Play, temporal, «Fijar» explícito | Alto | Baja | Bajo | Hecho |
| 3 | P0 | Teclado siempre escribe | Explorar sonidos sin ensuciar la melodía | Escribir / Tocar libremente | Alto | Baja | Bajo | Hecho |
| 4 | P0 | Clic con volumen no persistente | Practicar con un clic audible y estable | Bus de clic + preferencias | Alto | Media | Bajo | Hecho |
| 5 | P1 | Edición de notas con pocos atajos | Cortar y seleccionar todo, con ayuda visible | Ctrl+X, Ctrl+A, línea de atajos al seleccionar | Medio | Baja | Bajo | Hecho |
| 6 | P1 | Repetir solo el bloque entero | Bucle de un fragmento seleccionado | Reproducir solo la selección en bucle | Alto | Media | Medio (transporte) | Pendiente |
| 7 | P1 | Tempo de práctica manual | Subir el tempo por pasos en cada vuelta | Práctica progresiva (+N BPM cada K vueltas) | Alto | Media | Medio | Pendiente |
| 8 | P1 | Metrónomo y música: clic solo con opción «Clic» | Un solo control visible en el reproductor | Mostrar el clic como botón junto a Play | Medio | Baja | Bajo | Pendiente |
| 9 | P1 | Sin favoritos | Acceso inmediato a lo que se toca a diario | Marca de favorito + sección en Biblioteca (ya hay «Recientes») | Medio | Media | Bajo | Pendiente |
| 10 | P2 | Búsqueda de la biblioteca por texto | Búsqueda musical (tonalidad, BPM, acorde) | Índice sobre metadatos ya guardados | Medio | Media | Bajo | Pendiente |
| 11 | P2 | Marcadores de composición | Etiquetar «intro», «puente» dentro de una melodía | Marcas por posición | Medio | Alta | Medio (modelo) | Pendiente |
| 12 | P2 | Historial de melodía genérico | Ver y comparar versiones de una melodía | Vista de diferencias de notas | Medio | Alta | Medio | Pendiente |
| 13 | P2 | Comparar dos posiciones de escala | Estudiar dos digitaciones lado a lado | Dos mapas sincronizados | Medio | Alta | Bajo | Pendiente |

## Decisión

Se implementaron los puntos 1–5, que atienden directamente los cuatro reportes y son seguros y verificables. Los puntos 6–7 tocan el transporte de audio (planificación y bucles ya probados en `transport.test.ts`) y requieren su propia ronda de pruebas con escucha humana, por lo que no se publican a medias.

## Límites

- La calidad del sonido (clic, piano, guitarra sintetizados) solo se verifica con pruebas de amplitud, ausencia de saturación, temporización y registro de lo que recibe el motor; **no hay validación auditiva humana** y no se afirma una calidad perfecta.
- La guitarra y el piano son síntesis, no muestras reales.
