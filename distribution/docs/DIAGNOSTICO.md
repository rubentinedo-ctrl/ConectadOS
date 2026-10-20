# Bases identificadas y diagnóstico de solo lectura

En Mapa → Infraestructura por categoría → Bases de datos, cada base muestra su aplicación y su alojamiento: **Coolify · VPS** o **Supabase Cloud**. El nombre técnico se conserva en la ficha. Esta presentación no renombra tablas, bases ni recursos del proveedor.

La asociación usa las asignaciones locales por referencia y la pertenencia observada al servicio. Una coincidencia de nombres o un dominio no prueba pertenencia. Si falta la asignación, aparece el servicio observado y «aplicación pendiente de asignar». Las bases compartidas muestran todas las aplicaciones asignadas.

Desde la ficha o desde un aviso, pulsa **Diagnosticar sin cambios** y luego **Ejecutar diagnóstico**. La primera acción abre el historial; la segunda consulta los proveedores. No usa IA. En Coolify lee el inventario y únicamente el detalle de los servicios seleccionados, mediante GET. No ejecuta shell, SQL, reinicios, reparaciones ni envíos de correo.

El informe muestra el componente, estado declarado, fecha, fuente y siguiente paso. **Volver a comprobar** compara la selección con lecturas anteriores de la misma identidad. Un fallo pasa a recuperado únicamente si una lectura posterior verifica su estado sin fallo. Un error, una lectura vencida o un recurso desaparecido no acreditan recuperación. Un cambio de conexión o asignación invalida la comparación. Los componentes excluidos por Coolify conservan su indicación; se comprueban individualmente si los seleccionas.

El historial muestra las últimas diez comprobaciones comparables dentro de treinta días. Se conservan como máximo mil recibos en toda la instalación; los anteriores se eliminan al guardar otro resultado. No se presenta un estado saludable del proveedor como prueba de acceso SQL, datos o transacciones de negocio. La causa raíz requiere revisar registros específicos; este diagnóstico no los descarga ni los envía a un modelo.

Los reinicios existentes siguen en su flujo separado con selección exacta, revisión de persistencia y aprobación expresa. El diagnóstico no puede aprobar ni ejecutar ese flujo.
