# Despliegue de producción en Cloudflare Pages

GuitarAP genera un build estático en `dist/`. Las rutas se cargan en bloques independientes y el service worker incluye todos los bloques necesarios para seguir abriendo la aplicación offline.

## Configuración inicial mínima

1. En Cloudflare Dashboard, abrí **Workers & Pages → Create application → Pages → Connect to Git** y seleccioná `AdrielPasik/GuitarAP-`.
2. Elegí `main`, **Build command** `npm run build` y **Build output directory** `dist`.
3. En **Settings → Environment variables → Production**, agregá sólo `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. La segunda puede ser `sb_publishable_...`; nunca agregues contraseña PostgreSQL, claves secretas ni `service_role`.
4. Desplegá. Copiá la URL `https://<proyecto>.pages.dev` resultante.
5. En Supabase → **Authentication → URL Configuration**, pegá esa URL como **Site URL** y en **Redirect URLs**.

Las rutas SPA no necesitan `_redirects`: sin un `404.html` de nivel superior, Pages asume una SPA y sirve `index.html` para cualquier ruta que no sea un archivo. (La regla `/* /index.html 200` además generaba la advertencia de bucle infinito, por eso se eliminó.) `public/_headers` evita que el navegador cachee `sw.js`, `index.html` y `build-info.json`.

**No agregues un `wrangler.toml` con `pages_build_output_dir`**: Cloudflare lo convierte en la fuente de verdad del proyecto y las variables del dashboard pueden dejar de aplicarse al build (ver más abajo).

## Variables de entorno del build

`VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` se **incorporan al JavaScript durante el build** (Vite las lee al
compilar, no al ejecutar). Si faltan en Cloudflare Pages → Settings → Environment variables → **Production** en el
momento del build, la aplicación publicada funciona solo en modo local y el diálogo «Iniciar sesión» avisa que
esta versión no tiene la nube conectada.

Cómo comprobarlo después de desplegar: abrí la URL pública, hacé clic en **Iniciar sesión**. Si aparece el
formulario de correo y contraseña, el build tiene la configuración; si aparece el aviso «todavía no tiene la nube
conectada», agregá las dos variables en Production y **reintentá el despliegue** (cambiar variables no
recompila por sí solo). La clave `anon`/`publishable` es pública por diseño; jamás cargues `service_role`.

### Diagnóstico verificable

Cada build imprime `[build-diagnostics]` con **solo booleanos** (nunca valores): si Cloudflare estaba construyendo, si es
Production o Preview (por rama), si cada variable llegó al entorno del build, si Vite la va a incorporar, y si el
artefacto final contiene la URL pública del proyecto. Además publica `/build-info.json` con esos mismos datos:

```bash
curl https://guitarap.pages.dev/build-info.json
```

`artifact.supabaseUrlEmbedded: true` significa que el sitio publicado tiene la nube conectada. El build **falla** si
detecta una clave `service_role` o `sb_secret_` en la salida. Production (rama `main`) y Preview (otras ramas) tienen
conjuntos de variables **separados** en Cloudflare: el diagnóstico dice cuál estaba construyendo.

## Comprobaciones posteriores

- Las rutas `/biblioteca`, `/practica` y `/configuracion` deben responder con la aplicación (fallback SPA automático de Pages).
- La página debe servirse por HTTPS y no debe mostrar contenido mixto.
- En DevTools → Network no debe existir ninguna clave `service_role`, contraseña ni token dentro de archivos JavaScript. El JWT del usuario sí aparece en solicitudes autenticadas y no debe copiarse a logs.
- Después de una primera visita online, recargá offline y comprobá que abre el shell. La sincronización debe informar estado offline y conservar los cambios locales.
- Production y Preview tienen variables separadas en Cloudflare. No habilites Preview contra el proyecto de producción salvo que quieras que esas vistas accedan al mismo Supabase.

## Estado actual

El despliegue no se puede ejecutar desde este repositorio sin una cuenta autenticada de Cloudflare. No se afirma publicación hasta recibir una URL de Pages verificable.
