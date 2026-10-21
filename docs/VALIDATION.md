# ConectadOS RC11 · validación de la mejora de dominios

21 de octubre de 2026. RC11 conserva el instalador de RC10 y añade accesos HTTPS manuales a nombres de Cloudflare. No incorpora nuevos proveedores ni sondas automáticas; abrir un enlace no cambia la salud.

## Comprobado en esta revisión

- TypeScript/build correctos; 366 pruebas Node y batería HTTP aislada correctas.
- Normalización y rechazo de esquemas, rutas, credenciales, IP, nombres locales, comodines, etiquetas de verificación y punycode inválido. Solo zonas y registros A/AAAA/CNAME aptos.
- Mapa y explorador revisados en Chrome con datos ficticios: HTTPS, pestaña nueva, noopener/noreferrer/no-referrer; cero enlaces al ocultar nombres; A/CNAME con enlace y TXT sin enlace. Sin errores/advertencias observados de consola. No se abrieron dominios externos para probarlo.
- Actualización RC10 → RC11 ensayada en macOS arm64, con cuenta/proyecto/credencial ficticios: mismo acceso, configuración, puerto y clave de cifrado, credencial descifrable y proyecto conservados. No fue necesario crear otra cuenta. Sin conexiones reales, IA, correo ni producción.

## Resultados conservados y límites

El instalador no cambió. RC10 pasó instalación del ZIP exacto en Mac arm64 y Ubuntu amd64 aislado, siete pruebas Python y apertura TextEdit con fixture. No se repitieron restauraciones ni ensayos Linux de instalación por este cambio de interfaz. No se atribuyen esas pruebas a una nueva prueba Windows.

El propietario confirma que ya instaló la app en Mac; falta Windows/WSL2. Cada equipo debe comprobar su versión y conservar datos al actualizar. El prompt está en CONTINUAR-PRUEBAS.md. El paquete incluye guía HTML TinergIA y diferencia los cinco inventarios API de fichas manuales.

La release conserva manifiesto, ZIP y SHA-256. El acta adjunta en https://github.com/rubentinedo-ctrl/ConectadOS/releases/tag/v0.1.0-rc.11 registra la comprobación del paquete y de descarga. RC9/RC10 permanecen disponibles. Código propio MIT; accesos y datos de cada instalación quedan fuera del paquete.
