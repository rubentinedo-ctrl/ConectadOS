import {redirect} from 'next/navigation';
import {isAuthenticated} from '@/lib/server/security';
import {ObservedConsole} from '@/components/private/ObservedConsole';
export const dynamic='force-dynamic';
export default async function Page(){if(!await isAuthenticated())redirect('/access');return <ObservedConsole/>}
