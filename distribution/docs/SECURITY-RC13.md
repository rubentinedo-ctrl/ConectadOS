# Seguridad de dependencias · RC13

9 de noviembre de 2026. Esta revisión conserva todas las funciones de RC12 y el formato de datos 1.

Se sustituyen Next.js 16.4.0 por 16.4.6 y undici 7.30.0 por 7.30.2 según la resolución compatible del archivo de bloqueo. No se usa una actualización forzada de rama mayor. Los avisos que motivan la revisión están documentados por los proveedores:

- https://github.com/advisories/GHSA-2464-fhr4-w9xw
- https://github.com/advisories/GHSA-673q-mjm6-r5xr
- https://github.com/advisories/GHSA-p3m5-59mp-jv5r
- https://github.com/advisories/GHSA-2m5v-pch6-74hx

Una auditoría sin avisos conocidos refleja la información disponible al ejecutarla; no garantiza ausencia de vulnerabilidades. No se distribuyen estado, claves, datos del autor ni dependencias instaladas. Código propio MIT; los avisos de terceros se conservan.

La compilación Docker usa BuildKit, instala Git para comprobar el empaquetado y reserva 1,5 GiB de almacenamiento temporal en memoria para las pruebas. Git y esos archivos temporales no se añaden a la imagen de ejecución.
