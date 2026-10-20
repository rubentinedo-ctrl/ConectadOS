# Segunda copia del panel en Google Drive

Sigue [INSTALL-DRIVE.md](INSTALL-DRIVE.md). El exportador se ejecuta en el host Linux; es distinto del inicio de sesión con Google. Identifica cuenta, carpeta privada, contenedor, imagen inmutable y copia R2 comprobada. Mantén la clave de recuperación fuera del VPS y del destino.

La vista del panel recibe un informe de solo lectura y comprobantes limitados. Una lectura vencida conserva las fechas anteriores. Cada cambio de imagen, destino, clave u origen exige revisar la vinculación y conservar los recibos; no se reactivan fallos ni se borran archivos automáticamente. Un informe del VPS no sustituye una recuperación en otro equipo.

El publicador `scripts/drive-status.py` debe ser root, no escribible por el panel, sin red y con salida privada root:1000 0640. Monta solo esa carpeta como /drive-status de lectura; habilita CONECTADOS_DRIVE_STATUS=1 tras revisar el montaje. No montes claves, configuración OAuth, socket Docker ni carpetas de otras bases en la aplicación. El instalador del trabajador no modifica Coolify automáticamente.
