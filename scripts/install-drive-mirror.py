#!/usr/bin/env python3
"""Prepare the reviewed Linux Drive mirror. Default is a plan, with no commands or writes."""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile

SOURCE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('conectados_mirror', SOURCE / 'drive-mirror.py')
mirror = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mirror)
LIB = Path('/opt/conectados-drive-export')
ETC = Path('/etc/conectados-drive-export')
STATE = Path('/data/conectados-drive-export/worker')
UNITS = Path('/etc/systemd/system')
SERVICE = 'conectados-drive-export.service'
TIMER = 'conectados-drive-export.timer'


def path_without_links(path):
    path = Path(path)
    for current in [path, *path.parents]:
        if current.is_symlink():
            raise ValueError('Installation paths cannot follow links')


def private_directory(path, uid=None):
    path = Path(path)
    path_without_links(path)
    uid = os.geteuid() if uid is None else uid
    if path.exists():
        s = path.stat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != uid or stat.S_IMODE(s.st_mode) != 0o700:
            raise ValueError('Existing private directory differs; review it without changing permissions')


def shared_directory(path):
    """Validate the shared data parent without tightening an existing host directory."""
    path = Path(path)
    path_without_links(path)
    if path.exists():
        s = path.stat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != os.geteuid() or s.st_mode & 0o022:
            raise ValueError('Shared data parent must be owned by root and not writable by other users')


def validate_inputs(config, recovery, source_bytes=None):
    mirror.validate_config(config)
    if config['stateRoot'] != str(STATE) or config['helper'] != str(LIB / 'source.mjs'):
        raise ValueError('Use the fixed own installation paths')
    if not re.fullmatch(r'/[A-Za-z0-9_./-]+', config['rcloneConfig']):
        raise ValueError('Rclone path cannot contain systemd specifiers or whitespace')
    helper = (SOURCE / 'drive-mirror-source.mjs').read_bytes() if source_bytes is None else source_bytes
    if config['helperSha256'] != mirror.sha(helper):
        raise ValueError('Configuration must pin the supplied reviewed helper')
    if not isinstance(recovery, dict) or set(recovery) != {'schemaVersion', 'restoredOutsideVps', 'effectsPaused', 'sourceBinding', 'archive'}:
        raise ValueError('An independent recovery receipt is required')
    if recovery['schemaVersion'] != 1 or recovery['restoredOutsideVps'] is not True or recovery['effectsPaused'] is not True or recovery['sourceBinding'] != config['sourceBinding']:
        raise ValueError('Recovery receipt belongs to another source or has not passed')
    mirror.validate_source({'binding': recovery['sourceBinding'], 'automationEnabled': True, 'latest': recovery['archive']}, config['sourceBinding'])
    if recovery['archive'] is None or recovery['archive']['created'] != config['sourceFloor']:
        raise ValueError('Initial floor must be the independently recovered archive date')
    return {'dryRun': True, 'container': config['container'], 'imageId': config['imageId'],
            'configHash': mirror.initial_journal(config)['configurationHash'],
            'units': [SERVICE, TIMER], 'intervalSeconds': 60, 'activationRequested': False,
            'newPermissionCreated': False, 'uploadsRequested': False,
            'requirements': ['Linux, root and systemd', 'Exact healthy Coolify container and own volume',
                             'Existing private rclone OAuth access', 'Matching account and private folder',
                             'Verified R2 source and independent recovery', 'Separate reviewed activation']}


def unit_texts(config, restore):
    restore = str(restore)
    if not re.fullmatch(r'/[A-Za-z0-9_./-]+', restore) or '..' in Path(restore).parts:
        raise ValueError('Invalid own restore volume path')
    service = f'''[Unit]
Description=ConectadOS verified archive mirror to private Drive
After=docker.service network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=root
Environment=PYTHONDONTWRITEBYTECODE=1
ExecStart=/usr/bin/python3 {LIB}/drive-mirror.py --config {ETC}/config.json
UMask=0077
TimeoutStartSec=240
MemoryMax=384M
CPUQuota=25%
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
LockPersonality=yes
RestrictSUIDSGID=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=CAP_CHOWN CAP_DAC_OVERRIDE
ReadWritePaths={STATE} {Path(config['rcloneConfig']).parent} {restore}
Restart=no
'''
    timer = f'''[Unit]
Description=Check for a new verified ConectadOS archive
[Timer]
OnActiveSec=5s
OnUnitInactiveSec=60s
AccuracySec=1s
Unit={SERVICE}
[Install]
WantedBy=timers.target
'''
    return {SERVICE: service.encode(), TIMER: timer.encode()}


