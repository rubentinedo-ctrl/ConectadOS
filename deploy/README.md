# Instalar en Coolify

Necesitas un dominio propio, Docker/Coolify, proxy HTTPS y capacidad disponible. Este candidato de fuentes no incluye una imagen publicada ni un registro público.

1. Revisa README.md, docs/PRODUCT.md y docs/DEPENDENCIES.md. Guarda el código revisado en tu propio repositorio autorizado.
2. Crea un recurso nuevo Docker Compose desde ese repositorio. Base Directory: esta carpeta. Docker Compose Location: `compose.yml`.
3. Define `CONECTADOS_PUBLIC_ORIGIN` con tu origen exacto, por ejemplo `https://console.example.com`, sin puerto, ruta ni barra final. No es una credencial.
4. En Domains conecta ese mismo dominio al servicio conectados, puerto interno 3000. Apunta DNS al proxy y comprueba certificado y redirección HTTPS. El Compose no publica puertos al host.
5. Revisa los tres volúmenes independientes, usuario node, raíz de solo lectura y límites. La compilación puede requerir más memoria que el runtime de 1 CPU/1 GiB. No compiles en un VPS saturado.
6. Despliega y comprueba salud, `/demo` y `/access`; la API privada debe rechazar acceso sin sesión. Lee el código inicial del volumen de claves sin imprimirlo en logs; el propietario crea su cuenta y contraseña en la aplicación.
7. Configura y valida tus propios proveedores y copias. No reutilices accesos ni datos del autor. Sigue docs/OPERATIONS.md antes de activar efectos o actualizar.

No se permite incluir configuración, credenciales, cuenta o volúmenes dentro de una imagen o repositorio. Una compilación correcta no valida DNS, HTTPS ni conexiones.
