import { isEarlierReport } from './research.js'

export const columns = ['product', 'vendor', 'overall', 'green_flags', 'yellow_flags', 'red_flags', 'reasoning', 'reviewer_notes_original']
export const coverageLabels = { cited: 'Cited in the assessment', documented: 'Passage retained', no_usable_passage: 'No usable passage', unavailable: 'Could not retrieve text' }
export const findingLabels = { supported: 'Supported', partly_supported: 'Partly supported', contradicted: 'Contradicted', documented: 'Documented in source', unverified: 'Unverified' }

export function sourceAddress(value) {
  try {
    const url = new URL(value)
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url
  } catch {}
  return null
}

function observationText(item) {
  return [item.kind + ' · ' + (findingLabels[item.status] || item.status),
    item.finding !== item.quote && item.finding, '“' + item.quote + '”', item.reason, sourceAddress(item.url)?.href].filter(Boolean).join('\n')
}

export function operatorGap(report) {
  if (report.vendor || !report.dossier) return ''
  const product = report.productName || report.inputUrl
  const page = report.dossier.coverage?.find(item => item.origin === 'submitted' || item.url === report.inputUrl)
  if (page?.status === 'unavailable') return 'The submitted product page could not identify the operator because its text was unavailable.'
  return 'A passage identifying the responsible operator of ' + product + ' has yet to pass the evidence checks.'
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
  const earlier = isEarlierReport(report)
  const groups = earlier ? null : groupHighlights(report.checks)
  const sources = new Map(report.sources.map(source => [source.id, source.url]))
  const observations = report.dossier?.observations || []
  const pages = report.dossier?.coverage || []
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
        return 'The reviewer can verify this source statement. Evidence for a product benefit remains open.\n' + observationText(known)
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
    if (!labels.length) return subject + ' remain unverified. ' +
      (report.limitations?.[0] || report.interpretation || 'No criterion had enough validated evidence.')
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
  return {
    product: report.productName || report.inputUrl,
    vendor: report.vendor || (report.dossier ? ['Operator unverified.', operatorGap(report), sourceAddress(report.inputUrl)?.href].filter(Boolean).join('\n') : 'Unverified'),
    overall: labels[report.verdict] || 'Investigation incomplete',
    green_flags: flags('green'),
    yellow_flags: flags('yellow'),
    red_flags: flags('red'),
    reasoning: [withSources([...provenance, report.interpretation].filter(Boolean).join(' '), report.verdictEvidenceIds),
      ...(groups?.context ?? []).map(describe),
      ...observations.map(observationText),
      ...(report.testimony || []).map(t => withSources(['Customer testimony', t.text, t.explanation].filter(Boolean).join('\n'), t.evidenceIds)),
      report.dossier && (report.limitations || []).join('\n'),
      ...pages.map(page => [coverageLabels[page.status] || page.status, page.title, page.reason, sourceAddress(page.url)?.href].filter(Boolean).join('\n'))]
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
  const cell = value => value.replace(/[&<>|\\`*_\[\]~!]/g, ch => '&#' + ch.codePointAt(0) + ';')
    .replace(/\r\n?|\n/g, '<br>')
  const line = values => '| ' + values.join(' | ') + ' |\n'
  const table = line(columns) + line(columns.map(() => '---')) + line(columns.map(key => cell(row[key])))
  if (!report?.dossier) return table

  // Retrieved prose stays literal. Hyperlinks are composed only from checked HTTP(S) source addresses.
  const prose = value => cell(String(value || '').replace(/\s+/gu, ' ').trim()).replace(/[#]/g, '&#35;')
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
    appendix.push('- ' + [link(page.url, page.title), coverageLabels[page.status] || prose(page.status), prose(page.reason)].filter(Boolean).join(' · '))
  }
  if (report.limitations?.length) appendix.push('## Unknowns and limitations', report.limitations.map(s => '- ' + prose(s)).join('\n'))
  return table + '\n' + appendix.filter(Boolean).join('\n\n') + '\n'
}
