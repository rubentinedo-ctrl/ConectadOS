// Presentation only. Old receipts remain visible but never certify current coverage.
const dayLimit=25*3600000;
/** @param {import('./resource-backup-types').ResourceBackupsReport|undefined} report @param {number} now */
export function backupOverview(report,now,unavailable=false){
 const fresh=!unavailable&&report?.status==='observed'&&!report.error&&Number.isFinite(report.expiresAt)&&report.expiresAt>now;
 const rows=(report?.items??[]).map(item=>{
  let state=item.state;
  if(!fresh)state=item.latest?'stale':'unknown';
  else if(['restored','unverified'].includes(state)){
   if(!item.latest?.backupAt||item.latest.backupAt>now+30000)state='unknown';
   else if(now-item.latest.backupAt>dayLimit)state='overdue';
  }
  return {item,state};
 });
 const restored=rows.filter(r=>r.state==='restored').length,attention=rows.filter(r=>['failed','overdue'].includes(r.state)).length;
 return {fresh,rows,total:rows.length,restored,attention,pending:rows.length-restored,working:rows.filter(r=>r.state==='working').length};
}
/** @param {import('./backup-protection-types').BackupProtectionReport|undefined} report @param {number} now */
export function consoleCopyStatus(report,now,unavailable=false){
 const r=report?.r2,d=report?.drive;
 const recent=(copy,limit)=>Boolean(copy?.createdAt&&copy.createdAt<=now+30000&&now-copy.createdAt<=limit);
 const r2=unavailable?{tone:'unknown',label:'Lectura sin confirmar'}:!r?.configured?{tone:'unknown',label:'Sin configurar'}:!r.enabled?{tone:'unknown',label:'Programación pausada'}:r.lastAttempt&&['failed','uncertain'].includes(r.lastAttempt.state)?{tone:'attention',label:'Último intento por revisar'}:!r.workerFresh?{tone:'unknown',label:'Actividad sin confirmar'}:!recent(r.lastVerified,dayLimit)?{tone:'attention',label:'Copia reciente sin confirmar'}:{tone:'verified',label:'Copia comprobada'};
 const drive=unavailable?{tone:'unknown',label:'Lectura sin confirmar'}:!d?.configured?{tone:'unknown',label:'Sin configurar'}:d.status==='verified'&&!d.error&&!!d.expiresAt&&d.expiresAt>now&&recent(d.lastVerified,d.copyAgeLimitMs)?{tone:'verified',label:'Réplica comprobada'}:['error','failed','uncertain','overdue','lagging'].includes(d.status)?{tone:'attention',label:'Réplica por revisar'}:{tone:'unknown',label:({working:'Réplica en curso',paused:'Réplica pausada',pending:'Réplica pendiente',unverified:'Restauración pendiente',unbound:'Vinculación por revisar',stale:'Informe vencido',waiting:'Esperando informe'})[d.status]??'Lectura sin confirmar'};
 return {r2,drive};
}
export const backupStateLabel={restored:'Restauración local comprobada',unverified:'Falta probar la restauración',working:'Copia en curso',overdue:'Copia de más de 25 horas',failed:'Último intento con fallo',stale:'Informe vencido',unknown:'Sin evidencia vinculada'};
export const backupNextStep={restored:'Conserva los comprobantes y sigue el calendario de copias. La restauración registrada corresponde al ensayo local.',unverified:'Hay una copia registrada. Falta ensayar su restauración en un entorno aislado para confirmar que se puede recuperar.',working:'El informe registra una copia en curso. Actualiza la lectura cuando termine para conocer el resultado.',overdue:'Revisa el calendario y el último trabajo: la copia registrada supera las 25 horas.',failed:'Revisa el informe del trabajo y su error antes de aprobar un reintento. La copia anterior conserva su fecha.',stale:'Actualiza los informes. Los comprobantes anteriores siguen disponibles, pero no confirman el estado actual.',unknown:'Vincula el informe de esta base o revisa su lector. La falta de evidencia no confirma que exista o falte una copia.'};
