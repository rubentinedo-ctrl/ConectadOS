# Instalar la segunda copia en Drive con un agente

Este módulo se prepara después de instalar ConectadOS en Coolify y comprobar su copia R2. Requiere Linux, Docker, systemd, Python 3 y rclone. Protege ConectadOS; cada base observada necesita su propio respaldo. El instalador incluye comprobaciones de permisos, identidad, repetición y activación. Google requiere una autorización interactiva de tu administrador; no se incluye una cuenta del autor. La prueba completa con tus permisos debe realizarse antes de depender de esta réplica.

## Qué hace el usuario

Abre la carpeta de ConectadOS en Codex o Claude Code y escribe:

> Configura la segunda copia de ConectadOS en mi Drive. Lee AGENTS.md, docs/INSTALL-DRIVE.md y docs/DRIVE-MIRROR.md. Identifica mi instalación y conserva cualquier configuración o recibo existente. Prepara el acceso Google por navegador y una carpeta privada. Recupera primero una copia R2 en otro equipo. Muéstrame el plan con la cuenta, carpeta y permisos exactos antes de crear un acceso nuevo. Instala y activa solo después de comprobar el origen y la recuperación. No pegues tokens ni claves en el chat. Comprueba una copia nueva automática, su restauración y el estado del panel.

El agente recopila los identificadores técnicos. El usuario elige cuenta/carpeta, inicia sesión en Google y confirma un acceso nuevo cuando corresponde. La clave externa de recuperación se conserva fuera del VPS y no se sube a Drive. Los servicios pueden cobrar almacenamiento u operaciones; este módulo no necesita una API de IA.

## Preparar Google

