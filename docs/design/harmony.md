# Sistema armónico del mástil (v0.3)

## Principio

El color pertenece a la **función armónica**, no a la posición ni a la pantalla. Una tercera es violeta en el
mapa individual, en la vista conjunta, en la completa, en Práctica y en cualquier exportación.

## Grados y funciones

| Función | Color (claro) | Color (oscuro) | Grados que cubre |
|---|---|---|---|
| Tónica | azul `#1d5fd1` | `#7aa8ff` | 1 (además lleva doble anillo) |
| Tercera | violeta `#8a3fc2` | `#c797f2` | 3, ♭3 |
| Quinta | verde azulado `#0a7d62` | `#45d3ab` | 5, ♭5, ♯5 |
| Séptima | naranja `#c2410c` | `#ff905f` | 7, ♭7 |
| Otros | neutro (tinta) | neutro (papel) | 2, 4, 6, ♭2, ♭6, ♯4 y extensiones |

La paleta se eligió para que cada función sea distinguible por tono *y* luminancia (azul/naranja y violeta/verde
son pares de máximo contraste y funcionan con las formas habituales de daltonismo) y para no confundirse con el
color de producto: los botones primarios pasan a tinta neutra y la brasa queda para identidad y selección.
Contraste medido: etiqueta sobre punto ≥ 5.09:1 (claro) y ≥ 7.9:1 (oscuro); punto sobre madera ≥ 3.5:1.

**El color nunca es el único canal:** cada punto lleva su número o nombre; la tónica tiene doble anillo; las
alteraciones (♭3, ♭5, ♯5, ♭7, ♭2, ♭6) llevan además un **anillo punteado** del color de su función; los grados
fuera del resaltado se atenúan en lugar de desaparecer; la leyenda repite los números.

## Grado ≠ intervalo cromático

La etiqueta se calcula desde la distancia cromática a la tónica **y** el contexto del material (las distancias
presentes en todo el mapa, de modo que todas las posiciones se rotulan igual):

- 6 semitonos: ♭5 en locrio o blues; **♯4** si hay quinta justa y no hay cuarta justa (lidio).
- 8 semitonos: **♯5** sobre una tercera mayor sin quinta justa; en cualquier otro caso ♭6.
- Opcional «Nombrar extensiones»: 2 → 9, 5 → 11, 9 → 13.

La nomenclatura de notas (Do Re Mi / C D E) es la del mapa; los intervalos no se traducen.

## Modos de lectura (solo visuales)

- **Notas**, **Intervalos**, **Ambos** (nota como etiqueta principal e intervalo debajo, dentro del mismo punto) y
  **Dedos**; **Posiciones** en la vista completa para colorear por posición (modo explícito, no el predeterminado).
- **Resaltar:** Todo · Tónica · Tríada · Séptima. La leyenda es también un filtro: tocar un grado lo aísla; tocar
  otro lo suma.
- Nada de esto agrega, quita o mueve una nota. Se guarda en `FretboardContent.view` (campos opcionales; un mapa
  anterior se lee con los valores de siempre). En Práctica los cambios son locales y no escriben nada.
