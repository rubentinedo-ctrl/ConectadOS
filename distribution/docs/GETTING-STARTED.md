## Tu API y tu control de consumo

Cada instalación utiliza la API que configura su propietario. El código distribuido no incluye la clave de Tinergia ni una cuenta compartida. El proveedor factura a esa cuenta; una suscripción a ChatGPT no sustituye la facturación API.

En Ajustes → IA y voz elige el proveedor, tu modelo y guarda tu clave cifrada. El chat admite preguntas técnicas generales, ayuda del producto y análisis de las observaciones disponibles; no ejecuta reparaciones. El modelo no navega por Internet en esta versión: los cambios recientes requieren documentación actual.

Las nuevas configuraciones de texto usan **Sin límite local**. No existe un bloqueo diario obligatorio de consultas o tokens. La actividad de las últimas 24 horas se muestra como información. Puedes activar topes voluntarios de esa ventana si deseas una protección adicional. ConectadOS conserva los límites que ya tuviera una instalación anterior hasta que su propietario los cambie. Sin límite local no cambia los controles de acceso, el consentimiento, una consulta simultánea, el tamaño máximo de respuesta ni los límites del proveedor.

Cambiar la configuración invalida el contexto firmado anterior. Inicia una Nueva conversación para utilizarla. Los controles de tiempo y sesiones de voz se configuran por separado.

# Instalar ConectadOS

ConectadOS se instala en tu computadora o en tu servidor. La demostración no necesita cuentas de proveedores. La aplicación usa SQLite; no necesitas contratar una base de datos externa.

## Windows

Usa Ubuntu en WSL2 y ejecuta Node/npm dentro de Linux. Consulta [WINDOWS.md](WINDOWS.md). No se incluye instalador .exe; la prueba real en ese equipo es parte de la aceptación externa.

## Otra Mac

Sigue [MACOS.md](MACOS.md), anota Apple Silicon o Intel y empieza en una carpeta nueva con el mismo ZIP RC9 que usarás en Windows. No se trasladan datos ni claves de la instalación del autor.

## Con un agente

Guarda la carpeta completa y ábrela en Codex o Claude Code. Escribe:

> Instala ConectadOS. Lee AGENTS.md y README.md. Comprueba Node y npm. Ejecuta primero node scripts/install.mjs para revisar, y después --apply en esta carpeta si los requisitos están disponibles. Valida el arranque y la demostración. Conserva cualquier cuenta o configuración existente. Déjame elegir mi contraseña en la pantalla de acceso. Si quiero un VPS, prepara el despliegue de Coolify y comprueba HTTPS antes de exponer la aplicación.

Si descargaste el plan de la demostración, el agente puede añadir `--preferences /ruta/conectados-plan.json`. Solo contiene preferencias. No instala integraciones, activa IA ni autoriza gastos.

## Sin agente: macOS o Linux

1. Instala [Node.js 22.16 o posterior](https://nodejs.org/en/download), que incluye npm.
2. Descomprime la carpeta completa. Abre una terminal dentro de ella.
3. Ejecuta `node scripts/install.mjs`: muestra el plan sin cambiar archivos.
4. Ejecuta `node scripts/install.mjs --apply`. Descarga dependencias del archivo de bloqueo, prepara la instalación, comprueba requisitos y compila. Necesita conexión a Internet durante la descarga. Conserva cuentas y claves existentes; un conflicto detiene la instalación.
5. Ejecuta `npm start` y abre `http://127.0.0.1:3119/demo`.

Para una carpeta nueva con el puerto ocupado: `node scripts/install.mjs --apply --port 4200`. La dirección cambia a `http://127.0.0.1:4200/demo`. Un puerto nuevo no cambia una instalación existente. La ruta Windows/WSL2 requiere su prueba externa; los comandos del instalador se ejecutan dentro de Ubuntu.

## Crear tu cuenta

Abre `/access`. Usa el código del archivo privado `.keys/setup-token` y elige una contraseña de al menos 15 caracteres. No pegues el código, la contraseña ni tokens en el chat de un agente. Una instalación existente conserva su cuenta; no necesita otra.

La configuración de proveedores está en `/settings`. Cada proveedor muestra permisos, instrucciones y enlaces oficiales. Guarda el acceso y comprueba que aparezca un inventario con fecha reciente. El inicio con Google se configura para el origen de tu propia instalación; no autoriza Google Drive.

## IA, voz y costos

El mapa, las conexiones, los registros y el resumen sin IA funcionan sin pagar tokens de un modelo. Hosting, almacenamiento y correo pueden tener costos de sus propios proveedores. Para modelos comerciales y transcripción se usa tu API: la suscripción a Codex o Claude Code no cubre ese consumo. Revisa el proveedor, contenido y límite antes de enviar. Las claves permanecen cifradas en tu instalación.

## Detener, actualizar y recuperar

Detén el lanzador con Ctrl+C. Vuelve a iniciarlo con `npm start`. Comprueba requisitos con `npm run doctor`; el puerto ocupado es esperado mientras el servidor esté funcionando.

Antes de actualizar, conserva una copia y sus claves fuera del equipo. No borres `.data`, `.keys` ni `.backups` para resolver un error. `npm run backup` crea una copia local; no protege frente a perder la computadora. R2 y Drive son destinos externos opcionales. Las copias de ConectadOS contienen su catálogo y configuración; las bases de las aplicaciones observadas necesitan sus propios respaldos. Consulta la guía de actualización y recuperación de esta versión.

## VPS y Coolify

Sigue [deploy/README.md](../deploy/README.md). Usa un dominio HTTPS, proxy revisado y volúmenes independientes. El puerto 3000 es interno y no se publica directamente. La cuenta y los accesos se configuran después del despliegue. No transfieras una instalación ajena ni incluyas credenciales en una imagen o repositorio.

La publicación del repositorio y el paquete público se anuncia solo después de validar su contenido, licencias y capacidades. No existe todavía una URL pública de descarga.

## Prueba y documentación de la entrega

Abre GUIA-INSTALACION.html desde la carpeta raíz. Sigue [PRUEBA-EXTERNA.md](PRUEBA-EXTERNA.md) para registrar instalación, cuenta y reinicio. [RELEASE.md](RELEASE.md) fija el alcance de 0.1 y las mejoras posteriores.
