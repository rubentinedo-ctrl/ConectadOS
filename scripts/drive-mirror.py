#!/usr/bin/env python3
"""Optional host worker. Copies only verified ConectadOS archives; never syncs/deletes."""
import argparse
import configparser
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import time
import urllib.parse
import urllib.request

UUID = re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
HASH = re.compile(r'^[a-f0-9]{64}$')
LIMIT = 64 * 1024 * 1024 + 48


def sha(data):
    return hashlib.sha256(data).hexdigest()


def private_file(file, limit):
    file = Path(file)
    for current in [file, *file.parents]:
        if current.is_symlink():
            raise ValueError('Private path cannot follow links')
    info = file.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077 or info.st_size > limit:
        raise ValueError('Private file required')
    return file.read_bytes()


def atomic(file, data):
    file = Path(file)
    if file.exists():
        private_file(file, 2 * 1024 * 1024)
    temporary = file.with_name(file.name + '.pending')
    descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(json.dumps(data, separators=(',', ':')).encode())
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, file)
        directory = os.open(file.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if temporary.exists():
            temporary.unlink()


def validate_config(config):
    keys = {'schemaVersion', 'enabled', 'container', 'imageId', 'backupsVolume', 'sourceBinding',
            'sourceFloor', 'rcloneConfig', 'remote', 'folderId', 'parentId', 'account', 'allowedUsers',
            'stateRoot', 'helper', 'helperSha256'}
    if not isinstance(config, dict) or set(config) != keys or config['schemaVersion'] != 1 or type(config['enabled']) is not bool:
        raise ValueError('Invalid worker configuration')
    if not re.fullmatch(r'conectados-[a-z0-9]{24}', config['container']) or config['backupsVolume'] != config['container'][11:] + '_conectados-backups':
        raise ValueError('Worker must select exactly its own resource')
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', config['imageId']) or not HASH.fullmatch(config['sourceBinding']) or not HASH.fullmatch(config['helperSha256']):
        raise ValueError('Exact tested image and source required')
    if type(config['sourceFloor']) is not int or config['sourceFloor'] < 1 or config['sourceFloor'] > int(time.time() * 1000):
        raise ValueError('Invalid source floor')
    for key in ('folderId', 'parentId'):
        if not isinstance(config[key], str) or not re.fullmatch(r'[A-Za-z0-9_-]{10,160}', config[key]):
            raise ValueError('Exact folder identity required')
    if config['folderId'] == config['parentId'] or not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,40}', config['remote']):
        raise ValueError('Invalid own destination')
    if not isinstance(config['allowedUsers'], list) or not 1 <= len(config['allowedUsers']) <= 5 or config['account'] not in config['allowedUsers']:
        raise ValueError('Explicit account and users required')
    for user in config['allowedUsers']:
        if not isinstance(user, str) or not re.fullmatch(r'[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}', user):
            raise ValueError('Invalid allowed user')
    for key in ('rcloneConfig', 'stateRoot', 'helper'):
        value = config[key]
        if not isinstance(value, str) or not Path(value).is_absolute() or '..' in Path(value).parts or '\n' in value or '\x00' in value:
            raise ValueError('Absolute own path required')
    return config


def validate_source(source, binding):
    if not isinstance(source, dict) or set(source) != {'binding', 'automationEnabled', 'latest'} or source['binding'] != binding or type(source['automationEnabled']) is not bool:
        raise ValueError('Original source identity changed')
    latest = source['latest']
    if latest is not None and (not isinstance(latest, dict) or set(latest) != {'id', 'created', 'bytes', 'digest'} or not UUID.fullmatch(latest.get('id', '')) or not HASH.fullmatch(latest.get('digest', '')) or type(latest.get('created')) is not int or latest['created'] < 1 or type(latest.get('bytes')) is not int or not 1 <= latest['bytes'] <= LIMIT):
        raise ValueError('Invalid verified source')
    return source


def initial_journal(config):
    return {'schemaVersion': 1, 'configurationHash': sha(json.dumps(config, sort_keys=True).encode()),
            'enabled': config['enabled'], 'heartbeat': None, 'state': 'waiting', 'error': None, 'items': []}


