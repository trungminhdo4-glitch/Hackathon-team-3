import tempfile
import unittest
import agent
from test_agent import FakeBackend,FakeFetch,candidate
from test_v11 import evidence,judgement


class RegressionTests(unittest.IsolatedAsyncioTestCase):
    async def test_markdown_table_quote_matches_same_words_only(self):
        class F(FakeFetch):
            async def fetch(self,url):
                r=await super().fetch(url)
                r['text']='Supported branches 7.0.x Latest stable version. Fully supported with security updates.'
                return r
        c=candidate()
        c['reasons']=[dict(c['reasons'][0],quote='7.0.x | Latest stable version. Fully supported with security updates.')]
        good,bad,_=await agent.validate(c,{'url':'https://vendor.example'},F())
        self.assertEqual(len(good),1)
        self.assertEqual(bad,[])
        c['reasons'][0]['quote']='7.0.x | Latest stable version. No security updates.'
        good,bad,_=await agent.validate(c,{'url':'https://vendor.example'},F())
        self.assertEqual(good,[])
        self.assertEqual(len(bad),1)

    def test_mixed_green_and_material_unknown_becomes_yellow(self):
        selected,decision=agent.apply_judgement(judgement(unknowns=['A concrete current issue remains unresolved.']),
            [evidence('real'),evidence('alive')])
        self.assertEqual(decision['verdict'],'YELLOW')
        self.assertEqual(len(selected),2)
        self.assertEqual(len(decision['unknowns']),1)

    def test_maintained_product_plus_independent_record_suffices_for_green_guard(self):
        rows=[dict(evidence('alive'),origin='vendor'),evidence('trust','neutral')]
        self.assertEqual(agent.decide(candidate('GREEN'),rows,[],adjudicated=True)[0],'GREEN')
        self.assertEqual(agent.decide(candidate('GREEN'),rows[:1],[],adjudicated=True)[0],'YELLOW')

    async def test_failed_final_reference_gets_second_phase_retry(self):
        class B(FakeBackend):
            def __init__(self):
                super().__init__()
                self.phase=''
            async def research(self,p,context,phase):
                self.phase=phase
                self.order.append(phase)
                c=candidate()
                c['reasons']=c['reasons'][:2]
                return c
            async def adjudicate(self,p,context):
                return judgement(indices=[99] if self.phase=='A' else [0,1])
        b=B()
        with tempfile.TemporaryDirectory() as d:
            r=(await agent.Runner([{'id':'one','url':'https://vendor.example/','context':''}],d,b,FakeFetch(),seconds=30).run())[0]
            self.assertEqual(b.order,['A','B'])
            self.assertEqual(r['phase'],'B')
            self.assertEqual(r['verdict'],'GREEN')
            self.assertEqual(r['status'],'COMPLETE')
            self.assertTrue(r['adjudicated'])

if __name__=='__main__':
    unittest.main()
