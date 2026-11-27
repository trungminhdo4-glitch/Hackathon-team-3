import assert from 'node:assert/strict';
import test from 'node:test';
import { Runner, Usage } from '@openai/agents';
import { openReviewGate, resumeReviewGate } from '../server/reviewGate.js';

const report = {
  productName: 'Orbit', searchModel: 'gpt-6.2-sol', interpretation: 'The edition is unclear.',
  checks: [{id: 'licensing', label: 'Licensing and access', status: 'unverified'}],
};

function questionRunner(response) {
  return new Runner({tracingDisabled: true, modelProvider: {getModel(id) {
    assert.equal(id, report.searchModel);
    return {getResponse: response};
  }}});
}

for (const action of ['research', 'finalize']) {
  test(`the SDK pauses for the reviewer and resumes ${action} without another model call`, async () => {
    let calls = 0;
    const runner = questionRunner(async () => {
      calls++;
      return {usage: new Usage(), output: [{type: 'function_call', callId: 'choose', name: 'request_reviewer_input',
        arguments: JSON.stringify({criterion: 'licensing', request: 'scope', question:'Which edition of Orbit should we verify for licensing and access?'}), status: 'completed'}]};
    });
    const gate = await openReviewGate(report, runner);
    assert.equal(gate.mode, 'sdk');
    assert.match(gate.prompt, /Which edition.*Orbit.*licensing and access/);
    assert.equal(gate.state.run.getInterruptions().length, 1);
    const decision = await resumeReviewGate(gate, {action, guidance: ' Check the free edition. '});
    assert.deepEqual(decision, {action, guidance: action === 'research' ? 'Check the free edition.' : ''});
    assert.equal(calls, 1);
  });
}

test('a failed provider leaves a locally identified, actionable review checkpoint', async () => {
  const runner = questionRunner(async () => { throw new Error('provider unavailable'); });
  const gate = await openReviewGate(report, runner);
  assert.equal(gate.mode, 'local');
  assert.equal(gate.state, null);
  assert.match(gate.prompt, /licensing and access/);
  assert.deepEqual(await resumeReviewGate(gate, {action: 'finalize'}), {action: 'finalize', guidance: ''});
});

test('the review explains its decision boundary using actual retrieved material even without a model', async () => {
  const doc = {kind:'Product page', title:'Orbit Team plan', url:'https://orbit.example/terms',
    quote:'Shared workspaces are available with the Team plan.', criterion:'licensing'};
  const gate = await openReviewGate({...report, searchModel:null, dossier:{observations:[doc],coverage:[]}});
  assert.ok(gate.brief.known.includes(doc.quote));
  assert.equal(gate.brief.knownUrl, doc.url);
  assert.match(gate.brief.obstacle, /current terms.*Orbit/);
  assert.match(gate.brief.green, /advertised capability/);
  assert.match(gate.brief.yellow, /tier|quota/);
  assert.match(gate.brief.red, /contradict/);
  assert.match(gate.prompt, /Orbit Team plan/);
});

test('the offline review prompt names the same advertised outcome and missing proof as the report', async () => {
  const gap = {summary:'Orbit advertises routing by team.', reason:'The guide only showed the ticket in the queue.',
    missing:'The destination team for that ticket remains unknown.',request:'Can you share a trace showing which team received the test ticket?',
    sourceUrl:'https://orbit.example/guide', sourceTitle:'Routing guide',sourceQuote:'Tickets from the integration arrive in the shared queue.'};
  const gate = await openReviewGate({...report,searchModel:null,evidenceGap:gap,
    checks:[{id:'capability',label:'Core capability',status:'partly_supported'}]});
  assert.equal(gate.prompt,gap.request);
  assert.equal(gate.brief.knownUrl,gap.sourceUrl);
  assert.ok(gate.brief.obstacle.includes(gap.missing));
});
