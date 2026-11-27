import asyncio
import json
from pathlib import Path
import tempfile
import unittest
import agent
from test_agent import FakeBackend, FakeFetch, QUOTE, candidate


def evidence(axis='real', kind='positive', material=True):
    return {'claim': 'A bounded fixture claim.', 'url':'https://registry.example/item',
        'final_url':'https://registry.example/item', 'quote':QUOTE, 'kind':kind,
        'axis':axis,'material':material,'origin':'external','source_role':'registry',
        'validation':'QUOTE_PRESENT','source_sha256':'fixture','fetched_at':'fixture'}


def judgement(colour='GREEN', indices=None, unknowns=None, limitations=None):
    return {'verdict':colour,'reason_indices':indices if indices is not None else [0,1],
        'material_unknowns':unknowns or [],'limitations':limitations or ['No complete penetration test performed.']}


class TextTests(unittest.IsolatedAsyncioTestCase):
    def test_html_preserves_inline_words_and_table_boundaries(self):
        p=agent.PageParser()
        p.feed('<h1>Red<span>mine</span></h1><table><tr><td>7.0.1</td><td>2026-11-01</td></tr></table><script>FAKE</script>')
        text=' '.join(''.join(p.parts).split())
        self.assertEqual(text,'Redmine 7.0.1 2026-11-01')
        self.assertNotIn('FAKE',text)

    def test_legacy_encoding_and_unicode_normalization(self):
        raw='<meta charset="windows-1252"><p>Änderungen: jährlich für größere Unternehmen</p>'.encode('cp1252')
        self.assertIn('jährlich',agent.decode_page(raw,'text/html'))
        self.assertIn('jährlich',agent.decode_page(raw,'text/html; charset=windows-1252'))
        self.assertEqual(agent.norm('The “release” is main\u00adtained.'),agent.norm('The "release" is maintained.'))
        self.assertNotEqual(agent.norm('not maintained'),agent.norm('maintained'))

    def test_excerpts_locate_terms_without_inventing_text(self):
        text='intro '*1000+'Actual release version 7.1.4 published 2026-11-01. '+'end '*2000
        excerpt=agent.source_excerpts(text,'release version 7.1.4 published')
        self.assertIn('Actual release version 7.1.4 published 2026-11-01.',excerpt)
        self.assertLessEqual(len(excerpt),4500)

    async def test_short_substantive_quote_and_same_quote_different_axes(self):
        c=candidate()
        c['reasons'][0]['quote']='publishes a new release'
        good,bad,_=await agent.validate(c,{'url':'https://vendor.example'},FakeFetch())
        self.assertEqual(len(good),3)
        self.assertEqual(bad,[])

    async def test_paraphrase_still_rejected_with_attempt_record(self):
        c=candidate()
        c['reasons']=[dict(c['reasons'][0],quote='This software publishes reliable updates every single month.')]
        good,bad,_=await agent.validate(c,{'url':'https://vendor.example'},FakeFetch())
        self.assertEqual(good,[])
        self.assertIn('attempted_quote',bad[0])


class DecisionTests(unittest.TestCase):
    def test_rejected_optional_source_does_not_veto_adjudicated_green(self):
        reasons=[evidence('real'),evidence('alive')]
        self.assertEqual(agent.decide(candidate(),reasons,[{'error':'403 optional PDF'}],adjudicated=True)[0],'GREEN')
        self.assertEqual(agent.decide(candidate(),reasons,[{'error':'403 optional PDF'}])[0],'YELLOW')

    def test_material_adverse_survives_optional_source_rejection(self):
        self.assertEqual(agent.decide(candidate('RED'),[evidence('trust','adverse')],
            [{'error':'blocked optional source'}],adjudicated=True)[0],'RED')
        self.assertEqual(agent.decide(candidate('RED'),[evidence()],[],adjudicated=True)[0],'YELLOW')

    def test_final_references_are_confined_to_verified_evidence(self):
        rows=[evidence('real'),evidence('alive')]
        for refs in ([3],[-1],[True],[0,0]):
            with self.assertRaises(ValueError):
                agent.apply_judgement(judgement(indices=refs),rows)
        _,mixed = agent.apply_judgement(judgement(unknowns=['Unresolved current material fraud allegation.']),rows)
        self.assertEqual(mixed['verdict'],'YELLOW')
        self.assertTrue(mixed['unknowns'])
        selected,decision=agent.apply_judgement(judgement(),rows)
        self.assertEqual(len(selected),2)
        self.assertEqual(decision['unknowns'],[])
        self.assertTrue(decision['limitations'])

    def test_vendor_only_or_inactive_evidence_cannot_pass_green_guard(self):
        rows=[evidence('real'),evidence('alive')]
        for r in rows:
            r['origin']='vendor'
        self.assertEqual(agent.decide(candidate(),rows,[],adjudicated=True)[0],'YELLOW')
        self.assertEqual(agent.decide(candidate(),[evidence('real')],[],adjudicated=True)[0],'YELLOW')


