# Continuar las pruebas de una instalación existente

La instalación de Mac fue confirmada por el propietario. Windows sigue pendiente. La versión de cada equipo debe comprobarse leyendo package.json; no se deduce de la fecha ni de la demo.

## Prompt para Mac ya instalada

> Continúa la prueba de ConectadOS que ya está instalada en esta Mac. Localiza la carpeta y comprueba su versión y el proceso de arranque. No reinstales desde cero ni crees otra cuenta. La versión de referencia es https://github.com/rubentinedo-ctrl/ConectadOS, etiqueta v0.1.0-rc.12. Si hace falta actualizar, prepara antes una copia local privada recuperable de la configuración, estado y claves; revisa las instrucciones y compatibilidad. Actualiza únicamente el código necesario, conservando .data, .keys, .backups, contraseña, configuración, tokens y puerto. No sobrescribas cambios locales sin conservarlos. Detén y reinicia solo el proceso de esta instalación; no toques el VPS ni otras apps. Comprueba acceso con mi cuenta, persistencia, Dashboard, Mapa, Informes y Ajustes. Abre el asistente de bienvenida desde Dashboard o Ajustes → Proveedores; selecciona plataformas, avanza, pulsa Configurar después y verifica que al reiniciar conserva el paso sin borrar accesos. No cambies los tokens existentes. Revisa las guías de los cinco conectores y sus enlaces de credenciales. En Cloudflare comprueba que las zonas y los registros web admitidos tengan enlaces HTTPS a otra pestaña, que Ocultar nombres también los oculte y que MX/TXT no aparezcan como webs. No abras mis dominios automáticamente, conectes proveedores nuevos, consumas IA ni envíes correos para esta prueba. Entrégame el resultado y errores sin secretos; yo escribo mis contraseñas directamente en la app.

Los archivos privados no deben subirse a GitHub ni al chat. Si el agente está en un contenedor remoto, debe indicarlo y usar la terminal local del equipo; una prueba en Linux remoto no sustituye macOS.

## Prompt para Windows nuevo

> Instala ConectadOS desde https://github.com/rubentinedo-ctrl/ConectadOS, etiqueta v0.1.0-rc.12, en una carpeta nueva. Lee AGENTS.md, README.md y GUIA-INSTALACION.html. Usa Ubuntu en WSL2 y ejecuta Git, Node y npm dentro de Linux, no Node nativo de Windows. Comprueba requisitos y conserva cualquier instalación previa. Empieza sin APIs, ejecuta el instalador, abre la demo y /access. Abre npm run setup:code desde Ubuntu para que yo copie el código en la app sin mostrarlo en el chat y elija mi contraseña. Después del alta, comprueba el asistente de bienvenida, sus enlaces de tokens y Configurar después: al reabrirlo debe conservar selección y paso. No necesita APIs para esa prueba. Comprueba arranque, cierre de sesión y que la cuenta/configuración persistan tras reiniciar. No conectes proveedores o servicios con costo sin mi elección. Registra Windows, WSL/Ubuntu, versión Node, navegador y resultado.

## Qué significan los enlaces de Cloudflare

Son accesos manuales al nombre DNS con HTTPS en una pestaña nueva; no cambian su salud. No usan destinos/IP del registro ni envían cookies de ConectadOS. Solo zonas y nombres válidos A/AAAA/CNAME, sin comodines o etiquetas de verificación. Ocultar nombres retira las direcciones de la interfaz. Un dominio con correo puede no tener web; que no abra no demuestra por sí solo un fallo de DNS.
