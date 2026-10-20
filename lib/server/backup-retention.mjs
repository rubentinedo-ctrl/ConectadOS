import {AppError} from './store.mjs';
import {backupReport} from './backup-settings.mjs';
import {driveStatusReport} from './drive-status.mjs';

// Preview only. This module has no deletion transport or background activation.
/** @param {import('./store.mjs').Store} db @param {{days?:unknown,keepVerified?:unknown,now?:number}} options */
export function retentionPreview(db,{days=30,keepVerified=3,now=Date.now()}={}){
 if(typeof days!=='number'||typeof keepVerified!=='number')throw new AppError('Los límites de conservación deben ser números enteros.');
 if(!Number.isSafeInteger(days)||days<7||days>3650||!Number.isSafeInteger(keepVerified)||keepVerified<3||keepVerified>100)throw new AppError('Conserva entre 7 y 3.650 días y al menos tres copias verificadas.');
 const r=backupReport(db),drive=driveStatusReport(db,{now}),rows=db.db.prepare('SELECT id,state,created,bytes FROM external_backup_runs WHERE revision=? ORDER BY created DESC,id LIMIT 10001').all(r.revision);
 if(rows.length>10000)throw new AppError('El catálogo excede 10.000 copias. No se preparó una limpieza parcial.',409);
 const protectedIds=new Set(rows.filter(r=>r.state==='verified').slice(0,keepVerified).map(r=>r.id)),receipts=new Map(drive.history.map(r=>[r.id,r])),cutoff=now-days*86400000;
 const items=rows.map(row=>{const receipt=receipts.get(row.id);const reason=protectedIds.has(row.id)?'Últimas copias verificadas protegidas':row.state!=='verified'?'Intento no verificado: requiere revisión':row.created>=cutoff?'Dentro del periodo de conservación':drive.status!=='verified'?'Lectura de Drive sin verificar':!receipt?.restored?'Sin recibo Drive visible para esta versión':'Candidata a revisión manual';return {id:row.id,created:row.created,bytes:row.bytes,candidate:reason==='Candidata a revisión manual',reason}});
 return {scope:'ConectadOS',previewOnly:true,automaticDeletion:false,days,keepVerified,checkedAt:now,items,candidates:items.filter(r=>r.candidate).length,coverage:'Solo copias de este destino del panel. No consulta ni borra objetos; el recibo visible no confirma la existencia actual del archivo. Cada borrado exige inventario remoto actual, recuperación independiente y aprobación de los objetos exactos. Las bases observadas quedan fuera.'};
}
