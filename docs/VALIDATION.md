# ConectadOS 0.1 RC10 · validación

## Cambios de esta candidata

Ayuda desplegable de alta y `npm run setup:code` para abrir el código inicial en TextEdit (macOS) o Bloc de notas (Ubuntu WSL2), sin imprimirlo. Catálogo de capacidades en alta, Dashboard vacío y Ajustes. Guía HTML TinergIA completa, incluida en el ZIP, con configuración por proveedor. No hay nuevos conectores ni cambios operativos del VPS.

## Verificación de las fuentes

- TypeScript correcto; 364 pruebas Node y siete Python correctas.
- Compilación y batería HTTP aislada correctas: alta sin exposición del código, autenticación, origen, permisos privados y persistencia.
- Catálogo contrastado con los colectores implementados; los ejemplos manuales no se anuncian como inventarios API.
- Apertura del archivo probada con rutas que contienen espacios y caracteres de shell; rechaza enlaces simbólicos/archivos excesivos, conserva el contenido y no usa shell. Mac y WSL usan adaptadores separados; el adaptador WSL tiene prueba aislada, no aceptación Windows real.
- Auditoría de dependencias de producción sin vulnerabilidades conocidas al comprobarla el 20 de octubre de 2026.
- Guía con logo embebido, sin cargas remotas automáticas; enlaces internos revisados. Los enlaces a consolas solo se abren al pulsarlos.

## Paquete exacto y aceptación externa

La release incluye un acta complementaria con el SHA-256 y el resultado del ensayo del ZIP exacto. Consulta los adjuntos en https://github.com/rubentinedo-ctrl/ConectadOS/releases/tag/v0.1.0-rc.10. El manifiesto identifica todas las fuentes distribuidas; no contiene datos, cuentas, credenciales ni dependencias instaladas.

El propietario confirmó que RC9 se instaló correctamente; no se ha registrado aún el sistema/arquitectura exacto de esa aceptación. Windows/WSL2 y otra Mac deben completar su propia prueba de RC10. No se atribuyen al nuevo equipo las pruebas del autor. Los conectores existentes conservan sus pruebas anteriores; no se utilizaron cuentas reales ni consumo de IA, correos o respaldos para probar estos cambios.

RC9 queda disponible e intacta. RC10 es una prerelease para evaluación, con código propio MIT y avisos de terceros; no equivale a compatibilidad universal ni certificación en todos los sistemas.
