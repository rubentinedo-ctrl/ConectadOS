# Verificar recuperación desde Respaldos

La prueba restaura una copia existente de PostgreSQL en una instancia temporal sin red, puertos ni volúmenes de producción. No genera una copia nueva ni restaura sobre el origen. El botón muestra la versión que se probará, los límites y la aprobación. El trabajo continúa al salir de la página.

Un trabajador del host ejecuta una sola prueba a la vez: 512 MiB de memoria, 0,5 CPU, archivos temporales en memoria y margen mínimo de 2 GiB disponible. Conserva un diagnóstico privado cuando hay fallo, sin reintento automático. Una terminación inesperada se registra como fallo; los contenedores temporales vinculados a su propio diario se retiran en el siguiente ciclo. No se detienen contenedores ajenos.

## Separación de permisos

La web autenticada solo escribe solicitudes JSON acotadas en `.data/recovery-requests`. El trabajador root tiene una lista fija de referencias, archivos de copia, imágenes inmutables y snapshots privados de roles revisados por el operador. No acepta comandos, rutas, imágenes o nombres de contenedor desde la web. Docker y las claves del servidor no se montan en la aplicación. El informe vuelve por la carpeta de telemetría de solo lectura.

La solicitud caduca a los cinco minutos, identifica la versión exacta del archivo por SHA-256 y fecha, y queda vinculada al ID del contenedor del panel. Una recreación del panel invalida solicitudes pendientes. El diario impide repetir una solicitud ya procesada. Cambiar conexiones o identidad impide aplicar comprobantes anteriores. Las copias portables no instalan ni habilitan este trabajador.

## Qué comprueba

El trabajador comprueba SHA-256, restaura sin omitir propietarios ni permisos y detiene el ensayo ante errores. Compara los valores COPY de todas las tablas y las secuencias entre el archivo y un nuevo volcado de la instancia temporal. Los roles se recuperan de un snapshot separado revisado; no se conecta a la base de origen durante la ejecución. Se conserva un volcado de esquema comprobable por hash y un informe con el alcance real.

El comprobante se aplica únicamente al mismo archivo, fecha y referencia. Una nueva copia necesita un ensayo propio. Se conserva el recibo original del trabajador de respaldo, sin editar su booleano `restored`. El informe combina ambas evidencias para mostrar la restauración de PostgreSQL.

**Storage, secretos de servicios, OAuth, configuración, tareas y recorridos de la aplicación requieren comprobaciones separadas.** La inclusión en Drive acredita el lote, no la restauración externa individual. Un fallo no marca producción como caída ni modifica el archivo conservado.

## Habilitación por un agente en una instalación nueva

1. Revisar capacidad, backups vigentes, referencia exacta del catálogo y alcance de la autorización. No activar automáticamente por encontrar nombres parecidos.
2. Revisar `scripts/recovery-check-worker.py`, las imágenes ya instaladas y las fuentes. Guardar roles de cada base por separado mediante lectura autorizada, fuera de Git y con permisos 0600. Nunca usar claves del piloto.
3. Crear configuración root:root 0600 en `/etc/conectados-recovery-checks/config.json`: `schema`, `container` propio, `identity` de su conexión Coolify, `requests` (ruta física de `.data/recovery-requests`), `journal` privado y `bindings`. Cada clave de `bindings` es una referencia exacta y contiene `status`, `image` por digest, `user`, `database`, `supabase` y `roles`. Los status son los archivos nativos ya revisados, con `archive_identity`, `sha256`, `bytes` y fecha UTC. No es un ejecutor genérico para otros formatos.
4. Crear la cola como UID/GID de la aplicación (1000), directorio 0700 sin enlaces. Instalar el script root en `/opt/conectados-recovery-checks/worker.py`. El directorio de resultados y diario pertenecen a root; solo el informe público se entrega root:1000 0640 al lector de telemetría.
5. Ensayar las referencias autorizadas antes de instalar un servicio oneshot y temporizador. Restringir red, memoria y escrituras al diario y telemetría; conservar acceso al socket local Docker únicamente en el trabajador del host. No conectar ese socket al panel.
6. Comprobar aprobación/cancelación, sesión, origen, referencia y versión cambiadas, doble envío, fallo, limpieza y resultados. Conservar informes independientes fuera del VPS. Cada instalación requiere su propia revisión; un servidor sin ejecutor muestra el botón deshabilitado con una explicación.

Esta función no está habilitada por defecto para quien descarga ConectadOS.
