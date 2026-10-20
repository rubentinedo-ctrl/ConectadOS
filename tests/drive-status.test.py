import copy
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('status', Path(__file__).resolve().parents[1]/'scripts/drive-status.py')
status = importlib.util.module_from_spec(spec);spec.loader.exec_module(status)


def config():
    return {'schemaVersion': 1, 'enabled': True, 'container': 'conectados-'+'a'*24,
            'imageId': 'sha256:'+'b'*64, 'backupsVolume': 'a'*24+'_conectados-backups', 'sourceBinding': 'c'*64,
            'sourceFloor': 100, 'rcloneConfig': '/etc/fixture/rclone.conf', 'remote': 'fixture-drive',
            'folderId': 'PRIVATE_FOLDER_ID', 'parentId': 'PRIVATE_PARENT_ID', 'account': 'private@example.com',
            'allowedUsers': ['private@example.com'], 'stateRoot': '/data/fixture', 'helper': '/opt/fixture/source.mjs', 'helperSha256': 'd'*64}


def fixture():
    c = config();j = status.mirror.initial_journal(c)
    j.update(heartbeat=900, items=[{'id': '12345678-1234-1234-1234-123456789abc', 'digest': 'e'*64, 'created': 200, 'started': 300,
              'finished': 800, 'bytes': 1234, 'state': 'verified', 'fileId': 'PRIVATE_GOOGLE_FILE_ID',
              'restoration': {'restored': True, 'effectsPaused': True, 'downloadMatched': True, 'ownerPresent': True, 'integrity': 'ok', 'secret': 'PRIVATE_SECRET'},
              'error': 'PRIVATE_PROVIDER_ERROR'}])
    return c, j, {'timerActive': True, 'serviceState': 'idle', 'exitCode': 0}


class StatusTests(unittest.TestCase):
    def test_allowlist_keeps_dates_and_proof_without_account_folder_file_or_provider_secrets(self):
        c, j, u = fixture();report = status.status(c, j, u, 'f'*64, 1000)
        self.assertEqual(report['lastVerified']['created'], 200);self.assertEqual(report['lastVerified']['finished'], 800)
        self.assertTrue(report['lastVerified']['restored']);self.assertEqual(report['worker']['heartbeat'], 900)
        for secret in ['PRIVATE_FOLDER_ID', 'PRIVATE_PARENT_ID', 'private@example.com', 'PRIVATE_GOOGLE_FILE_ID', 'PRIVATE_SECRET', 'PRIVATE_PROVIDER_ERROR', '/etc/fixture']:
            self.assertNotIn(secret, json.dumps(report))
        self.assertEqual(report, status.status(c, j, u, 'f'*64, 1000))

    def test_uploaded_and_uncertain_results_never_become_a_verified_receipt(self):
        for state in ['uploading', 'uncertain', 'failed']:
            c, j, u = fixture();j['items'][0].update(state=state, restoration=None);j.update(state=state, enabled=False)
            report = status.status(c, j, u, 'f'*64, 1000)
            self.assertIsNone(report['lastVerified']);self.assertFalse(report['receipts'][0]['restored'])

    def test_claimed_verification_requires_all_isolation_and_integrity_flags(self):
        for flag in ['restored', 'effectsPaused', 'downloadMatched', 'ownerPresent', 'integrity']:
            c, j, u = fixture();j['items'][0]['restoration'][flag] = False
            with self.assertRaises(ValueError):status.status(c, j, u, 'f'*64, 1000)

    def test_configuration_change_duplicates_and_unknown_unit_states_fail_closed(self):
        c, j, u = fixture();c['folderId'] = 'ANOTHER_FOLDER_ID'
        with self.assertRaises(ValueError):status.status(c, j, u, 'f'*64, 1000)
        c, j, u = fixture();j['items'].append(copy.deepcopy(j['items'][0]))
        with self.assertRaises(ValueError):status.status(c, j, u, 'f'*64, 1000)
        c, j, u = fixture();u['serviceState'] = 'healthy'
        with self.assertRaises(ValueError):status.status(c, j, u, 'f'*64, 1000)

    def test_recent_publisher_keeps_old_heartbeat_and_source_dates(self):
        c, j, u = fixture();j['heartbeat'] = None
        report = status.status(c, j, u, 'f'*64, 100000000)
        self.assertIsNone(report['worker']['heartbeat']);self.assertEqual(report['lastVerified']['created'], 200)

    def test_last_success_is_retained_when_outside_the_thirty_recent_attempts(self):
        c, j, u = fixture()
        for n in range(31):
            item = copy.deepcopy(j['items'][0]);item.update(id=f'{n:08x}-1234-1234-1234-123456789abc', created=400+n, started=500+n, finished=800+n, state='failed', restoration=None);j['items'].append(item)
        report = status.status(c, j, u, 'f'*64, 1000)
        self.assertEqual(report['totalAttempts'], 32);self.assertEqual(len(report['receipts']), 30)
        self.assertTrue(report['lastVerified']['restored']);self.assertEqual(report['lastVerified']['created'], 200)

    def test_bad_time_size_and_impossible_order_do_not_publish_proof(self):
        for key, value in [('bytes', status.mirror.LIMIT+1), ('started', 199), ('finished', 299), ('created', 31001)]:
            c, j, u = fixture();j['items'][0][key] = value
            with self.assertRaises(ValueError):status.status(c, j, u, 'f'*64, 1000)


if __name__ == '__main__':unittest.main()
