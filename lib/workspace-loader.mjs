/** Commit inventory as soon as it arrives. An older request can never replace a newer read. */
export function createWorkspaceLoader({read,inventory,jobs,inventoryError,jobsError}){
 let revision=0;
 /** @param {AbortSignal} [signal] */
 async function load(signal){
  const own=++revision,current=()=>own===revision&&!signal?.aborted;
  const one=async(path,accept,reject)=>{try{const value=await read(path,signal);if(current())accept(value)}catch(error){if(current())reject(error)}};
  const primary=one('/api/infrastructure',inventory,inventoryError);
  void one('/api/operations',jobs,jobsError);
  await primary;
 }
 load.invalidate=()=>{revision++};
 return load;
}
