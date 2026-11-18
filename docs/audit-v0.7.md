# GuitarAP v0.7 — The Musical Universe

Informe de la evolución v0.7. Distingue en todo momento **implementado**, **probado**, **publicado** y **pendiente**.

## 1. Diagnóstico de v0.6.1

- La Biblioteca era una sola lista. Una carpeta con un material mostraba una fila arriba y una pantalla vacía.
- No había forma de mostrar una carpeta distinta de otra. El único orden era global («Recientes / Nombre»).
- Los tres «universos» (`estudio`, `britanico`, `psicodelico`) cambiaban sobre todo colores y una trama; tipografía,
  forma y tratamiento de encabezados eran los mismos.
- Armonía vivía en un panel fijo de 400 px: el círculo y el mástil quedaban comprimidos y los acordes muy abajo.
- El mástil de acordes mostraba todas las notas en 12 trastes y aclaraba «No se sugieren digitaciones».
- El metrónomo tenía un solo timbre.

## 2. Problemas visuales encontrados (y corregidos)

| Problema | Dónde | Corrección |
|---|---|---|
| Carpeta con 1 elemento = pantalla abandonada | Biblioteca | Encabezado de carpeta con portada, conteos reales y acciones; tarjeta de «agregar» en la grilla |
| `.cover` del selector de temas chocaba con las nuevas portadas | Configuración | Portadas renombradas a `.sleeve` |
| `cover-grid` (estilo «Retícula») chocaba con la grilla de portadas | Biblioteca | Ídem |
| `.facts` de Configuración convertía los datos de cada fila en una grilla | Biblioteca | Renombrado a `.entry-facts` |
| Los menús de cada fila quedaban recortados (`content-visibility` contiene la pintura) | Biblioteca | Quitado; 500 elementos siguen abriendo en < 3 s |
| Desborde horizontal de 8 px a 390 px en Configuración (botón largo `nowrap` + columna `1fr`) | Configuración, New Wave | `minmax(0, 1fr)` en móvil y botones que pueden partir línea (defecto latente, existía en todos los temas) |
| El tirador del panel quedaba fuera de su contenedor con `overflow: hidden` | Armonía | Tirador dentro del borde |

## 3. Arquitectura de personalización (dos niveles independientes)

| Nivel | Qué es | Dónde vive | Se sincroniza |
|---|---|---|---|
| A — Universo artístico | Tipografía, superficies, texturas, encabezados, portadas, controles | `localStorage: guitarap.pref.appearance.skin`, aplicado en `<html data-skin>` antes del primer render | No (por dispositivo) |
| B — Presentación de carpeta | Módulos, campos, densidad, orden, agrupación, descripción | `localStorage: guitarap.pref.folder-presentations` (mapa por id de carpeta) | No (por dispositivo) |
| Metadatos musicales | Artista, álbum, año, etiquetas, estado, notas, portada generada | `notebook.meta` del documento | Sí (con el documento, sin migración) |
| Datos musicales | Bloques: letras, melodías, tablaturas, mapas, acordes | `notebook.blocks` | Sí |

Ningún campo mezcla niveles: cambiar universo o presentación no escribe documentos (verificado por E2E).

Código: `src/core/presentation.ts` (modelo puro), `src/features/library/{FolderView,CustomizePanel,MetaDialog,Cover,folder-entries}`.

## 4. Reglas de herencia

- Sin entrada → hereda del padre; una carpeta de primer nivel sin entrada usa la predeterminada.
- `inherit` / `default` / `own` explícitos. La raíz de la biblioteca tiene su propia entrada y **no** se hereda a las carpetas.
- Resolución con conjunto de visitados y tope de profundidad: un ciclo corrupto nunca cuelga la app (test).
- Las entradas van por **id**: mover una carpeta conserva su presentación propia; si hereda, pasa a heredar del nuevo padre.
- «Aplicar a subcarpetas» pide confirmación y deja a los descendientes en `inherit`.
- Cualquier edición de una carpeta que heredaba la vuelve propia (el editor lo dice).

## 5. Módulos combinables

Encabezado ilustrado · Descripción · Destacados · Portadas · Lista · Recientes · Accesos de práctica · Información musical · Compartido.
Se activan y se ordenan (subir/bajar). Si se apagan Portadas y Lista, la lista aparece igual: una carpeta nunca oculta su contenido.
Cada módulo se construye solo con datos reales; los que no tienen datos no se dibujan.

