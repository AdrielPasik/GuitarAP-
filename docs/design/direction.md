# Dirección de diseño de GuitarAP (v0.2)

> Estado: implementada. Reemplaza el lenguaje anterior de «tarjetas + paneles + barras de herramientas».

## 1. Qué estaba mal

El diseño anterior era un panel de administración: cada grupo de controles vivía en una tarjeta con título en
mayúsculas, borde y otra tarjeta adentro. Las herramientas de la tablatura (articulación, estructura, lectura,
modos) ocupaban casi un viewport antes de mostrar una sola nota. El mástil eran 150 botones HTML. La biblioteca
era una grilla de tarjetas grandes con texto técnico («secuencia musical», «mapa espacial»). Práctica era el
editor en solo lectura.

## 2. Tres conceptos explorados

| | A. Music Studio | B. Music Notebook | C. Instrument First |
|---|---|---|---|
| Idea | Entorno de producción: lienzo central, inspector contextual, barra compacta | Documento de páginas con bloques musicales y anotaciones | El mástil es la pantalla; todo lo demás es secundario |
| Fortalezas | Excelente uso del espacio; acciones cerca del contenido | Resuelve «escala + frase + anotación en un solo material»; se entiende sin manual; encaja con carpetas y canciones | Interacción directa; es lo más musical para marcar notas |
| Debilidades | Pide un modelo de «pistas» y un inspector siempre presente: sobredimensionado para una libreta personal | Si se hace como editor de texto genérico, pierde lo musical | No resuelve cómo se organiza, se guarda y se practica el material; una tablatura larga no cabe en «un mástil» |
| Encaje con el uso real | Medio | **Alto** para organizar, estudiar y practicar | **Alto** para escribir y marcar |

## 3. Decisión: B como estructura, C como interacción, A como disciplina de espacio

- **Estructura (B):** todo es un *material* compuesto por *bloques* musicales: tablatura, mapa del mástil y texto.
  Un material puede ser una sola tablatura, un solo mapa o un cuaderno de estudio con varios. El usuario nunca
  decide «qué entidad crear»: decide «escribir una tablatura», «marcar una escala» o «armar un material de
  estudio».
- **Interacción (C):** el instrumento es el medio de entrada. Para escribir una melodía se hace clic sobre el
  mástil, y para marcar una escala se marcan puntos sobre el mástil. El mástil se acopla al pie de la tablatura
  y nunca desplaza la música fuera de la pantalla.
- **Disciplina de espacio (A):** una sola barra delgada global; barra contextual de una línea por bloque, que
  solo aparece en el bloque activo; opciones poco usadas en menús y popovers; cero tarjetas.

## 4. Sistema visual

**Identidad.** Papel cálido, tinta y un único acento «brasa». No hay gradientes, no hay sombras salvo en capas
flotantes (menús, diálogos), no hay tarjetas dentro de tarjetas. Los bloques se separan con espacio, no con cajas.

| Elemento | Decisión |
|---|---|
| Tipografía de interfaz | `Segoe UI Variable` / sistema (sin descargas: funciona offline) |
| Tipografía de títulos | Serif de sistema (`Iowan Old Style`, `Palatino`, `Georgia`): da carácter de cuaderno |
| Tipografía musical | Monoespaciada de sistema (`Cascadia Mono`, `SF Mono`, `Consolas`) para trastes y BPM |
| Escala tipográfica | 12.5 · 13.5 · 15 (base) · 17 · 20 · 24 · 28 px |
| Espaciado | Base 4 px: 4 · 8 · 12 · 16 · 24 · 32 |
| Radios | 4 px campos · 6 px botones · 8–10 px capas flotantes |
| Superficies | `bg` (fondo) · `surface` (barras) · `raised` (campos y capas) · `sunken` (hover, notas) |
| Estados | hover: fondo `sunken`; foco: contorno 2 px de acento con desfase; activo/seleccionado: **peso + inversión** (`.on` es tinta sobre papel), nunca solo color |
| Controles | 32 px de alto; objetivos del mástil ≥ 46 px de ancho |
| Movimiento | solo funcional: sacudida breve ante un dígito rechazado, giro del ícono al sincronizar; respeta `prefers-reduced-motion` |

**Color semántico.** Acento (selección, tónica, cursor), verde (sincronizado), ámbar (pendiente, sin conexión),
rojo (error, destructivo). Cada estado de sincronización lleva **ícono y texto**, no solo color.

**Información musical sin depender del color.** La tónica es un punto con *doble anillo*; las notas de otras
posiciones son contornos punteados; las posiciones en la vista completa llevan color **y** número en la leyenda
(y el modo «Posiciones» pone el número dentro de la nota).

**Dos temas diseñados, no invertidos.** Claro: papel y tinta. Oscuro: grafito cálido con acento más claro y
mástil de madera oscura. Contraste comprobado (WCAG 2.2 AA): texto principal ≥ 14:1, secundario ≥ 7.7:1,
terciario ≥ 5.2:1, texto sobre acento ≥ 5.5:1, números de traste ≥ 5.5:1 en ambos temas.

## 5. Referencias consultadas (no copiadas)

- **Guitar Pro / MuseScore / Soundslice:** selección de eventos, edición por teclado, entrada de técnicas como
  operadores entre notas.
- **Figma / Ableton:** herramientas contextuales según la selección, barra mínima y consistente.
- **Notion:** documentos modulares con bloques que se reordenan, duplican y eliminan con deshacer.

## 6. Antes y después

Capturas reales en [`docs/evidence/before`](../evidence/before) y [`docs/evidence/after`](../evidence/after).
Se regeneran con `CAPTURE_EVIDENCE=1 npx playwright test tests/e2e/visual-evidence.spec.ts`.
