import React from 'react'

function publicLink(value) {
  try {
    const url = new URL(value)
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url
  } catch {}
  return null
}

export function ResearchActivity({events = [], running = false}) {
  if (!running && !events.length) return null
  const latest = events.at(-1)
  return <div className="research-activity">
    {running && <p role="status">{latest?.model && <strong>{latest.model} · </strong>}{latest?.detail || 'Waiting for the research server…'}</p>}
    {events.length > 0 && <details>
      <summary>Research activity <span>({events.length})</span></summary>
      <ol>{events.map((event, i) => {
        const url = publicLink(event.url)
        return <li key={i}>
          <span className="step-stage">{event.stage}</span>
          {event.model && <strong>{event.model} · </strong>}
          <span>{event.detail} {url && <a href={url.href} target="_blank" rel="noopener noreferrer">{url.hostname}</a>}</span>
        </li>
      })}</ol>
    </details>}
  </div>
}
