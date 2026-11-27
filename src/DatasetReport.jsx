import React, { useState } from 'react'
import { columns, csvReport, datasetRow, markdownReport } from './datasetReport.js'

function download(row, format) {
  const csv = format === 'csv'
  const contents = csv ? '\uFEFF' + csvReport(row) : markdownReport(row)
  const blob = new Blob([contents], { type: (csv ? 'text/csv' : 'text/markdown') + ';charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const name = row.product.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80)
  link.href = href
  link.download = 'SaaSLens-' + (name || 'report') + '.' + format
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

export function DatasetReport({report, notes, onNotesChange, simulated}) {
  const [expanded, setExpanded] = useState(false)
  const [showMarkdown, setShowMarkdown] = useState(false)
  const row = datasetRow(report, notes, simulated)
  return <details className="dataset-report" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>View or download dataset report</summary>
    {expanded && <><div className="dataset-actions">
      <button type="button" className="retry" onClick={() => download(row, 'csv')}>Download CSV</button>
      <button type="button" className="retry" onClick={() => download(row, 'md')}>Download Markdown</button>
      <button type="button" className="dataset-toggle" aria-pressed={showMarkdown}
        onClick={() => setShowMarkdown(!showMarkdown)}>Markdown source</button>
    </div>
    {showMarkdown ? <pre className="dataset-markdown" aria-label="Markdown source" tabIndex="0">{markdownReport(row)}</pre> :
      <div className="dataset-scroll" role="region" aria-label="Dataset table" tabIndex="0">
        <table><caption className="sr-only">Dataset report for {row.product}</caption>
          <thead><tr>{columns.map(key => <th key={key} scope="col">{key}</th>)}</tr></thead>
          <tbody><tr>{columns.map(key => <td key={key}>{row[key]}</td>)}</tr></tbody>
        </table>
      </div>}
    <label htmlFor="reviewer-notes">Original reviewer notes <span>Optional · saved in this tab</span></label>
    <textarea id="reviewer-notes" value={notes} rows={2} onChange={event => onNotesChange(event.target.value)}/></>}
  </details>
}
