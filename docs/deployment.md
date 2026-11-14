# Despliegue en Cloudflare Pages

F0 deja listo el build estático en `dist/`; no contiene claves ni requiere variables de entorno.

## Configuración inicial manual

1. Creá o renombrá el repositorio remoto como `GuitarAP` y actualizá `origin` local cuando corresponda.
2. En Cloudflare Dashboard, abrí **Workers & Pages → Create application → Pages → Connect to Git** y seleccioná el repositorio.
3. Elegí la rama que quieras publicar (para una vista previa, `codex/f0-foundations`; para producción, únicamente la que apruebes después de revisar el PR).
4. Configurá **Build command**: `npm run build`.
5. Configurá **Build output directory**: `dist`.
6. Si configurás Supabase, agregá en **Settings → Environment variables** únicamente `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` para Production y Preview. Son valores públicos de navegador; no cargues una `service_role`.
7. Tras el primer despliegue, abrí la URL HTTPS, visitá la app una vez, poné el navegador offline y recargá para verificar el shell cacheado.

`public/_redirects` preserva las rutas SPA en Pages. `wrangler.toml` declara el directorio de salida para herramientas compatibles; el despliegue conectado a Git queda deliberadamente gestionado por Pages.

## Estado en F0

El despliegue no se puede ejecutar desde este repositorio sin una cuenta autenticada de Cloudflare. No se afirma publicación hasta recibir una URL de Pages verificable.
