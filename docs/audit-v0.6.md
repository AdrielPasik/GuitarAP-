# v0.6 — el espacio musical

## Qué se hizo, y qué no (sin adornos)

| Pedido | Estado | Dónde |
|---|---|---|
| Práctica respeta las carpetas | **Hecho y probado** | `features/practice/MaterialExplorer.tsx`, `practice-tree.ts`; E2E `v06-practice.spec.ts` |
| Partes de la canción a un clic en Práctica | **Hecho** | pestañas «Letra y melodía · Arreglos» en la barra de Práctica |
| Compartidos conmigo en Práctica, con su jerarquía y sin mezclarse | **Hecho** (solo lectura en Práctica; para colaborar hay un botón que abre el editor compartido) | pestaña «Compartidos conmigo» del explorador; ruta `/practica/c/:id` |
| Posición de lectura al cambiar de modo | **Hecho** | se guarda por material en la sesión |
| Instrumentos por tipo de bloque | **Hecho y probado** | `audio/instruments.ts`; Configuración → Sonido; E2E `v06-instruments.spec.ts` |
| Mis datos y almacenamiento | **Hecho y probado** | Configuración → Mis datos; E2E `v06-data.spec.ts` (F) |
| Resolver conflictos con comparación | **Hecho y probado** (con datos aislados; tu conflicto real no se tocó) | Configuración → Conflictos; `sync/conflict-diff.ts`, `engine.ts`; E2E (G) + 7 pruebas unitarias |
| Temas musicales originales (3) con vista previa | **Hecho y probado** (contraste ≥ 7:1 en texto principal y colores armónicos idénticos, en claro y oscuro) | `styles/skins.css`, `features/theme/skin.ts`; E2E `v06-themes.spec.ts` (E) |
| Biblioteca rediseñada | **Hecho** (carpetas y canciones como «fundas» con color propio; materiales como filas densas con lomo por tipo; funciona con 5 y con cientos) | `styles/stage.css` + `LibraryScreen.tsx` |
| Letra + melodía como una experiencia | **Ya existía (v0.5/0.5.1); no se rehízo.** La vista conjunta enlaza bloques reales por id, sin duplicar | pendiente a propósito: vincular **frases** de la letra con frases musicales (hoy el vínculo es por bloque) |
| Editor de letras como compositor | **Parcial:** ya tiene estructura con botones, autoguardado sin perder cursor y acordes sobre las palabras en lectura. No se hizo un rediseño nuevo en esta versión | — |
| Mover/copiar contenido entre bloques y documentos | **Ya existía y está probado (v0.5)**; sin cambios | `data/block-transfer.ts` |
| Colaboración | Verificada con las pruebas existentes (invitación, rol, edición, revocación) | `v05-sharing`, `v052-project-share` |

## Dónde se guardan tus datos (lo que la pantalla «Mis datos» dice)
1. Todo se guarda primero en **IndexedDB** de este navegador. Eso es lo que ves.
2. Al sincronizar, el servidor (Supabase) confirma cada parte; solo entonces se muestra «Sincronizada».
3. El JSON es una copia exportada que descargás vos. La app solo recuerda la fecha de las copias descargadas **desde este
   navegador**; si no hay registro dice «Sin registro» (no inventa una fecha).
4. Lo que no se puede comprobar se muestra como desconocido.

## Conflictos: cómo se resuelven
- Nada se resuelve solo. Un conflicto guardado por un cliente anterior queda intacto aunque sincronices.
- La pantalla muestra las dos versiones, cuándo se modificó cada una, la diferencia línea por línea (letras, notas, acordes) y,
  para tablaturas y mapas (donde no hay un diff fiable), las dos versiones completas.
- Opciones: **conservar ambas** (la nube pasa a ser un material aparte), **usar la de la nube**, **usar la de este
  dispositivo**, **fusionar bloque por bloque**. Cada una deja puntos de recuperación en el historial del material y
  ninguna borra la otra versión.

## Temas
Tres universos sobre la misma arquitectura: Estudio analógico (el aspecto de siempre), Rock británico, Psicodelia
progresiva. Son preferencias del dispositivo (no se sincronizan: no pueden generar conflictos). Los colores de tónica,
tercera, quinta y séptima son idénticos en todos. Recursos originales: ninguna portada, logo, foto ni personaje existente.

## Límites honestos
- Mover contenido hacia o desde proyectos **compartidos** no se ofrece (las copias de otras personas viven aparte, a propósito).
- Práctica no reproduce desde la nube sin conexión: los materiales compartidos se leen del servidor.
- La Biblioteca se ve distinta con pocos materiales; no se midió con 500 reales (el diseño es una cuadrícula + filas, sin virtualización).
