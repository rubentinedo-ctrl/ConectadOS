/** Public help only. No credentials, account URLs or connection state. */
export type ProviderGuide = {
  credential: string;
  purpose: string;
  steps: string[];
  permissions: string;
  note: string;
  docs: string;
  portal?: string;
  manual: boolean;
};

export const providerGuides: Record<string, ProviderGuide> = {
  Vercel: {
    credential: 'Token de acceso de Vercel',
    purpose: 'Consulta los proyectos y el despliegue de producción del equipo elegido desde Conexiones de proveedores.',
    steps: [
      'Abre la página de tokens e inicia sesión en la cuenta que contiene tus proyectos.',
      'Crea un token llamado ConectadOS. Selecciona el equipo que quieres consultar y una fecha de caducidad.',
      'Copia el valor completo del token y vuelve a esta pantalla.',
      'En Conexiones de proveedores, elige Vercel, pega el token y consulta tus equipos. Guarda la cuenta o equipo que quieres observar.',
    ],
    permissions: 'Limita el acceso al equipo necesario. Un token de cuenta puede permitir cambios; no debe considerarse automáticamente de solo lectura.',
    note: 'En Conexiones de proveedores, Consultar mis equipos permite seleccionar el equipo. El inventario no comprueba el funcionamiento de la aplicación.',
    portal: 'https://vercel.com/account/tokens',
    docs: 'https://vercel.com/docs/rest-api',
    manual: true,
  },
  Cloudflare: {
    credential: 'API Token de Cloudflare',
    purpose: 'Consulta las zonas y los registros DNS autorizados desde Conexiones de proveedores.',
    steps: [
      'Abre API Tokens e inicia sesión. Selecciona Create Token y crea un token personalizado.',
      'Añade Zone → Zone → Read y Zone → DNS → Read.',
      'En Zone Resources selecciona únicamente los dominios que quieres consultar. Define una caducidad.',
      'Crea el token, copia su valor y guárdalo en Conexiones de proveedores → Cloudflare. Consulta para verificar el acceso.',
    ],
    permissions: 'Lectura de zonas y DNS. No hace falta permiso Edit ni la Global API Key para este inventario.',
    note: 'Esta guía cubre dominios y DNS. R2 y otras funciones requerirán permisos distintos cuando se incorporen.',
    portal: 'https://dash.cloudflare.com/profile/api-tokens/',
    docs: 'https://developers.cloudflare.com/fundamentals/api/get-started/create-token/',
    manual: true,
  },
  Coolify: {
    credential: 'Token API de tu instalación de Coolify',
    purpose: 'Puedes consultar los recursos autorizados desde Inventario de Coolify en esta pantalla.',
    steps: [
      'Abre tu propio panel de Coolify y selecciona el equipo que contiene tus recursos.',
      'En Keys & Tokens → API Tokens crea un token con la descripción ConectadOS.',
      'Selecciona solo read y una caducidad. Los nombres pueden variar según tu versión.',
      'Copia el token completo y guárdalo junto a la dirección en Inventario de Coolify.',
    ],
    permissions: 'Solo read. No selecciones read:sensitive, write, deploy ni root para el inventario.',
    note: 'Configura la dirección de tu panel y el token en Inventario de Coolify. En tu panel debe estar habilitado el acceso a su API.',
    docs: 'https://coolify.io/docs/core/security/credentials/api-tokens',
    manual: true,
  },
  Hostinger: {
    credential: 'Token API de Hostinger',
    purpose: 'Configura un VPS y consulta su capacidad y las métricas de la última hora desde Conexiones de proveedores.',
    steps: [
      'Sigue la guía oficial y entra en tu panel de Hostinger.',
      'En API → Tokens de API selecciona Nuevo token.',
      'Escribe ConectadOS como nombre y selecciona una fecha de caducidad.',
      'Copia el valor antes de salir. Guárdalo en Conexiones de proveedores → Hostinger y selecciona el VPS autorizado.',
    ],
    permissions: 'Revisa el alcance que muestra tu panel. Esta guía no garantiza que el token tenga un modo de solo lectura.',
    note: 'Usa un token dedicado a esta aplicación y selecciona un VPS en Conexiones de proveedores. No introduzcas la contraseña root ni una clave SSH. El acceso observa un VPS seleccionado; no descubre aplicaciones ni paneles instalados dentro del servidor.',
    portal: 'https://hpanel.hostinger.com/profile/api',
    docs: 'https://developers.hostinger.com/',
    manual: true,
  },
  Supabase: {
    credential: 'Token personal de la API de gestión de Supabase',
    purpose: 'Consulta los proyectos que conserves en Supabase Cloud desde Conexiones de proveedores.',
    steps: [
      'Abre la guía oficial y sigue su enlace a los ajustes de access tokens de tu cuenta.',
      'Crea un token con alcance limitado a los proyectos que quieres consultar.',
      'Para el inventario inicial, selecciona Projects y Project Settings con acceso Read y una caducidad.',
      'Copia el token y guárdalo en Conexiones de proveedores → Supabase. Consulta para verificar el inventario autorizado.',
    ],
    permissions: 'Prefiere un token scoped de lectura. Evita Legacy con acceso completo. El conector solo consulta el listado de proyectos; los permisos efectivos del token deben revisarse en tu cuenta.',
    note: 'Este campo no pide la clave anon, service_role, secret key del proyecto ni la contraseña de PostgreSQL. Supabase instalado en tu VPS se consultará desde Coolify.',
    portal: 'https://supabase.com/dashboard/account/tokens',
    docs: 'https://supabase.com/docs/guides/platform/personal-access-tokens',
    manual: true,
  },
  'Google Drive': {
    credential: 'Autorización con Google (OAuth)',
    purpose: 'Permitirá acceder a los archivos de respaldo que autorices. Una API key no da acceso a tus archivos privados.',
    steps: [
      'Las copias a Drive se preparan con el instalador Linux documentado en docs/INSTALL-DRIVE.md.',
      'El agente instalador guía el consentimiento de Google con permisos propios; no hay asistente OAuth en esta pantalla.',
      'Revisarás los permisos y los archivos o carpetas que autorices antes de continuar.',
      'Comprueba después el recibo y la recuperación de una copia. Esta pantalla no pide una contraseña ni un token manual.',
    ],
    permissions: 'Se solicitará el alcance necesario para los archivos seleccionados. La elección final depende de si consultas copias o también las subes.',
    note: 'No introduzcas tu contraseña de Google ni un archivo JSON de cuenta de servicio en esta bóveda. El asistente OAuth todavía no está implementado.',
    docs: 'https://developers.google.com/workspace/drive/api/guides/api-specific-auth',
    manual: false,
  },
  Resend: {
    credential: 'API key de Resend para avisos por correo',
    purpose: 'Envía avisos por correo cuando configuras y verificas el canal en Ajustes → Monitores y avisos; no importa el inventario de Resend.',
    steps: [
      'Abre API Keys en Resend e inicia sesión.',
      'Selecciona Create API Key y usa el nombre ConectadOS avisos.',
      'Elige Sending access y limita la clave al dominio verificado desde el que enviarás.',
      'Copia la clave completa y guárdala abajo con una etiqueta.',
    ],
    permissions: 'Sending access permite enviar correo; no permite consultar todo el estado de la cuenta. No hace falta Full access para enviar avisos.',
    note: 'El dominio remitente debe estar verificado. Guardar la clave no envía correos ni activa alertas; los envíos del canal pueden tener costo según tu plan.',
    portal: 'https://resend.com/api-keys',
    docs: 'https://resend.com/docs/dashboard/api-keys/introduction',
    manual: true,
  },
};
