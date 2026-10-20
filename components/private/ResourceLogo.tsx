"use client";
import {useState,type ReactNode} from 'react';
import type {ResourceLogo as LogoMetadata} from '@/lib/infrastructure-types';
export function ResourceLogo({logo,privateNames=false,children}:{logo?:LogoMetadata;privateNames?:boolean;children:ReactNode}){
 const [failedUrl,setFailedUrl]=useState<string|null>(null);
 const url=logo?`/api/logos?ref=${encodeURIComponent(logo.ref)}&v=${encodeURIComponent(logo.revision)}`:null;
 return logo&&!privateNames&&url!==failedUrl?<img className="resource-own-logo" src={url!} alt="" aria-hidden="true" width={48} height={48} onError={()=>setFailedUrl(url)}/>:children;
}
