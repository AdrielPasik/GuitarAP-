# Decisiones ya aprobadas para fases futuras

Estas decisiones son contexto de producto y no tienen implementación en F0:

- Persistencia local: IndexedDB mediante Dexie.
- Nube: Supabase; autenticación privada por email y contraseña con registro cerrado.
- Sincronización: protocolo propio por documento. Su pull incremental basado en snapshots PostgreSQL, paginación, concurrencia e idempotencia se validarán mediante un spike y pruebas de integración en F2 antes de producción.
- Conflictos: conservar ambas versiones; ninguna edición local posterior puede marcarse como sincronizada por una respuesta anterior.
- Historial y backups: mecanismos independientes de la sincronización. Las versiones protegidas para recuperación no se podarán automáticamente.

F0 no contiene clientes de Supabase, Dexie, bases de datos, secretos ni lógica de sincronización.
