# Primera sincronización con una sola cuenta personal

## Único requisito técnico

Antes de sincronizar, ejecutá una vez `supabase/migrations/0006_production_hardening.sql` en Supabase SQL Editor. No borra ni modifica documentos existentes.

No necesitás crear usuarios QA ni ejecutar `npm run test:supabase` para usar GuitarAP.

## Prueba segura desde la interfaz

Usá un perfil temporal y vacío de Chrome (o un segundo perfil del navegador). No uses el perfil donde está tu biblioteca local real.

1. Abrí GuitarAP en ese perfil temporal e iniciá sesión con tu única cuenta personal.
2. En Biblioteca, creá una carpeta llamada `GuitarAP · prueba de sincronización` y dentro una tablatura llamada `Material descartable`.
3. En Configuración, exportá el backup, comprobá la descarga y marcá la confirmación. Esto vincula **solamente** la biblioteca vacía/de prueba de ese perfil.
4. Pulsá **Sincronizar ahora**. Debe aparecer un resultado sin error.
5. Abrí otro perfil temporal, iniciá sesión con la misma cuenta, exportá su backup vacío, confirmalo y pulsá **Sincronizar ahora**. Deben aparecer la carpeta y la tablatura descartables.
6. En el primer perfil, enviá ambos materiales de prueba a la papelera y sincronizá. En el segundo, sincronizá otra vez y verificá que se propagó la papelera.

No hagas cambios sobre materiales personales durante esta prueba. Los materiales de prueba quedan recuperables en la papelera; no hay eliminación irreversible.

Una vez terminada, podés cerrar esos perfiles temporales. Tu perfil habitual y su IndexedDB nunca se usaron en la prueba.

## Primera vinculación de la biblioteca real

Cuando la prueba anterior haya funcionado, abrí tu perfil habitual:

1. Configuración → iniciá sesión.
2. Exportá y guardá el backup solicitado.
3. Marcá la confirmación explícita y habilitá la biblioteca.
4. Pulsá **Sincronizar ahora**.

La primera vinculación asocia la biblioteca local existente con tu cuenta sólo después de esa confirmación. No pulses sincronizar si no guardaste el backup.
