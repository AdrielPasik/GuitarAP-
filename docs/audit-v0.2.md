# Auditoría previa al rediseño (noviembre 2026)

Método: lectura del código, ejecución local, capturas reales (`docs/evidence/before`) y revisión de la URL
pública sin credenciales. Los cuatro tipos de causa se separan a propósito.

## A. Limitación correcta del modelo temporal

Una cuerda no puede sonar en dos trastes en el mismo instante. `setFret` reemplaza la nota de esa cuerda en esa
columna. Eso **es correcto** y se conserva (hay pruebas que lo fijan).

## B. Limitación incorrecta de la interfaz

- La «Entrada por mástil» de la tablatura usaba `inputFromFretboard`, que escribe siempre en la columna activa.
  Un clic en otro traste de la misma cuerda **reemplazaba** la nota, y para escribir una frase había que pulsar
  «Paso siguiente» entre clics. El avance automático existía pero estaba apagado por defecto.
- El mapa espacial sí admitía muchas notas por cuerda (verificado: 11 marcadores), pero estaba escondido tras un
  selector de «Tipo» en el diálogo de creación y no se podía combinar con una tablatura.
- Las herramientas (articulación, estructura, lectura, modos) ocupaban medio viewport sobre la música.
- Cerrar la pantalla dentro de los 700 ms del autoguardado perdía la última edición (el temporizador se
  cancelaba al desmontar sin guardar).

## C. Necesidad no contemplada

- Un material con escala + frase + anotaciones. Antes eran documentos separados sin relación.
- Iniciar sesión de forma evidente y entender si el trabajo está solo en el dispositivo o sincronizado.

## D. Defectos de implementación

| Defecto | Evidencia |
|---|---|
| «Do» se mostraba como **«Reo»** (`replace('C','Do')` y luego `replace('D','Re')`) | captura `07-mapa-latino-bug-do.png` |
| Cada nota nueva del mapa guardaba `finger: 1` aunque nadie eligiera dedo | `toggleSpatialNote` |
| «Generar escala» usaba `window.confirm` y **reemplazaba toda la posición**, borrando marcas manuales | `FretboardEditor.generateScale` |
| La posición seleccionada vivía dentro del documento: cambiar de pestaña lo modificaba y creaba versiones | `selectPosition` |
| Cada autoguardado creaba una versión completa (cientos de versiones sincronizadas) | `saveDocument` |
| `saveDocument` escribía el documento entero: un editor abierto podía pisar carpeta y papelera | `saveDocument` |
| «Cancelar» en el diálogo de importar **reemplazaba** la biblioteca (`window.confirm`) | `RecoveryScreen.importBackup` |
| Tras «Cerrar sesión» la biblioteca vinculada aparecía **vacía** (el alcance quedaba bloqueado sin dueño) | `deactivateOwner` + `belongsToOwner` |
| Volver a iniciar sesión con la copia ya confirmada no reactivaba el alcance de la biblioteca | `SyncPanel` |

## E. Inicio de sesión

1. El formulario vivía dentro de Configuración → Sincronización.
2. **El build publicado en `guitarap.pages.dev` no incluye la configuración de Supabase** (el bundle no
   contiene ninguna URL de proyecto y la barra dice «sin nube configurada»), de modo que el formulario ni
   siquiera existía en producción. Ver [despliegue](deployment.md#variables-de-entorno-del-build).
3. El estado de sincronización de la barra superior era un texto fijo, no un estado real.

## F. Por qué los tests estaban en verde y la experiencia no

Las pruebas comprobaban que los componentes existían y que `setFret` escribía en una columna dada; ninguna
reproducía lo que hace un guitarrista (escribir cinco notas seguidas desde el mástil, marcar seis puntos en una
cuerda, abrir la app sin sesión). Las pruebas nuevas parten de esos casos.
