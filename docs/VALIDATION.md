# ConectadOS RC9 · cómo leer la validación

Este es un candidato de fuentes para prueba externa, versión `0.1.0-rc.9`. El alcance queda cerrado. No incluye cuentas, claves, copias, dependencias instaladas ni servicios del autor. No hay funciones nuevas respecto de la aplicación revisada; se actualizan distribución e instrucciones.

## Comprobaciones previas de las fuentes

El 20 de octubre de 2026, TypeScript y 361 pruebas Node terminaron sin fallos. Incluyen informes, contexto del chat, inventario, avisos, empaquetado e instalador. Se corrigió la omisión de fuentes nuevas todavía no registradas en Git y se añadió una prueba que demuestra su inclusión sin incorporar estado ignorado. Esto no acredita por sí solo una instalación nueva.

## Identidad y ensayo del archivo entregado

El ZIP incluye `SOURCE-MANIFEST.json`: cada fuente tiene tamaño y SHA-256. La entrega adjunta un `.zip.sha256` y un acta `ConectadOS-RC9-VALIDACION.md` con el hash del mismo ZIP y los resultados de instalación concretos. El acta se mantiene fuera del ZIP para poder registrar resultados sin cambiar el artefacto probado. Compara el hash antes de usarla como evidencia.

Las pruebas automatizadas emplean cuentas ficticias y carpetas nuevas; no conectan proveedores, envían correos, consumen IA ni modifican el VPS. Su alcance es instalación, demostración, protección de acceso, persistencia de cuenta, reinicio, configuración y ausencia de datos del autor. Linux amd64 en una máquina virtual sobre Mac no acredita Windows/WSL2 ni rendimiento amd64 nativo.

## Pruebas que hace el propietario

Completa un resultado independiente de `PRUEBA-EXTERNA.md` en Windows/WSL2 y otro en la otra Mac. Registra sistema y arquitectura, Node, navegador, etapa y errores sin secretos. Una prueba en la Mac del autor no acredita una Mac Intel o un equipo distinto. El archivo de resultado de la guía HTML permite registrar las marcas, pero hay que completar los datos del equipo.

Google, proveedores, IA/voz y copias externas son opcionales y necesitan las credenciales y permisos propios del usuario. No se declaran validados en una instalación nueva por haber funcionado en la del autor. El ejecutor Linux de recuperación, telemetría del host y observador externo se configuran por separado.

## Publicación

La prueba externa precede a la publicación. El manifiesto conserva `publicationReady: false` mientras sea candidato; no es una certificación legal ni de seguridad. MIT cubre el código propio; las dependencias y marcas conservan sus condiciones. Esta entrega no redistribuye ejecutables, dependencias instaladas ni imágenes Docker. No se anuncia una dirección GitHub ficticia.
