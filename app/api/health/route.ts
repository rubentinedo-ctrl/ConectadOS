import {store,response} from '@/lib/server/security';
export const runtime='nodejs';
export async function GET(){let db;try{db=store();db.db.prepare('SELECT 1').get();return response({status:'ok'})}catch{return response({status:'unavailable'},503)}finally{db?.close()}}
