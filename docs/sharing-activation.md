# Activar compartir y colaborar (acción manual del propietario)

Compartir está **construido, probado en un PostgreSQL real y publicado en el cliente, pero apagado**: hasta que apliques
la migración, la aplicación detecta que falta (`collab_capabilities`) y muestra «Compartir todavía no está activado».
Nada de tu biblioteca cambia al aplicarla: la migración solo **agrega** tablas y funciones (y una columna opcional).

## Antes de empezar

1. Hacé un **backup** desde Configuración → Copias de seguridad.
2. Elegí cuándo: no hace falta parar nada, pero conviene hacerlo sin sincronizaciones en curso.
3. Si tenés un proyecto Supabase de pruebas, aplicá primero ahí (recomendado).

## Aplicar

1. Supabase → **SQL Editor** → pegá el contenido de `supabase/migrations/0007_sharing.sql` y ejecutalo. Es repetible
   (`create … if not exists`, `create or replace`): si falla a medias, volvé a ejecutarlo.
2. Verificá (SQL Editor):
   ```sql
   select public.collab_capabilities();           -- {"sharing": 1}
   select count(*) from public.share_links;      -- 0, y sin error
   ```
3. En **Authentication → Providers → Email** dejá desactivado el registro público (no hace falta cambiarlo): las
   invitaciones usan cuentas que ya existen.
4. Recargá GuitarAP: Configuración → Colaboración deja de decir «no activado».

## Verificar los permisos en tu proyecto (10 minutos)

Con dos cuentas de prueba (no uses tu biblioteca real) repetí los escenarios de `tests/e2e/v05-sharing.spec.ts`:
enlace de lectura abierto en una ventana privada; enlace con contraseña (probá una incorrecta); invitar a la segunda
cuenta como lector, comentarista y editor, y comprobar que cada rol solo puede lo suyo; revocar y comprobar que la
segunda cuenta ya no lee ni escribe. Lo que no pueda leerse/escribirse **debe fallar con 403 o con un mensaje de
`forbidden`**; si algo que debería fallar funciona, desactivá compartir con el rollback y avisá.

## Recomendado (no lo puede hacer la aplicación)

- **Rate limiting** en Supabase (Auth/API) o en Cloudflare para `/rest/v1/rpc/share_unlock`: la base bloquea un enlace
  tras 5 contraseñas erróneas, pero no limita por IP.
- Revisá en **API → Settings** que `private` **no** esté en «Exposed schemas».
- Cloudflare Pages ya recibe `public/_headers` (sin caché ni referrer para `/c/*` e `/invitacion/*`).

## Deshacer

`supabase/migrations/0007_sharing_rollback.sql` elimina solo lo que agregó 0007 (y por lo tanto corta todos los
accesos compartidos). No toca documentos, nodos, versiones ni la sincronización privada. Se puede volver a aplicar 0007.

## Qué no cambia

`documents` y `library_nodes` conservan sus políticas «solo el propietario»; no se otorga acceso público a nada; no hay
`service_role` en el navegador; las contraseñas nunca se guardan ni se registran en claro.
