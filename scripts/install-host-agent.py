#!/usr/bin/env python3
"""Install the optional passive Linux sampler. Dry run unless --apply is supplied."""
import argparse, grp, hashlib, json, os, pwd, re, subprocess, sys
from pathlib import Path
from urllib.parse import urlsplit
ROOT=Path('/opt/conectados-host-agent');OUT=Path('/data/conectados-host-telemetry');UNIT=Path('/etc/systemd/system/conectados-host-agent.service');TIMER=Path('/etc/systemd/system/conectados-host-agent.timer')
def specifications(origin,server):
 url=urlsplit(origin)
 if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',server) or url.scheme!='https' or not url.hostname or url.username or url.password or url.port or url.path or url.query or url.fragment or not re.fullmatch(r'https://[A-Za-z0-9.-]+',origin):raise ValueError('Use a plain HTTPS origin and server UUID')
 service='''# ConectadOS passive host agent v1
[Unit]
Description=ConectadOS passive Linux host sample
[Service]
Type=oneshot
User=conectados-host-agent
Group=1000
ExecStart=/usr/bin/python3 /opt/conectados-host-agent/host-agent.py --coolify-origin ORIGIN --server-id SERVER --output /data/conectados-host-telemetry/host.json
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
PrivateNetwork=yes
ProtectSystem=strict
ProtectHome=yes
InaccessiblePaths=-/data/coolify -/var/lib/docker -/etc/ssh
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
CapabilityBoundingSet=
RestrictAddressFamilies=AF_UNIX
ReadWritePaths=/data/conectados-host-telemetry
UMask=0027
MemoryMax=64M
CPUQuota=10%
# Python startup also consumes the quota; allow headroom on busy hosts.
TimeoutStartSec=30s
'''.replace('ORIGIN',origin).replace('SERVER',server)
 timer='''# ConectadOS passive host agent v1
[Unit]
Description=ConectadOS passive sample every minute
[Timer]
OnBootSec=30s
OnUnitInactiveSec=60s
AccuracySec=1s
Unit=conectados-host-agent.service
[Install]
WantedBy=timers.target
'''
 return service,timer
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--coolify-origin',required=True);p.add_argument('--server-id',required=True);p.add_argument('--apply',action='store_true');p.add_argument('--previous-unit-sha256');a=p.parse_args();service,timer=specifications(a.coolify_origin,a.server_id)
 code=Path(__file__).with_name('host-agent.py').read_bytes();files={ROOT/'host-agent.py':code,UNIT:service.encode(),TIMER:timer.encode()}
 if not a.apply:print(json.dumps({'dryRun':True,'serverId':a.server_id,'paths':[str(x) for x in files],'output':str(OUT),'intervalSeconds':60,'networkAccess':False,'credentials':False,'systemAccount':'conectados-host-agent','loginShell':False}));return
 if a.previous_unit_sha256 and not re.fullmatch(r'[a-f0-9]{64}',a.previous_unit_sha256):raise ValueError('Invalid reviewed unit digest')
 if sys.platform!='linux' or os.geteuid()!=0 or not Path('/run/systemd/system').is_dir():raise ValueError('Apply requires a Linux host with root and systemd')
 for directory in [ROOT,OUT]:
  if directory.exists() and (directory.is_symlink() or not directory.is_dir()):raise ValueError('Destination must be a real directory')
 for path,content in files.items():
  if path.exists() or path.is_symlink():
   if path.is_symlink() or not path.is_file():raise ValueError('Existing installation path is not a regular file')
   if path.read_bytes()!=content and not (path==UNIT and a.previous_unit_sha256 and hashlib.sha256(path.read_bytes()).hexdigest()==a.previous_unit_sha256 and path.read_bytes().startswith(b'# ConectadOS passive host agent v1')):raise ValueError('Existing installation differs; preserve it and review before updating')
 try:grp.getgrgid(1000)
 except KeyError:subprocess.run(['groupadd','--gid','1000','conectados-host-readers'],check=True,capture_output=True)
 try:account=pwd.getpwnam('conectados-host-agent')
 except KeyError:
  subprocess.run(['useradd','--system','--no-create-home','--home-dir','/nonexistent','--gid','1000','--shell','/usr/sbin/nologin','conectados-host-agent'],check=True,capture_output=True);account=pwd.getpwnam('conectados-host-agent')
 if account.pw_shell!='/usr/sbin/nologin' or account.pw_gid!=1000 or account.pw_dir!='/nonexistent':raise ValueError('Existing system account differs; review before using it')
 ROOT.mkdir(mode=0o755,exist_ok=True);os.chown(ROOT,0,0);os.chmod(ROOT,0o755);OUT.mkdir(mode=0o750,exist_ok=True);os.chown(OUT,account.pw_uid,1000);os.chmod(OUT,0o750)
 for path,content in files.items():
  if not path.exists():
   fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o644)
   with os.fdopen(fd,'wb') as f:f.write(content)
  elif path.read_bytes()!=content:
   temporary=path.with_name(path.name+'.conectados-new')
   fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o644)
   try:
    with os.fdopen(fd,'wb') as f:f.write(content);f.flush();os.fsync(f.fileno())
    os.replace(temporary,path)
   finally:
    if temporary.exists():temporary.unlink()
  os.chown(path,0,0);os.chmod(path,0o644)
 subprocess.run(['systemd-analyze','verify',str(UNIT),str(TIMER)],check=True,capture_output=True)
 subprocess.run(['systemctl','daemon-reload'],check=True,capture_output=True);subprocess.run(['systemctl','start','conectados-host-agent.service'],check=True,capture_output=True);subprocess.run(['systemctl','enable','--now','conectados-host-agent.timer'],check=True,capture_output=True)
 print(json.dumps({'installed':True,'sampleWritten':(OUT/'host.json').is_file(),'timerEnabled':True,'runtimeUser':'conectados-host-agent','networkAccess':False,'credentials':False}))
if __name__=='__main__':
 try:main()
 except Exception:print('Host agent installation did not complete. Previous files were preserved; inspect its private diagnostics.',file=sys.stderr);sys.exit(1)
