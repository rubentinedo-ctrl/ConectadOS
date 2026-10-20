'use client';
import {useState} from 'react';
import {HealthWorkspace} from '@/components/private/HealthWorkspace';
import {workspaceFixture,previewAt} from '@/lib/preview/workspace-fixtures';
export default function DesignPreview(){
 const [at,setAt]=useState(previewAt),[data,setData]=useState(()=>workspaceFixture(previewAt));
 function refresh(){const time=Date.now();setAt(time);setData(workspaceFixture(time))}
 return <HealthWorkspace preview data={data} now={at} onChanged={async()=>{}} onRefresh={refresh} onLogout={()=>{}}/>;
}
