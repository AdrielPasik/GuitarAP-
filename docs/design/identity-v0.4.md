# Identidad v0.4: el estudio

## Tres direcciones

| | A · Music Atelier | B · Creative Recording Studio | C · Musical Universe |
|---|---|---|---|
| Idea | Taller personal: papel, tinta, edición | Superficies profundas, controles precisos | Guitarras flotantes, notas suspendidas |
| Fortaleza | Lectura de letras y cuadernos, calidez | Precisión de controles, foco | Inspiración, memoria visual |
| Riesgo | Puede quedarse en «elegante y quieta» | Parece un DAW (se pidió que no) | Distrae y cansa si está siempre |

**Elegida: A + C con la precisión de B.** Papel, tinta y la brasa como base (A); guitarras, notas y cuerdas
flotando **solo donde no se escribe música** (C); controles compactos, contrastes medidos y los colores armónicos
de v0.3 como único lenguaje de color musical (B).

## Marca

El isotipo es una **G** dibujada como la boca de una guitarra: un aro abierto, **seis cuerdas** que lo cruzan y una
**cabeza de nota** (con plica) donde la G se abre. Una idea, tres lecturas: instrumento, escritura, monograma.
Probado de 16 px a gigante, claro y oscuro. Se descartó la dirección con pentagrama (el pentagrama no es parte del
producto). Archivos: `public/brand/*.svg` (marca y lockup, claro/oscuro), `public/icons/*` (SVG y PNG 192/512,
maskable, favicon, apple-touch), exploración en `docs/brand/`. El lockup usa Fraunces; los SVG sueltos caen a una
serifa del sistema si Fraunces no está instalada (limitación conocida).

Uso: espacio libre mínimo = alto de la cabeza de nota; no recolorear la cabeza de nota; sobre fondos oscuros usar la
variante dark; por debajo de 20 px usar el isotipo sin cuerdas (`strings={false}`).

## Tipografía (tres familias, todas OFL, empaquetadas, solo subconjunto latino)

- **Fraunces** (variable): títulos, nombres de notas, letras. Personalidad editorial.
- **Figtree** (variable): interfaz y lectura. Humanista, muy legible en tamaños pequeños.
- **JetBrains Mono** (variable): números de tablatura, tempo y entrada de texto musical.
Ninguna decorativa en controles pequeños. Total ≈ 144 kB de woff2, en la caché de la PWA.

## Paleta

Se conserva la de v0.3: papel `#f4efe6`, tinta `#1f1c17`, brasa `#b5441a` (identidad y selección) y los cuatro
colores armónicos (tónica azul, tercera violeta, quinta verde azulado, séptima naranja). El círculo de quintas y el
explorador de acordes los reutilizan con el mismo significado.

## Ilustración y movimiento

Dos guitarras (acústica y eléctrica) dibujadas como línea, cuerdas que atraviesan el encabezado, un anillo de
quintas y cinco glifos de notas; todo SVG propio, `currentColor`, `aria-hidden`, `pointer-events: none`.

- Solo en **Biblioteca**, **estados vacíos** y encabezado de **Configuración**. En cuadernos y Práctica no se
  dibuja (probado).
- Movimiento: solo `transform` y `opacity`, ciclos de 13 a 40 s. Se detiene con `prefers-reduced-motion`, con la
  pestaña oculta y con el interruptor «Movimiento suave». «Ilustraciones decorativas» las oculta por completo.
- Microinteracciones: aparición escalonada del encabezado, nota que sube un poco al sonar, chips con elevación.

## Autocrítica de las capturas (`docs/evidence/v0.4`)

- *¿Tiene identidad?* Sí: titular en Fraunces cursiva, marca G, escena con guitarras. Reconocible.
- *¿Inspira?* La biblioteca ahora invita («¿Qué vas a componer hoy?») y parte del trabajo real del usuario
  («Seguir con», «Ideas pendientes»).
- *Corregido tras mirar:* guitarras recortadas por el borde, glifo de nota pisando el titular, checkbox gigante en
  el reparto de sílabas, pestañas del panel de armonía recortadas, subtítulo de sección con jerarquía incorrecta.
- *Pendiente:* las guitarras son estilizadas, no ilustraciones de lutier; la escena podría tener una variante
  nocturna más rica; el círculo de quintas apiña el rótulo alternativo F♯/G♭; la maqueta móvil del cuaderno es
  larga (la edición avanzada en móvil es funcional pero no refinada).
