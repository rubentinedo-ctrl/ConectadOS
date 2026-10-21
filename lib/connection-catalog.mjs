/** Public capabilities only: never include installation state or credentials. */
/** @type {{name:'Coolify'|'Vercel'|'Cloudflare'|'Hostinger'|'Supabase',scope:string,needs:string,limit:string,href:string}[]} */
export const inventoryConnectors = [
 {name:'Coolify',scope:'Aplicaciones, servicios y bases administradas por tu panel.',needs:'Dirección HTTPS de tu panel y token de lectura del equipo.',limit:'Solo recursos autorizados de Coolify; no descubre otros paneles.',href:'/settings#coolify-inventory'},
 {name:'Vercel',scope:'Proyectos y estado del despliegue de producción.',needs:'Token y selección de cuenta personal o equipo.',limit:'El estado del despliegue no comprueba el acceso ni las operaciones de la web.',href:'/settings#provider-connections'},
 {name:'Cloudflare',scope:'Zonas, nombres y registros DNS autorizados.',needs:'Token con lectura de zonas y DNS.',limit:'Este inventario no consulta Workers, facturación ni contenido de R2.',href:'/settings#provider-connections'},
 {name:'Hostinger',scope:'Un VPS seleccionado, su capacidad y métricas disponibles.',needs:'Token API y selección del VPS.',limit:'No enumera lo instalado dentro del servidor. EasyPanel requiere un conector propio.',href:'/settings#provider-connections'},
 {name:'Supabase',scope:'Proyectos alojados en Supabase Cloud.',needs:'Token personal de gestión con lectura de proyectos.',limit:'No lee tablas ni filas. Supabase en tu VPS se observa mediante Coolify.',href:'/settings#provider-connections'},
];
export const manualPlatformExamples = ['Netlify','EasyPanel','GoHighLevel'];
export const optionalConnections = [
 {name:'Resend',purpose:'Enviar avisos por correo, después de configurarlos y probarlos.',limit:'No importa el inventario de tu cuenta Resend.'},
 {name:'R2 / Google Drive',purpose:'Destinos opcionales para copias de ConectadOS.',limit:'Configuración separada; Drive requiere el instalador Linux. Sin OAuth visual en esta versión.'},
 {name:'IA y voz',purpose:'Asistente con tu modelo y claves propios.',limit:'Opcional y con consumo en tu proveedor. No es necesario para consultar inventarios.'},
];
export const connectionBoundary = 'ConectadOS consulta únicamente los proveedores que conectes y los recursos que autorices. No escanea tu equipo ni descubre toda una infraestructura por una sola clave.';
