import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,lstat} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {publicSourcePath,stageSourcePackage} from '../scripts/package-source.mjs';
import {execFileSync} from 'node:child_process';
test('a clean download candidate includes new sources but excludes ignored installation state',async()=>{
 const base=await mkdtemp(path.join(tmpdir(),'conectados-untracked-')),root=path.join(base,'source'),target=path.join(base,'candidate');await mkdir(root);
 try{
  execFileSync('git',['init','--quiet'],{cwd:root});
  const required=['distribution/README.md','distribution/AGENTS.md','distribution/CLAUDE.md','LICENSE','package.json','package-lock.json','scripts/install.mjs','distribution/docs/GETTING-STARTED.md','distribution/docs/PRODUCT.md','distribution/deploy/README.md'];
  for(const file of [...required,'lib/new-feature.mjs','.data/fixture.json']){await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),'Fixture only\n');}
  await writeFile(path.join(root,'.gitignore'),'.data/\n');
  const report=await stageSourcePackage(root,target);
  assert.ok(report.files.some(x=>x.file==='lib/new-feature.mjs'));
  assert.equal(await readFile(path.join(target,'lib/new-feature.mjs'),'utf8'),'Fixture only\n');
  assert.equal(report.files.some(x=>x.file.startsWith('.data/')),false);
  await assert.rejects(lstat(path.join(target,'.data')),{code:'ENOENT'});
 }finally{await rm(base,{recursive:true,force:true});}
});
test('source package excludes private files even under allowed ancestors',()=>{
 for(const file of ['app/.env.local','lib/.keys/vault.key','components/private/vault.key','docs/private/account.json','deploy/observer/node_modules/x/package.json','deploy/observer/.vercel/project.json','tests/../.keys/vault.key','/etc/passwd'])assert.equal(publicSourcePath(file),false,file);
 for(const file of ['components/private/AccountSecurity.tsx','scripts/install.mjs','docs/licenses/third-party/license.txt','deploy/observer/.env.example','distribution/GUIA-INSTALACION.html'])assert.equal(publicSourcePath(file),true,file);
 assert.equal(publicSourcePath('distribution/private-export.html'),false);
});
test('candidate rejects links and owner identifiers before writing and never replaces a target',async()=>{
 const base=await mkdtemp(path.join(tmpdir(),'conectados-source-')),root=path.join(base,'source'),target=path.join(base,'candidate');await mkdir(root);
 try{
  const required=['distribution/README.md','distribution/AGENTS.md','distribution/CLAUDE.md','LICENSE','package.json','package-lock.json','scripts/install.mjs','distribution/docs/GETTING-STARTED.md','distribution/docs/PRODUCT.md','distribution/deploy/README.md'];
  for(const file of required){await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),'Reviewed fixture source\n');}
  await writeFile(path.join(root,'scripts/install.mjs'),'https://console.'+['tinergia','com'].join('.'));await assert.rejects(stageSourcePackage(root,target,{files:required}),/identifier/);await assert.rejects(lstat(target),{code:'ENOENT'});
  await rm(path.join(root,'scripts/install.mjs'));await symlink(path.join(root,'LICENSE'),path.join(root,'scripts/install.mjs'));await assert.rejects(stageSourcePackage(root,target,{files:required}),/links/);await assert.rejects(lstat(target),{code:'ENOENT'});
  await rm(path.join(root,'scripts/install.mjs'));await writeFile(path.join(root,'scripts/install.mjs'),'Reviewed installer');const report=await stageSourcePackage(root,target,{files:required});assert.equal(report.publicationReady,false);assert.equal(report.includesState,false);assert.equal(await readFile(path.join(target,'README.md'),'utf8'),'Reviewed fixture source\n');await assert.rejects(stageSourcePackage(root,target,{files:required}),/exists/);assert.equal(await readFile(path.join(target,'scripts/install.mjs'),'utf8'),'Reviewed installer');
  await mkdir(path.join(root,'deploy/observer'),{recursive:true});await writeFile(path.join(root,'deploy/observer/.env.example'),'CRON_SECRET=FIXTURE_MUST_NOT_LEAK');const other=path.join(base,'other');await assert.rejects(stageSourcePackage(root,other,{files:[...required,'deploy/observer/.env.example']}),/non-template/);await assert.rejects(lstat(other),{code:'ENOENT'});
 }finally{await rm(base,{recursive:true,force:true});}
});
