import React from 'react'
import { isEarlierReport, verdictLabel } from './research.js'

const storageKey = 'saaslens.history.v1'

export function readHistory() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey))
    return Array.isArray(saved) ? saved.filter(entry => entry?.id && entry.report?.inputUrl &&
      Array.isArray(entry.report.checks) && Array.isArray(entry.report.sources) &&
      Array.isArray(entry.report.limitations)) : []
  } catch {
    return []
  }
}

export function saveHistory(entries) {
  // Keep the full list in memory when storage is unavailable. If the browser
  // runs out of session space, persist as many recent reports as fit.
  for (let count = entries.length; count > 0; count--) {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(entries.slice(0, count)))
      return
    } catch (error) {
      if (error.name !== 'QuotaExceededError') return
    }
  }
}

export function SessionHistory({ entries, current, busy, onOpen }) {
  return <details className="session-history">
    <summary>Session history <span>({entries.length})</span></summary>
    {entries.length === 0 ? <p>Completed reports will appear here for this tab.</p> :
      <ol>{entries.map(entry => <li key={entry.id}>
        <button type="button" aria-current={entry.id === current ? 'true' : undefined}
          disabled={busy} onClick={() => onOpen(entry)}>
          <span><strong>{entry.report.productName}</strong><small>{entry.report.inputUrl}</small>
            {entry.report.question && <small>{entry.report.question}</small>}</span>
          <span className="history-meta">{entry.scenario && 'Simulated · '}
            {isEarlierReport(entry.report)
              ? 'Previous rubric' + (typeof entry.report.score === 'number' ? ' · ' + entry.report.score + '/100' : '')
              : verdictLabel(entry.report)}
            <small>{entry.savedAt ? new Date(entry.savedAt).toLocaleString() : 'Earlier this session'}</small>
          </span>
        </button>
      </li>)}</ol>}
  </details>
}
