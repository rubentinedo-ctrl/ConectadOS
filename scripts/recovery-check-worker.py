#!/usr/bin/env python3
"""Restore only allowlisted backup archives in disposable, offline PostgreSQL fixtures."""
import argparse,datetime,fcntl,hashlib,json,os,re,stat,subprocess,tempfile,time,uuid
from pathlib import Path
HEX=re.compile(r'[a-f0-9]{64}'); UUID=re.compile(r'[a-f0-9-]{36}')
def read(path,limit=131072):
    p=Path(path)
    if any(x.is_symlink() for x in [p,*p.parents]):raise ValueError('linked input')
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        s=os.fstat(fd)
        if not stat.S_ISREG(s.st_mode) or s.st_size>limit:raise ValueError('input size')
        raw=os.read(fd,limit+1)
        if len(raw)!=s.st_size:raise ValueError('input changed')
        return json.loads(raw)
    finally:os.close(fd)
def write(path,value,mode=0o600):
    p=Path(path);fd,tmp=tempfile.mkstemp(dir=p.parent,prefix='.recovery-')
    try:
        with os.fdopen(fd,'w') as f:json.dump(value,f,separators=(',',':'));f.flush();os.fsync(f.fileno());os.fchmod(f.fileno(),mode)
        if mode==0o640:os.chown(tmp,0,1000)
        os.replace(tmp,p)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)
