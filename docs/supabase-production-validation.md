# Validación segura de Supabase real

## Requisito previo

El proyecto que ya recibió `0001` a `0005` debe ejecutar una vez, desde **SQL Editor**, la migración aditiva `supabase/migrations/0006_production_hardening.sql`.

La migración no actualiza ni elimina filas. Sustituye los dos RPC vigentes, restringe su ejecución a usuarios autenticados, deshabilita RPC antiguos que no escribían el change log y valida referencias entre carpetas, canciones, documentos y versiones.

## Crear las cuentas aisladas

1. En **Authentication → Users**, creá dos cuentas exclusivas para QA, por ejemplo `guitarap-qa-a` y `guitarap-qa-b`. No uses tu cuenta personal.
2. Creá localmente `.env.sync-test.local`. El patrón `.env.*` ya está ignorado por Git.
3. Guardá solamente:

```dotenv
GUITARAP_TEST_USER_A_EMAIL=
GUITARAP_TEST_USER_A_PASSWORD=
GUITARAP_TEST_USER_B_EMAIL=
GUITARAP_TEST_USER_B_PASSWORD=
GUITARAP_REMOTE_TEST_CONFIRM=isolated-test-users
```

La URL y la clave pública se leen de `.env.local`; no dupliques una clave secreta ni agregues `service_role`.

## Ejecutar

```text
npm run test:supabase
```

El script genera UUID y títulos exclusivos, nunca enumera ni modifica documentos preexistentes y no imprime emails, contraseñas, claves o tokens. Valida:

- autenticación de dos cuentas y dos sesiones del mismo usuario;
- carpetas anidadas, canción y metadatos;
- tablatura y mapa espacial con tres posiciones;
- historial recuperable;
- paginación incremental;
- idempotencia usando el mismo `op_id`;
- movimiento entre carpetas;
- papelera y restauración;
- conflicto entre dos ediciones con la misma revisión base;
- aislamiento de lectura y escritura entre cuentas mediante RLS.

Al finalizar envía únicamente sus propios materiales QA a la papelera. No borra filas ni versiones. Si querés inspeccionarlos antes, definí `GUITARAP_REMOTE_TEST_KEEP=1` para esa ejecución.

La pérdida física de una respuesta después del commit no se puede provocar contra Supabase sin un proxy de red controlado; ese caso sigue cubierto determinísticamente por `FakeTransport`. La repetición real del mismo `op_id` sí se comprueba contra el RPC.
