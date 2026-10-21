# ConectadOS RC12 · validación del asistente de bienvenida

21 de octubre de 2026. RC12 añade el asistente opcional de conexión inicial y conserva los cinco conectores de RC11. El instalador y las dependencias no cambian.

## Comprobado

- 371 pruebas Node correctas, incluidas selección, pasos, posponer, conflictos entre pestañas, rechazo de campos de secretos y finalización condicionada a lecturas recientes.
- TypeScript, build y batería HTTP aislada correctos: acceso y origen protegidos, progreso persistente después de reiniciar, sin consultas externas.
- Progreso conservado al reabrir SQLite y recuperar una copia local del estado. Cambiar preferencias no lo borra. Tabla adicional compatible con el formato de estado actual; no contiene credenciales.
- Recorrido en Chrome con cuenta ficticia: apertura automática, selección de plataformas, enlaces oficiales, formularios, resumen pendiente, posponer y retomar tras recargar/reiniciar, y apertura desde Ajustes. El resumen no permite declarar completas conexiones que no se consultaron.
- Formularios existentes reutilizados. Tokens en la bóveda cifrada; campos sin guardar no se conservan como borradores. No se crean conectores nuevos ni se activa observación, IA, correo o respaldo desde el asistente.

## Límites de estas pruebas

Las pruebas usan datos ficticios y no sustituyen una conexión nueva a cada cuenta del usuario. No se realizaron llamadas reales a proveedores, envíos de correo ni consumo de IA. No se modificó el VPS ni su aplicación instalada.

El instalador no cambió desde RC10: se conservan sus ensayos de instalación del ZIP en Mac arm64 y Ubuntu amd64. RC11 conservó cuenta/proyecto/credencial cifrada en actualización desde RC10. Windows/WSL2 sigue pendiente de la prueba externa del usuario; no se ofrece ejecutable Windows nativo. El propietario ya confirmó una instalación Mac, pero debe actualizar su versión para ver el asistente.

La guía HTML con logo incluye el nuevo recorrido y cómo continuar después. El paquete público excluye estado, credenciales, dependencias instaladas e historia privada. La entrega conserva manifiesto y archivo SHA-256. RC9, RC10 y RC11 permanecen disponibles.