## 6–7. Biblioteca y opciones por carpeta

Presets editables: Colección visual, Lista compacta, Cuaderno musical, Proyecto, Vista combinada.
14 campos visibles (portada, artista, autor/álbum, tonalidad, BPM, acordes, tipo, fechas, etiquetas, estado, reproducción, práctica, colaboradores, notas).
Densidad compacta / equilibrada (predeterminada) / detallada. Orden: manual, nombre, fecha, creación, artista, tipo, tonalidad — artista/tonalidad/etiquetas se deshabilitan si ningún material tiene ese dato.
Reproducción rápida desde la Biblioteca (primer bloque reproducible). Estrella para destacar.
Editor lateral no modal: la carpeta detrás es la vista previa en vivo; Guardar / Cancelar / Restaurar / Copiar a otra carpeta / Aplicar a subcarpetas.

## 8–10. Universos artísticos

| Universo | Dirección |
|---|---|
| Analog Studio | Nogal, latón, papel. Encabezado con veta de madera, perillas de latón en los títulos de módulo. Bajo brillo para sesiones largas. |
| British Invasion | Revista de los 60: versalitas pesadas, filetes dobles de imprenta, botones rectos rojos, trama de semitono en portadas, filas como índice editorial. |
| New Wave | Post-punk: sans 900 en mayúsculas, esquinas rectas, sombras duras desplazadas, diagonales amarillas y cian, barra superior negra con filete amarillo. |
| Psychedelic Universe | Serif liviana amplia con degradado en titulares, superficies muy redondeadas, halos, ondas concéntricas; deriva lenta de la portada (se detiene con «reducir movimiento» o pestaña oculta). |
| Vinyl Archive | Cartón, vinilo y etiqueta naranja: tipografía de catálogo en mono, números de catálogo «Nº 01», disco asomando de la funda al pasar el mouse, desgaste de anillo. |
| Songwriter's Notebook | Papel pautado, tinta azul, margen rojo; titulares en itálica de pluma; el campo de **letra** usa renglones más amplios e itálica azul. |

Selector con mini Biblioteca + mini editor por tarjeta, muestras de color y de tipografía. Un clic **previsualiza** en toda la app; «Aplicar» guarda; «Cancelar» o salir de la página vuelve al guardado.
Contraste verificado por E2E en los 6 universos × claro/oscuro (texto ≥ 7:1, secundario ≥ 4,5:1, botones ≥ 4,5:1). Colores armónicos idénticos en todos.

## 11–15. Armonía

- **Tres tamaños**: lateral (400 px), ampliado redimensionable (arrastre o flechas del teclado en el borde, doble clic restaura; 340 px – 72 % de la ventana) y laboratorio completo sobre la pantalla (la canción sigue abierta debajo, «Volver a la canción» o Esc). Modo y ancho son preferencias del dispositivo, nunca del documento.
- **Catálogo** (`src/core/theory/chords.ts`): tríadas, sus2/sus4, 5, add9, m(add9), 6, m6, 6/9, maj7, 7, m7, m(maj7), m7♭5, dim7, 7sus4, 7♭5, 7♯5, maj9, 9, m9, m(maj9), 7♭9, 7♯9, 11 (sin 3ª), m11, 13, maj13. Cadd9 ≠ C9 ≠ Cmaj9 y C7 ≠ Cmaj7 ≠ Cm7 ≠ Cm(maj7) verificados.
- **Generador de voicings** (`src/core/theory/voicings.ts`): búsqueda exhaustiva sobre la afinación real del documento (no asume EADGBE), una nota por cuerda, apertura ≤ 3 trastes, ≤ 4 dedos con cejilla detectada, máximo una cuerda muda intermedia, nota del bajo e inversión calculadas. Omisiones permitidas solo de 5ª (acordes de 4+ notas) y 9ª/11ª en trecenas; se muestran como «omite 5».
- **Mapa armónico vs. digitación tocable**: dos vistas distintas del mástil grande (hasta el traste 15).
- Filtros: zona, cantidad de cuerdas, bajo/inversión, tipo de posición. Comparación de dos posiciones. Rasgueado o simultáneo.
- **Tríadas e inversiones** en juegos de cuerdas 1-2-3 … 4-5-6 (1 = Mi agudo), séptimas en juegos de 4 cuerdas con 3ª inversión.
- Acciones explícitas: «Agregar a la progresión» y «Guardar posición como mapa» (crea un bloque de mapa con esa forma exacta). Explorar, escuchar y comparar no escriben nada (E2E compara el contenido guardado antes y después).

