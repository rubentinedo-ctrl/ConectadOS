# ConectadOS RC13 · comprobaciones de la candidata

9 de noviembre de 2026, America/New_York; ejecución que terminó el 10 de noviembre en UTC. Entrega de fuentes MIT para pruebas externas. RC13 conserva las funciones de RC12 y el formato de estado 1. Actualiza Next.js a 16.4.6 y undici a 7.30.2. Consulta SECURITY-RC13.md.

| Comprobación | Resultado |
| --- | --- |
| Instalación del lock | npm ci correcto; auditoría sin vulnerabilidades conocidas en la consulta realizada |
| TypeScript | npm run typecheck correcto |
| Pruebas Node | 371 aprobadas, 0 fallidas |
| Compilación | npm run build correcto, Node 22.23.1, Linux amd64 nativo |
| Batería HTTP | Aprobada en copia ficticia aislada, sin red: cuenta, origen, cookies, bienvenida, configuración cifrada, informes, persistencia, recuperación y cierre de sesión |
| Actualización y retorno | Versión anterior → RC13 → anterior → RC13 sobre el mismo estado ficticio; conserva cambios posteriores, contraseña, configuración y progreso de bienvenida |
| Recuperación | Copia coherente comprobada con RC13 en destino aislado, sin modificar el origen; efectos externos y sesiones desactivados en la copia |
| Piloto existente | RC13 publicada; cuenta, accesos, proyectos, configuración y volúmenes conservados. Exportador Drive y ejecutor de recuperación continúan con sus recibos y calendarios |
| Funciones | Sin cambios en app, components, lib, scripts o public frente a RC12 |
| Distribución | Fuentes y lock, sin estado, secretos, dependencias instaladas ni imágenes Docker; guía HTML incluida |
| Windows/WSL2 | Pendiente de prueba en el Windows real del propietario; Linux en un VPS no la sustituye |
| Otra Mac | Instalación previa confirmada por el propietario; aceptación de esta RC13 pendiente en ese equipo |

Las pruebas locales no consumieron APIs de IA ni enviaron correo. No activaron proveedores reales en las copias. El estado observado de servicios externos no demuestra sus operaciones de negocio. Una auditoría sin avisos conocidos no garantiza ausencia de vulnerabilidades.

El historial de RC12 se conserva en VALIDATION-RC12.md. Completa PRUEBA-EXTERNA.md antes de declarar aceptada esta candidata. La voz con micrófono y los proveedores propios se prueban solo si el propietario los configura; no se atribuye a RC13 una nueva prueba de voz humana.
