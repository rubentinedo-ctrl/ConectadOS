# Observador externo

Servicio independiente que comprueba destinos HTTPS aunque el VPS de ConectadOS no responda. Se instala en una cuenta propia de Vercel con almacenamiento privado. Sus cron, lectura, control y cifrado tienen credenciales distintas; no reutilices tokens de los proveedores observados.

Instala las dependencias de esta carpeta con `npm ci`, revisa `.env.example` y `vercel.json`, y crea las identidades privadas de tu instalación. El correo se configura separado y permanece apagado hasta revisar destino, remitente, límites y recepción real. La aceptación de Resend no acredita recepción. Nunca copies una política activa desde otra instalación.

Consulta docs/OPERATIONS.md del proyecto principal para el alcance. El observador no reemplaza comprobaciones de transacciones ni respalda las bases de datos.
