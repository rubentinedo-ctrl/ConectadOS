import importlib.util,pathlib,unittest
p=pathlib.Path(__file__).parents[1]/'scripts/recovery-check-worker.py';s=importlib.util.spec_from_file_location('recovery',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class RecoveryTests(unittest.TestCase):
 def test_signature(self):
  a=b'COPY public.a (x) FROM stdin;\n1\n2\n\\.\nSELECT pg_catalog.setval(\'x\', 2, true);'
  b=a.replace(b'1\n2',b'2\n1');self.assertEqual(m.signature(a),m.signature(b));self.assertNotEqual(m.signature(a),m.signature(a.replace(b'2\n',b'3\n')))
  with self.assertRaises(ValueError):m.signature(b'INSERT INTO x VALUES (1);')
 def test_requests(self):
  ref='a'*64;instance='b'*64;c={'bindings':{ref:{}}};j={'schema':1,'id':'12345678-1234-1234-1234-123456789abc','ref':ref,'sha256':'c'*64,'backupAt':100,'instance':instance,'createdAt':1000,'expiresAt':301000}
  self.assertTrue(m.valid_request(j,c,instance,1001))
  for patch in [{'ref':'d'*64},{'instance':'e'*64},{'expiresAt':999999},{'createdAt':1002},{'command':'anything'}]:self.assertFalse(m.valid_request({**j,**patch},c,instance,1001))
  self.assertFalse(m.valid_request(j,c,instance,301001))
if __name__=='__main__':unittest.main()
