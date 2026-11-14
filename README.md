# GuitarAP

Aplicación web progresiva local-first para biblioteca, tablaturas y diapasones de guitarra. Conserva los datos en IndexedDB y ofrece backups JSON, historial de versiones, Práctica y exportación PNG/PDF.

## Desarrollo

```bash
npm install
npm run dev
```

## Verificación

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:e2e
```

Consulta [la arquitectura](docs/architecture.md), los [ADRs](docs/adr) y la [guía de despliegue](docs/deployment.md) antes de avanzar de fase.

## Sincronización Supabase

La sincronización remota no está activa por defecto ni fue validada contra un proyecto real. Para prepararla:

1. Creá un proyecto Supabase y aplicá, en orden, `supabase/migrations/0001_guitarap.sql`, `0002_sync.sql` y `0003_sync_hardening.sql` con el SQL Editor o la CLI.
2. En **Authentication → Providers → Email**, desactivá los nuevos registros públicos. Creá los usuarios autorizados desde el Dashboard; la app solo ofrece inicio de sesión, nunca registro.
3. Copiá `.env.example` como `.env.local` y completá la URL y la clave anónima/publicable. Ambas se exponen al navegador por diseño; jamás uses `service_role`.
4. Abrí **Configuración** en GuitarAP, iniciá sesión, exportá el backup exigido por la interfaz y luego sincronizá. El JWT de sesión se usa como `Authorization` y la clave anónima como `apikey`, bajo RLS.
5. Probá dos navegadores con dos usuarios distintos: cada uno debe ver solo sus documentos. Para dos dispositivos del mismo usuario, sincronizá el primero, abrí el segundo, iniciá sesión y sincronizá.

El motor mantiene el cursor, las revisiones locales, reintentos y conflictos en IndexedDB. Ante un conflicto conserva la copia remota pendiente hasta una resolución explícita; ante una red caída deja los cambios locales intactos para el próximo intento. La primera subida exige exportar un backup y confirmar esa copia local.
