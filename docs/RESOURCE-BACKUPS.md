# Salud y protección por base

El lector de ConectadOS consulta metadatos de trabajos existentes. No abre SQL, archivos de copia, claves ni acceso a Drive. No crea copias, restaura, poda ni reinicia aplicaciones. La demostración y un servidor sin lector muestran falta de evidencia.

## Recorrido

El publicador Linux `scripts/resource-backup-status.py` lee únicamente `status.json` de las carpetas expresamente vinculadas bajo `/data/coolify/backups`. Lee además el resultado del envío general a Drive y el identificador del agente de host. Descarta rutas de archivos, errores privados, tokens y campos adicionales; publica un JSON acotado en la carpeta de telemetría ya montada de solo lectura.

El recolector valida origen, host autorizado reciente y referencia exacta de cada base. La referencia incluye la conexión y su identidad; un token reemplazado requiere revisar la vinculación. Un nombre parecido no identifica una base. Se conserva un historial de hasta 3.000 comprobantes, sin poda automática; una copia nueva fallida no hereda la restauración anterior. Una lectura vence a los tres minutos y una copia a las 25 horas, con fechas diferentes.

«Restauración local registrada» describe el informe del trabajador. ConectadOS no ejecutó otra restauración para mostrarlo. «Componente incluido» describe un lote diario de Drive con hash remoto comprobado, que incluye ese componente en esa fecha. El recibo general no identifica el hash individual de cada base: esta vista no acredita recuperación externa de su versión concreta. La evidencia de restauración externa permanece en los registros independientes hasta integrar un formato compatible.

## Preparación por un agente

1. Leer estas instrucciones, comprobar el lector de host existente y su montaje de solo lectura. No conectar el socket Docker a ConectadOS ni publicar directorios de copias.
2. Inspeccionar los informes existentes y el código exacto de los trabajadores, sin ejecutarlos. Confirmar qué significa `restored` y qué datos incluyen. Esta versión admite informes `success/failed/running`, timestamp UTC `YYYYMMDDTHHMMSSZ`, tamaño, SHA-256 y booleano `restored`. Otros formatos requieren un adaptador revisado y probado.
3. Vincular cada trabajador a la base exacta del inventario autorizado; verificar el contenedor/UUID usado por el trabajador. Obtener `ref` del catálogo vigente de ConectadOS, no construirlo por nombre. Guardar `/etc/conectados-resource-backups/config.json` root:root, 0600, fuera de Git.
4. Configuración: `{"schema":1,"bindings":[{"ref":"REFERENCIA_HEX_64","label":"carpeta-del-trabajador","component":"componente-en-lote-drive","coverage":"Alcance comprobado del trabajo"}]}`. Sin claves, URLs de archivos, comandos o rutas suministradas por el navegador.
5. Ejecutar revisión sin efectos: `python3 scripts/resource-backup-status.py --config /etc/conectados-resource-backups/config.json --review`. Comprobar que todas las fuentes y rutas son regulares, acotadas y sin enlaces. Conservar el lector y los trabajos originales.
6. Instalar el publicador revisado en `/opt/conectados-resource-backups/resource-backup-status.py`, propiedad root y no escribible por la aplicación. Usar un servicio oneshot separado, sin red, sin shell, sin acceso a secretos de migración/Docker/SSH, raíz de solo lectura y escritura limitada a la carpeta de telemetría. Ejecutarlo cada minuto. Esto lee metadatos privados con root; no conceder acceso de escritura a ConectadOS ni reutilizar un usuario de login.
7. Comprobar una publicación, su caducidad, identidad, estados por base y ausencia de secretos. Confirmar que el temporizador del publicador está activo y que los trabajadores de respaldo no se modificaron. Las pruebas de malformación/fallo se realizan con fixtures.

El publicador no instala ni modifica automáticamente un servicio. Conservar el plan, hashes de código/unidad/configuración y revisión del recurso exacto antes de aplicar. Un cambio de host o conexión exige otra revisión; recuperar una copia del panel no habilita automáticamente un publicador ajeno.
