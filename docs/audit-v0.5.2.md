# Auditoría v0.5.2 — sincronización privada y compartir proyectos

## 1. La sincronización rota: causa exacta

**Error:** `42702: column reference "parent_id" is ambiguous` (HTTP 400), devuelto por `public.sync_library`.

**Dónde:** `supabase/migrations/0006_production_hardening.sql`. La función declara las variables PL/pgSQL `parent_id`,
`node_id` y `song_id`. Dentro de la consulta que comprueba el padre de una carpeta
(`select 1 from public.library_nodes p where p.id = parent_id …`) PostgreSQL no puede distinguir la variable de la
columna `library_nodes.parent_id` y falla **al ejecutar la sentencia**. Cualquier envío que contiene una carpeta o una
canción falla; un envío vacío funciona. Por eso:

- los tests anteriores (que solo enviaban instantáneas vacías, o usaban un `FakeTransport` que ordena nodos) nunca lo vieron;
- los E2E de compartir insertaban filas directo en la base (`mirror`) y no pasaban por `sync_library`;
- tu biblioteca (con carpetas y canciones) nunca pudo subir ni una fila: «Todavía no se sincronizó».

No lo causó `0007`: el defecto viene de `0006`. Se reprodujo con el motor de sincronización real del cliente contra
Postgres + GoTrue + PostgREST reales (la respuesta, que el cliente descartaba, decía el código y el motivo).

## 2. Otros defectos encontrados al probar con datos reales (todos corregidos)

| Defecto | Efecto | Corrección |
|---|---|---|
| `IS NOT NULL` sobre un registro compuesto en `sync_library` (verdadero solo si **todas** las columnas son no nulas) | La comprobación «el id pertenece a otra cuenta» nunca corría; error equivocado y reintentable | `FOUND` (0008) |
| El servidor exigía `rev = anterior + 1`, el cliente subía su `rev` local (+1 por cada autoguardado) | Un documento editado varias veces entre dos sincronizaciones se rechazaba como «conflicto» aunque nadie más lo tocara | El cliente envía la revisión del servidor + 1 (dos contadores por registro) |
| Las carpetas se enviaban en el orden de IndexedDB (por id), no padres primero | `23503 node parent does not exist` | El cliente ordena padres primero; 0008 también ordena en el servidor |
| Un lote rechazado se guardaba como `pending` y se reenviaba idéntico para siempre | Arreglar la causa no alcanzaba | Un rechazo definitivo descarta el lote; se reconstruye desde la biblioteca |
| Todo viajaba en una sola petición | Riesgo de tamaño/timeout con historial grande | Se divide por peticiones chicas (carpetas → documentos → historial) |
| El eco de la propia subida podía marcarse como conflicto si se escribía durante la sincronización | Falsos conflictos | Se reconoce el eco por revisión del servidor |
| Revisiones iguales por casualidad en dos dispositivos se tomaban por «la misma versión» | **Pérdida de datos**: la descarga pisaba la edición local | Se decide por «cambió acá desde la última sincronización» + contenido; la versión de este dispositivo se guarda como copia visible |
| Registros que apuntan a una carpeta inexistente bloqueaban todo el envío | Sin sincronización | Se informan («N sin poder subir») y el resto se sincroniza; nada se borra |
| Cualquier error terminaba en «No pudimos sincronizar» | No se sabía qué pasaba | Mensaje por tipo (migración, sesión, permisos, servidor, conexión, datos) + detalle técnico redactado |

## 3. Integridad de tus datos locales

- La biblioteca local solo se **lee** para enviar; nunca se vacía, se reinicia ni se reemplaza por lo remoto.
- Descargar solo escribe lo que el servidor tiene y esta biblioteca no (o lo que no cambió acá). Si algo cambió en ambos
  lados, se conserva la versión del servidor y **la tuya se guarda como «… (copia de este dispositivo)»** y también sube.
- Un lote rechazado no modifica nada local (probado). Un fallo transitorio con la respuesta perdida se reintenta con el
  mismo id de operación (el servidor responde desde su registro: sin duplicados; probado).
- «Todo sincronizado» solo aparece tras la confirmación del servidor y sin elementos sin poder subir.

## 4. Compartir proyectos y carpetas

- Una canción es un **nodo** (`library_nodes.kind = 'song'`) con documentos cuyo `song_id` apunta a él. El backend de 0007
  ya soportaba compartir nodos; la interfaz solo ofrecía documentos (y el nodo estaba oculto en un menú).
- Nuevo: **Compartir proyecto** en el encabezado de la canción y **Compartir carpeta** en el de la carpeta; desde una
  parte, el diálogo ofrece «Todo el proyecto» por defecto.
- El diálogo lista las partes (`share_preview_scope`, que resultó correcto para la estructura real), explica la regla de
  herencia y compara con lo que hay en este dispositivo: si falta alguna parte en la nube, ofrece **Sincronizar para
  compartir** y no crea el enlace hasta que el servidor confirme.
- Invitado por enlace: un proyecto con navegación entre partes, en el orden en que se crearon. Colaborador: «Compartidos
  conmigo» agrupa las partes bajo su proyecto.

## 5. Pruebas

| Qué | Resultado |
|---|---|
| Base de datos (PostgreSQL WASM), 0001–0008 | 45 pruebas, incluyendo envíos no vacíos, la demostración del defecto de 0006, atomicidad, idempotencia, permisos, orden de partes |
| Motor + transporte (unitarias) | 23 pruebas: orden, partes, revisiones, `pending` obsoleto, conflictos, errores sin datos privados |
| **Stack real aislado** (Postgres de Supabase + GoTrue + PostgREST, `npm run test:real-stack`) | 14 pruebas: primera sincronización jerárquica, segundo dispositivo limpio, ediciones cruzadas, sin duplicados, conflicto sin pérdida, sesión inválida, conexión perdida, respuesta perdida, compartir proyecto/carpeta, invitación, edición, revocación |
| E2E con interfaz real y sincronización real | escenarios A–F del proyecto completo + «sincronizar para compartir» + diagnóstico (42702, sesión vencida, servidor caído, sin conexión) |

## 6. Lo que NO se pudo comprobar
- Tu proyecto real de Supabase (no tengo acceso ni lo toqué). Lo que sé de él viene de lo que me contaste (0007 aplicada) y
  del código de 0006. Si tu biblioteca real contiene datos que el servidor rechaza, la app ahora muestra el código exacto.
- El sonido y la fluidez en tu navegador y con tu volumen de datos reales.
