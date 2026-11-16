# Evidencia visual

- `before/` — estado previo al rediseño (v0.1), capturado de la compilación anterior y del sitio publicado.
- `after/` — v0.2. Se regenera con:

```bash
npm run build -- --mode e2e
CAPTURE_EVIDENCE=1 npx playwright test tests/e2e/visual-evidence.spec.ts
```

La autenticación y la sincronización se responden localmente: no se usa ninguna cuenta real.

| # | Captura |
|---|---|
| 00 | Primera visita, biblioteca vacía (con «Iniciar sesión» visible) |
| 01 / 02 | Biblioteca clara / oscura |
| 03 | Material nuevo |
| 04 | Inicio de sesión |
| 05 | Usuario conectado |
| 06 | Editor secuencial |
| 07 | Escritura por mástil |
| 08 | Vista combinada (mástil acoplado + tablatura) |
| 09 | Mapa con varias notas sobre una misma cuerda |
| 10 / 10b | Material con mapa y tablatura (claro / oscuro) |
| 11 / 12 / 13 | Posiciones individuales / conjuntas / mapa completo |
| 14 / 15 / 16 | Práctica con tablatura / con mapa / modo foco |
| 17 | Configuración |
| 18 / 18a–c | Sincronización y copias de seguridad |
| 19–21 | Tablet y móvil |
