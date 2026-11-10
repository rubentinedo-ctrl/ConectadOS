# Continuar las pruebas de una instalación existente

La instalación de Mac fue confirmada por el propietario. Windows sigue pendiente. La versión de cada equipo debe comprobarse leyendo package.json; no se deduce de la fecha ni de la demo.

## Prompt para Mac ya instalada

> Continúa la prueba de ConectadOS que ya está instalada en esta Mac. Localiza la carpeta y comprueba su versión y el proceso de arranque. No reinstales desde cero ni crees otra cuenta. La versión de referencia es https://github.com/rubentinedo-ctrl/ConectadOS, etiqueta v0.1.0-rc.13. Si hace falta actualizar, prepara antes una copia local privada recuperable de la configuración, estado y claves; revisa las instrucciones y compatibilidad. Actualiza únicamente el código necesario, conservando .data, .keys, .backups, contraseña, configuración, tokens y puerto. No sobrescribas cambios locales sin conservarlos. Detén y reinicia solo el proceso de esta instalación; no toques el VPS ni otras apps. Comprueba acceso con mi cuenta, persistencia, Dashboard, Mapa, Informes y Ajustes. Abre el asistente de bienvenida desde Dashboard o Ajustes → Proveedores; selecciona plataformas, avanza, pulsa Configurar después y verifica que al reiniciar conserva el paso sin borrar accesos. No cambies los tokens existentes. Revisa las guías de los cinco conectores y sus enlaces de credenciales. En Cloudflare comprueba que las zonas y los registros web admitidos tengan enlaces HTTPS a otra pestaña, que Ocultar nombres también los oculte y que MX/TXT no aparezcan como webs. No abras mis dominios automáticamente, conectes proveedores nuevos, consumas IA ni envíes correos para esta prueba. Entrégame el resultado y errores sin secretos; yo escribo mis contraseñas directamente en la app.

Los archivos privados no deben subirse a GitHub ni al chat. Si el agente está en un contenedor remoto, debe indicarlo y usar la terminal local del equipo; una prueba en Linux remoto no sustituye macOS.

## Prompt para Windows nuevo

Instala y prueba ConectadOS RC13 desde https://github.com/rubentinedo-ctrl/ConectadOS, etiqueta v0.1.0-rc.13, en este equipo Windows.

Primero comprueba que puedes trabajar en el Windows real y dentro de su Ubuntu WSL2. Un contenedor Linux remoto de un agente no sirve para validar esta prueba. Si tu terminal está en un contenedor remoto, no instales allí: indícame cómo abrir la terminal del agente en mi propio equipo. Si falta WSL2, indícame qué debo ejecutar como administrador y si debo reiniciar; conserva las distribuciones y los datos existentes.

Usa Git, Node y npm de Linux dentro de Ubuntu WSL2. Crea una carpeta nueva en el sistema de archivos Linux, sin reemplazar instalaciones anteriores. Clona el repositorio público y selecciona exactamente la etiqueta v0.1.0-rc.13. Lee AGENTS.md, README.md, GUIA-INSTALACION.html, docs/WINDOWS.md y docs/PRUEBA-EXTERNA.md antes de instalar. Comprueba Node >=22.16; la versión de referencia ensayada es 22.23.1. No sustituyas otros runtimes ni abras puertos públicos.

Ejecuta node scripts/install.mjs para revisar el plan, después node scripts/install.mjs --apply y npm start. Comprueba la demo, el acceso y que la API privada rechace peticiones sin sesión. Deja el servidor local funcionando y dame su dirección exacta. El puerto predeterminado es 3119; si está ocupado, sigue el instalador para usar otro libre sin detener aplicaciones ajenas.

Abre la guía HTML. En otra terminal de Ubuntu ejecuta npm run setup:code para abrir el código inicial en el editor de Windows. Yo copiaré el código directamente en la aplicación y elegiré mi usuario y contraseña. No leas ni imprimas el código, contraseñas, tokens ni cookies en el chat.

Prueba que esta instalación no incluye recursos ni accesos del autor. Después de crear mi cuenta, revisa el asistente de bienvenida, los cinco proveedores compatibles y sus enlaces para obtener tokens. Pulsa Configurar después y comprueba que conserva el progreso al reabrirlo y al reiniciar. Revisa Dashboard, Mapa, Alertas, Respaldos, Costos, Informes y Ajustes sin activar servicios externos. Genera informes HTML, PDF y Excel con datos ficticios o vacíos, identificándolos como tales. Prueba cerrar sesión, entrar con la misma cuenta y reiniciar solo este servidor local sin perder datos.

Primero completa el recorrido sin APIs. Para conectar un proveedor real, espera a que yo lo elija e introduzca mi propio token en la app. Google, IA, voz, correo, R2 y Drive son opcionales y requieren configuración propia; no consumas APIs ni actives copias o envíos automáticamente. No accedas al VPS de Tinergia ni reutilices datos, cuentas o credenciales del autor. No agregues funciones ni publiques releases.

Entrégame un resultado sencillo con Windows, versión WSL/Ubuntu, arquitectura, Node, navegador, etiqueta instalada, pasos aprobados, errores y opciones no probadas. Incluye la dirección local y el comando para volver a arrancar. Conserva la instalación para mis pruebas. No declares Windows validado si la ejecución ocurrió en Linux remoto.

## Qué significan los enlaces de Cloudflare

Son accesos manuales al nombre DNS con HTTPS en una pestaña nueva; no cambian su salud. No usan destinos/IP del registro ni envían cookies de ConectadOS. Solo zonas y nombres válidos A/AAAA/CNAME, sin comodines o etiquetas de verificación. Ocultar nombres retira las direcciones de la interfaz. Un dominio con correo puede no tener web; que no abra no demuestra por sí solo un fallo de DNS.