class WorkerCommandError(ValueError):
    def __init__(self, code):
        super().__init__('Bounded worker command failed')
        self.code = code


def tick(config, journal, adapter, save, now=None):
    """Crash journal precedes network writes. Failures pause rather than retry silently."""
    now = int(time.time() * 1000) if now is None else now
    if journal.get('schemaVersion') != 1 or journal.get('configurationHash') != initial_journal(config)['configurationHash'] or not isinstance(journal.get('items'), list) or len(journal['items']) > 512:
        raise ValueError('Explicit journal review required')
    if any(item.get('state') == 'uploading' for item in journal['items']):
        for item in journal['items']:
            if item.get('state') == 'uploading':
                item.update(state='uncertain', finished=now, error='Previous upload ended without verified recovery.')
        journal.update(enabled=False, state='uncertain', error='Review previous attempt before any new upload.', heartbeat=now)
        save(journal)
        return journal
    if not config['enabled'] or not journal['enabled']:
        journal.update(state='paused', heartbeat=now)
        save(journal)
        return journal
    attempted = False
    item = None
    phase = 'source-check'
    try:
        source = validate_source(adapter.source(), config['sourceBinding'])
        if not source['automationEnabled']:
            journal.update(enabled=False, state='paused', heartbeat=now, error='Source automation is paused or restored. Review before enabling.')
            save(journal)
            return journal
        latest = source['latest']
        previous = next((entry for entry in journal['items'] if latest and entry['id'] == latest['id']), None)
        if previous and (previous.get('digest') != latest['digest'] or previous.get('bytes') != latest['bytes']):
            raise ValueError('Previously exported identity changed')
        if not latest or latest['created'] <= config['sourceFloor'] or previous:
            journal.update(state='waiting', heartbeat=now)
            save(journal)
            return journal
        if len(journal['items']) >= 512:
            raise ValueError('Journal capacity reached; no retention deletes authorized')
        phase = 'folder-access'
        adapter.authorize_folder()
        phase = 'source-read'
        data = adapter.read_source(source)
        if len(data) != latest['bytes'] or sha(data) != latest['digest']:
            raise ValueError('Verified archive differs')
        if adapter.existing(latest['id']):
            raise ValueError('Own immutable name already exists; reconcile it first')
        item = {**latest, 'started': now, 'finished': None, 'state': 'preparing', 'fileId': None, 'restoration': None, 'error': None}
        journal['items'].append(item)
        journal.update(state='preparing', heartbeat=now)
        save(journal)
        if validate_source(adapter.source(), config['sourceBinding']) != source:
            raise ValueError('Source changed before upload')
        item['state'] = 'uploading'
        journal['state'] = 'uploading'
        save(journal)
        attempted = True
        phase = 'upload'
        adapter.upload(latest['id'], data)
        adapter.authorize_folder()
        phase = 'remote-verify'
        remote = adapter.existing(latest['id'])
        if not remote or remote.get('size') != str(len(data)) or remote.get('md5Checksum') != hashlib.md5(data).hexdigest() or remote.get('parents') != [config['folderId']]:
            raise ValueError('Remote identity or content differs')
        phase = 'download'
        downloaded = adapter.download(latest['id'])
        if len(downloaded) != len(data) or sha(downloaded) != latest['digest']:
            raise ValueError('Drive download differs')
        if validate_source(adapter.source(), config['sourceBinding']) != source or adapter.existing(latest['id']) != remote:
            raise ValueError('Source or remote changed before restoration')
        phase = 'isolated-recovery'
        proof = adapter.restore(source, downloaded)
        if proof.get('integrity') != 'ok' or proof.get('restored') is not True or proof.get('downloadMatched') is not True or proof.get('effectsPaused') is not True or proof.get('ownerPresent') is not True:
            raise ValueError('No valid recovery receipt')
        item.update(state='verified', finished=int(time.time() * 1000), fileId=remote['id'], restoration=proof)
        journal.update(state='waiting', error=None, heartbeat=int(time.time() * 1000))
        save(journal)
    except Exception as exc:
        if item:
            item.update(state='uncertain' if attempted else 'failed', finished=int(time.time() * 1000), error='Copy, download or isolated recovery not completed.', failurePhase=phase)
        journal.update(enabled=False, state='uncertain' if attempted else 'failed', heartbeat=int(time.time() * 1000), error='Work paused. Review source, access and private receipt; no automatic retry.', failurePhase=phase,
                       failureCode=exc.code if isinstance(exc, WorkerCommandError) else 'review-required', failedAt=int(time.time() * 1000))
        save(journal)
    return journal


