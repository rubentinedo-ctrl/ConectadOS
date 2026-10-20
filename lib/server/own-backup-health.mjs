// Stable findings: sample timestamps and archive IDs never reopen an email.
export function ownBackupHealth(r2,drive,now=Date.now()){
 const findings=[],p=r2.automation;
 if(r2.destination){
  const latest=r2.runs.find(r=>r.state==='verified');
  const problem=p.error||['paused','uncertain'].includes(p.state)?'paused':p.enabled&&!p.workerFresh?'worker':p.enabled&&(!latest||now-latest.created>25*3600000)?'overdue':null;
  findings.push({kind:'r2',monitoring:p.enabled||Boolean(p.error),fresh:p.enabled&&p.workerFresh&&p.state==='waiting'&&Boolean(latest)&&now-latest.created<=25*3600000,problem,
   title:problem==='worker'?'El trabajador de respaldos de ConectadOS no tiene pulso reciente':problem==='overdue'?'ConectadOS no tiene una copia R2 comprobada en las últimas 25 horas':'El respaldo automático de ConectadOS está pausado',
   detail:'Revisa Protección de ConectadOS. La copia diaria debe descargarse y restaurarse antes de darse por válida. Un resultado incierto requiere revisión; este aviso no reinicia ni modifica respaldos.'});
 }
 if(drive.configured&&r2.destination){
  const problem=['paused','failed','uncertain','overdue','lagging','stale','error','unbound','unverified'].includes(drive.status)?drive.status:null;
  findings.push({kind:'drive',monitoring:p.enabled,fresh:drive.status==='verified',problem,title:'La réplica Drive de ConectadOS necesita revisión',detail:'Estado observado: '+drive.status+'. Revisa Protección de ConectadOS para ver el último recibo de descarga y restauración. Este aviso no sube archivos ni reactiva la réplica.'});
 }
 return findings;
}
