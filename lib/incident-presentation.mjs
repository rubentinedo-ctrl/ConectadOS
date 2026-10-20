// Translate observed signals without guessing their cause or whether a stop is intentional.
export function incidentPresentation(i){
 const p=i.payload,id=p.findingId;
 if(id.startsWith('renewal:'))return {issue:'Renovación próxima o fecha pendiente de revisar',meaning:'Es un recordatorio del registro de costos; no demuestra un cobro ni un impago.',next:'Comprueba la fecha y el contrato en Costos.',area:'costs'};
 if(id.startsWith('backup:'))return {issue:'La protección de una copia requiere revisión',meaning:'La evidencia de copia o restauración necesita atención. No confirma pérdida de datos.',next:'Abre Respaldos y revisa la copia afectada y su última comprobación.',area:'backups'};
 if(/^(stale:|missing:|components-stale:)/.test(id)||p.severity==='unknown')return {issue:'Falta una lectura actual',meaning:'No tenemos datos suficientes para confirmar su estado. Esto no significa que esté caído.',next:'Comprueba la conexión y vuelve a consultar.',area:'connection'};
 if(id.startsWith('components-attention:'))return {issue:`${p.detail.match(/^\d+/)?.[0]??'Varios'} componentes detenidos o con advertencias`,meaning:'Son piezas internas de un servicio. Pueden estar detenidas de forma intencional; falta comprobarlo.',next:'Diagnostica para ver cuáles son y decidir si necesitan intervención.',area:'resource'};
 if(p.provider==='Supabase'&&/INACTIVE|PAUSED|paused/i.test(p.detail))return {issue:'Proyecto pausado o inactivo en Supabase',meaning:'El proveedor no lo reporta activo. Si es una prueba pausada a propósito, puedes retirarlo de pendientes.',next:'Confirma si debe estar activo antes de reanudarlo.',area:'resource'};
 if(/exited|stopped/i.test(p.detail))return {issue:'El recurso está detenido',meaning:'El proveedor informa que no está ejecutándose. Puede ser intencional; todavía no conocemos la causa.',next:'Diagnostica sin cambios y confirma si debe estar encendido.',area:'resource'};
 if(/degraded|unhealthy/i.test(p.detail))return {issue:'El servicio reporta un estado no saludable',meaning:'Una comprobación del proveedor no está pasando. Necesita diagnóstico para conocer el alcance.',next:'Obtén un diagnóstico antes de reiniciar o modificar el servicio.',area:'resource'};
 if(p.probeId)return {issue:'La comprobación web necesita revisión',meaning:'La prueba de acceso no acredita que todo el servicio funcione correctamente.',next:'Revisa la comprobación web y su respuesta.',area:'web'};
 return {issue:p.title,meaning:p.detail,next:'Comprueba la lectura y decide el siguiente paso antes de hacer cambios.',area:'resource'};
}
