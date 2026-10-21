# Conexiones de ConectadOS 0.1 RC12

El asistente de bienvenida permite elegir proveedores, seguir sus enlaces de tokens y posponer conservando el progreso. Se retoma en Dashboard o Ajustes → Proveedores. [Recorrido completo](WELCOME.md).

Cada usuario conecta sus propias cuentas desde `/settings` → Proveedores. La guía visual completa está en `GUIA-INSTALACION.html` en la raíz; se abre con doble clic y no pide claves.

## Inventario por API disponible

| Proveedor | Datos consultados | Configuración y límites |
| --- | --- | --- |
| Coolify | Aplicaciones, servicios y bases autorizadas del equipo | Dirección HTTPS pública y token read. API habilitada. Dominios con IPv4 pública; destinos LAN, localhost y redirecciones rechazados. No descubre otros paneles. |
| Vercel | Proyectos y estado de producción | Token y cuenta o equipo elegidos. Un despliegue listo no valida login ni operaciones internas. |
| Cloudflare | Zonas y registros DNS | Token Zone Read + DNS Read limitado a zonas. No inventaría Workers, facturas ni objetos R2. |
| Hostinger | Capacidad y métricas de un VPS seleccionado | Token y selección de una máquina. No descubre aplicaciones de Coolify/EasyPanel dentro del VPS ni trae automáticamente todos los VPS. |
| Supabase Cloud | Proyectos autorizados | Token personal de gestión con lectura; no anon/service_role. No lee tablas ni filas. El Supabase autohospedado se consulta por Coolify. |

Guardar no verifica una conexión. Pulsa Consultar, confirma el alcance, los recursos y la fecha. Un inventario vacío puede ser correcto; revisa equipo y permisos. Nunca pegues una clave de otro proveedor en un conector esperando que funcione.

Los tokens se guardan cifrados en tu instalación; no se imprimen ni se envían al modelo. El conector realiza lecturas, pero un token puede tener permisos más amplios en su proveedor. Revisa y limita los permisos en origen.

## Fichas manuales: sin inventario automático

Netlify, EasyPanel, GoHighLevel y cualquier otra plataforma se pueden registrar en Mapa → Gestionar otras plataformas con nombre, enlace, descripción y aplicación relacionada. No pegues claves ahí. La ficha no consulta su API, no verifica salud ni importa recursos. Hace falta desarrollar y probar un conector propio para incorporar esa API.

Ejemplo: Hostinger con EasyPanel permite observar el VPS mediante Hostinger y guardar EasyPanel como ficha. No enumera los proyectos de EasyPanel. No necesitas usar toda la infraestructura del autor; conecta únicamente lo que tengas.

## Funciones opcionales separadas

- Resend: envío de avisos después de configurar y comprobar el canal. No importa el inventario Resend. Revisa destinatario, reglas y límites antes de habilitar.
- R2: destino opcional de copias de ConectadOS con permisos y claves propios. No es el inventario Cloudflare.
- Google Drive: réplica mediante instalador Linux documentado. OAuth visual en el panel pendiente; entrar con Google no lo autoriza.
- Google: vinculación para iniciar sesión, con Client ID y origen propios. No da acceso a otros servicios.
- IA/voz: API y modelo elegidos por el propietario; consumo en su cuenta. No necesarios para inventario.
- Costos: importes y renovaciones registrados manualmente; no son facturas importadas.

## Ver recursos y mantenerlos actuales

En Mapa, Recursos muestra el inventario; Aplicaciones muestra tus agrupaciones locales. Asigna recursos a cada aplicación desde Organizar aplicaciones; no infieras dependencias por nombres parecidos.

La observación automática se activa por separado. Aproximadamente: Coolify/Vercel cada minuto, Hostinger/Supabase cada cinco y DNS cada diez, sujetos a límites, red y estado del proveedor. Debe seguir ejecutándose `npm start`; la instalación local no crea un servicio permanente. Las consultas conservan fuente y fecha; una lectura vieja no acredita una caída o recuperación.

## Enlaces oficiales

- [Coolify: tokens y acceso API](https://coolify.io/docs/core/security/credentials/api-tokens).
- [Vercel: API](https://vercel.com/docs/rest-api) y [tokens](https://vercel.com/account/tokens).
- [Cloudflare: creación de tokens](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/).
- [Hostinger: autenticación](https://docs.hostinger.com/api-reference/overview) y [API en hPanel](https://hpanel.hostinger.com/profile/api).
- [Supabase: tokens personales](https://supabase.com/docs/guides/platform/personal-access-tokens).

Guías oficiales revisadas el 20 de octubre de 2026; las etiquetas de cada panel pueden variar. Las capacidades de ConectadOS dependen de los conectores incluidos, no de todo lo que permita la API del proveedor.

## Abrir una web desde Cloudflare

Selecciona un dominio en el mapa o en Infraestructura → Dominios → Cloudflare. Los nombres aptos muestran un enlace HTTPS que abre otra pestaña. En los registros se ofrece solo para A/AAAA/CNAME con nombre válido; no para MX/TXT/NS, comodines o nombres de verificación. Ocultar nombres también oculta los enlaces. No se usa la IP o destino del registro ni se cambia su salud. Que exista DNS no garantiza que haya una web.
