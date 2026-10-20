#!/usr/bin/env python3
"""Passive Linux host sample. No socket, network, shell, Docker or credentials."""
import argparse, hashlib, json, os, re, sys, tempfile, time
from pathlib import Path
VERSION = "1"
def cpu_counters(text):
    row=text.splitlines()[0].split()
    if len(row)<9 or row[0]!="cpu":raise ValueError("CPU counters unavailable")
    values=[int(v) for v in row[1:9]]
    if any(v<0 for v in values):raise ValueError("CPU counters invalid")
    return values
def cpu_delta(before,after):
    changes=[b-a for a,b in zip(before,after)];total=sum(changes)
    if len(changes)!=8 or min(changes)<0 or total<=0:return {"workPercent":None,"stealPercent":None,"ioWaitPercent":None,"reason":"counter-reset"}
    percent=lambda v:round(100*v/total,3)
    return {"workPercent":percent(total-changes[3]-changes[4]-changes[7]),"stealPercent":percent(changes[7]),"ioWaitPercent":percent(changes[4]),"reason":"sampled"}
def memory(text):
    values={}
    for line in text.splitlines():
        match=re.fullmatch(r"([A-Za-z_()]+):\s+(\d+)\s+kB",line.strip())
        if match:values[match[1]]=int(match[2])*1024
    total,available,swap_total,swap_free=[values[k] for k in ("MemTotal","MemAvailable","SwapTotal","SwapFree")]
    if not 0<=available<=total or total<=0 or not 0<=swap_free<=swap_total:raise ValueError("Memory sample invalid")
    return {"totalBytes":total,"availableBytes":available,"swapTotalBytes":swap_total,"swapFreeBytes":swap_free}
def filesystem(info):
    total,free,available=[v*info.f_frsize for v in (info.f_blocks,info.f_bfree,info.f_bavail)]
    if not 0<=available<=free<=total or total<=0:raise ValueError("Filesystem sample invalid")
    return {"path":"/","totalBytes":total,"freeBytes":free,"availableBytes":available}
def sample(origin,server_id):
    if sys.platform!="linux":raise ValueError("Host agent requires Linux")
    machine=Path("/etc/machine-id").read_text().strip()
    if not re.fullmatch(r"[0-9a-fA-F]{32}",machine):raise ValueError("Host identity unavailable")
    start=time.monotonic();before=cpu_counters(Path("/proc/stat").read_text());time.sleep(1)
    after=cpu_counters(Path("/proc/stat").read_text());uptime=float(Path("/proc/uptime").read_text().split()[0]);loads=list(os.getloadavg())
    if uptime<0 or any(v<0 for v in loads):raise ValueError("Host sample invalid")
    return {"schema":1,"agentVersion":VERSION,"agentId":hashlib.sha256(machine.encode()).hexdigest(),"coolifyOrigin":origin,"serverId":server_id,
            "sampledAt":int(time.time()*1000),"windowMs":round((time.monotonic()-start)*1000),"cpuCount":os.cpu_count(),"cpu":cpu_delta(before,after),
            "memory":memory(Path("/proc/meminfo").read_text()),"disk":filesystem(os.statvfs("/")),"load":loads,"uptimeSeconds":uptime}
def write_sample(destination,value):
    path=Path(destination)
    if path.is_symlink() or not path.parent.is_dir() or path.parent.is_symlink():raise ValueError("Output requires an existing private directory")
    fd,temporary=tempfile.mkstemp(prefix=".host-sample-",dir=path.parent)
    try:
        os.fchmod(fd,0o640)
        with os.fdopen(fd,"w") as output:
            json.dump(value,output,allow_nan=False,separators=(",",":"));output.flush();os.fsync(output.fileno())
        os.replace(temporary,path)
    finally:
        if os.path.exists(temporary):os.unlink(temporary)
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--coolify-origin",required=True);parser.add_argument("--server-id",required=True);parser.add_argument("--output");args=parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}",args.server_id):raise ValueError("Server identity invalid")
    from urllib.parse import urlsplit
    url=urlsplit(args.coolify_origin)
    if url.scheme!="https" or not url.hostname or url.username or url.password or url.port or url.path or url.query or url.fragment:raise ValueError("Use a plain HTTPS origin")
    value=sample(args.coolify_origin,args.server_id)
    if args.output:write_sample(args.output,value);print(json.dumps({"sampleWritten":True,"sampledAt":value["sampledAt"]}))
    else:print(json.dumps(value,allow_nan=False))
if __name__=="__main__":
    try:main()
    except Exception:print("Host sample unavailable; previous file preserved.",file=sys.stderr);sys.exit(1)
