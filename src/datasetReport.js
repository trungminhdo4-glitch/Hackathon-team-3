import { isEarlierReport } from './research.js'

export const columns = ['product', 'vendor', 'overall', 'green_flags', 'yellow_flags', 'red_flags', 'reasoning', 'reviewer_notes_original']

export function groupHighlights(checks) {
  const supportedCapabilities = checks.filter(c => c.id === 'capability' && c.status === 'supported' &&
    c.impact === 'routine' && c.evidence.length)
  const coreEvidence = supportedCapabilities.flatMap(c => c.evidence)
  const groups = { green: [], yellow: [], red: [] }
  for (const check of checks) {
    if (!check.evidence.length || check.status === 'unverified') continue
    if (check.impact === 'disqualifying') groups.red.push(check)
    else if (check.impact === 'caveat') groups.yellow.push(check)
    else if (supportedCapabilities.includes(check)) groups.green.push(check)
    else if (check.id === 'experience' && check.status === 'supported') {
      const corroboratesUse = check.evidence.some(account => coreEvidence.some(e =>
        e.sourceId === account.sourceId && e.quote === account.quote))
      if (corroboratesUse) groups.green.push(check)
    }
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
  function flags(kind) {
    if (earlier && !Array.isArray(report.flags)) return 'Not recorded.'
    const items = earlier ? report.flags.filter(f => f.kind === kind) : groups[kind]
    const entries = items.map(f => {
      const description = earlier ? f.text : kind === 'green' ? f.claim : f.explanation || f.consequence
      const ids = f.evidenceIds ?? f.evidence?.map(e => e.sourceId)
      return withSources(description, ids)
    })
    return [...new Set(entries)].join('\n\n') || 'None identified.'
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
    reasoning: withSources([...provenance, report.interpretation].filter(Boolean).join(' '), report.verdictEvidenceIds),
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
