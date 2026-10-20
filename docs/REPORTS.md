# Informes de ConectadOS

En **Informes**, elige Resumen de salud, Protección de datos, Bases y alojamiento, Dominios y DNS, Costos y renovaciones o Avisos e historial. «Ver informe» presenta el análisis; HTML y Descargar PDF generan archivos directamente. Excel conserva el detalle técnico. El PDF ya no abre un diálogo de impresión.

Cada informe incluye resumen, indicadores explicados, gráficos de las lecturas disponibles, hallazgos con interpretación y siguiente paso, plan de revisión y fechas de sus fuentes. HTML permite desplegar las tablas de respaldo; el PDF prioriza el análisis. Los gráficos HTML se adaptan al ancho y conservan rótulos legibles sin escalarlos como imágenes.

El análisis es determinista y local: no necesita clave, consumo de IA, llamadas a los proveedores, envíos, nuevas copias ni restauraciones. Generar un informe no actualiza sus fuentes. Un estado sin advertencias no acredita login ni transacciones; desconocido no equivale a caído. Se separan recordatorios de renovación de avisos técnicos, y bases Cloud de Coolify. Los ensayos locales, inclusión Drive y copia del panel tienen alcances distintos.

CPU, RAM y disco usan las muestras de Hostinger y sus fechas. El 85% es un umbral orientativo del informe, no un límite del proveedor ni una predicción. Datos vencidos no se convierten en consumo cero. Los costos usan el registro manual: equivalente mensual por moneda, contratos/facturas separados de estimaciones; gastos únicos fuera del mensual. Ausencia de importes no significa infraestructura gratuita.

Las descargas ocultan nombres e importes por defecto, incluidos los importes derivados en gráficos. En «Privacidad y otros alcances» se pueden incluir expresamente. El modo de privacidad general impide reactivarlos desde el informe. Nunca se exportan claves ni valores DNS. Revisa nombres, importes y contenido antes de compartirlo.

El HTML es autónomo, sin scripts, recursos externos ni peticiones; incluye CSP y escapa el texto. El PDF vectorial se genera en el navegador al descargarlo, sin dependencias nuevas ni un navegador de impresión en el VPS. Utiliza las fuentes estándar Helvetica/Helvetica-Bold con codificación WinAnsi; conserva acentos españoles y representa caracteres fuera de esa cobertura como `[U+XXXX]`. No es un PDF etiquetado para accesibilidad. El HTML mantiene estructura semántica y descripción de las cifras de las gráficas. Excel sigue usando OOXML con cadenas de texto, sin fórmulas ni enlaces activos.

## Verificación

`tests/report-analysis.test.mjs`: vigencia de restauración, fuentes antiguas, estados desconocidos, privacidad de importes derivados, monedas separadas, renovación frente a incidencia, texto escapado, estructura PDF y fechas/muestras de Hostinger. Los contratos previos de exportación siguen vigentes. La revisión de entrega debe abrir los HTML, renderizar todas las páginas PDF y comprobar descargas desde la sesión real. No se repiten ensayos de las bases para validar estos documentos.
