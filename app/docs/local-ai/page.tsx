import Link from 'next/link';

export const metadata={title:'Modelo local · ConectadOS'};
export default function LocalAIGuide(){return <main className="landing"><section className="panel" style={{maxWidth:880,margin:'40px auto',padding:28}}>
 <Link href="/settings#assistant-settings">← Volver al asistente</Link>
 <h1>Usar IA con un modelo local</h1>
 <p>Esta opción interpreta las observaciones de ConectadOS con un modelo descargado. No necesita una clave API de un proveedor. Consume memoria, CPU y energía; la calidad y la licencia dependen del modelo.</p>
 <h2>En tu computadora</h2>
 <ol><li>Instala <a href="https://ollama.com/download" target="_blank" rel="noreferrer">Ollama desde su sitio oficial</a>. Elige un modelo de texto adecuado para tu memoria, revisa su licencia y descárgalo con Ollama.</li>
 <li>Configura <code>OLLAMA_NO_CLOUD=1</code> en el proceso de Ollama y reinícialo. Su API debe responder en loopback, puerto 11434, y confirmar que la nube está desactivada. Versiones sin esta comprobación no se aceptan.</li>
 <li>Inicia ConectadOS con <code>CONECTADOS_LOCAL_AI=loopback</code>. Esta variable habilita exclusivamente el Ollama del mismo equipo donde corre el servidor de ConectadOS.</li>
 <li>En Configuración, selecciona «Ollama · modelo local», consulta los modelos descargados y guarda uno. Revisa y autoriza una pregunta para comprobar la respuesta.</li></ol>
 <h2>En Docker o Coolify</h2>
 <p>Pide a tu agente que prepare un servicio privado llamado <code>ollama</code>, conectado a la misma red Docker de ConectadOS. Configura <code>OLLAMA_NO_CLOUD=1</code> en ese servicio y <code>CONECTADOS_LOCAL_AI=docker</code> en ConectadOS. El puerto 11434 debe permanecer privado, sin dominio público ni puerto publicado en el host.</p>
 <p>Antes de instalar, revisa capacidad, imagen inmutable, licencia del modelo, red y volumen independiente. Una URL del navegador no habilita un servidor de IA. Dentro de Docker, loopback corresponde al propio contenedor; no corresponde al Mac ni al VPS anfitrión.</p>
 <h2>Qué se comprueba antes de enviar</h2>
 <p>ConectadOS comprueba nube desactivada, modelo local descargado, capacidad de texto y contexto suficiente. No descarga modelos, instala software, ejecuta herramientas ni recorta las fuentes para ocultar incompatibilidades. Cada consulta requiere una revisión y autorización; no se repite automáticamente tras un fallo.</p>
 <p>La respuesta y la pregunta se mantienen en la pantalla. El historial guarda metadatos y consumo, sin el texto. Revisa también la configuración de registros del propio Ollama. Los límites locales se comparten con los demás motores y no calculan el costo de electricidad o del servidor.</p>
 <h2>Comprobar la calidad del modelo</h2>
 <p>Prueba una pregunta cuyo dato sí aparece en las fuentes y otra cuyo dato está ausente. Comprueba que responde con el dato y su cita en el primer caso, y reconoce la falta de información en el segundo. Si inventa memoria, costos o causas, conserva el resumen sin IA y prueba otro modelo antes de usar sus conclusiones.</p>
 <p>Si la consulta agota el tiempo de espera, revisa la capacidad del equipo y el modelo. El consumo puede haber comenzado; ConectadOS lo conserva como incierto y no repite la consulta automáticamente. Cancelar tampoco acredita consumo cero.</p>
 <h2>Si necesitas ayuda de tu agente</h2>
 <blockquote>Lee AGENTS.md y docs/LOCAL-AI.md de ConectadOS. Prepara el modelo local adecuado para este equipo, conserva lo que ya existe, desactiva Ollama Cloud y verifica la API. No abras puertos públicos ni uses mis credenciales de otros proveedores. Comprueba catálogo, consulta autorizada, parada y recuperación antes de declarar terminado el acceso local.</blockquote>
 <p><a href="https://docs.ollama.com/faq" target="_blank" rel="noreferrer">Configuración oficial de Ollama</a> · El funcionamiento completo de esta instalación requiere una prueba real; la presencia de un modelo en el catálogo no la sustituye.</p>
 </section></main>}