def installation_files(config, restore):
    return {LIB / 'drive-mirror.py': ((SOURCE / 'drive-mirror.py').read_bytes(), 0o600),
            LIB / 'source.mjs': ((SOURCE / 'drive-mirror-source.mjs').read_bytes(), 0o600),
            ETC / 'config.json': (json.dumps(config, sort_keys=True, indent=2).encode(), 0o600),
            **{UNITS / k: (v, 0o644) for k, v in unit_texts(config, restore).items()}}


def inspect_files(files, config, journal_path=None):
    journal_path = STATE / 'worker.json' if journal_path is None else Path(journal_path)
    # Check every existing destination before any writes. Never reset a journal.
    for path, (data, mode) in files.items():
        path_without_links(path)
        if path.exists():
            s = path.stat()
            if not stat.S_ISREG(s.st_mode) or s.st_uid != os.geteuid() or stat.S_IMODE(s.st_mode) != mode:
                raise ValueError('Existing installed file has different ownership or permissions')
            same = json.loads(path.read_bytes()) == config if path == ETC / 'config.json' else path.read_bytes() == data
            if not same:
                raise ValueError('Existing installation differs; a separate reviewed update is required')
    path_without_links(journal_path)
    if journal_path.exists():
        journal = json.loads(mirror.private_file(journal_path, 2 * 1024 * 1024))
        if journal.get('schemaVersion') != 1 or journal.get('configurationHash') != mirror.initial_journal(config)['configurationHash'] or not isinstance(journal.get('items'), list) or len(journal['items']) > 512:
            raise ValueError('Existing journal needs review and will not be reset')
        return journal
    # A missing journal in an existing installation is loss of identity, not a fresh install.
    if any(p.exists() for p in files):
        raise ValueError('Existing installation is missing its original journal')
    return None


def checked(args, stdin=None, timeout=45):
    result = subprocess.run(args, input=stdin, capture_output=True, timeout=timeout)
    if result.returncode:
        raise ValueError('Scoped host check failed; no provider details printed')
    return result.stdout


def host_source(config, helper):
    info = json.loads(checked(['docker', 'inspect', config['container']]))[0]
    if not info['State']['Running'] or info['State'].get('Health', {}).get('Status') != 'healthy' or info['Image'] != config['imageId'] or info['Config']['User'] != 'node':
        raise ValueError('Exact healthy own container is required')
    mounts = [m for m in info['Mounts'] if m['Destination'] == '/state/.backups']
    volume = json.loads(checked(['docker', 'volume', 'inspect', config['backupsVolume']]))[0]
    if len(mounts) != 1 or mounts[0].get('Name') != config['backupsVolume'] or mounts[0]['Type'] != 'volume' or mounts[0]['Source'] != volume['Mountpoint']:
        raise ValueError('Backup mount does not match the own named volume')
    path_without_links(volume['Mountpoint'])
    source = json.loads(checked(['docker', 'exec', '-i', config['container'], 'node', '--input-type=module'], helper + b"\nconsole.log(JSON.stringify(await describeDriveSource('/state')));\n"))
    mirror.validate_source(source, config['sourceBinding'])
    if not source['automationEnabled'] or not source['latest']:
        raise ValueError('The original source needs active R2 automation and a verified archive')
    return source, Path(volume['Mountpoint']) / 'drive-mirror'


def require_linux_host():
    if sys.platform != 'linux' or os.geteuid() != 0 or not Path('/run/systemd/system').is_dir():
        raise ValueError('Applying requires Linux, root and systemd')