class HostAdapter:
    def __init__(self, config, control_path=None):
        self.config = config
        self.control_path = control_path
        self.root = Path(config['stateRoot'])
        self.helper = private_file(config['helper'], 32768)
        if sha(self.helper) != config['helperSha256']:
            raise ValueError('Reviewed helper changed')
        self.backups = None
        self.token = None
        self.local = {}

    def command(self, args, stdin=None, timeout=120):
        if self.control_path and validate_config(json.loads(private_file(self.control_path, 32768))) != self.config:
            raise ValueError('Configuration changed during work')
        result = subprocess.run(args, input=stdin, capture_output=True, timeout=timeout)
        if result.returncode:
            # Only fixed codes enter the journal; stderr may contain provider secrets.
            locked = b'database is locked' in result.stderr or b'database is busy' in result.stderr
            raise WorkerCommandError('sqlite-busy' if locked else 'command-failed')
        return result.stdout

    def own_container(self):
        info = json.loads(self.command(['docker', 'inspect', self.config['container']], timeout=20))[0]
        if not info['State']['Running'] or info['Image'] != self.config['imageId'] or info['Config']['User'] != 'node':
            raise ValueError('Exact tested own container required')
        volumes = [v for v in info['Mounts'] if v['Destination'] == '/state/.backups' and v.get('Name') == self.config['backupsVolume'] and v['Type'] == 'volume']
        if len(volumes) != 1:
            raise ValueError('Own backup volume required')
        self.backups = Path(volumes[0]['Source'])
        if not self.backups.is_dir() or self.backups.is_symlink():
            raise ValueError('Own volume path required')

    def node(self, action, expected=None):
        self.own_container()
        request = json.dumps({'action': action, 'expected': expected})
        source = self.helper + ("\nconst request=" + request + ";const root='/state';let result;if(request.action==='describe')result=await describeDriveSource(root);else if(request.action==='read'){const bytes=await readDriveSource(root,request.expected);result={data:bytes.toString('base64')}}else if(request.action==='verify')result=await verifyDriveDownload(root,request.expected,{...(await import('./lib/server/external-backup.mjs')),...(await import('./lib/server/store.mjs'))});else throw Error('Unsupported own operation');console.log(JSON.stringify(result));\n").encode()
        return json.loads(self.command(['docker', 'exec', '-i', self.config['container'], 'node', '--input-type=module'], source, timeout=90))

    def source(self):
        return self.node('describe')

    def rclone(self, *args):
        return self.command(['rclone', '--config', self.config['rcloneConfig'], '--drive-root-folder-id', self.config['folderId'], '--retries', '1', '--low-level-retries', '1', '--contimeout', '15s', '--timeout', '45s', '--max-duration', '60s', '--bwlimit', '8M', *args], timeout=75)

    def api(self, route):
        if not route.startswith(('about?', 'files/','files?')):
            raise ValueError('Fixed Drive API required')
        request = urllib.request.Request('https://www.googleapis.com/drive/v3/' + route, headers={'Authorization': 'Bearer ' + self.token})
        # Google API must not redirect a credential-bearing request.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        with urllib.request.build_opener(NoRedirect).open(request, timeout=20) as response:
            data = response.read(65537)
            if len(data) > 65536:
                raise ValueError('Drive metadata exceeds limit')
            return json.loads(data)

    def authorize_folder(self):
        private_file(self.config['rcloneConfig'], 65536)
        self.rclone('about', self.config['remote'] + ':', '--json')
        parser = configparser.ConfigParser(interpolation=None)
        parser.read_string(private_file(self.config['rcloneConfig'], 65536).decode())
        self.token = json.loads(parser[self.config['remote']]['token'])['access_token']
        if self.api('about?fields=user(emailAddress)')['user']['emailAddress'] != self.config['account']:
            raise ValueError('Authorized Drive account changed')
        for identity, parent in [(self.config['parentId'], None), (self.config['folderId'], self.config['parentId'])]:
            meta = self.api('files/' + identity + '?fields=id,mimeType,trashed,parents,capabilities(canAddChildren),permissions(type,role,emailAddress,domain)')
            if meta.get('id') != identity or meta.get('mimeType') != 'application/vnd.google-apps.folder' or meta.get('trashed') or not meta.get('capabilities', {}).get('canAddChildren') or not meta.get('permissions'):
                raise ValueError('Own private writable folder required')
            if parent and meta.get('parents') != [parent]:
                raise ValueError('Own folder moved')
            if any(p.get('type') != 'user' or p.get('emailAddress', '').lower() not in self.config['allowedUsers'] for p in meta['permissions']):
                raise ValueError('Folder includes unapproved recipients')

    def existing(self, identity):
        if not UUID.fullmatch(identity):
            raise ValueError('Own archive identity required')
        query = "'" + self.config['folderId'] + "' in parents and name = '" + identity + ".cdbak' and trashed = false"
        data = self.api('files?' + urllib.parse.urlencode({'q': query, 'fields': 'nextPageToken,files(id,size,md5Checksum,parents)', 'pageSize': '100'}))
        if data.get('nextPageToken') or len(data.get('files', [])) > 1:
            raise ValueError('Ambiguous own archive name')
        return data['files'][0] if data.get('files') else None

    def read_source(self, source):
        import base64
        return base64.b64decode(self.node('read', source)['data'], validate=True)

    def upload(self, identity, data):
        file = self.root / (identity + '.cdbak')
        with file.open('xb') as handle:
            os.chmod(file, 0o600)
            handle.write(data)
        self.local[identity] = file
        self.rclone('copyto', str(file), self.config['remote'] + ':' + identity + '.cdbak', '--immutable')

    def download(self, identity):
        file = self.root / (identity + '-downloaded.cdbak')
        if file.exists():
            raise ValueError('New private download required')
        self.rclone('copyto', self.config['remote'] + ':' + identity + '.cdbak', str(file), '--immutable')
        os.chmod(file, 0o600)
        return private_file(file, LIMIT)

    def restore(self, source, data):
        self.own_container()
        target = self.backups / 'drive-mirror'
        if not target.exists():
            target.mkdir(mode=0o700)
            os.chown(target, 1000, 1000)
        if target.is_symlink() or target.stat().st_uid != 1000 or target.stat().st_mode & 0o077:
            raise ValueError('Own private restore directory required')
        file = target / (source['latest']['id'] + '.cdbak')
        with file.open('xb') as handle:
            os.chmod(file, 0o600)
            handle.write(data)
        os.chown(file, 1000, 1000)
        return self.node('verify', source)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise ValueError('Reviewed host worker requires root for its exact Docker volume')
    config = validate_config(json.loads(private_file(args.config, 32768)))
    root = Path(config['stateRoot'])
    if root.is_symlink() or not root.is_dir() or root.stat().st_uid != 0 or root.stat().st_mode & 0o077:
        raise ValueError('Private own state directory required')
    descriptor = os.open(root / 'worker.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({'state': 'busy', 'uploaded': False}))
            return
        journal_file = root / 'worker.json'
        if not journal_file.exists():
            raise ValueError('Explicit reviewed initialization required')
        journal = json.loads(private_file(journal_file, 2 * 1024 * 1024))
        result = tick(config, journal, HostAdapter(config, args.config), lambda data: atomic(journal_file, data))
        print(json.dumps({'state': result['state'], 'enabled': result['enabled'], 'verified': sum(i['state'] == 'verified' for i in result['items'])}))
    finally:
        os.close(descriptor)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Drive mirror stopped. Review private configuration and journal; no provider details printed.')
        raise SystemExit(1)
