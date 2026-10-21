# Instalar ConectadOS 0.1 RC12 en otra Mac

Esta prueba debe empezar en una carpeta nueva, con el ZIP RC12 completo. No copies `.data`, `.keys`, `.backups` ni dependencias de la instalación del autor. No necesitas Docker ni APIs para empezar.

## Preparación

1. En Acerca de esta Mac anota macOS y si el equipo usa Apple Silicon (M1/M2/M3/…) o Intel. El ensayo local de RC12 registra su arquitectura; no acredita una Mac distinta.
2. Descarga y extrae el ZIP. Si proviene de un repositorio GitHub ya publicado, también puedes clonarlo; esta guía no inventa una dirección de repositorio.
3. Abre `GUIA-INSTALACION.html` con doble clic. Conserva la carpeta completa.
4. Necesitas Node.js 22 LTS con npm, como mínimo 22.16. Comprueba `node --version` y `npm --version`. Usa [la descarga oficial](https://nodejs.org/en/download) correspondiente a Apple Silicon/arm64 o Intel/x64. No uses `sudo npm`, no sustituyas un Node existente sin revisar otros proyectos.

## Instalación mediante Codex o Claude Code

Abre esta carpeta en un agente con acceso a la terminal del equipo y escribe:

> Instala ConectadOS RC12 de esta carpeta en esta Mac. Lee AGENTS.md, README.md y docs/MACOS.md. Comprueba macOS, arquitectura, Node y npm. Conserva instalaciones existentes. Ejecuta node scripts/install.mjs para revisar y node scripts/install.mjs --apply. Inicia con npm start y comprueba /preview, /demo, /access y que /api/settings rechace acceso sin sesión. No conectes proveedores ni IA en la primera prueba. Déjame abrir el código privado y elegir mi contraseña en el navegador, sin mostrar secretos en el chat. Entrega dirección, cómo detener/reiniciar y el resultado de docs/PRUEBA-EXTERNA.md.

El CLI del agente ejecuta los comandos; ConectadOS no instala ni incluye Codex o Claude Code. También puedes instalar manualmente desde Terminal en la carpeta extraída:

```sh
node --version
npm --version
node scripts/install.mjs
node scripts/install.mjs --apply
npm start
```

Abre `http://127.0.0.1:3119/preview`. Usa exactamente la dirección que muestra el lanzador. Mantén la terminal abierta. Para una carpeta nueva con puerto ocupado, elige otro con `--port 4200`; nunca cambies el puerto de una instalación existente para ocultar un conflicto.

## Cuenta, reinicio y resultado

En `/access`, abre `.keys/setup-token` con un editor local y copia el código solo en la aplicación; elige una contraseña propia de al menos 15 caracteres. Los archivos que empiezan con punto están ocultos en Finder; puedes mostrarlos con Command+Shift+Punto. No envíes códigos ni claves al agente.

Detén con Ctrl+C. Vuelve a la misma carpeta, ejecuta `npm start` y entra con tu cuenta. La instalación local no configura inicio automático: al suspender o apagar la Mac, el panel deja de estar disponible.

Completa `docs/PRUEBA-EXTERNA.md` por separado de Windows. Primero valida instalación sin APIs. Después, si deseas, añade un proveedor propio y prueba los informes; Google, IA, voz y copias externas requieren su propia configuración. Tu cuenta real empieza sin datos del autor. No apuntes estas pruebas de escritura a una instalación de producción.

## Abrir el código inicial

Con el lanzador funcionando, abre otra terminal en esta carpeta y ejecuta `npm run setup:code`. En Mac se abre TextEdit; desde Ubuntu WSL2, Bloc de notas de Windows. Copia el código solo en /access y cierra el editor sin guardar cambios. Si el entorno no puede abrir ventanas, sigue GUIA-INSTALACION.html → Tu cuenta. El código no se imprime en la terminal. No lo compartas con el agente.
