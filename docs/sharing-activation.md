# Activar Compartir (lo único que tenés que hacer)

Compartir está **construido, auditado y probado, pero apagado** en tu Supabase hasta que apliques una migración.
Mientras no la apliques, la app dice «Compartir todavía no está disponible en este proyecto» y no ofrece nada que no
funcione. La migración solo **agrega** tablas y funciones: no modifica ni borra ninguna tabla, fila, documento ni
política existente.

## 1. Activar (una sola acción, ~2 minutos)

1. Hacé un backup: GuitarAP → Configuración → Copias de seguridad.
2. Supabase → **SQL Editor** → pegá **todo** el contenido de `supabase/migrations/0007_sharing.sql` → **Run**.
   Es repetible: si se corta a medias, volvé a ejecutarlo.
3. Comprobá, en el mismo editor:
   ```sql
   select public.collab_capabilities();   -- debe devolver {"sharing": 1}
   ```
4. Recargá GuitarAP. En una canción aparece **Compartir** con enlace de lectura, contraseña, invitaciones y permisos.

Para deshacerlo: pegá `supabase/migrations/0007_sharing_rollback.sql` y ejecutalo. Quita solo lo que agregó 0007 (y por
lo tanto corta todos los accesos compartidos); tus documentos no se tocan.

## 2. Para que tu amigo pueda **editar** (por cada persona)

El enlace de solo lectura funciona sin cuenta. Editar requiere que la persona **tenga una cuenta en tu proyecto**, y
GuitarAP no tiene registro (a propósito: el registro público sigue cerrado). Entonces:

1. Supabase → **Authentication → Users → Add user** → email y contraseña, con *Auto Confirm User* marcado.
2. Pasale ese email y contraseña a tu amigo. Entra en GuitarAP con «Iniciar sesión».
3. En «Tema 1 FT Goti» → **Compartir → Invitar a un colaborador → Editor** → copiás el enlace de invitación y se lo
   mandás. Él lo abre con su sesión iniciada y acepta.

Limitación honesta: la app todavía no permite cambiar la contraseña desde la interfaz; esa cuenta solo sirve para
colaborar (no tiene tu biblioteca: ve únicamente lo que le compartas).

## 3. Cómo comprobar que no se expone el resto de tu biblioteca

Hacelo con una canción de prueba, no con las tuyas:

1. Creá dos canciones: «Prueba compartida» y «Prueba privada». Compartí solo la primera (enlace + invitación).
2. Abrí el enlace de lectura en una ventana privada: ves solo «Prueba compartida» y **ningún comentario tuyo**.
3. Con la cuenta de tu amigo: **Compartidos conmigo** lista solo «Prueba compartida». Si pegás en la barra la dirección de
   otra canción tuya, no abre nada.
4. En **Compartir** → **Revocar**: recargá la ventana de tu amigo; ya no lee ni guarda.

Si compartís una **carpeta**, el diálogo te muestra antes la lista exacta de lo que se comparte; solo alcanza lo que está
dentro de esa carpeta (y lo que muevas adentro después).

## Qué protege cada capa (y qué no)

| Capa | Qué hace |
|---|---|
| RLS + funciones | Las tablas nuevas no tienen políticas para `anon`/`authenticated`; todo pasa por funciones que verifican `auth.uid()` y el rol **en cada llamada** (un JWT viejo no sirve tras revocar). |
| Enlaces | Token aleatorio de 256 bits; en la base solo se guarda su hash. Los lectores no reciben tus comentarios. Si el enlace tiene contraseña, ni siquiera se muestra el título antes de ingresarla. |
| Contraseñas | bcrypt; se verifican en el servidor. 5 errores bloquean el enlace 15 min y cada bloqueo siguiente dura el doble (hasta 24 h). |
| Límite por dirección de red | **En la base de datos**: 20 intentos fallidos por hora desde una misma IP (hasheada) bloquean esa IP en cualquier enlace. Lee `cf-connecting-ip` (que Supabase/Cloudflare fijan, el cliente no puede elegirlo) o el último salto de `x-forwarded-for`. Cloudflare Pages **no** ve estas peticiones (van directo al dominio de Supabase), por eso el límite vive en la base. |
| Lo que no hace | No limita peticiones por segundo (un atacante puede seguir *enviándolas*, y cada intento fallido cuesta 0,25 s en el servidor). Para limitar a nivel de red haría falta un dominio propio delante de Supabase (plan de pago de Supabase o Cloudflare delante); no es necesario para la seguridad de las contraseñas. No impide capturas de pantalla ni que alguien guarde una copia de lo que ya vio: revocar corta lecturas nuevas, no borra copias ya descargadas. |

## Lo que validé y con qué

Ver `docs/audit-v0.5.1.md`: 35 pruebas de base de datos en PostgreSQL (WASM) y 7 pruebas contra **Postgres de Supabase +
GoTrue + PostgREST reales en contenedores aislados** (`npm run test:real-stack`, requiere Docker). Eso **no** es tu
proyecto de Supabase: por eso, después de activar, conviene repetir la sección 3 con canciones de prueba.
