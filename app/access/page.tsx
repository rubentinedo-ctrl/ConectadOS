import {redirect} from 'next/navigation';
import {store,isAuthenticated} from '@/lib/server/security';
import {AccessForm} from '@/components/private/AccessForm';
export const dynamic='force-dynamic';
export default async function Access(){if(await isAuthenticated())redirect('/');const db=store();try{return <AccessForm setup={!db.hasOwner()} googleEnabled={db.googleStatus().linked}/>}finally{db.close()}}
