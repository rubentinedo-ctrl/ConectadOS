import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,lstat,mkdir,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const exec=promisify(execFile),sha=data=>createHash('sha256').update(data).digest('hex');
const top=new Set(['package.json','package-lock.json','next.config.ts','next-env.d.ts','proxy.ts','tsconfig.json','LICENSE','Dockerfile','compose.yml','.dockerignore','.gitignore']);
const docs=new Set(['docs/BRAND-ASSETS.md','docs/license-supplements.json']);
export function publicSourcePath(file){
 if(typeof file!=='string'||file.includes('\\')||file.startsWith('/')||file.split('/').some(p=>!p||p==='.'||p==='..'))return false;
 const parts=file.split('/');
 if(parts.some(p=>['node_modules','.git','.next','.vercel','.data','.keys','.backups','__pycache__'].includes(p)||p.startsWith('.env')&&file!=='deploy/observer/.env.example'||p==='private'&&file.split('/').slice(0,2).join('/')!=='components/private'))return false;
 if(top.has(file)||docs.has(file))return true;
 if(file.startsWith('docs/licenses/'))return /\.(txt|md)$/i.test(file);
 if(file.startsWith('distribution/'))return /\.md$/.test(file)||file==='distribution/GUIA-INSTALACION.html';
 if(file.startsWith('components/private/'))return /^components\/private\/[^/]+\.(tsx|css)$/.test(file);
 if(/^(app|components|lib|scripts|tests|public)\//.test(file))return /\.(ts|tsx|mjs|js|css|py|json)$/.test(file);
 if(file.startsWith('deploy/observer/'))return /\.(mjs|json)$/.test(file)||file==='deploy/observer/LICENSE'||file==='deploy/observer/.env.example';
 return /^deploy\/[^/]+\.(service|timer)$/.test(file);
}
async function regularFile(root,file){
 let current=root;for(const part of file.split('/')){current=path.join(current,part);if((await lstat(current)).isSymbolicLink())throw Error('Source package cannot follow links');}
 const st=await lstat(current);if(!st.isFile()||st.size>2*1024*1024)throw Error('Source must be bounded regular text');
 const data=await readFile(current);if(data.includes(0))throw Error('Source must be text, not a binary');return data;
}
export async function stageSourcePackage(root,target,{files}={}){
 root=path.resolve(root);target=path.resolve(target);if(target===root||target.startsWith(root+path.sep))throw Error('Package must be outside the working tree');
 try{await lstat(target);throw Error('Destination already exists; it is preserved');}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!files)files=(await exec('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,maxBuffer:4*1024*1024})).stdout.split('\0').filter(Boolean);
 const plan=new Map();for(const file of [...new Set(files)].sort()){
  if(!publicSourcePath(file))continue;
  const data=await regularFile(root,file),destination=file.startsWith('distribution/')?file.slice(13):file;
  if(plan.has(destination))throw Error('Two sources map to the same packaged file');
  if(file==='deploy/observer/.env.example'){
   const allowed={OBSERVER_ENABLED:'0',OBSERVER_TARGETS:'[{"id":"panel","url":"https://panel.example.com"}]',OBSERVER_INTERVAL_SECONDS:'300',CRON_SECRET:'',OBSERVER_REPORT_SECRET:'',BLOB_STORE_ID:''};
   for(const line of data.toString('utf8').split('\n').map(s=>s.trim()).filter(s=>s&&!s.startsWith('#'))){const at=line.indexOf('=');if(at<1||!Object.hasOwn(allowed,line.slice(0,at))||allowed[line.slice(0,at)]!==line.slice(at+1))throw Error('Observer environment example contains non-template configuration');}
  }
  // Owner-specific deployment history and key material must not enter a public candidate.
  if(/tinergia\.com|82\.25\.92\.126|ruben\.tinedo@|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(data.toString('utf8')))throw Error('Private deployment identifier or key material in source; review before packaging');
  plan.set(destination,{source:file,data});
  if(file.startsWith('distribution/'))plan.set(file,{source:file,data});
 }
 for(const required of ['README.md','AGENTS.md','CLAUDE.md','LICENSE','package.json','package-lock.json','scripts/install.mjs','docs/GETTING-STARTED.md','docs/PRODUCT.md','deploy/README.md'])if(!plan.has(required))throw Error('Missing required public source: '+required);
 const manifest={schemaVersion:1,kind:'source-only-review-candidate',publicationReady:false,includesState:false,includesInstalledDependencies:false,files:[...plan].map(([file,{data}])=>({file,bytes:data.length,sha256:sha(data)}))};
 await mkdir(target,{mode:0o700});try{
  for(const [file,{data}] of plan){const destination=path.join(target,file);await mkdir(path.dirname(destination),{recursive:true,mode:0o700});await writeFile(destination,data,{flag:'wx',mode:0o600});}
  await writeFile(path.join(target,'SOURCE-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
 }catch(e){await rm(target,{recursive:true,force:true});throw e;}
 return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length!==3)throw Error('Uso: node scripts/package-source.mjs DESTINO_NUEVO_FUERA_DEL_REPOSITORIO');const report=await stageSourcePackage(fileURLToPath(new URL('../',import.meta.url)),process.argv[2]);console.log(JSON.stringify({files:report.files.length,sourceOnly:true,publicationReady:false}));}catch(e){console.error(e.message);process.exitCode=1;}
}
