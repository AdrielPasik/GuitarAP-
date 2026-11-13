# ADR 0003: PWA con shell precacheado y actualización explícita

**Estado:** aceptado (F0)

El service worker de producción precachea exclusivamente el shell generado por Vite. No hay reglas de caché de red en tiempo de ejecución, por lo que no se cachean APIs ni datos de Supabase. En desarrollo se desactiva para evitar contaminación de caché.

Una versión nueva no toma control de una sesión sin aviso: cuando está lista se muestra un botón y la persona elige actualizar. Esto prioriza una sesión estable frente a la actualización inmediata.