def install(config, recovery, activate=False, reviewed=None):
    validate_inputs(config, recovery)
    require_linux_host()
    # Serialize installers independently of the worker's copy lock. The installer
    # never rewrites a worker journal belonging to an existing installation.
    lock = Path('/run/lock/conectados-drive-install.lock')
    path_without_links(lock)
    try:
        descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        os.fchmod(descriptor, 0o600)
    except FileExistsError:
        descriptor = os.open(lock, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        s = os.fstat(descriptor)
        if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or stat.S_IMODE(s.st_mode) != 0o600:
            raise ValueError('Own private installer lock is required')
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return apply_installation(config, recovery, activate, reviewed)
    finally:
        os.close(descriptor)


def apply_installation(config, recovery, activate=False, reviewed=None):
    plan = validate_inputs(config, recovery)
    if activate and (not config['enabled'] or reviewed != plan['configHash']):
        raise ValueError('Activation requires this exact enabled configuration hash')
    data_root = STATE.parent.parent
    shared_directory(data_root)
    for directory in [LIB, ETC, STATE.parent, STATE]:
        private_directory(directory)
    helper = (SOURCE / 'drive-mirror-source.mjs').read_bytes()
    source, restore = host_source(config, helper)
    files = installation_files(config, restore)
    original = inspect_files(files, config)
    private_directory(restore, uid=1000)
    # An active installation is never disabled or reset merely by repeating installation.
    active = subprocess.run(['systemctl', 'is-active', TIMER], capture_output=True).returncode == 0
    if active and original is None:
        raise ValueError('Active timer without a complete original installation requires review')
    if activate and original and (not original.get('enabled') or original.get('error') is not None or original.get('state') != 'waiting' or any(item.get('state') != 'verified' for item in original['items'])):
        raise ValueError('Activation cannot conceal a paused, failed, uncertain or running worker')
    if activate and not active:
        if original and (not original.get('enabled') or original.get('error') is not None or original.get('state') != 'waiting' or original.get('items')):
            raise ValueError('Activation cannot clear failed, paused or existing history')
        if source['latest'] != recovery['archive']:
            raise ValueError('A newer source needs independent recovery and reconciliation first')
    # OAuth remains in its existing private file. This checks, rather than grants, access.
    with tempfile.TemporaryDirectory(prefix='conectados-drive-install-') as stage:
        stage_root = Path(stage).resolve()
        stage_root.chmod(0o700)
        staged = stage_root / 'source.mjs'
        staged.write_bytes(helper)
        staged.chmod(0o600)
        adapter = mirror.HostAdapter({**config, 'helper': str(staged)})
        adapter.authorize_folder()
    if not data_root.exists():
        data_root.mkdir(mode=0o755)
        data_root.chmod(0o755)
    for directory in [LIB, ETC, STATE.parent, STATE]:
        if not directory.exists():
            directory.mkdir(mode=0o700)
            directory.chmod(0o700)
    if not restore.exists():
        restore.mkdir(mode=0o700)
        restore.chmod(0o700)
        os.chown(restore, 1000, 1000)
    for path, (data, mode) in files.items():
        if not path.exists():
            descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, mode)
            with os.fdopen(descriptor, 'wb') as f:
                os.fchmod(f.fileno(), mode)
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
    if original is None:
        journal_path = STATE / 'worker.json'
        descriptor = os.open(journal_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'w') as f:
            os.fchmod(f.fileno(), 0o600)
            json.dump(mirror.initial_journal(config), f)
            f.flush()
            os.fsync(f.fileno())
    checked(['systemd-analyze', 'verify', str(UNITS / SERVICE), str(UNITS / TIMER)])
    checked(['systemctl', 'daemon-reload'])
    if activate and not active:
        # Recheck immediately before the first execution. Never copy an unreviewed newer archive.
        current, _ = host_source(config, helper)
        if current != source:
            raise ValueError('Source changed before activation; timer remains stopped')
        checked(['systemctl', 'start', SERVICE], timeout=250)
        journal = json.loads(mirror.private_file(STATE / 'worker.json', 2 * 1024 * 1024))
        if not journal['enabled'] or journal['error'] is not None or journal['state'] != 'waiting' or journal['items']:
            raise ValueError('Checked initial cycle did not preserve the reviewed floor')
        checked(['systemctl', 'enable', '--now', TIMER])
        active = subprocess.run(['systemctl', 'is-active', TIMER], capture_output=True).returncode == 0
        if not active:
            raise ValueError('Timer activation has no authoritative active confirmation')
    return {'installed': True, 'existingJournalPreserved': original is not None,
            'timerActive': active, 'newPermissionCreated': False, 'initialCycleCopied': False,
            'activationRequested': activate, 'configHash': plan['configHash']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, help='Private reviewed worker JSON, not an OAuth token')
    parser.add_argument('--recovery-proof', required=True, help='Private independent recovery receipt')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--activate', action='store_true')
    parser.add_argument('--reviewed-config-sha256')
    args = parser.parse_args()
    if args.activate and not args.apply:
        raise ValueError('Use --apply for explicit activation')
    config = json.loads(mirror.private_file(args.config, 32768))
    recovery = json.loads(mirror.private_file(args.recovery_proof, 32768))
    result = install(config, recovery, args.activate, args.reviewed_config_sha256) if args.apply else validate_inputs(config, recovery)
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Drive installation not completed. Existing configuration and receipts were preserved. Review requirements, source, folder access and private diagnostics; no credentials printed.', file=sys.stderr)
        sys.exit(1)
