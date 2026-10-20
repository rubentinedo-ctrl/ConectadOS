#!/usr/bin/env python3
"""Publish bounded metadata from existing backup workers. No backup, archive read or network."""
import argparse, datetime, hashlib, json, os, re, stat, tempfile, time
from pathlib import Path
BASE = Path('/data/coolify/backups')
OUT = Path('/data/conectados-host-telemetry')
HASH = re.compile(r'[a-f0-9]{64}')
LABEL = re.compile(r'[a-z0-9][a-z0-9-]{0,63}')

def read_json(path, limit=65536):
    path = Path(path)
    for parent in [path, *path.parents]:
        if parent.is_symlink(): raise ValueError('Linked input rejected')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= limit: raise ValueError('Bounded regular input required')
        data = os.read(fd, limit+1)
        if len(data) != info.st_size: raise ValueError('Input changed')
        return json.loads(data), int(info.st_mtime*1000)
    finally: os.close(fd)

def validate_config(value):
    if not isinstance(value, dict) or set(value) != {'schema','bindings'} or value['schema'] != 1 or not isinstance(value['bindings'], list) or not 1 <= len(value['bindings']) <= 100: raise ValueError('Reviewed bindings required')
    refs = set(); labels=set()
    for b in value['bindings']:
        if not isinstance(b,dict) or set(b) != {'ref','label','component','coverage'} or not isinstance(b['ref'],str) or not HASH.fullmatch(b['ref']) or b['ref'] in refs: raise ValueError('Unique resource reference required')
        if not isinstance(b['label'],str) or not LABEL.fullmatch(b['label']) or b['label'] in labels or not isinstance(b['component'],str) or not LABEL.fullmatch(b['component']): raise ValueError('Fixed worker identity required')
        if not isinstance(b['coverage'],str) or not 1 <= len(b['coverage']) <= 240 or any(ord(c)<32 or ord(c)==127 for c in b['coverage']): raise ValueError('Plain coverage required')
        refs.add(b['ref']); labels.add(b['label'])
    return value

def stamp(value):
    if not isinstance(value,str) or not re.fullmatch(r'\d{8}T\d{6}Z',value): raise ValueError('UTC backup date required')
    return int(datetime.datetime.strptime(value,'%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc).timestamp()*1000)

def receipt(binding, raw, reported, now, drive=None):
    empty={'ref':binding['ref'],'state':'invalid','backupAt':None,'reportedAt':reported,'restored':False,'bytes':None,'sha256':None,'source':binding['label']+' · trabajador existente','coverage':binding['coverage'],'drive':None}
    if raw is None:return {**empty,'state':'missing','reportedAt':None}
    try:
        if not isinstance(raw,dict) or raw.get('status') not in ['success','failed','running'] or type(reported)!=int or not 0<reported<=now+30000:raise ValueError()
        at=stamp(raw.get('timestamp'))
        if at>now+30000:raise ValueError()
        r={**empty,'state':raw['status'],'backupAt':at}
        if r['state']=='success':
            if type(raw.get('bytes'))!=int or not 0<raw['bytes']<2**50 or not isinstance(raw.get('sha256'),str) or not HASH.fullmatch(raw['sha256']) or reported<at or type(raw.get('restored'))!=bool:raise ValueError()
            # An explicit mismatch cannot be hidden by a general restored=true field.
            restored=raw['restored'] and all(raw.get(k,True) is True for k in ['rows_match','policies_match','database_properties_match','security_match'])
            r.update(bytes=raw['bytes'],sha256=raw['sha256'],restored=restored)
        if drive:
            d,dt=drive
            period=d.get('period') if isinstance(d,dict) else None
            if isinstance(period,str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}',period) and 0<dt<=now+30000:
                status='failed' if d.get('status')=='failed' else 'not-confirmed'
                # Inclusion in a verified daily bundle is weaker than restoring this individual version.
                if d.get('status') in ['success','degraded'] and d.get('remote_hash_verified') is True and binding['component'] in d.get('components',[]) and binding['component'] not in d.get('errors',[]) and datetime.datetime.fromtimestamp(at/1000,datetime.timezone.utc).strftime('%Y-%m-%d')==period:status='included'
                r['drive']={'state':status,'period':period,'reportedAt':dt}
        return r
    except (ValueError,TypeError,OverflowError):return empty

def build(config,host,read=read_json,now=None):
    now = int(time.time()*1000) if now is None else now;validate_config(config)
    if host.get('schema')!=1 or not isinstance(host.get('agentId'),str) or not HASH.fullmatch(host['agentId']) or type(host.get('sampledAt'))!=int or not 0<=now-host['sampledAt']<=180000:raise ValueError('Fresh host binding required')
    drive=None
    try:drive=read(BASE/'drive-export/status.json')
    except (OSError,ValueError):pass
    items=[]
    for b in config['bindings']:
        try:raw,reported=read(BASE/b['label']/'status.json');items.append(receipt(b,raw,reported,now,drive))
        except FileNotFoundError:items.append(receipt(b,None,None,now))
        except (OSError,ValueError):items.append({**receipt(b,None,None,now),'state':'invalid'})
    return {'schema':1,'sampledAt':now,'agentId':host['agentId'],'serverId':host['serverId'],'coolifyOrigin':host['coolifyOrigin'],'items':items}

def publish(value):
    if OUT.is_symlink() or not OUT.is_dir():raise ValueError('Existing host output directory required')
    data=json.dumps(value,separators=(',',':'),allow_nan=False).encode()
    if len(data)>65536:raise ValueError('Report exceeds limit')
    target=OUT/'resource-backups.json'
    if target.is_symlink() or target.exists() and not target.is_file():raise ValueError('Invalid output')
    fd,tmp=tempfile.mkstemp(prefix='.resource-backups-',dir=OUT)
    try:
        with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno());os.fchown(f.fileno(),0,1000);os.fchmod(f.fileno(),0o640)
        os.replace(tmp,target)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--config',required=True);p.add_argument('--review',action='store_true');a=p.parse_args()
    config,mtime=read_json(a.config);validate_config(config)
    if a.review:print(json.dumps({'reviewed':True,'bindings':len(config['bindings']),'network':False,'archivesRead':False,'backupTriggered':False}));return
    if os.geteuid()!=0:raise ValueError('Private metadata publisher requires root')
    st=Path(a.config).stat()
    if st.st_uid!=0 or stat.S_IMODE(st.st_mode)!=0o600:raise ValueError('Root private configuration required')
    host,_=read_json(OUT/'host.json');value=build(config,host);publish(value)
    print(json.dumps({'published':True,'resources':len(value['items'])}))
if __name__=='__main__':
    try:main()
    except Exception:print('Resource backup report unavailable; previous evidence preserved.');raise SystemExit(1)
