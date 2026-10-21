# Prueba externa de ConectadOS 0.1 RC10

Haz esta prueba en una carpeta nueva, con el ZIP de entrega. Usa tu propia cuenta y tus accesos. No copies `.data`, `.keys`, `.backups` ni configuraciones de otra instalación. La prueba Windows/WSL2 requiere tu equipo; el ensayo Linux del autor no la sustituye.

## Un resultado por equipo

Usa el mismo ZIP RC10 en Windows y en la otra Mac, pero carpetas, cuentas y archivos de resultado independientes. En Mac sigue [MACOS.md](MACOS.md). Anota arquitectura (Apple Silicon/Intel), sistema, Node y navegador. No copies claves ni bases entre equipos.

## Primera prueba sin APIs

- [ ] Descomprimí el ZIP completo y pude entender README.md o GUIA-INSTALACION.html.
- [ ] En Windows preparé Ubuntu WSL2 siguiendo docs/WINDOWS.md; el agente ejecuta comandos dentro de Linux.
- [ ] El instalador terminó sin errores. Anoté sistema, versión de Node y puerto.
- [ ] Abrí `/preview` y `/demo`; veo datos ficticios identificados como demostración.
- [ ] Abrí `/access`, creé mi cuenta con el código local y una contraseña propia.
- [ ] La pantalla real está vacía o pide conexiones; no muestra recursos privados del autor.
- [ ] Abrí Configuración, el mapa, los informes y el asistente sin errores visibles.
- [ ] Cerré sesión; una ventana privada pide acceso antes de mostrar datos privados.
- [ ] Detuve con Ctrl+C, ejecuté `npm start` y pude entrar con la misma cuenta.

## Prueba con mis conexiones

- [ ] Añadí un único proveedor con token dedicado y los permisos mínimos indicados en la interfaz.
- [ ] El inventario muestra mis recursos y una fecha reciente; guardar el token por sí solo no se presentó como verificación.
- [ ] Puedo abrir categoría → proveedor → recurso y volver al mapa.
- [ ] Puedo registrar un costo o una plataforma manual y distinguirlo de una observación automática.
- [ ] Abrí un informe explicado y descargué HTML, PDF directo y Excel; revisé gráficos, textos y privacidad antes de incluir nombres o importes.

Google, IA, voz y respaldo externo se prueban solo si los configuras. Google para entrar no autoriza Drive. La IA comercial usa tu API y puede cobrar consumo. Para voz: dos preguntas, una interrupción y finalizar; comprueba que deje de usar el micrófono. Una copia externa se acepta después de recuperarla en un destino nuevo con sus claves custodiadas fuera del origen.

## Resultado para compartir

Copia estos campos sin secretos ni información de tus recursos:

- Paquete: ConectadOS 0.1 RC10.
- Sistema, arquitectura y versión de WSL/Ubuntu, si aplica:
- Node y navegador:
- Etapa alcanzada y último paso correcto:
- Resultado: pasó / falló / no probado.
- Mensaje de error, sin tokens, cookies ni datos personales:
- Captura recortada, sin códigos ni claves, si ayuda:
- Mi decisión: listo para ofrecer / requiere corregir lo indicado.

No envíes carpetas privadas ni una copia de tu base para informar un error. Detenerte antes de conectar APIs es una prueba válida de instalación, pero no acredita esos proveedores ni la calidad de IA/voz.

## Navegación

Comprueba Dashboard, Mapa, Alertas, Respaldos, Costos, Asistente e Informes. En Ajustes abre cada sección; no introduzcas claves para probar la demostración. Una sección sin conexión debe explicar qué falta. «Ocultar nombres» debe poder desactivarse. Seleccionar la opción de reinicio de un recurso solo abre su revisión; no apruebes un reinicio real como parte de esta prueba.
