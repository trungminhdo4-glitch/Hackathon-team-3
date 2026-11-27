import asyncio
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import agent

QUOTE = 'This software product publishes a new release every month.'


class FakeFetch:
    requests = 0
    def __init__(self):
        self.fail = set()
    async def fetch(self, url):
        if url in self.fail:
            raise RuntimeError('404')
        await asyncio.sleep(.001)
        self.requests += 1
        return {'url': url, 'final_url': url, 'text': QUOTE, 'links': [],
                'sha256': 'fixture-hash', 'fetched_at': '2026-11-27T00:00:00Z'}


def candidate(verdict='GREEN'):
    return {'name': 'Fixture', 'verdict': verdict, 'summary': 'untrusted summary must not leak',
        'reasons': [{'claim': 'Monthly releases are documented.', 'url': 'https://customer.example/confirmation',
            'quote': QUOTE, 'source_role': 'customer', 'kind': 'positive', 'axis': axis, 'material': True} for axis in ('real', 'alive', 'trust')],
        'unknowns': []}


class FakeBackend:
    def __init__(self, delay=.01, fail=(), hang=()):
        self.active = self.peak = self.calls = 0
        self.order = []
        self.delay, self.fail, self.hang = delay, fail, hang
    async def start(self):
        pass
    def close(self):
        pass
    async def research(self, p, context, phase):
        self.active += 1
        self.peak = max(self.peak, self.active)
        self.calls += 1
        self.order.append((p['id'], phase))
        try:
            await asyncio.sleep(5 if p['id'] in self.hang else self.delay)
            if p['id'] in self.fail:
                raise RuntimeError('mock model outage')
            c = candidate()
            # Distinct exact quotes per axis to avoid evidence deduplication.
            c['reasons'] = [dict(c['reasons'][0], axis='real')]
            c['verdict'] = 'YELLOW'
            c['unknowns'] = ['Trust and current activity remain unresolved.']
            return c
        finally:
            self.active -= 1


class ValidationTests(unittest.IsolatedAsyncioTestCase):
    async def test_quote_rejects_fabrication_and_keeps_valid(self):
        c = candidate()
        c['reasons'] = [c['reasons'][0], dict(c['reasons'][0], quote='This is a fabricated assertion about a serious breach.')]
        good, bad, sources = await agent.validate(c, {'url': 'https://vendor.example'}, FakeFetch())
        self.assertEqual(len(good), 1)
        self.assertEqual(len(bad), 1)
        self.assertEqual(len(sources), 1)
        self.assertEqual(good[0]['validation'], 'QUOTE_PRESENT')
        self.assertEqual(good[0]['origin'], 'external')

    async def test_unfetchable_and_short_quote_rejected(self):
        f = FakeFetch()
        f.fail.add('https://customer.example/confirmation')
        good, bad, _ = await agent.validate(candidate(), {'url': 'https://vendor.example'}, f)
        self.assertEqual(len(good), 0)
        self.assertEqual(len(bad), 3)
        c = candidate()
        c['reasons'][0]['quote'] = 'monthly'
        good, bad, _ = await agent.validate(c, {'url': 'https://vendor.example'}, FakeFetch())
        self.assertGreaterEqual(len(bad), 1)

    def test_context_guards(self):
        c = candidate()
        self.assertEqual(agent.decide(c, [], [dict(error='failed')])[0], 'YELLOW')
        c['verdict'] = 'RED'
        self.assertEqual(agent.decide(c, [], [])[0], 'YELLOW')
        r = {'axis': 'trust', 'kind': 'adverse', 'material': True, 'origin': 'external'}
        self.assertEqual(agent.decide(c, [r], [])[0], 'RED')
        self.assertEqual(agent.decide(c, [r], [{'error': 'missing context quote'}])[0], 'YELLOW')
        c['verdict'] = 'GREEN'
        r = [{'axis': x, 'kind': 'positive', 'origin': 'external'} for x in ('real', 'alive', 'trust')]
        self.assertEqual(agent.decide(c, r, [])[0], 'GREEN')
        for item in r:
            item['origin'] = 'vendor'
        self.assertEqual(agent.decide(c, r, [])[0], 'YELLOW')

    def test_url_policy(self):
        for url in ('file:///etc/passwd', 'https://user:pass@example.com', 'https://example.com:9999'):
            with self.assertRaises(ValueError):
                agent.url_ok(url)
        self.assertEqual(agent.domain('https://docs.vendor.co.uk'), 'vendor.co.uk')

    async def test_private_network_blocked(self):
        f = agent.Fetcher()
        with self.assertRaises(ValueError):
            await f.fetch('http://127.0.0.1/')