def digest(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for b in iter(lambda:f.read(1048576),b''):h.update(b)
    return h.hexdigest()
def signature(raw):
    lines=raw.decode().splitlines();tables={};seq=[];i=0
    while i<len(lines):
        line=lines[i]
        if line.startswith('COPY ') and line.endswith(' FROM stdin;'):
            rows=[];key=line;i+=1
            while i<len(lines) and lines[i]!='\\.':rows.append(lines[i]);i+=1
            if i==len(lines) or key in tables:raise ValueError('invalid COPY')
            tables[key]={'rows':len(rows),'sha256':hashlib.sha256('\n'.join(sorted(rows)).encode()).hexdigest()}
        elif line.startswith('SELECT pg_catalog.setval('):seq.append(line)
        elif line.startswith(('INSERT ','SELECT pg_catalog.lo_','SELECT pg_catalog.lowrite')):raise ValueError('unsupported data section')
        i+=1
    return {'tables':tables,'sequences':sorted(seq)}
def valid_request(j,c,instance,now):
    if not isinstance(j,dict) or set(j)!={'schema','id','ref','sha256','backupAt','instance','createdAt','expiresAt'}:return False
    return j['schema']==1 and isinstance(j['id'],str) and bool(UUID.fullmatch(j['id'])) and j['ref'] in c['bindings'] and isinstance(j['sha256'],str) and bool(HEX.fullmatch(j['sha256'])) and j['instance']==instance and type(j['backupAt'])==int and type(j['createdAt'])==int and type(j['expiresAt'])==int and 0<=now-j['createdAt']<=300000 and now<j['expiresAt']<=j['createdAt']+300000
def run(args,data=None,timeout=90,log=None):
    r=subprocess.run(args,input=data,capture_output=True,timeout=timeout)
    if log:log.write(r.stderr);log.flush()
    if r.returncode:raise RuntimeError('isolated command failed')
    return r.stdout
def restore(binding,request,work):
    status=read(binding['status']);archive=Path(status['archive_identity'][0]);base=Path('/data/coolify/backups/databases')
    if status['status']!='success' or status['sha256']!=request['sha256'] or not archive.is_relative_to(base) or any(p.is_symlink() for p in [archive,*archive.parents]) or not archive.is_file() or archive.stat().st_size!=status['bytes'] or status['bytes']>268435456:raise ValueError('backup changed')
    at=int(datetime.datetime.strptime(status['timestamp'],'%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc).timestamp()*1000)
    if digest(archive)!=request['sha256'] or at!=request['backupAt']:raise ValueError('digest or date mismatch')
    name='conectados-recovery-'+uuid.uuid4().hex[:20];token=request['id'];started=False
    user=binding['user'];database=binding['database']
    if not all(re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',x) for x in [user,database]):raise ValueError('reviewed database identity required')
    init='initdb -D /tmp/proof --username='+user+' --no-locale --encoding=UTF8 --auth-local=trust --auth-host=reject >/tmp/initdb.log 2>&1 && exec postgres -D /tmp/proof -c listen_addresses= -c unix_socket_directories=/tmp -c shared_buffers=32MB -c work_mem=2MB -c max_connections=20'
    if binding['supabase']:init+=' -c shared_preload_libraries=pg_net,pg_stat_statements -c pg_net.database_name=template1'
    with open(work/'diagnostic-private.log','ab') as log:
      def call(args,data=None,timeout=90):return run(args,data,timeout,log)
      def sql(q,db='postgres'):
        return call(['docker','exec','-i',name,'psql','-h','/tmp','-XqAt','-v','ON_ERROR_STOP=1','-U',user,'-d',db],('SET timezone=\'UTC\'; SET search_path=pg_catalog; '+q).encode())
      try:
        call(['docker','run','-d','--pull','never','--name',name,'--label','conectados.recovery='+token,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','512m','--memory-swap','512m','--cpus','0.5','--pids-limit','128','--tmpfs','/tmp:rw,nosuid,size=384m,mode=1777','--tmpfs','/var/lib/postgresql/data:rw,nosuid,size=1m,mode=1777','--user','postgres','--entrypoint','sh',binding['image'],'-c',init]);started=True
        spec=json.loads(call(['docker','inspect',name]))[0]
        if spec['HostConfig']['NetworkMode']!='none' or spec['Mounts'] or spec['HostConfig']['PortBindings'] or spec['HostConfig']['Memory']!=536870912:raise ValueError('isolation mismatch')
        for _ in range(60):
            r=subprocess.run(['docker','exec',name,'pg_isready','-h','/tmp','-U',user,'-d','postgres'],capture_output=True)
            if r.returncode==0:break
            time.sleep(1)
        else:raise RuntimeError('fixture startup failed')
        roles=Path(binding['roles']).read_text();duplicates=['CREATE ROLE '+user+';','CREATE ROLE "'+user+'";']
        if sum(line in duplicates for line in roles.splitlines())!=1:raise ValueError('bootstrap mismatch')
        sql('\n'.join('-- existing bootstrap' if line in duplicates else line for line in roles.splitlines()))
        if database!='postgres':sql('CREATE DATABASE "'+database+'" OWNER "'+user+'";')
        raw=archive.read_bytes()
        call(['docker','exec','-i',name,'pg_restore','-h','/tmp','-U',user,'-d',database,'--single-transaction','--exit-on-error'],raw,420)
        expected=signature(call(['docker','exec','-i',name,'pg_restore','--data-only','--file=-'],raw,180))
        actual=signature(call(['docker','exec',name,'pg_dump','-h','/tmp','-U',user,'-d',database,'--data-only'],timeout=180))
        write(work/'data-comparison-private.json',{'expected':expected,'actual':actual})
        if expected!=actual:raise ValueError('restored data mismatch')
        # A second schema dump validates catalog access, ownership, ACLs, policies and constraints survived restore.
        schema=call(['docker','exec',name,'pg_dump','-h','/tmp','-U',user,'-d',database,'--schema-only'],timeout=180)
        write(work/'proof.json',{'schema':1,'ref':request['ref'],'backupSha256':request['sha256'],'restored':True,'tables':len(expected['tables']),'dataMatch':True,'sequencesMatch':True,'schemaDumpSha256':hashlib.sha256(schema).hexdigest(),'network':'none','productionMounts':0,'productionWrites':False,'fullApplicationRecovery':False,'finishedAt':int(time.time()*1000)})
        return len(expected['tables'])
      finally:
        if started:
            own=json.loads(run(['docker','inspect',name]))[0]
            if own['Config']['Labels'].get('conectados.recovery')==token:run(['docker','rm','-f',name])
def main():
    os.umask(0o077);p=argparse.ArgumentParser();p.add_argument('--config',required=True);a=p.parse_args();config_path=Path(a.config)
    if config_path.stat().st_uid!=0 or stat.S_IMODE(config_path.stat().st_mode)!=0o600:raise ValueError('root configuration required')
    c=read(config_path);journal=Path(c['journal']);journal.mkdir(mode=0o700,parents=True,exist_ok=True)
    lock=open(journal/'worker.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    own=json.loads(run(['docker','inspect',c['container']]))[0];instance=own['Id']
    host=read('/data/conectados-host-telemetry/host.json')
    if not own['State']['Running'] or int(time.time()*1000)-host['sampledAt']>180000:raise ValueError('host unavailable')
    jobs=read(journal/'jobs.json') if (journal/'jobs.json').exists() else []
    # Only fixtures tied to this private journal can be reclaimed after a crash.
    for cid in run(['docker','ps','-aq','--filter','label=conectados.recovery']).decode().split():
        item=json.loads(run(['docker','inspect',cid]))[0]
        if item['Name'].startswith('/conectados-recovery-') and item['Config']['Labels'].get('conectados.recovery') in {j['id'] for j in jobs} and item['HostConfig']['NetworkMode']=='none' and not item['Mounts']:
            run(['docker','rm','-f',cid])
    # Crashed jobs are never automatically retried.
    for j in jobs:
        if j['state'] in ['running','queued']:j.update(state='failed',finishedAt=int(time.time()*1000))
    def publish():
        write(journal/'jobs.json',jobs)
        write('/data/conectados-host-telemetry/recovery-checks.json',{'schema':1,'sampledAt':int(time.time()*1000),'instance':instance,'identity':c['identity'],'agentId':host['agentId'],'serverId':host['serverId'],'coolifyOrigin':host['coolifyOrigin'],'refs':list(c['bindings']),'jobs':jobs[-80:]},0o640)
    publish()
    requests=Path(c['requests'])
    if any(p.is_symlink() for p in [requests,*requests.parents]) or not requests.is_dir():raise ValueError('reviewed queue required')
    for f in sorted(requests.glob('*.json'))[:100]:
        try:j=read(f,4096)
        except (ValueError,OSError):continue
        current=json.loads(run(['docker','inspect',c['container']]))[0]
        if current['Id']!=instance or not current['State']['Running']:return
        if not valid_request(j,c,instance,int(time.time()*1000)) or f.name!=j['ref']+'.json' or any(old['id']==j['id'] for old in jobs):continue
        job={k:j[k] for k in ['id','ref','sha256','backupAt','createdAt']};job.update(state='running',finishedAt=None,tables=0);jobs.append(job);jobs[:]=jobs[-80:];publish()
        work=journal/j['id'];work.mkdir(mode=0o700)
        try:
            # Bounded headroom and no overlap with existing recovery/build work.
            mem=next(int(l.split()[1])*1024 for l in Path('/proc/meminfo').read_text().splitlines() if l.startswith('MemAvailable:'))
            active=run(['docker','ps','--format','{{.Names}}']).decode().splitlines()
            if mem<2147483648 or any(v.startswith(('protection-restore-','vertical-restore-','conectados-recovery-')) for v in active):raise ValueError('recovery busy')
            job['tables']=restore(c['bindings'][j['ref']],j,work);job['state']='success'
        except Exception:job['state']='failed'
        finally:job['finishedAt']=int(time.time()*1000);publish()
if __name__=='__main__':
    try:main()
    except Exception:print('Recovery worker unavailable; no automatic retry.');raise SystemExit(1)
