# Código propio y dependencias

El código propio se distribuye bajo LICENSE (MIT). Este paquete contiene fuentes, package.json y package-lock.json; no contiene node_modules, compilación ni binarios nativos. El instalador descarga dependencias desde npm mediante el lockfile.

Los trazados estáticos de Simple Icons conservan CC0 y derechos de marca. Los textos en docs/licenses y el manifiesto docs/license-supplements.json se conservan íntegros. `npm run build` genera un inventario de las dependencias realmente instaladas y sus avisos; no atribuye la licencia del contenedor a todos sus componentes.

Sharp/libvips y componentes de Next pueden incluir licencias Apache, LGPL o MPL y avisos adicionales. El inventario mantiene `publicationReady: false`: antes de redistribuir una imagen o ejecutable debes revisar sus versiones, avisos y fuentes correspondientes por plataforma. La presencia de MIT o de archivos de licencia no acredita esa revisión.

El logo TinergIA incrustado en GUIA-INSTALACION.html identifica al autor y conserva sus derechos de marca; ver BRAND.md. No se incluyen fuentes tipográficas ni imágenes remotas que deban descargarse al abrir la guía.
