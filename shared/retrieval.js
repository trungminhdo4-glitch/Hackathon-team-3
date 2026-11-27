// Only these public descriptions can be shown for transport failures. Raw exception
// messages can contain socket addresses, response bodies or other private details.
export function retrievalFailure(error) {
  const status = error?.httpStatus;
  if (Number.isInteger(status) && status >= 100 && status <= 599) return {code:'http', httpStatus:status};
  if (error?.name === 'TimeoutError' || error?.code === 'ETIMEDOUT') return {code:'timeout'};
  if (error?.name === 'AbortError') return {code:'interrupted'};
  const code = {ENOTFOUND:'dns', EAI_AGAIN:'dns', SIZE_LIMIT:'size', REDIRECT_LIMIT:'redirect',
    UNSAFE_URL:'unsafe', UNSUPPORTED_FORMAT:'format', ECONNRESET:'connection', ECONNREFUSED:'connection',
    PAGE_CHALLENGE:'challenge', PAGE_EMPTY:'empty'}[error?.code];
  return {code:code || 'unavailable'};
}

const readErrors = {
  timeout:['The page read timed out.', 'Try the direct document URL or a public mirror from the same publisher.'],
  interrupted:['The read was interrupted.', 'Retry the page in a new investigation.'],
  dns:['The hostname could not be resolved.', 'Check the publisher’s current hostname.'],
  connection:['The connection could not be completed.', 'Check whether the publisher provides another public documentation URL.'],
  size:['The response exceeded the 1 MiB limit.', 'Use the individual article or release note.'],
  redirect:['The page exceeded the redirect limit.', 'Provide the final public document URL.'],
  unsafe:['The URL or its redirect failed the public-network checks.', 'Use a publicly accessible source.'],
  format:['The response was a download or an unsupported format or encoding.', 'Find an HTML or plain-text version.'],
  challenge:['The page returned an access challenge.', 'Find another public account or an accessible document from the publisher.'],
  empty:['The page returned too little readable text.', 'Try a public help article, release note or other text version.'],
  unavailable:['The reader could not retrieve the page. The specific cause was not recorded.', 'Look for an accessible document about the same claim.'],
};
export function explainReadFailure(failure) {
  if (failure?.code === 'http') {
    const status = failure.httpStatus;
    const next = status === 429 ? 'Retry later or look for a separately published source.' :
      [401,403].includes(status) ? 'Use a publicly accessible equivalent or an independent account.' :
      [404,410].includes(status) ? 'Look for the publisher’s current location for the document.' :
        'Try the direct public document or an alternative source.';
    return ['The publisher returned HTTP ' + status + '.', next];
  }
  return readErrors[failure?.code] ?? readErrors.unavailable;
}
export const laneNames = {official:'Official search', independent:'Independent search', guided:'Guided search',
  submitted:'Submitted page', suggested:'Suggested page', web_search:'Search result · lane unrecorded'};

export function reportLimitations(report) {
  const notes = report.limitations || [];
  const pages = report.dossier?.coverage;
  const legacy = /^Some (?:official|independent|guided) search pages could not supply readable public text\.$/;
  if (!pages?.length || !notes.some(note => legacy.test(note))) return notes;
  const quoted = pages.filter(page => page.status === 'cited' || page.status === 'documented').length;
  const failed = pages.filter(page => page.status === 'unavailable').length;
  return [...notes.filter(note => !legacy.test(note)),
    'Across the saved investigation, ' + quoted + ' of ' + pages.length + ' checked pages supplied retained passages and ' +
    failed + ' could not be retrieved. The earlier search warnings did not record the failed URLs by search lane or the underlying errors.'];
}

export function pageAttempts(page) {
  const attempts = page.attempts?.length ? page.attempts : [{lane:page.origin, requestedUrl:page.url,
    outcome:page.status === 'unavailable' ? 'unavailable' : 'read', failure:page.failure}];
  return attempts.map(attempt => {
    let [reason,next] = attempt.outcome === 'unavailable' ? explainReadFailure(attempt.failure) : [];
    if (attempt.outcome === 'excluded_publisher') {
      reason = 'The page resolved to the product publisher and could not corroborate the claim independently.';
      next = 'Find a customer-authored deployment or third-party test.';
    } else if (attempt.outcome === 'read' && page.status === 'no_usable_passage') {
      reason = page.reason;
      next = 'Try a document naming the product edition and describing the task or purchasing condition.';
    }
    return {lane:laneNames[attempt.lane] || 'Search lane unrecorded', requestedUrl:attempt.requestedUrl,
      redirected:attempt.requestedUrl !== page.url, reason, next};
  });
}