class SchedulingTests(unittest.IsolatedAsyncioTestCase):
    def products(self, n=10):
        return [{'id': f'p{i:02}', 'url': f'https://vendor{i}.example/', 'context': ''} for i in range(n)]

    async def test_ten_product_concurrency_failures_fairness_atomic_exports(self):
        b = FakeBackend(fail={'p03'})
        with tempfile.TemporaryDirectory() as d:
            runner = agent.Runner(self.products(), d, b, FakeFetch(), seconds=3,
                workers=4, models=2, phase_a=1, deepen=False)
            snapshots = []
            original = runner.save
            def save():
                original()
                snapshots.append(json.loads((Path(d)/'submission.json').read_text()))
            runner.save = save
            result = await runner.run()
            self.assertEqual(len(result), 10)
            self.assertEqual(b.peak, 2)
            self.assertEqual([x[0] for x in b.order], [p['id'] for p in self.products()])
            self.assertEqual(sum(r['status'] == 'ERROR' for r in result), 1)
            self.assertTrue(all(r['status'] in ('ERROR', 'PARTIAL') for r in result))
            self.assertTrue(any(any(p['phase'] == 'A' for p in s['products']) and
                any(p['status'] == 'PENDING' for p in s['products']) for s in snapshots))
            self.assertEqual(len(list((Path(d)/'checkpoints').glob('*.json'))), 10)
            self.assertTrue((Path(d)/'submission.csv').read_text().startswith('id,url,verdict,status'))
            self.assertNotIn('untrusted summary', (Path(d)/'report.md').read_text())
            self.assertEqual(list(Path(d).glob('.submission*')), [])

    async def test_product_deadline_releases_model_slot(self):
        b = FakeBackend(hang={'p00'})
        with tempfile.TemporaryDirectory() as d:
            runner = agent.Runner(self.products(3), d, b, FakeFetch(), seconds=3,
                workers=2, models=1, phase_a=.4, deepen=False)
            result = await runner.run()
            self.assertEqual(result[0]['status'], 'TIMEOUT')
            self.assertTrue(any(r['phase'] == 'A' for r in result[1:]))
            self.assertEqual(b.active, 0)

    async def test_global_deadline_preserves_every_row(self):
        b = FakeBackend(delay=5)
        with tempfile.TemporaryDirectory() as d:
            start = agent.time.monotonic()
            runner = agent.Runner(self.products(), d, b, FakeFetch(), seconds=.3,
                workers=3, models=2, phase_a=5, deepen=False)
            result = await runner.run()
            self.assertLess(agent.time.monotonic()-start, 3)
            self.assertEqual(len(result), 10)
            self.assertTrue(all(r['status'] == 'TIMEOUT' for r in result))
            self.assertEqual(b.active, 0)

    async def test_resume_binding_and_reuse(self):
        with tempfile.TemporaryDirectory() as d:
            b = FakeBackend()
            await agent.Runner(self.products(2), d, b, FakeFetch(), deepen=False).run()
            b2 = FakeBackend()
            await agent.Runner(self.products(2), d, b2, FakeFetch(), resume=True, deepen=False).run()
            self.assertEqual(b2.calls, 0)
            with self.assertRaises(ValueError):
                await agent.Runner(self.products(1), d, FakeBackend(), FakeFetch(), resume=True).run()
            with self.assertRaises(ValueError):
                await agent.Runner(self.products(2), d, FakeBackend(), FakeFetch()).run()

    async def test_deepening_after_all_initial_passes(self):
        b = FakeBackend()
        with tempfile.TemporaryDirectory() as d:
            result = await agent.Runner(self.products(4), d, b, FakeFetch(),
                seconds=30, workers=2, models=1, phase_a=1, phase_b=1).run()
            self.assertEqual([x[1] for x in b.order], ['A']*4 + ['B']*4)
            self.assertTrue(all(r['phase'] == 'B' for r in result))

    async def test_phase_b_failure_preserves_phase_a_evidence(self):
        class B(FakeBackend):
            async def research(self, p, context, phase):
                if phase == 'B':
                    raise RuntimeError('deepening outage')
                return await super().research(p, context, phase)
        with tempfile.TemporaryDirectory() as d:
            r = (await agent.Runner(self.products(1), d, B(), FakeFetch(), seconds=30).run())[0]
            self.assertEqual(r['phase'], 'A')
            self.assertEqual(len(r['reasons']), 1)
            self.assertEqual(r['status'], 'PARTIAL')

    async def test_process_cancel_terminates_child(self):
        task = asyncio.create_task(agent.process(['python3', '-c', 'import time; time.sleep(60)']))
        await asyncio.sleep(.03)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task

    async def test_billing_login_refused(self):
        async def status(*args, **kwargs):
            return 0, 'Logged in using an API key'
        with patch.object(agent, 'process', status):
            with self.assertRaisesRegex(RuntimeError, 'billing is refused'):
                await agent.CodexBackend().start()


