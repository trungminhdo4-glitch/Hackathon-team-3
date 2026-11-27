import React, { useState } from 'react'
import { laneNames } from '../shared/retrieval.js'

function publicLink(value) {
  try {
    const url = new URL(value)
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url
  } catch {}
  return null
}

export function ResearchActivity({events = [], running = false, savedGap}) {
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState(false)
  if (!running && !events.length) return null
  const latest = events.at(-1)
  const detail = event => savedGap && event.detail?.startsWith('Evidence review found an unresolved core claim.')
    ? [savedGap.summary, savedGap.reason, savedGap.missing].filter(Boolean).join(' ') : event.detail
  const actor = event => event.model || (event.role === 'human' ? 'Reviewer' : 'SaaSLens')
  const actors = Map.groupBy(events, actor)
  const selected = actors.has(filter) ? filter : ''
  const visible = selected ? actors.get(selected) : events
  return <div className="research-activity">
    {running && <p role="status">{latest?.model && <strong>{latest.model} · </strong>}{latest?.detail || 'Waiting for the research server…'}</p>}
    {events.length > 0 && <>
      <div className="activity-agents" role="group" aria-label="Contributions by participant">
        {[...actors].map(([name, items]) => <button key={name} type="button" className="actor-work"
          aria-label={'Show activity for ' + name} aria-pressed={selected === name}
          onClick={() => { setFilter(name); setOpen(true) }}>
          <strong>{name}</strong><small>{items.some(event => event.role === 'specialist') ? 'Search specialist' :
            name === 'SaaSLens' ? 'Research workflow' : name === 'Reviewer' ? 'Human input' : 'Research agent'}</small>
          <span>{detail(items.at(-1))}</span>
        </button>)}
      </div>
      <details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>Research activity <span>({events.length})</span></summary>
      {selected && <button className="reset-activity" type="button" onClick={() => setFilter('')}>Show all activity</button>}
      <ol aria-label={selected ? 'Activity for ' + selected : 'Activity timeline'}>{visible.map((event, i) => {
        const url = publicLink(event.url)
        return <li key={i}>
          <span className="step-stage">{laneNames[event.lane] || event.stage}</span>
          {event.model && <strong>{event.model} · </strong>}
          <span>{detail(event)} {url && <a href={url.href} target="_blank" rel="noopener noreferrer">{url.hostname}</a>}</span>
        </li>
      })}</ol>
    </details></>}
  </div>
}
