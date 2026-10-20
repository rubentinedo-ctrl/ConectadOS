import {configuration,validateState,MAX_BYTES} from './monitor.mjs';
// Validate before using a backup in a new, paused installation. No network writes.
export function recoverExport(text) {
  if(typeof text!=='string'||Buffer.byteLength(text)>MAX_BYTES+6000)throw new Error('Invalid observer backup');
  const backup=JSON.parse(text);
  if(!backup||Object.keys(backup).length!==4||backup.backupVersion!==1||!Number.isSafeInteger(backup.exportedAt)||backup.exportedAt<0||!backup.configuration||Object.keys(backup.configuration).length!==2)throw new Error('Invalid observer backup');
  const config=configuration({OBSERVER_TARGETS:JSON.stringify(backup.configuration.targets),OBSERVER_INTERVAL_SECONDS:String(backup.configuration.intervalSeconds)});
  const state=validateState(backup.state,config);
  if(state.lastAttemptAt>backup.exportedAt||state.completedAt>backup.exportedAt)throw new Error('Backup contains future observations');
  return {config,state:{...structuredClone(state),lease:null},enabled:false};
}
