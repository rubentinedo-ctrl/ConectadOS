# Preparada · sin desplegar

Esta clasificación identifica una aplicación de Coolify creada y aún sin despliegues registrados. Es distinta de una lectura saludable, un fallo y una lectura desconocida.

El recolector usa exclusivamente GET: lee el estado del recurso y, para aplicaciones declaradas exited/stopped, pide una página del historial de despliegues. Solo clasifica como preparada cuando la respuesta completa confirma count=0, tiene fecha reciente y corresponde a la misma aplicación y conexión. No se deduce por nombre, etiquetas, ausencia de registros o un error de permisos. Hasta veinte historiales por ciclo comparten el límite de tiempo y de consultas de Coolify.

La clasificación se muestra en el mapa, inventario, Dashboard, diagnóstico, relaciones, contexto del asistente e informes. En Mapa, el filtro **Sin desplegar** abre las aplicaciones que pertenecen a esta categoría. Usa un color azul propio y no se incluye en los recursos saludables ni en el filtro de fallos por revisar.

Si un recurso ya tiene al menos un despliegue registrado y está detenido, conserva su advertencia. Una aplicación en ejecución, incluso si su primer despliegue aún no aparece en el historial, se evalúa por su estado actual. Las lecturas vencidas, incompletas o fallidas no justifican clasificar como preparada. Cuando se despliega, la lectura siguiente deja de clasificarla como preparada; cualquier fallo de ese despliegue aparece como advertencia.

Un aviso anterior que correspondía a una aplicación sin desplegar pasa al historial como **Reclasificado · sin desplegar**. Conserva la observación original, su fecha y la razón. No se marca como resuelto ni genera evidencia de reparación. El diagnóstico tampoco llama recuperación a este cambio de clasificación ni al primer arranque posterior.

La función no configura la aplicación, no publica código, no despliega, no reinicia y no llama a proveedores de IA. La categoría indica que el lanzamiento está pendiente; no garantiza que el código, claves o configuración ya estén completos. La aprobación del lanzamiento se gestiona por separado.
