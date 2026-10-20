import {readFile,readdir,lstat,mkdir,writeFile,cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const sha=value=>createHash('sha256').update(value).digest('hex');
const noticeName=/^(?:licen[cs]e|copying|copyright|notice)(?:[._-]|$)/i;
const ignored=new Set(['node_modules','.git','.next','.data','.keys','.backups','private']);
const relative=(root,file)=>path.relative(root,file).split(path.sep).join('/');
async function entries(folder){try{if(!(await lstat(folder)).isDirectory())return [];return await readdir(folder,{withFileTypes:true})}catch(e){if(e.code==='ENOENT')return [];throw e}}

// Read only dependency folders. Never traverse links or installation state.
export async function dependencyInventory(root,{at=new Date().toISOString()}={}){
 root=path.resolve(root);const packages=[],bundled=[],nativeComponents=[],notices=[],texts=new Map(),scopes=[];
 async function collectNotices(folder,owner,depth=0){
  if(depth>20)throw Error('Dependency notice directory exceeds depth limit');
  for(const entry of await entries(folder)){
   const file=path.join(folder,entry.name);
   if(entry.isDirectory()&&!ignored.has(entry.name))await collectNotices(file,owner,depth+1);
   else if(entry.isFile()&&noticeName.test(entry.name)){
    const data=await readFile(file);if(data.length>2*1024*1024||data.includes(0))throw Error('Dependency notice is not bounded text');
    const hash=sha(data);texts.set(hash,data);notices.push({owner,source:relative(root,file),sha256:hash,bytes:data.length,artifact:'docs/licenses/third-party/'+hash+'.txt'});
   }
  }
 }
 async function vendored(folder){
  for(const entry of await entries(folder)){
   const file=path.join(folder,entry.name);
   if(entry.isDirectory()&&!ignored.has(entry.name))await vendored(file);
   else if(entry.isFile()&&entry.name==='package.json'){
    const data=JSON.parse(await readFile(file,'utf8')),files=await entries(folder);
    bundled.push({name:data.name??null,version:data.version??null,license:data.license??null,packagePath:relative(root,folder),licenseFiles:files.filter(e=>e.isFile()&&noticeName.test(e.name)).map(e=>e.name).sort()});
   }
  }
 }
 async function installed(folder,scope){
  for(const entry of await entries(folder)){
   if(!entry.isDirectory()||entry.name.startsWith('.'))continue;
   const dir=path.join(folder,entry.name);
   if(entry.name.startsWith('@')){await installed(dir,scope);continue}
   const files=await entries(dir);if(!files.some(e=>e.name==='package.json'&&e.isFile()))continue;
   const metadata=await readFile(path.join(dir,'package.json')),data=JSON.parse(metadata.toString('utf8')),record={scope,packageJsonSha256:sha(metadata),name:data.name??null,version:data.version??null,license:data.license??null,licenseFiles:files.filter(e=>e.isFile()&&noticeName.test(e.name)).map(e=>e.name).sort(),packagePath:relative(root,dir)};
   packages.push(record);await collectNotices(dir,record.packagePath);
   if(data.name?.startsWith('@img/sharp-libvips-')&&files.some(e=>e.name==='README.md'&&e.isFile())){const file=path.join(dir,'README.md'),bytes=await readFile(file);if(bytes.length>2*1024*1024||bytes.includes(0))throw Error('Supplier notice is not bounded text');const hash=sha(bytes);texts.set(hash,bytes);notices.push({owner:record.packagePath,source:relative(root,file),sha256:hash,bytes:bytes.length,artifact:'docs/licenses/third-party/'+hash+'.txt',kind:'supplier-readme'});}
   if(data.name==='next')await vendored(path.join(dir,'dist/compiled'));
   if(data.name?.startsWith('@img/sharp-libvips-')&&files.some(e=>e.name==='versions.json'&&e.isFile())){
    const versions=JSON.parse(await readFile(path.join(dir,'versions.json'),'utf8'));
    for(const [name,version] of Object.entries(versions))nativeComponents.push({packagePath:record.packagePath,name,version,license:null,review:'Corresponding source and component notices not yet verified'});
   }
   await installed(path.join(dir,'node_modules'),scope);
  }
 }
 for(const [name,base] of [['main',root],['observer',path.join(root,'deploy/observer')]]){
  let lock;try{lock=await readFile(path.join(base,'package-lock.json'))}catch(e){if(e.code!=='ENOENT')throw e}
  const count=packages.length;await installed(path.join(base,'node_modules'),name);scopes.push({name,installed:packages.length>count,lockSha256:lock?sha(lock):null});
 }

 const supplements=[];let supplementalFile;try{const f=path.join(root,'docs/license-supplements.json'),st=await lstat(f);if(!st.isFile())throw Error('Supplement manifest must be a regular file');if(st.size>256*1024)throw Error('Supplement manifest exceeds limit');supplementalFile=JSON.parse(await readFile(f,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
 if(supplementalFile){
  if(supplementalFile.schemaVersion!==1||Object.keys(supplementalFile).sort().join(',')!=='records,schemaVersion'||!Array.isArray(supplementalFile.records)||supplementalFile.records.length>256)throw Error('Invalid supplemental notice manifest');
  const ids=new Set();for(const entry of supplementalFile.records){
   const keys=['packagePath','name','version','packageJsonSha256','kind','sourceURL','revision','registryIntegrityVerified','artifact','sha256','bytes'];
   if(!entry||Object.keys(entry).length!==keys.length||!keys.every(k=>Object.hasOwn(entry,k))||!['license','supplier-notice'].includes(entry.kind)||typeof entry.packagePath!=='string'||typeof entry.name!=='string'||typeof entry.version!=='string'||!(/^[a-f0-9]{64}$/).test(entry.packageJsonSha256)||!(/^[a-f0-9]{40}$/).test(entry.revision)||!(/^[a-f0-9]{64}$/).test(entry.sha256)||entry.registryIntegrityVerified!==true||entry.artifact!=='docs/licenses/third-party/'+entry.sha256+'.txt'||!Number.isSafeInteger(entry.bytes)||entry.bytes<1||entry.bytes>2*1024*1024)throw Error('Invalid supplemental notice');
   let url;try{url=new URL(entry.sourceURL)}catch{throw Error('Invalid supplemental source')};if(url.protocol!=='https:'||url.hostname!=='raw.githubusercontent.com'||url.username||url.password||url.search||url.hash||!new RegExp('^/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/'+entry.revision+'/[^?#]+$').test(url.pathname))throw Error('Supplement source must pin an upstream revision');
   const id=entry.packagePath+'|'+entry.kind;if(ids.has(id))throw Error('Duplicate supplemental notice');ids.add(id);
   let current=root;for(const part of entry.artifact.split('/')){current=path.join(current,part);const st=await lstat(current);if(st.isSymbolicLink())throw Error('Supplement artifact cannot follow a link')}
   const file=path.join(root,entry.artifact),st=await lstat(file);if(!st.isFile()||st.size!==entry.bytes)throw Error('Supplement artifact differs');const bytes=await readFile(file);if(bytes.includes(0)||sha(bytes)!==entry.sha256)throw Error('Supplement artifact differs');
   const installed=packages.find(p=>p.packagePath===entry.packagePath);if(installed&&(installed.name!==entry.name||installed.version!==entry.version||installed.packageJsonSha256!==entry.packageJsonSha256))throw Error('Supplement no longer matches installed package');
   supplements.push({...entry,installed:Boolean(installed),verified:true});texts.set(entry.sha256,bytes);notices.push({owner:entry.packagePath,source:entry.artifact,sha256:entry.sha256,bytes:entry.bytes,artifact:entry.artifact,kind:'upstream-'+entry.kind,upstream:entry.sourceURL,installed:Boolean(installed)});
  }
 }
 packages.sort((a,b)=>a.packagePath.localeCompare(b.packagePath));bundled.sort((a,b)=>a.packagePath.localeCompare(b.packagePath));notices.sort((a,b)=>a.source.localeCompare(b.source));nativeComponents.sort((a,b)=>(a.packagePath+'/'+a.name).localeCompare(b.packagePath+'/'+b.name));
 const report={schemaVersion:2,at,platform:process.platform,arch:process.arch,lockSha256:scopes.find(s=>s.name==='main')?.lockSha256??null,scope:'Installed main and observer packages, Next vendored metadata and supplied notice texts, native version metadata; no legal or distribution-completeness certification',scopes,packages,bundled,nativeComponents,supplements,notices,publicationReady:false};
 return {report,texts};
}

export async function writeDependencyInventory(root,options){
 const {report,texts}=await dependencyInventory(root,options),target=path.join(root,'docs/licenses/third-party');await mkdir(target,{recursive:true});
 for(const [hash,data] of texts){const file=path.join(target,hash+'.txt');try{await writeFile(file,data,{flag:'wx'})}catch(e){if(e.code!=='EEXIST')throw e;if(!data.equals(await readFile(file)))throw Error('Existing notice artifact does not match source')}}
 await writeFile(path.join(root,'docs/dependency-review.json'),JSON.stringify(report,null,2)+'\n');return report;
}

export async function packageDependencyNotices(root,target){
 const report=await writeDependencyInventory(root),licenses=path.join(target,'licenses');
 await cp(path.join(root,'docs/licenses'),licenses,{recursive:true});
 const packagedArtifact=artifact=>relative(path.join(root,'docs/licenses'),path.join(root,artifact));
 const packaged={...report,scope:'Build dependency evidence; includes development and optional packages not necessarily traced into runtime. Completeness review still required.',supplements:report.supplements.map(n=>({...n,artifact:packagedArtifact(n.artifact)})),notices:report.notices.map(n=>({...n,artifact:packagedArtifact(n.artifact)}))};
 await writeFile(path.join(licenses,'dependency-review.json'),JSON.stringify(packaged,null,2)+'\n');
 await cp(path.join(root,'LICENSE'),path.join(target,'LICENSE'));
 return packaged;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../',import.meta.url)),report=await writeDependencyInventory(root);
 console.log(JSON.stringify({packages:report.packages.length,bundled:report.bundled.length,nativeComponents:report.nativeComponents.length,noticeSources:report.notices.length,uniqueTexts:new Set(report.notices.map(n=>n.sha256)).size,missingDeclaredLicense:report.packages.filter(p=>!p.license).length,missingRootLicenseText:report.packages.filter(p=>!p.licenseFiles.length).length,publicationReady:false}));
}
