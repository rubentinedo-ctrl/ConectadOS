import importlib.util, unittest, tempfile, pathlib, json, os
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('agent',pathlib.Path(__file__).parents[1]/'scripts/host-agent.py');agent=importlib.util.module_from_spec(spec);spec.loader.exec_module(agent)
class HostAgentTests(unittest.TestCase):
 def test_cpu_counts_guest_once_and_separates_steal_and_iowait(self):
  before=agent.cpu_counters('cpu 10 0 10 70 5 0 0 5 7 3\n');after=agent.cpu_counters('cpu 30 0 20 120 15 0 0 15 20 10\n');self.assertEqual(agent.cpu_delta(before,after),{'workPercent':30.0,'stealPercent':10.0,'ioWaitPercent':10.0,'reason':'sampled'})
 def test_reset_no_delta_is_unknown_not_zero(self):
  self.assertEqual(agent.cpu_delta([1]*8,[0]*8)['workPercent'],None);self.assertEqual(agent.cpu_delta([1]*8,[1]*8)['reason'],'counter-reset')
 def test_memory_available_estimate_not_free(self):
  m=agent.memory('MemTotal: 100 kB\nMemAvailable: 40 kB\nMemFree: 5 kB\nSwapTotal: 20 kB\nSwapFree: 10 kB\n');self.assertEqual(m['availableBytes'],40960)
  with self.assertRaises(ValueError):agent.memory('MemTotal: 100 kB\nMemAvailable: 101 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n')
 def test_disk_user_available_keeps_reserved_blocks(self):
  d=agent.filesystem(SimpleNamespace(f_frsize=4096,f_blocks=100,f_bfree=50,f_bavail=40));self.assertEqual(d['freeBytes']-d['availableBytes'],40960)
 def test_output_atomic_private_and_failure_preserves_previous(self):
  with tempfile.TemporaryDirectory() as directory:
   p=pathlib.Path(directory)/'host.json';agent.write_sample(p,{'schema':1});self.assertEqual(p.stat().st_mode&0o777,0o640)
   with self.assertRaises(ValueError):agent.write_sample(p,{'bad':float('nan')})
   self.assertEqual(json.loads(p.read_text()),{'schema':1});self.assertEqual(len(list(pathlib.Path(directory).iterdir())),1)
   linked=pathlib.Path(directory)/'link';linked.symlink_to(p)
   with self.assertRaises(ValueError):agent.write_sample(linked,{'schema':2})
if __name__=='__main__':unittest.main()
