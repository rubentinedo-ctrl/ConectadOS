# Instalar desde Windows con WSL2

ConectadOS 0.1 RC11 usa Node dentro de Ubuntu, mediante WSL2. No incluye un instalador .exe ni una instalación nativa de Windows. El recorrido Linux está probado; la prueba en tu equipo Windows forma parte de la aceptación externa de esta entrega.

## 1. Preparar Ubuntu

Si ya usas WSL, abre PowerShell y ejecuta `wsl --list --verbose`. Conserva tus distribuciones y datos existentes. Debe aparecer Ubuntu con VERSION 2. No desinstales ni reinicies otras aplicaciones para instalar ConectadOS.

Si aún no tienes WSL, abre PowerShell como administrador y ejecuta:

```powershell
wsl --install -d Ubuntu-24.04
```

Reinicia Windows si lo pide. Abre Ubuntu desde Inicio y crea su usuario y contraseña. Esta contraseña pertenece a Linux; la cuenta de ConectadOS se crea después. No compartas ninguna contraseña en un chat. Confirma en PowerShell con `wsl --list --verbose` que Ubuntu aparece como versión 2. Si el nombre de la distribución no está disponible, consulta `wsl --list --online` y la guía oficial antes de cambiar el comando.

[Instalación oficial de WSL](https://learn.microsoft.com/en-us/windows/wsl/install) · [Ubuntu en WSL2](https://ubuntu.com/wsl/docs/latest/howto/install-ubuntu-wsl2/).

## 2. Llevar la carpeta a Linux

Descomprime el ZIP completo en Windows. En Ubuntu ejecuta `explorer.exe .` para abrir su carpeta personal en el Explorador de Windows. Copia allí la carpeta ConectadOS extraída, sin reemplazar una instalación existente. El destino será, por ejemplo, `~/ConectadOS`.

Trabaja en el sistema de archivos de Linux; evita instalar dependencias dentro de `/mnt/c`. [Recomendación de Microsoft](https://learn.microsoft.com/en-us/windows/wsl/setup/environment).

## 3. Instalar con un agente

Abre la carpeta Linux en un agente que pueda ejecutar comandos dentro de esa distribución WSL. Si el agente está en Windows, indícale expresamente la distribución y la ruta Linux. Copia este encargo:

> Instala ConectadOS de esta carpeta en Ubuntu de WSL2. Lee AGENTS.md, README.md y docs/WINDOWS.md. Comprueba la distribución y la ruta real. Ejecuta Node y npm dentro de Linux, no los de Windows. Si faltan, prepara Node 22 desde nodejs.org y verifica el archivo oficial antes de instalarlo, sin sustituir runtimes existentes. Después ejecuta node scripts/install.mjs para revisar, node scripts/install.mjs --apply y npm start. Valida demostración, acceso y rechazo de la API privada sin sesión. No conectes proveedores, IA ni copias externas en esta primera prueba. No uses credenciales del autor. Déjame crear la cuenta y elegir mi contraseña en el navegador. Entrega dirección, comando de reinicio y resultado.

La demostración no necesita APIs ni Docker. La terminal del servidor debe permanecer abierta mientras usas la instalación local.

## 4. Instalación manual dentro de Ubuntu

Instala [Node.js](https://nodejs.org/en/download) dentro de Ubuntu. Requisito: 22.16 o posterior; entorno Linux comprobado con 22.23.1. Node instalado solo en Windows no cumple este paso. Después, en la terminal de Ubuntu:

```sh
cd ~/ConectadOS
node --version
npm --version
node scripts/install.mjs
node scripts/install.mjs --apply
npm start
```

Abre desde Edge o Chrome de Windows `http://127.0.0.1:3119/preview`. Microsoft documenta el acceso desde Windows a un servidor WSL mediante localhost. Usa exactamente la dirección 127.0.0.1 que muestra el lanzador; evita sustituirla por localhost en los formularios. Si no abre, conserva la dirección loopback que muestra el lanzador y revisa su estado y las [instrucciones de red WSL](https://learn.microsoft.com/en-us/windows/wsl/networking); no abras puertos públicos ni desactives el firewall.

En `/access`, abre el código privado con el editor local, por ejemplo `notepad.exe "$(wslpath -w "$HOME/ConectadOS/.keys/setup-token")"` desde Ubuntu. Copia el código solo en ConectadOS, elige tu usuario y una contraseña de al menos 15 caracteres. No uses `cat` para enviarlo a un agente. Tras crear la cuenta, el código deja de servir para crear otra.

Detén con Ctrl+C. Para volver: abre Ubuntu, entra en `~/ConectadOS` y ejecuta `npm start`. No se instala arranque automático en Windows. Suspender el equipo o detener WSL interrumpe esta instalación local; para uso continuo consulta deploy/README.md.

## 5. Prueba externa

Completa [PRUEBA-EXTERNA.md](PRUEBA-EXTERNA.md). Primero demuestra que instalación, mapa ficticio, cuenta y reinicio funcionan. Después conecta un proveedor propio y comprueba inventario y fecha. Google, IA, voz y respaldos son opcionales y requieren su configuración independiente. No publiques el paquete como validado en Windows antes de completar este recorrido.

## Abrir el código inicial

Con el lanzador funcionando, abre otra terminal en esta carpeta y ejecuta `npm run setup:code`. En Mac se abre TextEdit; desde Ubuntu WSL2, Bloc de notas de Windows. Copia el código solo en /access y cierra el editor sin guardar cambios. Si el entorno no puede abrir ventanas, sigue GUIA-INSTALACION.html → Tu cuenta. El código no se imprime en la terminal. No lo compartas con el agente.
