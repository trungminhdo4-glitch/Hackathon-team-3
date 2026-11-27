import { isEarlierReport } from './research.js'

export const columns = ['product', 'vendor', 'overall', 'green_flags', 'yellow_flags', 'red_flags', 'reasoning', 'reviewer_notes_original']

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
  function withSources(text, ids = []) {
    const urls = [...new Set(ids.map(id => sources.get(id)).filter(url => /^https?:\/\//i.test(url || '')))]
    return [text, ...urls].filter(Boolean).join('\n')
  }
  function describe(finding) {
    const lines = [...new Set([finding.claim, finding.explanation, finding.consequence].filter(Boolean))]
    return withSources(lines.join(' '), finding.evidenceIds ?? finding.evidence?.map(e => e.sourceId))
  }
  function emptyFlag(kind) {
    if (earlier) return 'The original report recorded no ' + kind + ' flag.'
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
  const provenance = [simulated && 'Simulated report.', earlier && 'Previous points-based rubric.'].filter(Boolean)
  return {
    product: report.productName || report.inputUrl,
    vendor: report.vendor || 'Unverified',
    overall: labels[report.verdict] || 'Investigation incomplete',
    green_flags: flags('green'),
    yellow_flags: flags('yellow'),
    red_flags: flags('red'),
    reasoning: [withSources([...provenance, report.interpretation].filter(Boolean).join(' '), report.verdictEvidenceIds),
      ...(groups?.context ?? []).map(finding => finding.label + ' · ' + describe(finding))].filter(Boolean).join('\n\n'),
    reviewer_notes_original: notes,
  }
}

export function csvReport(row) {
  function quoteCell(value) {
    // Preserve literal text when a spreadsheet opens a cell beginning with a formula trigger.
    const safe = /^\s*[=+@-]|^[\t\r\n]/u.test(value) ? "'" + value : value
    return '"' + safe.replaceAll('"', '""') + '"'
  }
  return columns.join(',') + '\r\n' + columns.map(key => quoteCell(row[key])).join(',') + '\r\n'
}

export function markdownReport(row) {
  // Escape Markdown and HTML from source passages and reviewer notes before inserting table line breaks.
  const cell = value => value.replace(/[&<>|\\`*_\[\]~!]/g, ch => '&#' + ch.codePointAt(0) + ';')
    .replace(/\r\n?|\n/g, '<br>')
  const line = values => '| ' + values.join(' | ') + ' |\n'
  return line(columns) + line(columns.map(() => '---')) + line(columns.map(key => cell(row[key])))
}
