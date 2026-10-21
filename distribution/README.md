# ConectadOS

RC10 · descarga pública: [paquete y guía](https://github.com/rubentinedo-ctrl/ConectadOS/releases/tag/v0.1.0-rc.10). Para descargar sin cuenta: `git clone --branch v0.1.0-rc.10 --single-branch https://github.com/rubentinedo-ctrl/ConectadOS.git`.

Abre **GUIA-INSTALACION.html** con doble clic. Incluye el logo de TinergIA, el alta y la configuración de cada proveedor. La instalación y demo no requieren APIs ni un agente de pago. Un agente debe usar una terminal del equipo de destino.

**Inventario API disponible:** Coolify, Vercel, Cloudflare, Hostinger (un VPS elegido) y Supabase Cloud. **Registro manual sin API:** Netlify, EasyPanel, GoHighLevel y otras fichas. Resend sirve para correo; R2/Drive para copias; IA/voz son opcionales y con accesos propios. [Alcance exacto](docs/CONNECTIONS.md).

Panel de infraestructura que puedes alojar en tu computadora o servidor. Explora aplicaciones, bases y dominios en un mapa; consulta Coolify, Cloudflare, Vercel, Hostinger y Supabase; organiza proyectos y revisa observaciones, historial, avisos y costos registrados.

El explorador abre categorías, proveedores y recursos por niveles. Conserva el dashboard de capacidad e historial. Puedes registrar otras plataformas y asociarlas a proyectos; una ficha manual no activa su API. Los informes incluyen análisis, gráficos y explicaciones. Puedes descargar HTML autónomo, PDF directo o Excel con el detalle. Nombres e importes privados se ocultan por defecto al exportar.

**ConectadOS 0.1 RC10 · entrega para prueba externa.** El código propio tiene licencia MIT. Este paquete contiene fuentes y archivos de bloqueo, sin dependencias instaladas, datos, claves ni configuración del autor. El repositorio y las descargas RC10 son públicos; la aceptación externa sigue pendiente. Consulta [el alcance y sus límites](docs/PRODUCT.md).

Dashboard con métricas de Hostinger y ayudas, mapa por proveedor, alertas con limpieza/reescaneo, chat con contexto de inventario y topes opcionales. [Informes explicados](docs/REPORTS.md) y [verificación de recuperación opcional del host](docs/RECOVERY-CHECKS.md).

Bases con aplicación y alojamiento explícitos; [diagnóstico sin cambios](docs/DIAGNOSTICO.md), con estados nuevos e historial comparable.

Las aplicaciones creadas y sin despliegues registrados tienen su propia [clasificación](docs/CLASIFICACION.md): Preparada · sin desplegar.

## Empieza aquí

1. Descarga el ZIP de esta entrega y extrae la carpeta completa, sin copiar datos de otra instalación.
2. Abre [GUIA-INSTALACION.html](GUIA-INSTALACION.html) con doble clic: guía autónoma de TinergIA, con ruta Windows, pasos copiables y checklist descargable.
3. Prueba primero la demostración y tu cuenta, sin APIs. Después añade un proveedor propio.
4. Completa [la prueba externa](docs/PRUEBA-EXTERNA.md) antes de ofrecer o publicar esta versión.

## Instalación

Necesitas Node.js 22.16 o posterior con npm y conexión a Internet para descargar dependencias. Las pruebas de esta entrega se registran en [VALIDATION.md](docs/VALIDATION.md); la aceptación en tus dos equipos está pendiente. Para la otra Mac sigue [MACOS.md](docs/MACOS.md). En Windows usa [Ubuntu con WSL2](docs/WINDOWS.md): Node y npm se ejecutan dentro de Linux. La aceptación Windows/WSL2 se confirma con tu prueba; no se incluye instalador .exe.

Puedes descargar y extraer el ZIP o clonar la etiqueta v0.1.0-rc.10 del repositorio público rubentinedo-ctrl/ConectadOS. Abre esta carpeta en Codex, Claude Code o un agente con terminal local como Antigravity, con su terminal en el mismo sistema donde instalarás, y escribe:

> Instala ConectadOS. Lee AGENTS.md y README.md. Revisa requisitos, ejecuta el instalador y valida el arranque. Conserva configuraciones existentes. Empieza con la demostración local sin APIs y deja que yo elija mi contraseña.

También puedes hacerlo desde una terminal en esta carpeta:

```sh
node scripts/install.mjs
node scripts/install.mjs --apply
npm start
```

Abre `http://127.0.0.1:3119/preview` para explorar la interfaz con datos ficticios, sin APIs. El primer comando muestra el plan; el segundo instala y compila. Para una carpeta nueva puedes elegir otro puerto con `--port 4200`. Ctrl+C detiene la aplicación; `npm start` vuelve a iniciarla. [Guía paso a paso](docs/GETTING-STARTED.md).

## Tu cuenta y conexiones

En `/access` crea tu cuenta con tu propia contraseña. En una segunda terminal, `npm run setup:code` abre el código privado en TextEdit (Mac) o Bloc de notas (Ubuntu WSL2), sin imprimirlo. Cópialo solo en la app y cierra el editor sin guardar cambios. En `/settings`, cada proveedor explica los permisos y enlaza a su página de accesos. Guardar un token no equivale a comprobar la conexión. Google requiere configurar el origen de esta instalación en tu proyecto de Google Cloud; iniciar sesión con Google no autoriza Drive.

La demostración no consulta cuentas. El mapa real requiere conexiones autorizadas; una observación puede estar vencida o cubrir solo parte de un servicio. La aplicación no garantiza la disponibilidad de tus aplicaciones ni administra automáticamente sus bases de datos.

## Alcance de esta versión

Consulta [RELEASE.md](docs/RELEASE.md) para las funciones incluidas y límites. OAuth visual de Drive, retención con borrado y mantenimiento avanzado quedan en la hoja de ruta posterior, sin bloquear esta entrega. La marca se describe en [BRAND.md](docs/BRAND.md).

## IA y costos

El panel y el resumen sin IA funcionan sin una API de modelos. IA, transcripción y conversación en tiempo real son opcionales y usan tus claves. [Voz y límites](docs/REALTIME-VOICE.md). El consumo lo cobra el proveedor en tu cuenta. Las suscripciones a un agente de programación no incluyen ese consumo. La opción de modelo local requiere instalación y revisión separadas; su calidad depende del modelo. [Operación y límites](docs/OPERATIONS.md).

## Servidor, copias y licencias

Para Coolify usa [la guía de servidor](deploy/README.md). No publiques directamente el puerto de Node. Usa HTTPS y volúmenes propios. Las copias del panel incluyen su catálogo y configuración; las bases observadas necesitan sus propios respaldos. Conserva las claves fuera del servidor y comprueba una restauración antes de depender de una copia. [Segunda copia en Drive](docs/INSTALL-DRIVE.md), [protección por base](docs/RESOURCE-BACKUPS.md) y [vista previa de retención](docs/RETENTION.md).

MIT cubre el código propio; las marcas y dependencias conservan sus condiciones. `npm ci` descarga las dependencias según el lockfile. El build preserva sus avisos. Este archivo de fuentes no distribuye binarios de terceros. [Dependencias y límites de redistribución](docs/DEPENDENCIES.md).

## Dónde está cada función

Mapa reúne aplicaciones, bases, dominios, servidores y otras plataformas. Dashboard muestra capacidad e historial; el detalle del VPS se despliega allí. Alertas contiene avisos y resultados del monitor externo. Respaldos muestra la evidencia de recuperación. Costos, Asistente e Informes mantienen sus funciones.

Ajustes es el único acceso a proveedores, IA y voz, cuenta, respaldos y monitores. «Ocultar nombres» ayuda a compartir pantalla; no anonimiza todos los datos. Los reinicios están en las opciones avanzadas de cada recurso de Coolify y siempre requieren revisar y aprobar la orden.
