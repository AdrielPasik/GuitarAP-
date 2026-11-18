# Sincronizar y compartir: lo que tenés que hacer

Estado de tu Supabase de producción: `0001`–`0007` están aplicadas (confirmaste `collab_capabilities()` = `{"sharing":1}`).
Falta **una sola migración**: `0008_sync_library_fix.sql`. Sin ella la sincronización de cualquier biblioteca con
carpetas o canciones falla, y por eso Compartir te pedía «sincronizá primero».

## La única acción: aplicar 0008 (1 minuto, no toca tus datos)

1. En GuitarAP: Configuración → Sincronización → **Copiar la migración 0008** (aparece cuando el servidor tiene el defecto).
   También podés copiar el contenido de `supabase/migrations/0008_sync_library_fix.sql`.
2. Supabase → **SQL Editor** → pegá → **Run**. Solo reemplaza cuatro funciones (`sync_library`, `shared_with_me`,
   `share_read`, `share_preview_scope`) y agrega `sync_capabilities`. No crea, modifica ni borra tablas, filas, documentos
   ni políticas. Es repetible.
3. Comprobá en el mismo editor:
   ```sql
   select public.sync_capabilities();   -- {"syncLibrary": 2}
   ```
4. En GuitarAP: **Sincronizar ahora**. La primera vez sube tu biblioteca por partes (carpetas, documentos, historial).
   Tu biblioteca local no se modifica ni se vacía: sólo se envía. Cuando el estado diga «Todo sincronizado» el servidor
   confirmó cada parte.

Si el servidor todavía tuviera el defecto, la app ya no dice «No pudimos sincronizar»: dice *«Falta aplicar una
reparación en Supabase»* y muestra el código (42702) y esta instrucción.

> Si alguna vez volvés a ejecutar `0007_sharing.sql`, ejecutá `0008` después (0007 redefine `shared_with_me`).

## Compartir «Tema 1 ft Gottya» entero

1. Biblioteca → abrí la canción → **Compartir proyecto** (también está en el menú «⋯» de la canción, y en cualquier parte
   de la canción el botón Compartir ofrece «Todo el proyecto»).
2. El diálogo dice «Compartir el proyecto «Tema 1 ft Gottya»» y lista las partes que se comparten. Si alguna parte todavía
   no está en la nube, lo avisa y ofrece **Sincronizar para compartir**: no se crea ningún enlace hasta que el servidor
   confirme todas las partes.
3. Copiás **un** enlace de lectura (con contraseña si querés) y se lo mandás a tu amigo: ve todas las partes.

**Regla de herencia:** se comparte todo lo que esté dentro del proyecto, ahora y mientras siga dentro. Una parte nueva
queda compartida en cuanto se sincronice; si la sacás, deja de compartirse. Nada de tus otras canciones o carpetas es accesible.

### Para que tu amigo edite
Necesita una cuenta en tu proyecto (la app no tiene registro): Supabase → Authentication → Users → *Add user* (email y
contraseña, con *Auto Confirm User*). Después, en Compartir proyecto → *Invitar* → Editor → le pasás el enlace de
invitación. Una sola invitación le da las partes del proyecto; las ve agrupadas en «Compartidos conmigo».

## Carpetas normales
Biblioteca → abrí la carpeta (por ejemplo ESCALAS) → **Compartir carpeta**. Antes de crear el enlace se muestra la lista
exacta de materiales; no incluye carpetas hermanas, otras canciones, ni materiales en la papelera.

## Qué protege cada capa (y qué no)

| Capa | Qué hace |
|---|---|
| RLS + funciones | Las tablas nuevas no tienen políticas para `anon`/`authenticated`; todo pasa por funciones que verifican `auth.uid()` y el rol **en cada llamada** (un JWT viejo no sirve tras revocar). |
| Enlaces | Token aleatorio de 256 bits; en la base solo se guarda su hash. Los lectores no reciben tus comentarios. Con contraseña, ni siquiera se muestra el título antes de ingresarla. |
| Contraseñas | bcrypt; se verifican en el servidor. 5 errores bloquean el enlace 15 min y cada bloqueo siguiente dura el doble (hasta 24 h); 20 intentos fallidos por hora desde una misma IP bloquean esa IP. Cloudflare Pages no ve estas peticiones (van directo a Supabase), por eso el límite vive en la base. |
| Revocar | Corta lecturas y escrituras nuevas al instante. No borra lo que alguien ya vio o guardó. |

## Deshacer
`0007_sharing_rollback.sql` quita solo lo que agregó 0007 (y corta todos los accesos compartidos). `0008` no necesita
rollback: volver al cuerpo de 0006 traería de vuelta el defecto de sincronización.

## Cómo se validó
Ver `docs/audit-v0.5.2.md`. `npm run test:real-stack` (Docker) corre Postgres de Supabase + GoTrue + PostgREST reales en
contenedores aislados. Eso **no** es tu proyecto de Supabase: después de aplicar 0008 conviene probar con una canción de
prueba antes de usar las reales.
