# Despliegue de producción en Cloudflare Pages

GuitarAP genera un build estático en `dist/`. Las rutas se cargan en bloques independientes y el service worker incluye todos los bloques necesarios para seguir abriendo la aplicación offline.

## Configuración inicial manual

1. En Cloudflare Dashboard, abrí **Workers & Pages → Create application → Pages → Connect to Git** y seleccioná el repositorio `AdrielPasik/GuitarAP-`.
2. Elegí `main` como rama de producción y habilitá despliegues automáticos para nuevos commits de esa rama.
3. Usá una versión actual de Node compatible con el `package-lock.json` (Node 24 recomendado).
4. Configurá **Build command**: `npm run build`.
5. Configurá **Build output directory**: `dist`.
6. Dejá **Root directory** vacío y **Framework preset** en `None` o `Vite`.
7. En **Settings → Environment variables**, agregá para Production únicamente `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. La segunda puede ser la clave pública `sb_publishable_...`; nunca agregues la contraseña PostgreSQL, una clave secret ni `service_role`.
8. Después del primer despliegue copiá la URL `https://<proyecto>.pages.dev`.
9. En Supabase abrí **Authentication → URL Configuration**: establecé esa URL HTTPS como **Site URL** y agregala también a **Redirect URLs**. Si luego usás un dominio propio, agregalo sin retirar `pages.dev` hasta terminar la transición.
10. Abrí la aplicación publicada, iniciá sesión con una cuenta de prueba, verificá una sincronización y luego comprobá el shell PWA en modo offline.

`public/_redirects` preserva las rutas SPA en Pages. `wrangler.toml` declara el directorio de salida para herramientas compatibles; el despliegue conectado a Git queda deliberadamente gestionado por Pages.

## Comprobaciones posteriores

- Las rutas `/biblioteca`, `/practica` y `/configuracion` deben responder con la aplicación; `public/_redirects` aplica el fallback SPA.
- La página debe servirse por HTTPS y no debe mostrar contenido mixto.
- En DevTools → Network no debe existir ninguna clave `service_role`, contraseña ni token dentro de archivos JavaScript. El JWT del usuario sí aparece en solicitudes autenticadas y no debe copiarse a logs.
- Después de una primera visita online, recargá offline y comprobá que abre el shell. La sincronización debe informar estado offline y conservar los cambios locales.
- Production y Preview tienen variables separadas en Cloudflare. No habilites Preview contra el proyecto de producción salvo que quieras que esas vistas accedan al mismo Supabase.

## Estado actual

El despliegue no se puede ejecutar desde este repositorio sin una cuenta autenticada de Cloudflare. No se afirma publicación hasta recibir una URL de Pages verificable.
