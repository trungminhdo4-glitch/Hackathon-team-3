import { isEarlierReport } from './research.js'
import { describeCapabilityGap } from '../shared/evidenceGap.js'
import { pageAttempts, reportLimitations, searchProviderLabel } from '../shared/retrieval.js'

export const columns = ['product', 'vendor', 'overall', 'green_flags', 'yellow_flags', 'red_flags', 'reasoning', 'reviewer_notes_original']
export const coverageLabels = { cited: 'Cited in the assessment', documented: 'Passage retained', no_usable_passage: 'No usable passage', unavailable: 'Could not retrieve text', excluded_publisher:'Publisher redirect excluded from independent evidence' }
export const findingLabels = { supported: 'Supported', partly_supported: 'Partly supported', contradicted: 'Contradicted', documented: 'Documented in source', unverified: 'Unverified' }

export function sourceAddress(value) {
  try {
    const url = new URL(value)
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url
  } catch {}
  return null
}

// Earlier activity logs recorded only a generic outcome. Explain it from the saved evidence.
export function savedGapDetail(report) {
  if (report.evidenceGap || isEarlierReport(report) || /placeholder or example domain/i.test(report.interpretation)) return null
  if (!report.review && report.verdict !== 'insufficient' && report.verdictBasis !== 'evidence_gap') return null
  if (!report.activity?.some(event => event.detail?.startsWith('Evidence review found an unresolved core claim.'))) return null
  if (report.review?.prompt && report.review.mode === 'sdk') {
    return {summary:'The researcher paused on this question about ' + (report.productName || report.inputUrl) + '.',
      missing:report.review.prompt}
  }
  return describeCapabilityGap(report)
}

function observationText(item) {
  return [item.kind + ' · ' + (findingLabels[item.status] || item.status),
    item.finding !== item.quote && item.finding, '“' + item.quote + '”', item.reason, sourceAddress(item.url)?.href].filter(Boolean).join('\n')
}

export function operatorGap(report) {
  if (report.vendor || (!report.dossier && (isEarlierReport(report) || !sourceAddress(report.inputUrl)))) return ''
  const product = report.productName || report.inputUrl
  if (!report.dossier) return 'The saved report includes no verified passage naming the operator of ' + product + '.'
  const page = report.dossier.coverage?.find(item => item.origin === 'submitted' || item.url === report.inputUrl)
  if (page?.status === 'unavailable') return 'The submitted product page could not identify the operator because its text was unavailable.'
  return 'A passage identifying the responsible operator of ' + product + ' has yet to pass the evidence checks.'
}

// Old reports retained activity and verdict citations even when they did not retain a source dossier.
function savedSourceTrail(report) {
  const pages = new Map()
  const submitted = sourceAddress(report.inputUrl)
  if (submitted) pages.set(submitted.href, 'Submitted product URL')
  for (const e of report.activity || []) {
    const url = sourceAddress(e.url)
    if (!url || !['retrieve','read','search'].includes(e.stage)) continue
    const detail = e.detail || ''
    if (/unavailable|unreadable|failed|timed out/i.test(detail)) pages.set(url.href, 'Retrieval did not provide readable text')
    else if (/retrieved readable|retrieved submitted|retrieved (?:public|source) text/i.test(detail)) pages.set(url.href, 'Readable page recorded in the activity log')
    else if (!pages.has(url.href)) pages.set(url.href, 'URL recorded in the research activity')
  }
  for (const source of report.sources || []) {
    const url = sourceAddress(source.url)
    if (url) pages.set(url.href, 'Cited in the saved report')
  }
  return [...pages].map(([url,label]) => label + '\n' + url)
}

export function groupHighlights(checks) {
  const groups = { green: [], yellow: [], red: [], context: [] }
  for (const check of checks) {
    if (!check.evidence?.length || check.status === 'unverified') continue
    if (Object.hasOwn(groups, check.flag)) groups[check.flag].push(check)
    else if (check.impact === 'disqualifying') groups.red.push(check)
    else if (check.impact === 'caveat') groups.yellow.push(check)
    else if (check.id === 'capability' && check.status === 'supported') groups.green.push(check)
    else groups.context.push(check)
  }
  return groups
}

