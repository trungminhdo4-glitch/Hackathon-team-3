import { randomUUID } from 'node:crypto';
import { InputError } from './investigate.js';
import { openReviewGate, resumeReviewGate } from './reviewGate.js';
import { validatePublicUrl } from './fetch.js';

const reviewLifetime = 30 * 60_000;

function finalize(report) {
  if (report.verdict !== 'insufficient') return report;
  return { ...report, verdict: 'yellow', verdictBasis: 'evidence_gap',
    interpretation: 'Yellow because the evidence is inconclusive. ' + report.interpretation };
}

function withActivity(report, activity) {
  return activity.length ? { ...report, activity: [...activity] } : report;
}

function reviewError(status, message) {
  return Object.assign(new Error(message), { name: 'ReviewError', status });
}

export function readDecision(body) {
  if (Object.keys(body).some(key => !['id','action','guidance'].includes(key)) ||
      typeof body.id !== 'string' || body.id.length !== 36 ||
      !['research','finalize'].includes(body.action)) throw new InputError('Choose a valid review action.');
  if (body.action === 'finalize' && body.guidance !== undefined) throw new InputError('Send guidance with a research request.');
  if (body.action === 'research') {
    if (typeof body.guidance !== 'string' || !body.guidance.trim() || body.guidance.length > 1000)
      throw new InputError('Describe the next research task or provide a public source in up to 1,000 characters.');
    const guidance = body.guidance.trim();
    // Validate explicit source leads before consuming the paused SDK state.
    for (const [url] of guidance.matchAll(/https?:\/\/[^\s<>"`]+/gi)) validatePublicUrl(url.replace(/[.,;!?\])]+$/, ''));
    return { id: body.id, action: body.action, guidance };
  }
  return { id: body.id, action: body.action };
}

export function createReviewWorkflow(investigate, { openGate = openReviewGate, resumeGate = resumeReviewGate } = {}) {
  const sessions = new Map();
  function remove(id) {
    clearTimeout(sessions.get(id)?.timer);
    sessions.delete(id);
  }
  function expire(id, entry) {
    entry.timer = setTimeout(() => remove(id), reviewLifetime);
    entry.timer.unref();
  }
  async function start(input, options, activity) {
    let findings;
    const report = await investigate(input.subject, { ...options, onFindings: value => { findings = value; } });
    if (!input.review || report.verdict !== 'insufficient') return withActivity(finalize(report), activity);
    const gate = await openGate(report);
    if (sessions.size >= 32) {
      const oldest = [...sessions].find(([, entry]) => !entry.running);
      if (oldest) remove(oldest[0]);
      else throw reviewError(503, 'All review slots are busy. Retry in a moment.');
    }
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + reviewLifetime).toISOString();
    options.onActivity({ stage: 'review', detail: 'Paused for your research direction', status: 'paused',
      ...(gate.mode === 'sdk' && { model: report.searchModel, role: 'researcher' }) });
    // Retain only server-owned state behind an unguessable, expiring review ID.
    const entry = { gate, findings, report, subject: input.subject, question: options.question,
      model: options.model, helperModel: options.helperModel, activity: [...activity] };
    sessions.set(id, entry);
    expire(id, entry);
    return withActivity({ ...report, verdict: null, review: { id, prompt: gate.prompt, ...(gate.brief && {brief:gate.brief}), mode: gate.mode, expiresAt } }, activity);
  }
  async function finish(entry, decision, onActivity, activity) {
    const { action, guidance } = await resumeGate(entry.gate, decision);
    let report = entry.report;
    if (action === 'research') {
      onActivity({stage:'review', role:'human', detail:'Provided a follow-up task: ' + guidance});
      try {
        const updated = await investigate(entry.subject, { question: entry.question, model: entry.model,
          helperModel: entry.helperModel, priorFindings: entry.findings, guidance, onActivity });
        if (updated.verdict == null) throw new Error('Follow-up retrieval did not complete.');
        report = updated;
      } catch {
        report = { ...report, limitations: [...(report.limitations ?? []),
          'The guided search could not finish. This verdict uses the evidence retained from the first round.'] };
        onActivity({stage:'review', detail:'Follow-up incomplete. Retained the first round of findings.'});
      }
    } else {
      onActivity({stage:'review', role:'human', detail:'Chose to finish with the evidence already checked'});
    }
    const final = finalize(report);
    onActivity({stage:'verdict', detail:'Final verdict: ' + final.verdict});
    return { ...final, activity: [...entry.activity, ...activity],
      ...(entry.report.helperModel && !final.helperModel && { helperModel: entry.report.helperModel }),
      reviewOutcome: action === 'research' ? { action, guidance } : { action } };
  }
  async function resume(decision, onActivity, activity) {
    const entry = sessions.get(decision.id);
    if (!entry) throw reviewError(410, 'This review has expired. Start a new investigation to continue.');
    const choice = JSON.stringify(decision);
    if (entry.choice && entry.choice !== choice) throw reviewError(409, 'A different decision was already submitted for this review.');
    if (entry.result) return entry.result;
    if (entry.running) return entry.running;
    entry.choice = choice;
    clearTimeout(entry.timer);
    entry.running = finish(entry, decision, onActivity, activity);
    try {
      entry.result = await entry.running;
      delete entry.gate;
      delete entry.findings;
      delete entry.report;
      delete entry.activity;
      return entry.result;
    } catch (error) {
      delete entry.choice;
      throw error;
    } finally {
      delete entry.running;
      expire(decision.id, entry);
    }
  }
  return { start, resume };
}
