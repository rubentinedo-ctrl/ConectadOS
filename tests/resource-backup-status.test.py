import unittest,importlib.util,tempfile,sys,os,json,time
from pathlib import Path
spec=importlib.util.spec_from_file_location('resource_status',Path(__file__).resolve().parents[1]/'scripts/resource-backup-status.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ResourceStatusTests(unittest.TestCase):
 def setUp(self):
  self.at=int(time.time()*1000);self.b={'ref':'a'*64,'label':'fixture','component':'fixture-completo','coverage':'Fixture database and files'};self.c={'schema':1,'bindings':[self.b]};self.h={'schema':1,'agentId':'b'*64,'sampledAt':self.at,'serverId':'fixture-host','coolifyOrigin':'https://panel.example'};self.raw={'status':'success','timestamp':'20261013T080000Z','bytes':5000,'sha256':'c'*64,'restored':True,'rows_match':True};self.stamp=m.stamp(self.raw['timestamp'])
 def test_no_archive_or_network_and_only_bound_status_metadata(self):
  calls=[]
  def read(p):
   calls.append(str(p))
   if p.parent.name=='drive-export':return ({'status':'success','period':'2026-10-13','remote_hash_verified':True,'components':['fixture-completo'],'errors':[]},self.at)
   return ({**self.raw,'private_token':'MUST_NOT_ESCAPE','archive':'PRIVATE_PATH'},self.at)
  r=m.build(self.c,self.h,read,self.at);self.assertEqual(len(calls),2);self.assertTrue(all(p.endswith('/status.json') for p in calls));self.assertTrue(r['items'][0]['restored']);self.assertEqual(r['items'][0]['drive']['state'],'included');self.assertNotIn('MUST_NOT_ESCAPE',json.dumps(r));self.assertNotIn('PRIVATE_PATH',json.dumps(r))
 def test_failed_missing_or_explicit_mismatch_cannot_become_restored(self):
  self.assertFalse(m.receipt(self.b,{**self.raw,'rows_match':False},self.at,self.at)['restored']);self.assertEqual(m.receipt(self.b,None,None,self.at)['state'],'missing');self.assertFalse(m.receipt(self.b,{**self.raw,'status':'failed'},self.at,self.at)['restored']);self.assertEqual(m.receipt(self.b,{**self.raw,'bytes':True},self.at,self.at)['state'],'invalid');self.assertEqual(m.receipt(self.b,{**self.raw,'timestamp':'20260230T080000Z'},self.at,self.at)['state'],'invalid')
 def test_binding_and_external_inclusion_are_strict(self):
  for c in [{'schema':1,'bindings':[{**self.b,'label':'../../keys'}]},{'schema':1,'bindings':[self.b,self.b]}]:
   with self.assertRaises(ValueError):m.validate_config(c)
  for d in [{'status':'failed','period':'2026-10-13'},{'status':'success','period':'2026-10-12','remote_hash_verified':True,'components':['fixture-completo']}]:self.assertNotEqual(m.receipt(self.b,self.raw,self.at,self.at,(d,self.at))['drive']['state'],'included')
  with self.assertRaises(ValueError):m.build(self.c,{**self.h,'sampledAt':self.at-180001},now=self.at)
 def test_reader_rejects_links_directories_and_oversized_input(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t).resolve()/'data';p.write_text('{"status":"success"}');self.assertEqual(m.read_json(p)[0]['status'],'success');link=Path(t).resolve()/'link';link.symlink_to(p)
   for file in [link,Path(t).resolve()]:
    with self.assertRaises(ValueError):m.read_json(file)
   p.write_text(' '*65537)
   with self.assertRaises(ValueError):m.read_json(p)
if __name__=='__main__':unittest.main()
