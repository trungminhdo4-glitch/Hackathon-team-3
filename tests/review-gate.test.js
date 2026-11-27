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
        arguments: JSON.stringify({criterion: 'licensing', request: 'scope'}), status: 'completed'}]};
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
