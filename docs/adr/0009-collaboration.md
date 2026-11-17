# ADR 0009: Compartir y colaborar sin tocar la biblioteca privada

**Estado:** aceptado e implementado (v0.5). **Backend: preparado y probado en un PostgreSQL real, NO aplicado a producción** (ver `docs/sharing-activation.md`).

## Contexto

La sincronización de v0.2–v0.4 es privada: cada documento pertenece a una cuenta y se replica con `sync_library` /
`pull_library` (RPC `SECURITY DEFINER`, tablas con RLS «solo el propietario», navegadores sin permisos de escritura
directa desde 0006). Compartir no es «agregar una tabla `shared_documents`»: hay que decidir quién puede qué, hacerlo
cumplir en el servidor, y no abrir ninguna lectura genérica.

## Decisiones

1. **Ninguna política nueva sobre `documents` ni `library_nodes`.** Siguen siendo propietario-solo. Todo acceso
   ajeno pasa por funciones `SECURITY DEFINER` (migración `0007_sharing.sql`) que verifican `auth.uid()` y el rol en
   cada llamada. Las tablas nuevas (`share_members`, `share_invites`, `share_links`, `share_sessions`,
   `share_activity`, `collab_ops`) tienen RLS activada **sin políticas** y sin permisos para `anon`/`authenticated`.
2. **Roles:** propietario (implícito: `documents.owner_id`), editor, comentarista, lector. El comentarista solo puede
   *agregar* un comentario validado (`collab_add_comment` no toca nada más). Solo el propietario comparte, invita,
   cambia roles o revoca.
3. **Alcance de una carpeta = contención**, evaluada en el momento: un documento es alcanzable si él, o cualquier
   carpeta/canción que lo contiene, está compartida y no revocada. Agregar un documento lo comparte; moverlo fuera
   termina su acceso; moverlo dentro lo concede; mandar la carpeta a la papelera suspende todo; revocar corta todo.
   La interfaz muestra, antes de compartir, la lista exacta de materiales (`share_preview_scope`).
4. **Enlaces de lectura:** token aleatorio de 256 bits (`gen_random_bytes(32)`); se guarda solo su SHA-256 y se
   muestra una vez (el dispositivo del propietario puede recordarlo para recopiarlo). Vencimiento opcional,
   revocación, `allow_export` (solo controla botones: no impide capturas). Un enlace de lectura **nunca incluye
   comentarios** (anotaciones personales). Una contraseña opcional se guarda como bcrypt (coste 10).
5. **Contraseña validada en el servidor:** `share_unlock` devuelve una sesión aleatoria (también guardada con hash, 2 h,
   atada a un enlace, invalidada al cambiar la contraseña o revocar). `share_read` no entrega nada sin sesión válida:
   la pantalla de contraseña solo conoce el título. Cinco fallos seguidos bloquean el enlace 15 minutos (los resultados
   se *devuelven*, no se lanzan, para que el contador se confirme). **Limitación:** no hay límite por IP en SQL; añadir
   rate limiting en Supabase/Cloudflare es una acción manual recomendada.
6. **Invitaciones sin API administrativa:** el propietario crea un enlace de invitación de un solo uso (con rol y
   vencimiento); la persona **inicia sesión con una cuenta existente** y acepta. El registro público sigue cerrado y no
   hay `service_role` en el navegador. Los colaboradores se muestran con una etiqueta que ellos eligen, nunca con el
   correo.
7. **Edición concurrente = revisión + fusión por bloque.** `collab_save_document` es un compare-and-swap sobre `rev`:
   si cambió, no escribe nada y devuelve la versión actual. El cliente conserva la *base* acordada (`baseContent`) y
   fusiona en tres vías (`core/merge.ts`): bloques distintos se conservan ambos; mismo bloque editado por los dos →
   queda la versión del otro en su lugar y la mía como copia «(tu versión)» con aviso; editado aquí/borrado allá → se
   conserva; comentarios por unión de ids. Idempotente por `op_id`. Se guarda una versión de recuperación con autor, como
   mucho cada 2 minutos por autor.
8. **Offline y revocación:** la copia del colaborador vive en IndexedDB aparte (`shared`, tabla aditiva, ligada a su
   cuenta), así que nunca se mezcla con la biblioteca ni entra en el backup. Los cambios pendientes se suben cuando hay
   conexión; si el permiso fue revocado, el servidor rechaza (la autorización se resuelve en cada llamada) y la
   interfaz ofrece «Guardar mi copia en mi biblioteca». Al cerrar sesión se descartan las copias ajenas sin cambios.
9. **Integración con la sincronización privada:** cada guardado de un colaborador agrega una entrada al `sync_changes`
   del propietario y sube `rev`, de modo que los dispositivos del propietario reciben el cambio por el `pull_library`
   de siempre (probado). Si el propietario editó a la vez, su push cae en el flujo de conflictos existente (conserva
   la copia remota pendiente: nunca pierde en silencio). **Pendiente:** fusionar automáticamente ese conflicto del lado
   del propietario con `mergeNotebooks`.
10. **Despliegue compatible:** el cliente sondea `collab_capabilities`. Sin la migración, «Compartir» y «Compartidos»
    dicen que no está activado y no ofrecen ningún botón inoperante; los enlaces `/c/…` muestran un mensaje honesto.
    `public/_headers` impide cachear `/c/*` e `/invitacion/*`, les pone `Referrer-Policy: no-referrer` y `noindex`.

## Qué se probó y con qué (y qué no)

- **Motor real:** `tests/db` ejecuta las migraciones **0001–0007 tal cual** en PostgreSQL (PGlite/WASM) con los roles
  `anon`/`authenticated`, `auth.uid()` por claim y *default privileges* como Supabase: 30 pruebas (negativas incluidas:
  token inventado/vencido/revocado, escritura sin permiso, lector, comentarista, editor intentando compartir, extraño,
  enumeración, lectura de historial ajeno, acceso directo a tablas y al esquema `private`, fuerza bruta, tablas sin
  filtraciones, idempotencia, aplicar dos veces, rollback).
- **Interfaz contra ese motor:** `scripts/test-gateway.mjs` expone las mismas RPC por HTTP y las pruebas E2E
  (`v05-sharing.spec.ts`, 8) recorren enlace, contraseña, invitación, roles, revocación, conflictos y carpetas con dos
  navegadores.
- **No probado:** un proyecto de Supabase real (PostgREST/GoTrue/JWT reales, extensiones, límites de la plataforma).
  Eso requiere aplicar la migración con autorización del propietario y repetir `docs/sharing-activation.md`.
