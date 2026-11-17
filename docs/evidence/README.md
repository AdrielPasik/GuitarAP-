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
| 22 / 23 | Sitio publicado (guitarap.pages.dev): primera visita y diálogo de inicio de sesión con el formulario de correo y contraseña (nube conectada; `/build-info.json` lo confirma). |

## v0.3

- `v0.2/` — línea base antes de v0.3: capturas de v0.2 y tres tomas nuevas con contenido real. Incluye
  `v02-export-png-resultado.png`, la exportación de v0.2 con el mástil negro.
- `v0.3/` — v0.3. Se regenera con `CAPTURE_EVIDENCE=1 npx playwright test tests/e2e/visual-evidence.spec.ts`
  (junto con los archivos exportados reales: `14a-archivo-*.png` y `14b-archivo-*.pdf`).

| # | Captura |
|---|---|
| 01 / 02 | Biblioteca de Escalas / carpeta anidada (Escalas ▸ Modos) |
| 03 / 04 / 05 | Do jónico con solo un mapa / cuaderno vacío / menú de bloques |
| 06 / 07 / 08 | Mapa en notas / intervalos / ambos |
| 09 / 10 | Tríada resaltada / séptima resaltada |
| 11 | Posiciones (vista conjunta) |
| 12 / 13 | Diálogo de exportación / vista previa |
| 14a / 14b | Archivo PNG y PDF exportados (reales) |
| 15 | Cuaderno con mapa y tablatura |
| 16 / 17 | Práctica con intervalos / modo foco |
| 18 / 19 / 20 / 21 | Configuración / tema claro / tema oscuro / exportación en tema oscuro |


## v0.4

- `v0.3/` es el **antes** (la biblioteca, el cuaderno y la identidad de v0.3). `v0.4/` es el **después**. Se
  regenera con `CAPTURE_EVIDENCE=1 npx playwright test tests/e2e/visual-evidence-v04.spec.ts`: contenido real
  escrito a través de la interfaz (una canción «Hoy vuelvo a casa» con letra, melodía con sílabas, acordes,
  tablatura, mapa y un comentario).

| # | Captura |
|---|---|
| 01 | Nueva biblioteca musical (encabezado, «Seguir con», «Ideas pendientes») |
| 02 / 03 | Tres direcciones de identidad / logo claro y oscuro, íconos |
| 04 | Estado vacío con guitarras |
| 05a / 05b | Movimiento: dos cuadros de la escena, 3,5 s de diferencia |
| 06 | Pantalla de creación (menú «Nuevo») |
| 07 / 08 | Canción con letra / con melodía |
| 09 / 10 / 11 | Editor simple de melodías con teclado / melodía sonando (nota resaltada) / melodía con letra |
| 12 | Tablatura sonando (columna resaltada) |
| 13 / 14 | Mapa de escala / cuaderno mixto completo |
| 15 | Comentarios |
| 16 / 17 | Práctica / modo foco |
| 18 / 18b | Configuración: sonido / apariencia |
| 19 / 20 / 20b | Tema claro / oscuro / cuaderno en oscuro |
| 21 / 22 / 23 | Escritorio / tablet (22, 22b) / móvil (23, 23b, 23c) |
| 24 / 25 / 26 | Herramientas de armonía: círculo / modulación / acordes |

## v0.5

- `v0.4/` es el **antes**; `v0.5/` el **después**. Se regenera con
  `CAPTURE_EVIDENCE=1 npx playwright test tests/e2e/visual-evidence-v05.spec.ts` (usa dos cuentas de prueba contra la
  pasarela local de PostgreSQL; no toca ninguna biblioteca real).

| # | Captura |
|---|---|
| 01 / 02 | Biblioteca / inicio de una composición (formulario mínimo: nombre, BPM, tonalidad, plantilla) |
| 03 / 04 | Canción con secciones e índice / encabezado con BPM y tonalidad |
| 05 / 06 | Letra + melodía / sonando con la nota resaltada y tempo de práctica |
| 07 / 08 / 09 | Menú del bloque / Mover a… / Copiar a… |
| 10 / 11 | Círculo de quintas abriendo en la tonalidad de la canción / Práctica |
| 12 / 13 | Configuración: Colaboración / Preferencias musicales |
| 14 / 15 | Compartir (privado) / enlace, invitación y colaboradores |
| 16 / 17 / 17b | Invitado: contraseña / lectura / canción completa |
| 18 / 19 / 20 / 21 | Invitación / proyecto colaborativo / actividad / compartidos conmigo |
| 22 / 23 / 24 | Estado vacío / tema oscuro / configuración oscura |
| 25–29 | Tablet y móvil (canción, invitado, biblioteca) |
