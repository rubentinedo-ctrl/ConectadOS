# Operación de tu instalación

## Acceso y configuración

Crea la cuenta en `/access` con el código privado `.keys/setup-token` y tu contraseña. Configura los proveedores desde `/settings` siguiendo los enlaces y permisos que muestra cada formulario. Cada instalación usa sus propios accesos. La cuenta Google solo autoriza inicio de sesión; Drive usa un flujo y permisos diferentes. No guardes secretos en el repositorio ni los pegues en un chat.

## Copias y recuperación

`.data`, `.keys` y `.backups` son privados. `npm run backup` crea una copia local, que no protege ante perder el equipo. Usa destinos externos independientes para protección ante esa pérdida. Conserva la clave de recuperación fuera del VPS y fuera del bucket; una copia cifrada sin clave no puede recuperarse.

Las copias protegen ConectadOS, no las bases observadas. Una subida no equivale a restauración. Comprueba integridad, cuenta y datos en un destino nuevo; conserva el origen y pausa avisos, recolector y programación para evitar efectos duplicados. Nunca sobrescribas una instalación que recibió escrituras posteriores. La recuperación local recibe carpeta de copia, destino nuevo y archivo vault.key. La recuperación cifrada recibe archivo cifrado, destino nuevo y archivo backup-encryption.key; los tres deben ser rutas absolutas. El agente debe revisar scripts/restore.mjs o scripts/restore-encrypted.mjs antes de ejecutar el recorrido correspondiente. Las claves se indican por ruta, nunca por su contenido.

R2 requiere su acceso S3 autorizado y una copia comprobada antes de activar programación. La política activa realiza una primera copia y luego una diaria; no borra objetos. Un fallo o resultado incierto requiere revisión, sin reintentos ciegos. Drive requiere el exportador Linux separado: `python3 scripts/install-drive-mirror.py --help`. Primero plan sin efectos; instalación y activación son pasos distintos, con OAuth propio y recuperación independiente. El instalador mediante agente pasó un ensayo real en Ubuntu con OAuth propio, copia programada y recuperación en otro equipo. Cada instalación debe comprobar sus propios permisos y destino; el asistente OAuth integrado en la interfaz se aplaza.

## Actualizaciones

Detén el único escritor y conserva una copia reciente con sus claves separadas. Ensaya candidato y retorno sobre una copia aislada antes de cambiar la imagen de tu recurso Coolify. Mantén volúmenes, origen HTTPS y formato de almacenamiento. Si vuelves al código anterior, conserva y verifica los datos más recientes; no reinstales una copia antigua encima. No reutilices activaciones automáticas desde una restauración.

## IA, voz y acciones

El resumen sin IA no consume tokens. Los modelos comerciales usan API propia: configura proveedor, modelo y límites desde el panel; revisa contenido antes de enviar. El modelo no recibe claves ni shell. Los datos pueden salir a tu proveedor elegido.

La transcripción usa una clave propia de OpenAI, captura manual y consentimiento. El micrófono exige permiso del navegador. Revisa el clip y el texto; cancela desde el control correspondiente. La lectura del sistema depende del navegador y de sus voces. La conversación real con interrupción fue aceptada en el entorno del operador. Comprueba calidad y micrófono en tu propio equipo.

La IA local requiere servicio privado, nube desactivada y modelo adecuado al equipo. No se descarga ni se habilita por elegir una preferencia. Los modelos pequeños pueden inventar datos: una respuesta no acredita calidad. No abras el servicio de modelos al público.

Las acciones muestran recurso e impacto y exigen aprobación específica. Ante resultado incierto, consulta el estado antes de repetir. No uses el asistente para autorizar borrados o reinicios por inferencia.

## Observador externo

El observador de deploy/observer se instala aparte del VPS observado, con almacén privado y credenciales nuevas de cron, lectura y control. Genera identidades propias, prueba recepción de correo y habilita el canal explícitamente. La lectura del panel no activa envíos. No transplantes una activación desde una copia.