class PipelineTests(unittest.IsolatedAsyncioTestCase):
    async def test_pipeline_selects_mixed_colours_and_limits_do_not_force_partial(self):
        class B(FakeBackend):
            async def research(self,p,context,phase):
                c=candidate()
                c['unknowns']=['No buyer-specific deployment context. No full audit.']
                if p['id']=='red':
                    c['reasons']=[dict(c['reasons'][0],kind='adverse',axis='trust')]
                else:
                    c['reasons']=c['reasons'][:2]
                c['reasons'].append(dict(c['reasons'][0],url='https://blocked.example/optional'))
                return c
            async def adjudicate(self,p,context):
                self.calls+=1
                if p['id']=='red':
                    return judgement('RED',[0])
                if p['id']=='yellow':
                    return judgement('YELLOW',[0,1],['Current maintenance commitment remains unresolved.'])
                return judgement('GREEN',[0,1])
        f=FakeFetch()
        f.fail.add('https://blocked.example/optional')
        rows=[{'id':colour,'url':'https://vendor.example/','context':''} for colour in ['green','yellow','red']]
        with tempfile.TemporaryDirectory() as d:
            reports=await agent.Runner(rows,d,B(),f,seconds=10,deepen=False,phase_a=3).run()
            by_id={r['id']:r for r in reports}
            self.assertEqual([r['verdict'] for r in reports],['GREEN','YELLOW','RED'])
            self.assertEqual(by_id['green']['status'],'COMPLETE')
            self.assertEqual(by_id['red']['status'],'COMPLETE')
            self.assertEqual(by_id['yellow']['status'],'PARTIAL')
            self.assertEqual(len(by_id['green']['rejected_reasons']),1)
            self.assertTrue(all(r['adjudicated'] for r in reports))
            saved=json.loads((Path(d)/'submission.json').read_text())
            self.assertEqual(saved['products'][0]['verdict'],'GREEN')
            self.assertNotIn('blocked.example',(Path(d)/'report.md').read_text())

    async def test_final_judge_failure_preserves_partial_evidence(self):
        class B(FakeBackend):
            async def adjudicate(self,p,context):
                raise RuntimeError('judge outage')
        with tempfile.TemporaryDirectory() as d:
            rows=[{'id':'one','url':'https://vendor.example/','context':''}]
            r=(await agent.Runner(rows,d,B(),FakeFetch(),seconds=10,deepen=False).run())[0]
            self.assertEqual(r['status'],'PARTIAL')
            self.assertTrue(r['reasons'])
            self.assertEqual(r['verdict'],'YELLOW')
            self.assertFalse(r['adjudicated'])

    async def test_prior_evidence_not_erased_by_deepening(self):
        class B(FakeBackend):
            async def research(self,p,context,phase):
                c=candidate()
                c['reasons']=[dict(c['reasons'][0],axis='real' if phase=='A' else 'alive')]
                return c
            async def adjudicate(self,p,context):
                rows=context['evidence']
                return judgement('GREEN' if len(rows)>1 else 'YELLOW',list(range(len(rows))))
        with tempfile.TemporaryDirectory() as d:
            rows=[{'id':'one','url':'https://vendor.example/','context':''}]
            r=(await agent.Runner(rows,d,B(),FakeFetch(),seconds=30).run())[0]
            self.assertEqual(r['phase'],'B')
            self.assertEqual(r['verdict'],'GREEN')
            self.assertEqual({x['axis'] for x in r['reasons']},{'real','alive'})


    async def test_global_slots_cover_final_judgement_too(self):
        class B(FakeBackend):
            async def adjudicate(self,p,context):
                self.calls += 1
                self.active += 1
                self.peak = max(self.active,self.peak)
                try:
                    await asyncio.sleep(.01)
                    return judgement('YELLOW',[0],['Current maintenance not corroborated.'])
                finally:
                    self.active -= 1
        b=B()
        rows=[{'id':f'p{i}','url':f'https://vendor{i}.example/','context':''} for i in range(10)]
        with tempfile.TemporaryDirectory() as d:
            reports=await agent.Runner(rows,d,b,FakeFetch(),seconds=10,phase_a=3,
                workers=4,models=2,deepen=False).run()
            self.assertEqual(b.peak,2)
            self.assertEqual(b.active,0)
            self.assertEqual(b.calls,20)
            self.assertTrue(all(r['adjudicated'] for r in reports))

    async def test_judgement_deadline_preserves_validated_sources(self):
        class B(FakeBackend):
            async def adjudicate(self,p,context):
                await asyncio.sleep(5)
                return judgement('GREEN',[0])
        rows=[{'id':'one','url':'https://vendor.example/','context':''}]
        with tempfile.TemporaryDirectory() as d:
            r=(await agent.Runner(rows,d,B(),FakeFetch(),seconds=3,phase_a=.5,deepen=False).run())[0]
            self.assertEqual(r['status'],'PARTIAL')
            self.assertEqual(r['verdict'],'YELLOW')
            self.assertTrue(r['reasons'])
            self.assertFalse(r['adjudicated'])


    async def test_unverified_material_lead_is_carried_into_next_judgement(self):
        class B(FakeBackend):
            async def research(self,p,context,phase):
                c=candidate('YELLOW')
                c['reasons']=[dict(c['reasons'][0],axis='real' if phase=='A' else 'alive')]
                if phase=='A':
                    c['reasons'].append(dict(c['reasons'][0],claim='An unresolved material incident is alleged.',
                        kind='adverse',material=True,quote='A fabricated quote must never pass verification.'))
                return c
            async def adjudicate(self,p,context):
                self_outer.assertTrue(any(x['kind']=='adverse' for x in context['unverified_leads']))
                return judgement('YELLOW',list(range(len(context['evidence']))),['Specific incident lead remains unverified.'])
        self_outer=self
        with tempfile.TemporaryDirectory() as d:
            rows=[{'id':'one','url':'https://vendor.example/','context':''}]
            r=(await agent.Runner(rows,d,B(),FakeFetch(),seconds=30).run())[0]
            self.assertEqual(r['phase'],'B')
            self.assertEqual(r['verdict'],'YELLOW')
            self.assertEqual(len(r['rejected_reasons']),1)

if __name__=='__main__':
    unittest.main()