Reutiliza un acceso existente únicamente cuando su cuenta y permisos estén autorizados para esta instalación. En una instalación nueva, prepara un cliente OAuth propio siguiendo la [guía de rclone](https://rclone.org/drive/#making-your-own-client-id). El cliente de Google para iniciar sesión en el panel es distinto.

Preferir `drive.file` y carpetas creadas por ese mismo cliente: ese alcance permite acceder a archivos y carpetas que crea la aplicación; una carpeta creada con otro acceso puede no estar disponible. No ampliar permisos para ocultar ese fallo. `root_folder_id` selecciona la carpeta de trabajo de rclone; no reduce por sí mismo el alcance OAuth. [Alcances y carpetas](https://rclone.org/drive/#scopes).

El agente prepara `rclone config` con un archivo privado propio y permisos 0600. En un VPS sin navegador puede utilizar un túnel SSH hacia el callback local de rclone, según la [configuración remota oficial](https://rclone.org/remote_setup/#configuring-using-ssh-tunnel). El usuario completa la autorización en Google. El agente comprueba cuenta, carpeta, padre, permisos y ausencia de destinatarios no autorizados. No copiar tokens manualmente al chat ni incluirlos en argumentos. No utilizar `rclone sync`, `delete` o `purge`.

El archivo rclone debe estar en una ruta privada accesible al servicio, fuera de `/root`, porque la unidad usa `ProtectHome=yes`. El agente debe identificar los nombres del recurso/volumen Coolify que valida `validate_config`; no renombrar una instalación activa para forzar coincidencia.

## Recuperación independiente antes de instalar

En otro equipo, descarga el archivo cifrado R2 con su nombre UUID y conserva la clave original en privado. Con el código revisado de esta versión:

```sh
node scripts/drive-recovery-receipt.mjs \
  /ruta/privada/UUID.cdbak \
  /ruta/privada/recuperacion-nueva \
  /ruta/privada/backup-encryption.key \
  /ruta/privada/recuperacion-drive.json \
  --outside-vps-confirmed
```

El agente debe comprobar que este comando corre fuera del VPS observado. El programa no puede determinar la ubicación física de una computadora: el argumento registra esa confirmación del agente. El comando restaura realmente, comprueba integridad, acceso a credenciales y efectos pausados, conserva el archivo de origen y crea un recibo privado 0600. Nunca reemplaza un recibo existente. La recuperación queda conservada para revisión; no se inicia automáticamente.

El recibo contiene solo versión, confirmaciones, huella del origen y metadatos del archivo (UUID, fecha, tamaño y SHA-256). No contiene claves ni cuenta Google. Puede transferirse al VPS por SSH privado. La clave de recuperación permanece fuera de esa transferencia.

## Plan y preparación del host

El agente genera el JSON del trabajador en una carpeta privada, usando `validate_config` de `scripts/drive-mirror.py`. Obtiene contenedor, digest de imagen, volumen propio y huella real mediante `describeDriveSource`. Configura `sourceFloor` con la fecha del archivo del recibo independiente y `helperSha256` con el archivo suministrado. No se solicita al usuario escribir estos identificadores. Cuenta/carpeta/usuarios autorizados proceden de su elección y de la comprobación Google.

```sh
python3 scripts/install-drive-mirror.py \
  --config /ruta/privada/drive-worker.json \
  --recovery-proof /ruta/privada/recuperacion-drive.json
```

El modo predeterminado solo muestra el plan: no consulta proveedores, crea archivos ni ejecuta órdenes del host. El resultado incluye `configHash`, que identifica la configuración exacta revisada. No imprime cuenta, carpeta, tokens ni clave de recuperación.

Si falta `/data`, prepara ese padre compartido con modo 0755; las carpetas propias de configuración y diario usan 0700. Un padre existente debe pertenecer a root, ser un directorio sin enlaces y no permitir escritura a otros usuarios. El instalador conserva sus permisos; rechaza un padre inseguro en vez de cambiarlo.

Para preparar, como root en Linux, añade `--apply`. Comprueba contenedor saludable y digest exacto, volumen propio, R2 activo, acceso Google existente y carpeta privada antes de instalar. Crea código/configuración privados y las dos unidades systemd fijas. El temporizador queda detenido en una instalación nueva. Repetir con la misma configuración conserva el diario y la activación existentes; no desactiva una instalación que ya está funcionando. Un archivo diferente, permiso inseguro, enlace o pérdida del diario exige revisión; no se reemplaza por una instalación vacía.

Para activar una instalación nueva ya revisada:

```sh
python3 scripts/install-drive-mirror.py \
  --config /ruta/privada/drive-worker.json \
  --recovery-proof /ruta/privada/recuperacion-drive.json \
  --apply --activate --reviewed-config-sha256 HUELLA_DEL_PLAN
```

La política preparada usa `enabled: true`; el temporizador permanece detenido hasta este paso. La primera activación exige que la última R2 coincida con la recuperación independiente y que no haya historia/fallos por reconciliar. Comprueba un ciclo inicial sin volver a subir esa copia y activa el temporizador. Un origen más nuevo obliga a recuperar y revisar ese archivo antes de activar. Repetir la activación de una instalación ya activa no repite el ciclo inicial.

## Comprobación final y límites

Crear una sola copia R2 nueva intencionada. Observar el temporizador y su servicio reales; no iniciar manualmente el exportador para acreditar automatización. Comprobar un recibo nuevo, descarga/restauración, otra recuperación fuera del VPS y un ciclo posterior sin duplicado. Verificar que el calendario diario R2 y los trabajos de otras aplicaciones permanezcan intactos.

El instalador no agrega montajes a Coolify ni instala el publicador de la vista. Eso requiere el procedimiento separado de [DRIVE-STATUS.md](DRIVE-STATUS.md), con ensayo de imagen, corte y copia. Tampoco actualiza exportadores instalados, crea accesos OAuth, selecciona cuentas por inferencia, limpia copias ni reintenta fallos. La guía visual está en /docs/drive. El módulo de retención prepara una vista previa; no activa borrados. Una instalación nueva debe comprobar su propio ciclo completo.
