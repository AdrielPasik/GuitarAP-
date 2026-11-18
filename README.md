# GuitarAP

Tu estudio personal para **componer, estudiar y escuchar** ideas musicales, como aplicación web progresiva local-first.
En un mismo cuaderno conviven **letra**, **melodía** (notas con octava y duración sencilla), **progresiones de
acordes**, **tablaturas**, **mapas del mástil** (escalas con varias posiciones), **comentarios** y notas de estudio.
Se puede **escuchar** lo que escribís (síntesis local de piano y guitarra, sin descargas, offline), explorar armonía
(círculo de quintas, acordes, modulación) sin tocar tu composición, practicar y exportar (PNG, PDF, MIDI). Conserva
los datos en IndexedDB, sincroniza opcionalmente con tu cuenta y ofrece backups JSON e historial de versiones.
Una canción tiene BPM y tonalidad propios que heredan todos sus bloques; podés mover y copiar contenido entre bloques y
canciones, ver la letra junto a su melodía y, cuando se active el backend (ver `docs/sharing-activation.md`), compartirla
por enlace (con contraseña opcional) o con colaboradores con roles. No hay pentagramas: es una decisión de producto.

- [Auditoría v0.5.2](docs/audit-v0.5.2.md) · [Auditoría v0.5.1](docs/audit-v0.5.1.md) · [Auditoría v0.5](docs/audit-v0.5.md) · [Colaboración (ADR 0009)](docs/adr/0009-collaboration.md) · [Activar compartir](docs/sharing-activation.md) · [Sistema v0.5](docs/design/system-v0.5.md)
- [Auditoría v0.4](docs/audit-v0.4.md) · [Audio (ADR 0007)](docs/adr/0007-audio-architecture.md) · [Modelo de composición (ADR 0008)](docs/adr/0008-composition-model.md) · [Identidad](docs/design/identity-v0.4.md)
- [Auditoría v0.3](docs/audit-v0.3.md) · [Sistema armónico](docs/design/harmony.md) · [Auditoría v0.2](docs/audit-v0.2.md) · [Dirección de diseño](docs/design/direction.md) ·
  [Arquitectura de experiencia](docs/ux-architecture.md) · [Evidencia visual](docs/evidence/README.md)

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

1. Creá un proyecto Supabase y aplicá, en orden, todas las migraciones `0001` a `0005` con el SQL Editor o la CLI. `0004` agrega nodos, versiones y el cursor por cuenta; `0005` instala los RPC atómicos.
2. En **Authentication → Providers → Email**, desactivá los nuevos registros públicos. Creá los usuarios autorizados desde el Dashboard; la app solo ofrece inicio de sesión, nunca registro.
3. Copiá `.env.example` como `.env.local` y completá la URL y la clave anónima/publicable. Ambas se exponen al navegador por diseño; jamás uses `service_role`.
4. Abrí **Configuración** en GuitarAP, iniciá sesión, exportá el backup exigido por la interfaz y luego sincronizá. El JWT de sesión se usa como `Authorization` y la clave anónima como `apikey`, bajo RLS.
5. Probá dos navegadores con dos usuarios distintos: cada uno debe ver solo sus documentos. Para dos dispositivos del mismo usuario, sincronizá el primero, abrí el segundo, iniciá sesión y sincronizá.

El motor mantiene el cursor, las revisiones locales, reintentos y conflictos en IndexedDB. Ante un conflicto conserva la copia remota pendiente hasta una resolución explícita; ante una red caída deja los cambios locales intactos para el próximo intento. La primera subida exige exportar un backup y confirmar esa copia local.
