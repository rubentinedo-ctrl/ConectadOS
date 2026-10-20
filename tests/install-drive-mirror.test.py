import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('installer', ROOT / 'scripts/install-drive-mirror.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
ID = '12345678-1234-1234-1234-123456789abc'


def fixture():
    config = {'schemaVersion': 1, 'enabled': True, 'container': 'conectados-' + 'a' * 24,
              'imageId': 'sha256:' + 'b' * 64, 'backupsVolume': 'a' * 24 + '_conectados-backups',
              'sourceBinding': 'c' * 64, 'sourceFloor': 100, 'rcloneConfig': '/etc/fixture/rclone.conf',
              'remote': 'fixture-drive', 'folderId': 'fixture-folder-123', 'parentId': 'fixture-parent-123',
              'account': 'owner@example.com', 'allowedUsers': ['owner@example.com'],
              'stateRoot': str(installer.STATE), 'helper': str(installer.LIB / 'source.mjs'),
              'helperSha256': installer.mirror.sha((ROOT / 'scripts/drive-mirror-source.mjs').read_bytes())}
    proof = {'schemaVersion': 1, 'restoredOutsideVps': True, 'effectsPaused': True,
             'sourceBinding': config['sourceBinding'],
             'archive': {'id': ID, 'created': 100, 'bytes': 20, 'digest': 'd' * 64}}
    return config, proof


class InstallTests(unittest.TestCase):
    def test_plan_has_no_io_effects_commands_or_account_disclosure(self):
        c, p = fixture()
        with patch.object(installer.subprocess, 'run', side_effect=AssertionError('No commands in plan')), patch.object(installer.os, 'open', side_effect=AssertionError('No writes in plan')):
            plan = installer.validate_inputs(c, p)
        self.assertTrue(plan['dryRun'])
        self.assertFalse(plan['uploadsRequested'])
        text = json.dumps(plan)
        for value in [c['account'], c['folderId'], c['parentId'], c['sourceBinding'], c['rcloneConfig']]:
            self.assertNotIn(value, text)

    def test_recovery_source_floor_and_helper_are_bound(self):
        config, proof = fixture()
        changes = [{'restoredOutsideVps': False}, {'effectsPaused': False}, {'sourceBinding': 'e' * 64}, {'schemaVersion': 2}, {'injected': 'TOKEN_CANARY'}]
        for change in changes:
            with self.assertRaises(ValueError):
                installer.validate_inputs(config, {**proof, **change})
        for field, value in [('sourceFloor', 101), ('helperSha256', 'e' * 64), ('stateRoot', '/tmp/elsewhere'), ('helper', '/tmp/source.mjs')]:
            with self.assertRaises(ValueError):
                installer.validate_inputs({**config, field: value}, proof)

    def test_rejects_systemd_path_injection_and_unverified_archive(self):
        c, p = fixture()
        for path in ['/etc/a b/conf', '/etc/%n/conf', '/etc/conf\nExecStart=/bin/false', '/etc/../conf']:
            with self.assertRaises(ValueError):
                installer.validate_inputs({**c, 'rcloneConfig': path}, p)
        for archive in [None, {**p['archive'], 'digest': 'bad'}, {**p['archive'], 'bytes': 0}]:
            with self.assertRaises(ValueError):
                installer.validate_inputs(c, {**p, 'archive': archive})

    def test_symlink_or_nonprivate_existing_directory_not_changed(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root).resolve() / 'directory'
            directory.mkdir(mode=0o755)
            with self.assertRaises(ValueError):
                installer.private_directory(directory)
            self.assertEqual(directory.stat().st_mode & 0o777, 0o755)
            link = Path(root).resolve() / 'link'
            link.symlink_to(directory)
            with self.assertRaises(ValueError):
                installer.private_directory(link / 'new')

    def test_existing_file_difference_and_lost_journal_never_reset(self):
        c, _ = fixture()
        with tempfile.TemporaryDirectory() as root:
            file = Path(root).resolve() / 'code.py'
            file.write_bytes(b'existing')
            file.chmod(0o600)
            journal = Path(root).resolve() / 'worker.json'
            with self.assertRaises(ValueError):
                installer.inspect_files({file: (b'new', 0o600)}, c, journal)
            self.assertEqual(file.read_bytes(), b'existing')
            with self.assertRaises(ValueError):
                installer.inspect_files({file: (b'existing', 0o600)}, c, journal)
            self.assertFalse(journal.exists())

    def test_existing_failed_or_uncertain_journal_preserved_byte_for_byte(self):
        c, _ = fixture()
        with tempfile.TemporaryDirectory() as root:
            file = Path(root).resolve() / 'code.py'
            file.write_bytes(b'code')
            file.chmod(0o600)
            for state in ['failed', 'uncertain']:
                journal = Path(root).resolve() / 'worker.json'
                value = {**installer.mirror.initial_journal(c), 'enabled': False, 'state': state,
                         'error': 'REVIEW_CANARY', 'items': [{'id': ID, 'state': state}]}
                data = json.dumps(value, indent=2).encode()
                journal.write_bytes(data)
                journal.chmod(0o600)
                self.assertEqual(installer.inspect_files({file: (b'code', 0o600)}, c, journal), value)
                self.assertEqual(journal.read_bytes(), data)

    def test_apply_requires_supported_real_host_before_any_commands(self):
        c, p = fixture()
        with patch.object(installer.sys, 'platform', 'darwin'), patch.object(installer.subprocess, 'run', side_effect=AssertionError('No commands')):
            with self.assertRaises(ValueError):
                installer.install(c, p)

    def test_host_identity_and_own_named_mount_checked_before_source_execution(self):
        config, proof = fixture()
        info = {'State': {'Running': True, 'Health': {'Status': 'healthy'}},
                'Image': config['imageId'], 'Config': {'User': 'node'},
                'Mounts': [{'Destination': '/state/.backups', 'Name': config['backupsVolume'],
                            'Type': 'volume', 'Source': '/var/lib/docker/volumes/fixture/_data'}]}
        for change in ['image', 'health', 'user', 'foreign-volume', 'source-path']:
            changed = copy.deepcopy(info)
            if change == 'image': changed['Image'] = 'sha256:' + 'e' * 64
            if change == 'health': changed['State']['Health']['Status'] = 'unhealthy'
            if change == 'user': changed['Config']['User'] = 'root'
            if change == 'foreign-volume': changed['Mounts'][0]['Name'] = 'another-project'
            if change == 'source-path': changed['Mounts'][0]['Source'] = '/foreign'
            calls = []
            def command(args, stdin=None, timeout=45):
                calls.append(args)
                if args[:2] == ['docker', 'inspect']: return json.dumps([changed]).encode()
                if args[:3] == ['docker', 'volume', 'inspect']: return json.dumps([{'Mountpoint': info['Mounts'][0]['Source']}]).encode()
                raise AssertionError('No source execution for another identity')
            with patch.object(installer, 'checked', side_effect=command):
                with self.assertRaises(ValueError): installer.host_source(config, b'fixture-helper')
            self.assertFalse(any('exec' in args for args in calls))

    def fake_installation(self, action, with_data_root=True):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder).resolve()
            for name in ['opt', 'etc', 'units', 'volume'] + (['data'] if with_data_root else []):
                (base / name).mkdir(mode=0o700)
            with patch.multiple(installer, LIB=base/'opt/mirror', ETC=base/'etc/mirror', STATE=base/'data/mirror/worker', UNITS=base/'units'):
                c, p = fixture()
                restore = base / 'volume/drive-mirror'
                source = {'binding': c['sourceBinding'], 'automationEnabled': True, 'latest': copy.deepcopy(p['archive'])}
                commands = []
                active = [False]
                def command(args, stdin=None, timeout=45):
                    commands.append(args)
                    if args == ['systemctl', 'start', installer.SERVICE]:
                        path = installer.STATE / 'worker.json'
                        journal = json.loads(path.read_text())
                        journal['heartbeat'] = 1000
                        installer.mirror.atomic(path, journal)
                    if args == ['systemctl', 'enable', '--now', installer.TIMER]:
                        active[0] = True
                    return b''
                actual_private_directory = installer.private_directory
                def directory(path, uid=None):
                    # Fixture owns files as the test user; production always checks node UID 1000.
                    return actual_private_directory(path, uid=os.geteuid() if uid == 1000 else uid)
                with patch.object(installer, 'host_source', return_value=(source, restore)), patch.object(installer.mirror.HostAdapter, 'authorize_folder', return_value=None), patch.object(installer, 'checked', side_effect=command), patch.object(installer, 'private_directory', side_effect=directory), patch.object(installer.os, 'chown', return_value=None), patch.object(installer.subprocess, 'run', side_effect=lambda *a, **k: subprocess.CompletedProcess(a[0], 0 if active[0] else 3)):
                    action(c, p, source, commands, active)

    def test_clean_host_without_data_root_prepares_private_state_and_repeats_without_reset(self):
        def action(c, p, source, commands, active):
            root = installer.STATE.parent.parent
            self.assertFalse(root.exists())
            result = installer.apply_installation(c, p)
            self.assertTrue(result['installed'])
            self.assertEqual(root.stat().st_mode & 0o777, 0o755)
            self.assertEqual(installer.STATE.stat().st_mode & 0o777, 0o700)
            before = (installer.STATE / 'worker.json').read_bytes()
            self.assertTrue(installer.apply_installation(c, p)['existingJournalPreserved'])
            self.assertEqual((installer.STATE / 'worker.json').read_bytes(), before)
        self.fake_installation(action, with_data_root=False)

    def test_shared_data_root_with_unsafe_permissions_rejected_before_commands_or_changes(self):
        def action(c, p, source, commands, active):
            root = installer.STATE.parent.parent
            root.chmod(0o777)
            with self.assertRaises(ValueError):
                installer.apply_installation(c, p)
            self.assertEqual(root.stat().st_mode & 0o777, 0o777)
            self.assertFalse(installer.STATE.parent.exists())
            self.assertEqual(commands, [])
        self.fake_installation(action)

    def test_fresh_prepare_has_no_start_enable_upload_or_reset_on_repeat(self):
        def action(c, p, source, commands, active):
            result = installer.apply_installation(c, p)
            self.assertFalse(result['timerActive'])
            self.assertFalse(result['initialCycleCopied'])
            self.assertFalse(any('start' in a or 'enable' in a for a in commands))
            journal = installer.STATE / 'worker.json'
            before = journal.read_bytes()
            again = installer.apply_installation(c, p)
            self.assertTrue(again['existingJournalPreserved'])
            self.assertEqual(journal.read_bytes(), before)
            for file, (_, mode) in installer.installation_files(c, Path(source.get('restore', '/fixture'))).items():
                self.assertEqual(file.stat().st_mode & 0o777, mode)
        self.fake_installation(action)

    def test_activation_hash_source_changes_and_one_checked_cycle(self):
        def action(c, p, source, commands, active):
            installer.apply_installation(c, p)
            with self.assertRaises(ValueError):
                installer.apply_installation(c, p, activate=True, reviewed='e' * 64)
            correct = installer.mirror.initial_journal(c)['configurationHash']
            old = source['latest']
            source['latest'] = {**old, 'created': 101}
            with self.assertRaises(ValueError):
                installer.apply_installation(c, p, activate=True, reviewed=correct)
            source['latest'] = old
            self.assertFalse(active[0])
            result = installer.apply_installation(c, p, activate=True, reviewed=correct)
            self.assertTrue(result['timerActive'])
            self.assertEqual(commands.count(['systemctl', 'start', installer.SERVICE]), 1)
            before = (installer.STATE / 'worker.json').read_bytes()
            installer.apply_installation(c, p, activate=True, reviewed=correct)
            self.assertEqual(commands.count(['systemctl', 'start', installer.SERVICE]), 1)
            self.assertEqual((installer.STATE / 'worker.json').read_bytes(), before)
        self.fake_installation(action)

    def test_active_timer_with_failed_worker_never_claims_reactivation(self):
        def action(c, p, source, commands, active):
            installer.apply_installation(c, p)
            active[0] = True
            file = installer.STATE / 'worker.json'
            journal = json.loads(file.read_text())
            journal.update(enabled=False, state='uncertain', error='FIXTURE_REVIEW_REQUIRED')
            file.write_text(json.dumps(journal))
            before = file.read_bytes()
            with self.assertRaises(ValueError):
                installer.apply_installation(c, p, activate=True, reviewed=installer.mirror.initial_journal(c)['configurationHash'])
            self.assertEqual(file.read_bytes(), before)
            self.assertFalse(any('start' in args or 'enable' in args for args in commands))
        self.fake_installation(action)

    def test_private_umask_does_not_change_required_new_file_modes(self):
        def action(c, p, source, commands, active):
            previous = os.umask(0o077)
            try:
                installer.apply_installation(c, p)
                for file, (_, mode) in installer.installation_files(c, '/fixture/restore').items():
                    self.assertEqual(file.stat().st_mode & 0o777, mode)
                self.assertTrue(installer.apply_installation(c, p)['existingJournalPreserved'])
            finally:
                os.umask(previous)
        self.fake_installation(action)

    def test_cli_error_does_not_print_untrusted_credential_canary(self):
        with tempfile.TemporaryDirectory() as root:
            config, proof = fixture()
            config['injected'] = 'FICTIONAL_SECRET_CREDENTIAL_CANARY'
            files = [Path(root).resolve() / 'config.json', Path(root).resolve() / 'receipt.json']
            for file, data in zip(files, [config, proof]):
                file.write_text(json.dumps(data))
                file.chmod(0o600)
            result = subprocess.run([sys.executable, str(ROOT/'scripts/install-drive-mirror.py'), '--config', str(files[0]), '--recovery-proof', str(files[1])], capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertNotIn(config['injected'], result.stdout + result.stderr)
            self.assertNotIn('Traceback', result.stderr)


if __name__ == '__main__':
    unittest.main()
