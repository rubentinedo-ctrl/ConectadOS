#!/usr/bin/env python3
"""Read-only status publisher. Never accesses Google, Docker, or backup contents."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import time

spec = importlib.util.spec_from_file_location('own_mirror', Path(__file__).with_name('drive-mirror.py'))
mirror = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mirror)


def integer(value, minimum=0, maximum=2**53-1):
    return type(value) is int and minimum <= value <= maximum


def receipt(item, now):
    if not isinstance(item, dict) or not mirror.UUID.fullmatch(item.get('id', '')) or not mirror.HASH.fullmatch(item.get('digest', '')):
        raise ValueError('Invalid own receipt')
    if item.get('state') not in ['preparing', 'uploading', 'verified', 'uncertain', 'failed'] or not integer(item.get('bytes'), 1, mirror.LIMIT):
        raise ValueError('Invalid own receipt')
    if not integer(item.get('created'), 1, now+30000) or not integer(item.get('started'), item['created'], now+30000):
        raise ValueError('Invalid receipt time')
    finished = item.get('finished')
    if finished is not None and not integer(finished, item['started'], now+30000):
        raise ValueError('Invalid receipt time')
    verified = item['state'] == 'verified'
    if verified and (finished is None or not item.get('fileId') or not isinstance(item.get('restoration'), dict) or any(item['restoration'].get(k) is not True for k in ['restored', 'downloadMatched', 'effectsPaused', 'ownerPresent']) or item['restoration'].get('integrity') != 'ok'):
        raise ValueError('Verified receipt requires recovery evidence')
    return {k: item[k] for k in ['id', 'digest', 'bytes', 'created', 'started', 'finished', 'state']} | {'restored': verified}


def status(config, journal, units, runtime_identity, now):
    mirror.validate_config(config)
    if not mirror.HASH.fullmatch(runtime_identity) or journal.get('schemaVersion') != 1 or journal.get('configurationHash') != mirror.initial_journal(config)['configurationHash']:
        raise ValueError('Reviewed runtime identity required')
    if type(journal.get('enabled')) is not bool or journal.get('state') not in ['waiting', 'preparing', 'uploading', 'paused', 'failed', 'uncertain']:
        raise ValueError('Invalid own journal')
    heartbeat = journal.get('heartbeat')
    if heartbeat is not None and not integer(heartbeat, 1, now+30000):
        raise ValueError('Invalid worker heartbeat')
    if not isinstance(journal.get('items'), list) or len(journal['items']) > 512:
        raise ValueError('Bounded own journal required')
    items = [receipt(item, now) for item in journal['items']]
    if len({item['id'] for item in items}) != len(items):
        raise ValueError('Duplicate own receipt')
    if set(units) != {'timerActive', 'serviceState', 'exitCode'} or type(units['timerActive']) is not bool or units['serviceState'] not in ['idle', 'running', 'failed'] or not integer(units['exitCode'], 0, 255):
        raise ValueError('Invalid unit observation')
    verified = [item for item in items if item['restored']]
    return {'schema': 1, 'sourceBinding': config['sourceBinding'], 'runtimeIdentity': runtime_identity,
            'destinationIdentity': mirror.sha(json.dumps({k: config[k] for k in ['folderId', 'parentId', 'account', 'allowedUsers', 'remote']}, sort_keys=True).encode()),
            'observedAt': now, 'worker': {'enabled': config['enabled'] and journal['enabled'], 'heartbeat': heartbeat, 'state': journal['state'], **units},
            'totalAttempts': len(items), 'receipts': sorted(items, key=lambda i: i['created'], reverse=True)[:30],
            'lastVerified': max(verified, key=lambda i: i['created']) if verified else None}


def identity_file(file, config):
    file = Path(file)
    expected_volume = config['container'][11:] + '_conectados-keys'
    if not file.is_absolute() or file.name != 'backup-worker.key' or file.parent.name != '_data' or file.parent.parent.name != expected_volume:
        raise ValueError('Own keys volume required')
    for current in [file, *file.parents]:
        if current.is_symlink():
            raise ValueError('Identity cannot follow links')
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_uid != 1000 or st.st_mode & 0o077 or st.st_size != 32:
            raise ValueError('Private existing worker identity required')
        data = os.read(fd, 33)
        if len(data) != 32:
            raise ValueError('Bounded existing identity required')
        return hashlib.sha256(data).hexdigest()
    finally:
        os.close(fd)


def publish(root, report):
    root = Path(root)
    if not root.is_absolute() or root.is_symlink() or not root.is_dir():
        raise ValueError('Reviewed status directory required')
    for current in [root, *root.parents]:
        if current.is_symlink():
            raise ValueError('Status directory cannot follow links')
    st = root.stat()
    if st.st_uid != 0 or st.st_gid != 1000 or stat.S_IMODE(st.st_mode) != 0o750:
        raise ValueError('Private status directory required')
    target = root / 'status.json'
    if target.exists() or target.is_symlink():
        st = target.lstat()
        if not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or st.st_gid != 1000 or stat.S_IMODE(st.st_mode) != 0o640:
            raise ValueError('Private status file required')
    data = json.dumps(report, separators=(',', ':')).encode()
    if len(data) > 32768:
        raise ValueError('Bounded status required')
    temporary = root / 'status.json.pending'
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(data);handle.flush();os.fsync(handle.fileno());os.fchown(handle.fileno(), 0, 1000);os.fchmod(handle.fileno(), 0o640)
        os.replace(temporary, target)
        directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
        try:os.fsync(directory)
        finally:os.close(directory)
    finally:
        if temporary.exists():temporary.unlink()


def main():
    parser = argparse.ArgumentParser();parser.add_argument('--config', required=True);parser.add_argument('--identity-file', required=True);parser.add_argument('--output', required=True);args = parser.parse_args()
    if os.geteuid() != 0:raise ValueError('Reviewed publisher requires root to read its own private journal')
    config = mirror.validate_config(json.loads(mirror.private_file(args.config, 32768)))
    journal = json.loads(mirror.private_file(Path(config['stateRoot'])/'worker.json', 2*1024*1024))
    result = subprocess.run(['systemctl', 'show', 'conectados-drive-export.service', '--property=ActiveState,ExecMainStatus'], capture_output=True, text=True, timeout=10)
    if result.returncode:raise ValueError('Own service observation failed')
    properties = dict(line.split('=', 1) for line in result.stdout.strip().splitlines())
    if set(properties) != {'ActiveState', 'ExecMainStatus'}:raise ValueError('Own service properties missing')
    state = properties['ActiveState']
    if state not in ['inactive', 'active', 'activating', 'deactivating', 'failed']:raise ValueError('Unknown own service state')
    timer = subprocess.run(['systemctl', 'is-active', 'conectados-drive-export.timer'], capture_output=True, text=True, timeout=10)
    if timer.returncode not in [0, 3] or timer.stdout.strip() not in ['active', 'inactive']:raise ValueError('Own timer observation failed')
    exit_code = int(properties['ExecMainStatus'])
    units = {'timerActive': timer.returncode == 0, 'serviceState': 'failed' if state == 'failed' or exit_code else 'idle' if state == 'inactive' else 'running', 'exitCode': exit_code}
    report = status(config, journal, units, identity_file(args.identity_file, config), int(time.time()*1000))
    publish(args.output, report)
    print(json.dumps({'published': True, 'schema': 1}))


if __name__ == '__main__':
    try:main()
    except Exception:
        print('Drive status unavailable. Review private journal and fixed unit identities; no credentials printed.');raise SystemExit(1)
