# Arquitectura de experiencia (v0.2)

## Modelo mental

GuitarAP es un cuaderno musical. El guitarrista piensa en tareas, no en entidades:

| Quiero… | Acción visible |
|---|---|
| escribir un riff o un solo | Nuevo → **Tablatura** |
| estudiar una escala | Nuevo → **Mapa de escala** |
| juntar escala, frase y apuntes | Nuevo → **Material de estudio** (o «Agregar bloque» en cualquier material) |
| organizar canciones | Nuevo → **Canción** / **Carpeta** |
| tocar | **Practicar** |

## Dos representaciones, una regla clara

| | Secuencia (tablatura) | Mapa (diapasón) |
|---|---|---|
| Qué es | Eventos en orden temporal | Puntos sobre el instrumento, sin orden |
| Varias notas en una cuerda | Solo en eventos distintos (una cuerda no suena en dos trastes a la vez) | **Sí, todas las que quieras** |
| Un clic en el mástil… | Melodía: agrega el **evento siguiente**. Acorde: agrega una cuerda al **mismo evento** | Marca o desmarca el punto |
| Dónde se escribe | Bloque «Tablatura» | Bloque «Mapa del mástil» |

Esto fue verificado con pruebas: el modelo temporal nunca admite dos trastes en una cuerda de un mismo evento,
y el mapa admite cualquier cantidad. Ambos conviven en un mismo material, así que **no hace falta abandonar el
documento** para mostrar una escala dentro de una tablatura.

## Material = bloques

```
Material (título, ubicación, historial)
 ├─ Bloque · Mapa del mástil   (posiciones, tónica, intervalos, dedos)
 ├─ Bloque · Título de sección
 ├─ Bloque · Tablatura          (eventos, técnicas)
 └─ Bloque · Nota de estudio
```

Los bloques se agregan (menú «Agregar bloque» o el «+» entre bloques), se reordenan, duplican y eliminan.
Eliminar muestra «Deshacer»; además todo cambio queda en el historial de versiones. Los títulos de sección
alimentan la navegación por secciones de Práctica.

## Entrada de tablatura

**Teclado.** Los números se escriben en la celda activa. `0` y `3`–`9` se confirman al instante; `1` y `2`
esperan un segundo dígito (12, 15, 24) o una tecla de confirmación. No hay temporizadores: el resultado no
depende de la velocidad. Un dígito inválido (por ejemplo `2` `5`) se **rechaza** y nunca escribe en otra celda.
El cursor avanza al confirmar y la tablatura crece al final de la frase.

**Mástil.** Dos modos explícitos, siempre visibles junto al mástil:
- *Melodía*: cada clic es la nota siguiente. Nunca pisa música existente: si el evento siguiente ya tiene
  notas, inserta uno nuevo.
- *Acorde*: varias cuerdas en el mismo evento; volver a hacer clic en una cuerda la corrige sin tocar las demás;
  «Siguiente evento» pasa al acorde que sigue.

**Técnicas.** `h`/`p` (ligado), `/` `\` (slide), `b` (bend ½ → 1 → nada), `~` (vibrato), `x` (apagada). Ligado y
slide unen la nota con la **siguiente de la misma cuerda**; el sentido (hammer-on o pull-off, slide ascendente
o descendente) se deduce de los trastes, de modo que no puede existir un gesto contradictorio.

## Cuenta y sincronización

| Estado | Lo que ve la persona |
|---|---|
| Sin sesión | «Solo en este dispositivo» + botón **Iniciar sesión** siempre visible en la barra superior |
| Con sesión, sin vincular | «Falta activar la sincronización» → asistente de tres pasos: descargar copia verificada, confirmar, vincular |
| Vinculada | «Todo sincronizado», «N cambios pendientes», «Sincronizando…», «Sin conexión», «No pudimos sincronizar», «N conflictos por revisar» |

- El trabajo local nunca se bloquea por falta de cuenta o de red.
- **Cerrar sesión solo detiene la sincronización**: no oculta ni borra materiales de este dispositivo.
- Los errores de autenticación se explican con palabras («El correo o la contraseña no son correctos»), sin
  códigos HTTP. El detalle técnico no se muestra.
- Si el build no tiene Supabase configurado, el diálogo lo dice con claridad en lugar de ocultar el botón.

## Práctica

Vista de lectura independiente: el material en grande (zoom 80–220 %), selector de material con búsqueda,
anterior/siguiente (dentro de la canción si pertenece a una), navegación por secciones, metrónomo siempre a
mano. **Modo foco** (tecla `F`): oculta toda la interfaz; queda una franja inferior con el metrónomo que
*reserva* su espacio (no flota sobre la música). `Esc` sale. Pantalla completa cuando el navegador la ofrece.

## Navegación

Una barra superior única: identidad, Biblioteca · Práctica · Configuración, metrónomo, cuenta/estado, tema.
En pantallas angostas la navegación pasa a la parte inferior. La ubicación de la biblioteca vive en la URL
(`/biblioteca?c=…`), de modo que «Volver» y el botón Atrás regresan a la carpeta correcta.