class InputTests(unittest.TestCase):
    def test_input_id_safety(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/'products.json'
            p.write_text(json.dumps([{'id': '../escape', 'url': 'https://example.com'}]))
            with self.assertRaises(ValueError):
                agent.load_products(p)
            p.write_text(json.dumps(['https://example.com']))
            self.assertEqual(agent.load_products(p)[0]['id'], 'p01')


class CheckpointProgressTests(unittest.IsolatedAsyncioTestCase):
    async def test_timeout_during_validation_keeps_first_verified_quote(self):
        class B(FakeBackend):
            async def research(self, p, context, phase):
                c = candidate('YELLOW')
                c['reasons'] = [c['reasons'][0], dict(c['reasons'][1], url='https://slow.example/')]
                return c
        class F(FakeFetch):
            async def fetch(self, url):
                if url == 'https://slow.example/':
                    await asyncio.sleep(5)
                return await super().fetch(url)
        with tempfile.TemporaryDirectory() as d:
            rows = [{'id':'one', 'url':'https://vendor.example/', 'context':''}]
            result = await agent.Runner(rows, d, B(), F(), seconds=3, phase_a=.5, deepen=False).run()
            self.assertEqual(result[0]['status'], 'PARTIAL')
            self.assertEqual(len(result[0]['reasons']), 1)
            saved = json.loads((Path(d)/'checkpoints/one.json').read_text())
            self.assertEqual(len(saved['report']['reasons']), 1)

    async def test_startup_failure_has_error_rows(self):
        class B(FakeBackend):
            async def start(self):
                raise RuntimeError('subscription unavailable')
        with tempfile.TemporaryDirectory() as d:
            rows = [{'id':'one', 'url':'https://vendor.example/', 'context':''}]
            with self.assertRaises(RuntimeError):
                await agent.Runner(rows, d, B(), FakeFetch()).run()
            r = json.loads((Path(d)/'submission.json').read_text())['products'][0]
            self.assertEqual(r['status'], 'ERROR')
            self.assertIn('subscription unavailable', r['errors'][0])

if __name__ == '__main__':
    unittest.main()
