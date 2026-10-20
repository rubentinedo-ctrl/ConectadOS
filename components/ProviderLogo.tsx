import {providerIcons} from '@/lib/provider-icons';
export function ProviderLogo({provider,size=24}:{provider:keyof typeof providerIcons;size?:number}){
 const icon=providerIcons[provider];
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={icon.path}/></svg>;
}
