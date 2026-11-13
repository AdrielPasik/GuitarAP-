# Arquitectura de F0

F0 define la envoltura de la aplicación, no sus funciones de negocio. La app es React con Vite y TypeScript estricto; React Router resuelve la navegación y Tailwind CSS el estilo.

## Estructura

```text
src/
  app/          composición, rutas y estilos globales
  components/   piezas visuales reutilizables sin reglas de negocio
  features/     capacidades aisladas (tema y PWA en F0)
  test/         preparación transversal de pruebas
tests/e2e/      pruebas contra el build de producción
docs/adr/       decisiones arquitectónicas
```

## Regla de dependencias

`app` puede componer `features` y `components`. Un `feature` puede importar utilidades o componentes compartidos, pero no otro `feature`. `components` no importa desde `features` ni `app`. Las integraciones de infraestructura futuras se introducirán detrás de contratos dentro del feature que las use.

Los directorios de dominio (biblioteca, tablatura, diapasón, práctica, sincronización) no existen aún: las rutas de F0 son únicamente reservas visuales. Así se evita predeterminar el modelo local, los contratos de sincronización o los editores antes de sus fases autorizadas.

## PWA

El build genera un manifiesto y un service worker que precachea solo el shell estático. No se define `runtimeCaching`, por lo que ninguna API actual o futura —incluida Supabase— entra en la caché de la PWA. En desarrollo el service worker está desactivado. En producción una actualización espera una decisión explícita mediante el aviso de interfaz.
