import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('mirror', Path(__file__).resolve().parents[1] / 'scripts/drive-mirror.py')
mirror = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mirror)
ID = '12345678-1234-1234-1234-123456789abc'
DATA = b'FICTIONAL ENCRYPTED ARCHIVE'


def config():
    return {'schemaVersion': 1, 'enabled': True, 'container': 'conectados-' + 'a' * 24,
            'imageId': 'sha256:' + 'b' * 64, 'backupsVolume': 'a' * 24 + '_conectados-backups',
            'sourceBinding': 'c' * 64, 'sourceFloor': 100, 'rcloneConfig': '/etc/fixture/rclone.conf',
            'remote': 'fixture-drive', 'folderId': 'fixture-folder-123', 'parentId': 'fixture-parent-123',
            'account': 'owner@example.com', 'allowedUsers': ['owner@example.com'],
            'stateRoot': '/data/fixture-mirror', 'helper': '/opt/fixture/source.mjs', 'helperSha256': 'd' * 64}


class Adapter:
    def __init__(self, fail=None):
        self.calls = []
        self.fail = fail
        self.put = False
        self.current = {'binding': 'c' * 64, 'automationEnabled': True,
                        'latest': {'id': ID, 'created': 200, 'bytes': len(DATA), 'digest': mirror.sha(DATA)}}
        self.remote = {'id': 'fixture-drive-file', 'size': str(len(DATA)), 'md5Checksum': mirror.hashlib.md5(DATA).hexdigest(), 'parents': ['fixture-folder-123']}

    def called(self, name):
        self.calls.append(name)
        if self.fail == name:
            raise RuntimeError('FIXTURE_SECRET_MUST_NOT_BE_LOGGED')

    def source(self):
        self.called('source')
        return copy.deepcopy(self.current)

    def authorize_folder(self):
        self.called('authorize')

    def read_source(self, source):
        self.called('read')
        return DATA if self.fail != 'corrupt-source' else DATA + b'x'

    def existing(self, identity):
        self.called('existing')
        return self.remote if self.put else None

    def upload(self, identity, data):
        self.put = True
        self.called('upload')

    def download(self, identity):
        self.called('download')
        return DATA if self.fail != 'corrupt-download' else DATA + b'x'

    def restore(self, source, data):
        self.called('restore')
        return {'integrity': 'ok', 'restored': self.fail != 'false-receipt', 'downloadMatched': True, 'effectsPaused': True, 'ownerPresent': True}


