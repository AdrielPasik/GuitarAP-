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

1. Creá un proyecto Supabase y aplicá, en orden, `supabase/migrations/0001_guitarap.sql` y `supabase/migrations/0002_sync.sql` con el SQL Editor o la CLI.
2. Configurá Supabase Auth. Las políticas usan `auth.uid()`; el usuario autenticado nunca debe proporcionar un `owner_id` distinto.
3. En el cliente, tras obtener el JWT de una sesión real, construí `new SupabaseTransport(SUPABASE_URL, accessToken)` y ejecutá `new SyncEngine(transport).sync(user.id)`.
4. No expongas una `service_role` en el navegador. La clave/JWT usada por el transporte debe ser de sesión de usuario y respetar RLS.

El motor mantiene el cursor, las revisiones locales, reintentos y conflictos en IndexedDB. Ante un conflicto conserva la copia remota pendiente hasta una resolución explícita; ante una red caída deja los cambios locales intactos para el próximo intento.
