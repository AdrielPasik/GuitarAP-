# ADR 0004: CI en GitHub Actions y despliegue en Cloudflare Pages

**Estado:** aceptado (F0)

GitHub Actions ejecuta typecheck, lint, unitarias, build y E2E contra el build de producción. Cloudflare Pages recibirá el resultado de `npm run build` desde `dist` mediante una conexión Git configurada por el propietario de la cuenta.

No se almacenan tokens de Cloudflare en el repositorio ni se publica una rama automáticamente. El despliegue y cualquier promoción a producción siguen siendo acciones explícitas fuera de F0.