class MirrorTests(unittest.TestCase):
    def test_source_failure_preserves_safe_code_and_timestamp_without_provider_text(self):
        class Locked(Adapter):
            def source(self):
                raise mirror.WorkerCommandError('sqlite-busy')
        result, _ = self.run_tick(Locked())
        self.assertEqual(result['failurePhase'], 'source-check')
        self.assertEqual(result['failureCode'], 'sqlite-busy')
        self.assertIsInstance(result['failedAt'], int)
        self.assertFalse(result['enabled'])
        self.assertEqual(result['items'], [])

    def run_tick(self, adapter=None, journal=None):
        cfg = config()
        saved = []
        journal = journal or mirror.initial_journal(cfg)
        result = mirror.tick(cfg, journal, adapter or Adapter(), lambda data: saved.append(copy.deepcopy(data)), now=500)
        return result, saved

    def test_verified_download_recovery_and_no_repeat(self):
        adapter = Adapter()
        result, saved = self.run_tick(adapter)
        self.assertEqual(result['items'][0]['state'], 'verified')
        self.assertIn('restore', adapter.calls)
        self.assertTrue(any(j['items'] and j['items'][0]['state'] == 'uploading' for j in saved))
        self.run_tick(adapter, result)
        self.assertEqual(adapter.calls.count('upload'), 1)

    def test_upload_download_or_receipt_failure_pauses_without_secret_or_retry(self):
        for failure in ['upload', 'download', 'corrupt-download', 'false-receipt']:
            adapter = Adapter(failure)
            result, _ = self.run_tick(adapter)
            self.assertFalse(result['enabled'])
            self.assertIn(result['failurePhase'], ['upload', 'download', 'isolated-recovery'])
            self.assertEqual(result['items'][0]['state'], 'uncertain')
            self.assertNotIn('FIXTURE_SECRET', json.dumps(result))
            count = len(adapter.calls)
            self.run_tick(adapter, result)
            self.assertEqual(len(adapter.calls), count)

    def test_crash_claim_is_uncertain_and_does_not_contact_any_provider(self):
        cfg = config()
        journal = mirror.initial_journal(cfg)
        journal['items'] = [{'id': ID, 'state': 'uploading'}]
        adapter = Adapter()
        result, _ = self.run_tick(adapter, journal)
        self.assertEqual(result['state'], 'uncertain')
        self.assertFalse(result['enabled'])
        self.assertEqual(adapter.calls, [])

    def test_preflight_failures_do_not_upload_or_claim_recovery(self):
        for failure in ['authorize', 'read', 'corrupt-source']:
            adapter = Adapter(failure)
            result, _ = self.run_tick(adapter)
            self.assertFalse(result['enabled'])
            self.assertNotIn('upload', adapter.calls)

    def test_source_floor_and_paused_or_changed_installation(self):
        for change in ['old', 'paused', 'changed']:
            adapter = Adapter()
            if change == 'old':
                adapter.current['latest']['created'] = 100
            elif change == 'paused':
                adapter.current['automationEnabled'] = False
            else:
                adapter.current['binding'] = 'f' * 64
            result, _ = self.run_tick(adapter)
            self.assertNotIn('upload', adapter.calls)
            self.assertEqual(result['state'], 'waiting' if change == 'old' else ('paused' if change == 'paused' else 'failed'))

    def test_existing_name_is_never_overwritten(self):
        adapter = Adapter()
        adapter.put = True
        result, _ = self.run_tick(adapter)
        self.assertFalse(result['enabled'])
        self.assertNotIn('upload', adapter.calls)

    def test_source_changes_before_or_after_upload_never_receive_verified_receipt(self):
        for after in ['read', 'download']:
            adapter = Adapter()
            original = getattr(adapter, 'read_source' if after == 'read' else 'download')
            def change(*args, original=original):
                result = original(*args)
                adapter.current['binding'] = 'f' * 64
                return result
            setattr(adapter, 'read_source' if after == 'read' else 'download', change)
            result, _ = self.run_tick(adapter)
            self.assertFalse(result['enabled'])
            self.assertEqual(result['items'][0]['state'], 'failed' if after == 'read' else 'uncertain')
            self.assertNotIn('restore', adapter.calls)

    def test_folder_permission_account_and_parent_checks_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            file = root / 'rclone.conf'
            file.write_text('[fixture-drive]\ntoken={"access_token":"FICTIONAL_TOKEN_NOT_REAL"}\n')
            file.chmod(0o600)
            for invalid in ['none', 'account', 'public', 'domain', 'other-user', 'moved', 'trashed', 'readonly']:
                adapter = mirror.HostAdapter.__new__(mirror.HostAdapter)
                adapter.config = {**config(), 'rcloneConfig': str(file)}
                adapter.rclone = lambda *args: b'{}'
                def api(route):
                    if route.startswith('about?'):
                        return {'user': {'emailAddress': 'other@example.com' if invalid == 'account' else 'owner@example.com'}}
                    identity = route.split('/')[1].split('?')[0]
                    permission = {'type': 'user', 'emailAddress': 'owner@example.com'}
                    if invalid == 'public':
                        permission = {'type': 'anyone'}
                    elif invalid == 'domain':
                        permission = {'type': 'domain', 'domain': 'example.com'}
                    elif invalid == 'other-user':
                        permission['emailAddress'] = 'unknown@example.com'
                    return {'id': identity, 'mimeType': 'application/vnd.google-apps.folder',
                            'trashed': invalid == 'trashed', 'capabilities': {'canAddChildren': invalid != 'readonly'},
                            'permissions': [permission], 'parents': ['different-parent' if invalid == 'moved' else 'fixture-parent-123']}
                adapter.api = api
                if invalid == 'none':
                    adapter.authorize_folder()
                else:
                    with self.assertRaises(ValueError):
                        adapter.authorize_folder()

    def test_configuration_binding_cannot_be_transplanted(self):
        journal = mirror.initial_journal(config())
        journal['configurationHash'] = 'f' * 64
        with self.assertRaises(ValueError):
            self.run_tick(Adapter(), journal)

    def test_changed_previously_exported_archive_is_not_silently_ignored(self):
        adapter = Adapter()
        journal, _ = self.run_tick(adapter)
        adapter.current['latest']['digest'] = 'f' * 64
        result, _ = self.run_tick(adapter, journal)
        self.assertFalse(result['enabled'])
        self.assertEqual(adapter.calls.count('upload'), 1)

    def test_config_rejects_other_volumes_images_accounts_paths_and_unknown_keys(self):
        for field, value in [('backupsVolume', 'other-database'), ('imageId', 'latest'), ('account', 'someone@example.com'), ('helper', '../private/key'), ('sourceFloor', True), ('remote', 'fixture:other'), ('extra', 'untrusted')]:
            cfg = config()
            cfg[field] = value
            with self.assertRaises(ValueError):
                mirror.validate_config(cfg)
        self.assertEqual(mirror.validate_config(config()), config())

    def test_atomic_journal_permissions_and_link_rejection(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root).resolve() / 'worker.json'
            mirror.atomic(target, {'state': 'fixture'})
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(mirror.private_file(target, 100)), {'state': 'fixture'})
            link = Path(root).resolve() / 'link'
            link.symlink_to(target)
            with self.assertRaises(ValueError):
                mirror.atomic(link, {'state': 'changed'})
            self.assertEqual(json.loads(target.read_bytes()), {'state': 'fixture'})


if __name__ == '__main__':
    unittest.main()
