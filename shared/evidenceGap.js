// Shared by new investigations and the presentation of reports retained in a tab.
export function describeCapabilityGap(report) {
  const product = report.productName || report.inputUrl || 'the submitted product';
  const checks = (report.checks || []).filter(c => c.id === 'capability' && (c.status !== 'supported' || c.flag === 'yellow'));
  const checked = checks.find(c => c.claim && c.evidence?.some(e => e.quote && report.sources?.some(s => s.id === e.sourceId)));
  const hypothesis = !checked && checks.find(c => c.claim || c.investigatedClaim);
  const passages = (report.dossier?.observations || []).filter(o => o.criterion === 'capability');
  const proposed = hypothesis?.claim || hypothesis?.investigatedClaim;
  const passage = proposed ? passages.find(o => o.quote === proposed) :
    passages.find(o => o.kind === 'Product page') || passages.find(o => o.kind === 'Publisher documentation') || passages[0];
  const quote = checked?.evidence.find(e => e.quote && report.sources?.some(s => s.id === e.sourceId));
  const source = quote ? report.sources?.find(s => s.id === quote.sourceId) : passage;
  const target = checked?.claim || proposed || passage?.quote;
  if (!target) {
    return {
      summary:'The collected material did not identify a testable user task and expected result for ' + product + '.',
      missing:'A product or edition page naming the task, its inputs and its expected output is needed before the researcher can test it.',
      request:'Which product or edition of ' + product + ' should we test, and what result should it produce for a user?',
    };
  }
  const measured = /\d+(?:[.,]\d+)?\s*(?:%|percent\b|×|x\b|milliseconds?\b|seconds?\b|minutes?\b)/iu.test(target);
  const standardProof = measured
    ? 'A benchmark for this edition needs to report the claimed metric and value, test conditions, and measured result.'
    : 'A worked example, test or deployment for this edition needs to show the inputs, what the user did, and the resulting output for that task.';
  const missing = checked?.status === 'partly_supported' && /^(?:confirm|verify|check|compare|obtain|inspect|request|measure|test)\b/i.test(checked.consequence || '')
    ? checked.consequence : standardProof;
  if (proposed && !source) {
    return {target, summary:'The researcher investigated this proposition about ' + product + ': “' + target + '”',
      reason:'The report contains no verified passage tying that proposition to this edition or establishing the result.',
      missing, request:'Which public document identifies this capability for ' + product + ', and where can we check the result: “' + target + '”?'};
  }
  const summary = 'The open question for ' + product + ' is whether it delivers this outcome in actual use: “' + target + '”';
  const reason = checked?.explanation || checks.find(c => c.explanation && !c.explanation.startsWith('The retrieved evidence did not establish'))?.explanation ||
    'The retained passage describes the task. The research could not verify its result for this product and edition.';
  const request = measured ? 'Can you point to a benchmark for ' + product + ' that tests “' + target + '” under the advertised conditions?'
    : 'Can you share a worked example or deployment of ' + product + ' that shows a user doing this and the result: “' + target + '”?';
  return {summary, target, reason, missing, request,
    ...(source && {sourceUrl:source.url, sourceTitle:source.title, sourceQuote:quote?.quote || passage?.quote})};
}