## 16. Metrónomo

Cuatro timbres sintetizados (clic digital, woodblock, clic analógico, percusión seca), todos ajustados a picos similares y medidos sin clipping al máximo (E2E renderiza cada timbre offline con el limitador). Audibilidad por cuerpo/ataque, no solo por amplitud. Prueba de sonido, porcentaje de volumen visible, compás recordado. Sigue usando el único AudioContext y no toca el BPM guardado.

## 17. Mejoras propias de la auditoría (ranking)

| # | Problema | Beneficio | Complejidad | Riesgo | Estado |
|---|---|---|---|---|---|
| 1 | Carpetas casi vacías se ven abandonadas | Alto | Media | Bajo | Hecho |
| 2 | Orden global para todas las carpetas | Alto | Baja | Bajo | Hecho (por carpeta) |
| 3 | No se podía escuchar sin abrir el material | Medio | Baja | Bajo | Hecho (reproducción rápida) |
| 4 | Desborde horizontal latente en Configuración móvil | Medio | Baja | Bajo | Hecho |
| 5 | Choques de nombres CSS (`.cover`, `.facts`) | Medio | Baja | Bajo | Hecho |
| 6 | Vista previa de mapas en filas de ESCALAS | Medio | Media | Bajo | Pendiente |
| 7 | Ordenar manualmente arrastrando | Medio | Media | Medio | Pendiente (el «orden manual» usa el orden existente) |
| 8 | Sincronizar presentación entre dispositivos | Alto | Alta | Medio | Pendiente (requiere decisión de esquema) |

## 18. Pruebas

- Unitarias nuevas: `voicings.test.ts` (fórmulas, honestidad nota a nota de **cada** voicing de 15 acordes, formas abiertas clásicas, cejilla, omisión declarada, inversiones, drop D, tríadas por juego de cuerdas, séptimas con 3ª inversión, mapa), `presentation.test.ts` (herencia, independencia, ciclo, raíz, aplicar a subcarpetas, reparación de datos, combinación y orden de módulos).
- E2E nueva `v07-universe.spec.ts`: escenarios A, B, C, D (0/1/10/100/500), Ficha, E (6 sistemas distintos), F (armonía completa), H (metrónomo).
- E2E actualizada `v06-themes.spec.ts`: ahora previsualiza, cancela y aplica; contraste y responsive en los 6 universos.
- Ninguna prueba existente se eliminó.

Tiempos medidos (máquina local, build de producción, Chromium headless): abrir carpeta de 500 materiales ≈ 2,7 s incluyendo navegación; 500 portadas con todos los campos ≈ 1,2–1,5 s.

## 20–21. Persistencia y sincronización

- Presentación, universo, tamaño de Armonía y timbre del metrónomo: persistidos localmente y verificados tras recarga. Disponibles sin conexión (localStorage).
- Metadatos de ficha: viajan en `notebook.meta`, que ya se sincroniza y se fusiona campo a campo (`core/merge.ts`): sin migración remota.
- **No** se agregó ninguna migración de Supabase ni se tocó RLS. La presentación es personal por dispositivo: un colaborador nunca cambia la de otro, pero tampoco viaja a tu otro dispositivo (pendiente).

## 25–26. Limitaciones reales y pendientes

- Presentación de carpetas no sincronizada entre dispositivos (necesita una tabla o columna nueva con RLS por usuario; se debe diseñar y aplicar con autorización).
- Portadas: solo diseños originales generados. Subir imágenes propias requiere almacenamiento seguro (Supabase Storage con políticas): no activado.
- Digitación de dedos: se calcula cantidad de dedos y cejilla, no qué dedo va en cada nota.
- Undécimas/trecenas: incluidas solo las fórmulas estándar; sin ♯11/♭13 todavía.
- Dominantes secundarias / acordes prestados como lista dedicada: no agregados (el laboratorio permite explorar cualquier acorde cromático, y Modulación ya existía).
- La síntesis orienta el oído; no reproduce una guitarra real.
