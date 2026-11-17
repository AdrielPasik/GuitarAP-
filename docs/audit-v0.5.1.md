# Auditoría v0.5.1

## 1. Qué había realmente en producción (v0.5, commit b8a5ccb)

| Pregunta | Respuesta comprobada |
|---|---|
| ¿Cloudflare servía algo viejo? | No. `build-info.json` mostraba el commit correcto; el problema era del diseño. |
| ¿Qué CSS cambió de v0.4 a v0.5? | `git diff 762bcde..b8a5ccb -- src/styles`: **solo `studio.css` (+687 líneas)**. `base.css`, `app.css`, `notebook.css` y `art.css` (paleta, tipografía, barra superior, materiales) quedaron **idénticos**. |
| ¿Qué fue visible? | Componentes nuevos (secciones, diálogo de mover, compartir, invitado, Letra + melodía) con su propio CSS. |
| ¿Qué no se rediseñó? | La identidad global: mismo fondo beige plano, misma barra clara, la letra en una caja blanca, Configuración y Práctica con los mismos estilos. v0.5 fue refinamiento de botones/encabezados y funciones, **no** el rediseño profundo pedido. |
| ¿Service worker mostrando una interfaz vieja? | No se comprobó un caso concreto; el SW usa actualización con aviso. No hay evidencia de que sea la causa. |

## 2. Qué cambió en v0.5.1

Teclado musical como entrada principal (suena al tocar), cuaderno de letra, mesa Letra + melodía, y un sistema visual
común («taller de luthier», `src/styles/stage.css`). Evidencia en `docs/evidence/v0.5.1/`.

Autocrítica honesta: **la biblioteca, las tablaturas, el mapa y el diálogo de compartir recibieron marco y tipografía, no
una recomposición**; el diálogo de compartir sigue siendo claramente funcional más que bello. El sonido del teclado se
verificó por el planificador de audio (notas programadas, alturas, sin duplicados); **no** se escuchó en un navegador real
con parlantes en esta sesión.

## 3. Auditoría de `0007_sharing.sql` (hallazgos y correcciones, antes de aplicarla)

| Hallazgo | Corrección |
|---|---|
| Un lector invitado recibía los comentarios personales del propietario | `collab_pull_document` los quita para el rol *lector* (el comentarista los ve, los necesita). |
| El título de un enlace con contraseña se mostraba antes de ingresarla | Ahora no se devuelve hasta desbloquear. |
| Bloqueo de contraseña fijo (15 min = ~480 intentos/día por enlace) | Escalonado: cada bloqueo dura el doble, hasta 24 h; se reinicia al acertar. |
| Sin límite por origen (ni Cloudflare Pages ni nada del lado del sitio ve estas peticiones) | Límite **en la base**: 20 fallos/hora por IP hasheada (`cf-connecting-ip` o último `x-forwarded-for`). |
| Invitaciones con vencimiento arbitrario | Futuro y como máximo 90 días. |
| PostgREST podía tardar en ver las funciones | `notify pgrst, 'reload schema'` al final (también en el rollback). |

Sin cambios necesarios: RLS sin políticas en tablas nuevas, `private` no expuesto, tokens solo como hash, CAS por
revisión, revocación efectiva en cada llamada, carpeta por contención.

## 4. Validación

| Qué | Cómo | Resultado |
|---|---|---|
| SQL, permisos, negativos | `tests/db` (PostgreSQL real vía WASM, migraciones 0001–0007) | 35 pruebas, todas pasan |
| Auth, JWT, RLS, PostgREST reales | `npm run test:real-stack`: imagen `supabase/postgres:15.1.1.78`, `supabase/gotrue:v2.158.1`, `postgrest/postgrest:v12.2.3` en contenedores aislados, cuentas reales de GoTrue, HTTP real | 7 pruebas, todas pasan: JWT→rol, tablas y `private` inaccesibles, enlace sin comentarios, límite por IP leyendo cabeceras reales, carpeta compartida sin exponer otras canciones, roles, CAS, revocación inmediata con JWT vigente, sincronización privada intacta, rollback y reaplicación |
| Interfaz con dos cuentas | `v05-sharing.spec.ts` contra la pasarela local respaldada por PostgreSQL | 8 escenarios pasan |
| Suite E2E completa, entorno limpio | `npx playwright test` sin nada más corriendo | 114 pasan, 0 fallan (3 omitidos: capturas a demanda) |

Los 5 fallos que apareció al principio **no eran carga**: 3 por el cambio de producto (escribir ahora suena por defecto)
y 2 por mi rediseño (portada demasiado alta tapaba la hoja de tablatura; la escena decorativa en el encabezado). Se
corrigieron el diseño y los tests, no se eliminaron. Un fallo anterior intermitente (rol tras recargar) se debía a una
carrera real del cliente y a que el E2E servía un `dist` viejo: ver el historial.

**Lo que sigue sin validarse:** tu proyecto real de Supabase (versión de PostgREST/GoTrue de su plataforma, límites,
configuración de Auth). Ver `docs/sharing-activation.md` sección 3.

## 5. Riesgos que quedan

1. Para que tu amigo **edite** necesita una cuenta que crees en Supabase (no hay registro en la app ni cambio de contraseña).
2. Sin límite de peticiones por segundo a nivel de red (cada fallo cuesta 0,25 s y hay bloqueo por IP y por enlace).
3. Revocar no borra lo que alguien ya vio o guardó.
4. Si el propietario edita a la vez que un colaborador, el push privado del propietario cae en conflicto conservando la copia remota (no se pierde nada); la fusión automática de ese caso sigue pendiente.
