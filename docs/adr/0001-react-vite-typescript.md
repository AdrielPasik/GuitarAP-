# ADR 0001: React, Vite y TypeScript estricto

**Estado:** aceptado (F0)

Se adopta React con Vite y TypeScript en modo `strict`. React da una base adecuada para los futuros editores independientes; Vite mantiene el ciclo local rápido y construye archivos estáticos para Pages. El modo estricto y `noUnusedLocals`/`noUnusedParameters` descubren contratos incompletos temprano.

No se introduce estado global ni una biblioteca de componentes en F0: todavía no hay un dominio que lo justifique.
