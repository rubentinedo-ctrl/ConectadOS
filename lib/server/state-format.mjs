// Increase this only for a storage change that an older runtime cannot safely read.
export const STATE_FORMAT=1;
export function assertStateFormat(db){
 const format=db.prepare('PRAGMA user_version').get().user_version;
 // Format zero is the existing development database, before this guard was added.
 if(format!==0&&format!==STATE_FORMAT)throw new Error('El formato de datos requiere otra versión de ConectadOS. Se conservó sin modificar.');
 return format;
}
