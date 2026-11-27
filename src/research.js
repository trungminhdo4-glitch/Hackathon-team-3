const currentVerdicts = {
  green: 'Green · Core promise supported',
  yellow: 'Yellow · Material caveat',
  red: 'Red · Material risk',
  insufficient: 'Insufficient evidence',
}

const earlierVerdicts = {
  green: 'Credible based on available evidence',
  yellow: 'Not enough or mixed evidence',
  red: 'Material red flags found',
}

export function verdictLabel(report) {
  if (report.review) return 'Awaiting your input'
  if (report.verdict === 'yellow' && report.verdictBasis === 'evidence_gap') return 'Yellow · Evidence gap'
  const labels = isEarlierReport(report) ? earlierVerdicts : currentVerdicts
  return labels[report.verdict] || 'Investigation incomplete'
}

export function isEarlierReport(report) {
  return report.rubricVersion !== 2
}

export function requestAssessment(subject, question, model, onActivity) {
  return requestReport('/api/investigate', { subject, question: question || undefined, model, review: true }, onActivity)
}

export function respondToReview(id, action, guidance, onActivity) {
  return requestReport('/api/investigate/review', { id, action, guidance: action === 'research' ? guidance : undefined }, onActivity)
}

async function requestReport(path, input, onActivity) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson, application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(250_000),
  })
  if (response.ok && response.headers.get('content-type')?.includes('application/x-ndjson')) {
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    const activity = []
    let buffer = ''
    let report
    let failure
    function receive(line) {
      if (!line.trim()) return
      const message = JSON.parse(line)
      if (message.type === 'error') failure = message.error || 'The investigation could not finish.'
      if (message.type === 'activity' && typeof message.event?.detail === 'string') {
        activity.push(message.event)
        onActivity?.(message.event)
      }
      if (message.type === 'result') report = message.report
    }
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          receive(buffer)
          break
        }
        const lines = (buffer + value).split('\n')
        buffer = lines.pop()
        for (const line of lines) receive(line)
      }
    } catch (error) {
      await reader.cancel().catch(() => {})
      throw error
    } finally {
      reader.releaseLock()
    }
    if (failure) throw new Error(failure)
    if (!report) throw new Error('The connection ended before the report arrived. Retry the investigation.')
    return { ...report, activity: report.activity ?? activity }
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('The research server is unavailable. Try again in a moment.')
  }
  const report = await response.json()
  if (!response.ok) {
    const error = new Error(report.error || 'The investigation could not finish.')
    error.status = response.status
    throw error
  }
  return report
}
