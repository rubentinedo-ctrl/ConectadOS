import {redirect} from 'next/navigation';
import {isAuthenticated} from '@/lib/server/security';
import {PrivateConsole} from '@/components/private/PrivateConsole';
export const dynamic='force-dynamic';
export default async function Page(){if(!await isAuthenticated())redirect('/access');return <PrivateConsole/>}
