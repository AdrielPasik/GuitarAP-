# ADR 0002: Módulos por capacidad y límites explícitos

**Estado:** aceptado (F0)

La app separa composición (`app`), componentes compartidos y capacidades (`features`). Los features no se importan entre sí. Las funcionalidades futuras se crean solo en su fase aprobada y exponen una superficie pequeña a `app`.

Esta estructura evita una carpeta de "utils" que acumule negocio y evita crear desde F0 módulos vacíos de biblioteca, sincronización o editores.