export function datasetRow(report, notes = '', simulated = false) {
  const savedGap = savedGapDetail(report)
  const earlier = isEarlierReport(report)
  const groups = earlier ? null : groupHighlights(report.checks)
  const sources = new Map(report.sources.map(source => [source.id, source.url]))
  const observations = report.dossier?.observations || []
  const pages = report.dossier?.coverage || []
  const archive = !earlier && !report.dossier ? savedSourceTrail(report) : []
  function withSources(text, ids = []) {
    const urls = [...new Set(ids.map(id => sources.get(id)).filter(url => /^https?:\/\//i.test(url || '')))]
    return [text, ...urls].filter(Boolean).join('\n')
  }
  function describe(finding) {
    const lines = [...new Set([finding.claim, finding.explanation, finding.consequence].filter(Boolean))]
    const description = [finding.label, findingLabels[finding.status], lines.join(' ')].filter(Boolean).join(' · ')
    const quoted = (finding.evidence || []).filter(e => e.quote && sources.has(e.sourceId)).map(e =>
      [e.sourceType, e.attribution, '“' + e.quote + '”', sources.get(e.sourceId)].filter(Boolean).join('\n'))
    return quoted.length ? [description, ...quoted].join('\n') :
      withSources(description, finding.evidenceIds ?? finding.evidence?.map(e => e.sourceId))
  }
  function emptyFlag(kind) {
    if (earlier) return 'The original report recorded no ' + kind + ' flag.'
    if (report.dossier) {
      const known = observations.find(item => item.kind === 'Product page') || observations[0]
      if (kind === 'green' && known) {
        const gap = report.evidenceGap || savedGap
        return (gap ? gap.summary + ' ' + gap.missing : 'The reviewer can verify this source statement. Evidence for a product benefit remains open.') +
          '\n' + observationText(known)
      }
      if (kind === 'yellow' && report.verdictBasis === 'evidence_gap') return report.interpretation
      const read = pages.filter(page => page.status !== 'unavailable')
      const finding = {green:'a verified benefit', yellow:'a material caution', red:'a substantiated disqualifying risk'}[kind]
      if (!read.length) return 'No readable source established ' + finding + ' for ' + (report.productName || report.inputUrl) + '.'
      const page = read.find(page => page.url === report.inputUrl) || read[0]
      return [read.length + ' reviewed ' + (read.length === 1 ? 'page' : 'pages') + ' yielded no finding classified as ' + finding + '.',
        page.title, sourceAddress(page.url)?.href].filter(Boolean).join('\n')
    }
    const subject = { green: 'Strengths', yellow: 'Cautions', red: 'Disqualifying risks' }[kind]
    if (report.verdict == null) return subject + ' could not be assessed. ' + report.interpretation
    const labels = [...new Set(report.checks.filter(c => c.evidence?.length && c.status !== 'unverified').map(c => c.label))]
    if (!labels.length) {
      const product = report.productName || report.inputUrl || 'this product'
      if (kind === 'green') {
        const documented = report.answer?.evidence?.find(item => item.quote && sources.has(item.sourceId))
        if (documented) return withSources(product + ' · The saved answer cites this passage. No strength was established from it.\n“' + documented.quote + '”', [documented.sourceId])
        return [product + ' · No citation in the saved checks demonstrates the claimed benefit.',
          archive[0], 'Run the investigation again to collect and compare the source passages.'].filter(Boolean).join('\n')
      }
      if (kind === 'yellow') return product + ' · ' + (report.interpretation || 'The saved evidence leaves the core product claim unresolved.')
      return 'Disqualifying risks remain unverified for ' + product + '. The saved checks contain no cited contradiction. ' +
        (archive.length ? 'See the recorded source trail in reasoning.' : report.interpretation || '')
    }
    if (kind === 'green' && groups.context.length) {
      return 'No strength was classified. The report documented the following finding. ' + describe(groups.context[0])
    }
    const unknown = report.checks.find(c => c.status === 'unverified')
    if (kind === 'yellow' && unknown) return 'No material caveat was established. ' +
      unknown.label + ' remains open. ' + unknown.explanation
    const missing = { green: 'a product strength', yellow: 'a material caveat', red: 'a disqualifying risk' }
    return 'Evidence on ' + labels.join(', ').toLowerCase() + ' did not establish ' + missing[kind] + '.'
  }
  function flags(kind) {
    const items = earlier ? (report.flags || []).filter(f => f.kind === kind) : groups[kind]
    const entries = items.map(f => {
      return earlier ? withSources([f.text, f.explanation].filter(Boolean).join(' '),
        f.evidenceIds ?? f.evidence?.map(e => e.sourceId)) : describe(f)
    })
    return [...new Set(entries)].join('\n\n') || emptyFlag(kind)
  }
  const labels = { green: 'Green', yellow: 'Yellow', red: 'Red', insufficient: 'Insufficient evidence' }
  const provenance = [simulated && 'Simulated report.', earlier && 'Previous points-based rubric.',
    report.verdictBasis === 'evidence_gap' && 'Yellow reflects an unresolved evidence gap.'].filter(Boolean)
  const providers = [...new Set((report.activity || []).map(event => searchProviderLabel(event.provider)).filter(Boolean))]
  return {
    product: report.productName || report.inputUrl,
    vendor: report.vendor || (operatorGap(report) ? ['Operator unverified.', operatorGap(report), sourceAddress(report.inputUrl)?.href].filter(Boolean).join('\n') : 'Unverified'),
    overall: labels[report.verdict] || 'Investigation incomplete',
    green_flags: flags('green'),
    yellow_flags: flags('yellow'),
    red_flags: flags('red'),
    reasoning: [withSources([...provenance, report.interpretation].filter(Boolean).join(' '), report.verdictEvidenceIds),
      providers.length && 'Search providers recorded in activity · ' + providers.join(', '),
      savedGap && [savedGap.summary, savedGap.reason, savedGap.missing].filter(Boolean).join(' '),
      sourceAddress((report.evidenceGap || savedGap)?.sourceUrl)?.href,
      ...(groups?.context ?? []).map(describe),
      archive.length ? 'Saved source trail\n' + archive.join('\n\n') : '',
      ...observations.map(observationText),
      ...(report.testimony || []).map(t => withSources(['Customer testimony', t.text, t.explanation].filter(Boolean).join('\n'), t.evidenceIds)),
      report.dossier && reportLimitations(report).join('\n'),
      ...pages.map(page => [coverageLabels[page.status] || page.status, page.title, sourceAddress(page.url)?.href,
        ...pageAttempts(page).map(attempt => [attempt.lane, attempt.provider && 'Search provider · ' + attempt.provider, attempt.redirected && sourceAddress(attempt.requestedUrl)?.href,
          attempt.reason || page.reason, attempt.next && 'Next search · ' + attempt.next].filter(Boolean).join('\n'))].filter(Boolean).join('\n'))]
      .filter(Boolean).join('\n\n'),
    reviewer_notes_original: notes,
  }
}

export function csvReports(rows) {
  function quoteCell(value) {
    // Preserve literal text when a spreadsheet opens a cell beginning with a formula trigger.
    const safe = /^\s*[=+@-]|^[\t\r\n]/u.test(value) ? "'" + value : value
    return '"' + safe.replaceAll('"', '""') + '"'
  }
  return [columns.join(','), ...rows.map(row => columns.map(key => quoteCell(row[key])).join(','))].join('\r\n') + '\r\n'
}

export function csvReport(row) {
  return csvReports([row])
}

export function markdownReport(row, report) {
  // Escape Markdown and HTML from source passages and reviewer notes before inserting table line breaks.
  const cell = value => value.replace(/[&<>|\\`*_\[\]~!#]/g, ch => '&#' + ch.codePointAt(0) + ';')
    .replace(/\r\n?|\n/g, '<br>')
  const line = values => '| ' + values.join(' | ') + ' |\n'
  const table = line(columns) + line(columns.map(() => '---')) + line(columns.map(key => cell(row[key])))
  if (!report?.dossier) return table

  // Retrieved prose stays literal. Hyperlinks are composed only from checked HTTP(S) source addresses.
  const prose = value => cell(String(value || '').replace(/\s+/gu, ' ').trim())
  const link = (url, title) => {
    const address = sourceAddress(url)
    return address ? '[' + prose(title || address.hostname) + '](<' + address.href + '>)' : ''
  }
  const appendix = ['## ' + prose(row.product), '**' + prose(row.overall) + '** · ' + prose(report.interpretation)]
  const sources = new Map(report.sources.map(s => [s.id, s]))
  for (const finding of report.checks) {
    appendix.push('### ' + prose(finding.label) + ' · ' + (findingLabels[finding.status] || prose(finding.status)))
    appendix.push(...[...new Set([finding.claim, finding.explanation, finding.consequence].filter(Boolean))].map(prose))
    for (const e of finding.evidence || []) {
      const s = sources.get(e.sourceId)
      if (s && e.quote) appendix.push('> ' + prose(e.quote), link(s.url, s.title))
    }
  }
  if (report.dossier.observations?.length) appendix.push('## What the sources say')
  for (const item of report.dossier.observations || []) {
    appendix.push('### ' + prose(item.title || sourceAddress(item.url)?.hostname), prose(item.kind) + ' · ' + (findingLabels[item.status] || prose(item.status)))
    if (item.finding !== item.quote) appendix.push(prose(item.finding))
    appendix.push('> ' + prose(item.quote), prose(item.reason), link(item.url, item.title))
  }
  if (report.testimony?.length) appendix.push('## Customer testimony')
  for (const account of report.testimony || []) {
    appendix.push('> ' + prose(account.text), prose(account.explanation))
    for (const id of account.evidenceIds || []) {
      const s = sources.get(id)
      if (s) appendix.push(link(s.url, s.title))
    }
  }
  if (report.dossier.coverage?.length) appendix.push('## Pages checked')
  for (const page of report.dossier.coverage || []) {
    for (const attempt of pageAttempts(page)) {
      appendix.push('- ' + [link(page.url, page.title), attempt.lane, coverageLabels[page.status] || prose(page.status),
        attempt.provider && 'Search provider · ' + attempt.provider,
        attempt.redirected && link(attempt.requestedUrl, 'Original URL'), prose(attempt.reason || page.reason),
        attempt.next && 'Next search · ' + prose(attempt.next)].filter(Boolean).join(' · '))
    }
  }
  if (report.limitations?.length) appendix.push('## Unknowns and limitations', reportLimitations(report).map(s => '- ' + prose(s)).join('\n'))
  return table + '\n' + appendix.filter(Boolean).join('\n\n') + '\n'
}
