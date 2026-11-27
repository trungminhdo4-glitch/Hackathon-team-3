import React, { useEffect, useState } from 'react'
import { Icon } from './icons.jsx'
import { ResearchActivity } from './ResearchActivity.jsx'
import { sourceAddress, groupHighlights } from './datasetReport.js'
import { verdictLabel } from './research.js'
import { searchProviderLabel } from '../shared/retrieval.js'
import './briefing.css'

export function ProductHeading({name, subtitle, headingRef}) {
  const initials = (name || '').replace(/^https?:\/\/(www\.)?/i, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0,2).map(word => [...word][0]).join('').toUpperCase()
  return <div className="brief-product">
    <span className="brief-initials" aria-hidden="true">{initials || <Icon name="substance"/>}</span>
    <div><h2 id="report-title" tabIndex="-1" ref={headingRef}>{name}</h2>
      <p className="brief-caption">{subtitle}</p></div>
  </div>
}

export function numberedSources(report) {
  const sources = (report.sources || []).filter(source => sourceAddress(source.url)).map(source => ({...source}))
  const byUrl = new Set(sources.map(source => source.url))
  for (const observation of report.dossier?.observations || []) {
    if (!observation.quote || !sourceAddress(observation.url) || byUrl.has(observation.url)) continue
    sources.push({id:observation.sourceId || observation.url, url:observation.url, title:observation.title,
      contextOnly:true, quote:observation.quote})
    byUrl.add(observation.url)
  }
  return sources.map((source,i) => ({...source,number:i+1}))
}

export function CitationNumbers({ids = [], sources}) {
  return [...new Set(ids)].map(id => {
    const source = sources.get(id)
    return source && <a className="brief-citation" key={id} href={source.url} target="_blank" rel="noopener noreferrer"
      title={source.title} aria-label={'Source ' + source.number + ' · ' + (source.title || source.url)}>[{source.number}]</a>
  })
}

function recordedQueries(events) {
  const seen = new Set()
  return events.flatMap(event => {
    const match = /^(?:Searched for|Searching Tavily for) “(.+)”$/u.exec(event.detail || '')
    const siteMap = event.tool === 'map' && event.status === 'attempted' && sourceAddress(event.url)
    if (!match && !siteMap) return []
    const provider = searchProviderLabel(event.provider,event.tool)
    const text = siteMap ? 'Map documentation on ' + siteMap.hostname : match[1]
    const key = [provider,event.model,text].join(' ')
    if (seen.has(key)) return []
    seen.add(key)
    return [{key,provider,model:event.model,text}]
  })
}

function QueryList({queries}) {
  const item = query => <li key={query.key}><Icon name="search"/><div>{query.text}
    {(query.provider || query.model) && <small>{[query.provider,query.model].filter(Boolean).join(' · ')}</small>}</div></li>
  return queries.length > 0 && <div className="brief-queries"><ul>{queries.slice(0,2).map(item)}</ul>
    {queries.length > 2 && <details><summary>{queries.length - 2} more {queries.length === 3 ? 'search' : 'searches'}</summary>
      <ul>{queries.slice(2).map(item)}</ul></details>}</div>
}

function Progress({events, report, running, failed}) {
  const times = events.map(e => Date.parse(e.at)).filter(Number.isFinite)
  const started = times[0]
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!running || !started) return
    const timer = setInterval(() => setNow(Date.now()),1000)
    return () => clearInterval(timer)
  },[running, started])
  const elapsed = started && (running || times.length > 1) ? Math.max(0, Math.round(((running ? now : times.at(-1)) - started) / 1000)) : null
  const isSearch = e => ['search','read'].includes(e.stage) || (e.stage === 'retrieve' && (e.provider || e.status === 'read'))
  const isWriting = e => ['assess','validate','verdict','review'].includes(e.stage)
  const searched = events.some(isSearch)
  const latest = events.findLast(e => isSearch(e) || isWriting(e))
  const paused = Boolean(report?.review)
  const done = !!report?.verdict && !paused
  const interrupted = failed || (report && !paused && !done)
  const active = latest && isWriting(latest) ? 2 : searched ? 1 : 0
  const queries = recordedQueries(events)
  const issues = events.filter(e => ['search','retrieve','read'].includes(e.stage) && ['incomplete','unavailable'].includes(e.status))
  const phaseState = i => {
    if (i === 2 && paused) return 'paused'
    if (!events.length && report) return i === 2 && done ? 'complete' : 'unrecorded'
    if (i === 1 && !searched && (done || paused || active === 2)) return 'unrecorded'
    if (i < active) return 'complete'
    if (interrupted && i === active) return 'stopped'
    if (done) return 'complete'
    if (running && i === active) return 'active'
    return 'pending'
  }
  const steps = [
    ['Plan', 'Identify the product and its claims'],
    ['Search', 'Company sources and independent reporting'],
    ['Write', 'Assess findings and cite the evidence'],
  ]
  const labels = {complete:'Complete',active:'In progress',pending:'Pending',paused:'Awaiting input',stopped:'Interrupted',unrecorded:'Not recorded'}
  return <section className="brief-panel brief-progress" aria-label="Research stages">
    <div className="brief-panel-title"><h3>{running ? 'Researching' : paused ? 'Awaiting input' : interrupted ? 'Incomplete' : 'Done'}</h3>
      {elapsed !== null && <span title="Time from recorded activity">{elapsed}s</span>}</div>
    <ol>{steps.map(([title,description],i) => {
      const state = phaseState(i)
      return <li key={title} className={'brief-step ' + state}>
        <span className="brief-node" aria-hidden="true">{state === 'complete' ? <Icon name="check"/> : state === 'stopped' ? '!' : null}</span>
        <div><h4>{title}<span className="sr-only"> · {labels[state]}</span></h4>
          <p>{state === 'unrecorded' ? 'No activity recorded' : description}</p>
          {i === 1 && <QueryList queries={queries}/>}
          {i === 1 && issues.length > 0 && <details className="brief-issues"><summary>Retrieval issues ({issues.length})</summary>
            <ul>{issues.map((event,i) => <li key={i}>{event.detail}{sourceAddress(event.url) && <a href={event.url}
              target="_blank" rel="noopener noreferrer">{event.url}</a>}</li>)}</ul></details>}</div>
      </li>
    })}</ol>
  </section>
}

export function BriefingRail({report, events = [], running = false, failed = false, sources = []}) {
  const observed = report ? sources : [...new Set(events.filter(e =>
    (e.status === 'read' || /^Retrieved (?:readable |submitted page)/i.test(e.detail)) && sourceAddress(e.url)).map(e => e.url))]
    .map((url,i) => ({url,number:i+1}))
  return <aside className="brief-rail" aria-label="Research and sources">
    <Progress {...{events,report,running,failed}}/>
    <section className="brief-panel brief-sources" aria-label={report ? 'Briefing sources' : 'Pages read so far'}>
      <div className="brief-panel-title"><h3>{report ? 'Sources' : 'Pages read'}</h3><span>{observed.length}</span></div>
      {observed.length ? <ol>{observed.map(source => {
        const url = sourceAddress(source.url)
        const official = source.url === report?.inputUrl || report?.dossier?.coverage?.some(page => page.url === source.url && page.origin === 'submitted')
        const kind = report?.dossier?.observations?.find(item => item.url === source.url)?.kind
        return <li key={source.id || source.url}><span className="brief-counter">{source.number}</span>
          <div><a href={url.href} target="_blank" rel="noopener noreferrer">{source.title || url.hostname}<Icon name="external"/></a>
            <p><span>{url.hostname.replace(/^www\./,'')}</span>{(official || kind) && <small>{official ? 'Product site' : kind}</small>}
              {source.contextOnly && <small className="context-label">Context only</small>}</p></div></li>
      })}</ol> : <p className="brief-empty">{report ? 'No source passages were retained in this assessment.' : failed ? 'No readable sources were recorded.' : 'Public pages appear here as they are read.'}</p>}
    </section>
  </aside>
}

export function BriefingActions({report, sources, containerRef}) {
  const [message,setMessage] = useState('')
  const [fallback,setFallback] = useState('')
  async function copy() {
    const lookup = new Map(sources.map(s => [s.id,s.number]))
    const markers = ids => [...new Set(ids || [])].filter(id => lookup.has(id)).map(id => '[' + lookup.get(id) + ']').join(' ')
    const groups = Object.values(groupHighlights(report.checks || [])).flat()
    const text = [
      report.productName || report.inputUrl, verdictLabel(report), [report.interpretation,markers(report.verdictEvidenceIds)].filter(Boolean).join(' '),
      ...groups.map(item => [item.status === 'contradicted' ? 'Contradicted claim ·' :
        item.status === 'partly_supported' ? 'Partly supported claim ·' : '',item.claim,item.consequence,markers(item.evidenceIds)].filter(Boolean).join(' ')),
      ...(!sources.some(s => !s.contextOnly) ? sources.slice(0,2).map(s => '“' + s.quote + '” [' + s.number + ']') : []),
      ...sources.map(s => '[' + s.number + '] ' + (s.contextOnly ? 'Context only · ' : '') + (s.title || '') + ' ' + s.url),
    ].filter(Boolean).join('\n\n')
    try { await navigator.clipboard.writeText(text); setMessage('Briefing copied'); setFallback('') }
    catch { setMessage('Select and copy the briefing below.'); setFallback(text) }
  }
  function print() {
    const node = containerRef.current
    if (!node) return
    node.classList.add('brief-print')
    window.addEventListener('afterprint', () => node.classList.remove('brief-print'), {once:true})
    window.print()
  }
  return <div className="brief-actions"><div><button type="button" aria-label="Copy briefing" title="Copy briefing" onClick={copy}><Icon name="copy"/></button>
    <button type="button" aria-label="Print or save briefing as PDF" title="Print or save as PDF" onClick={print}><Icon name="download"/>PDF</button></div>
    {message && <small role="status">{message}</small>}
    {fallback && <textarea value={fallback} readOnly aria-label="Copyable briefing" onFocus={e => e.target.select()}/>}</div>
}

export function PendingBriefing({subject,events,running,failed}) {
  const name = sourceAddress(subject)?.hostname || subject || 'Product research'
  const latest = events.at(-1)
  return <div className="brief-grid brief-pending">
    <div className="brief-main"><ProductHeading name={name} subtitle={failed ? 'Investigation incomplete' : 'Research in progress'}/>
      <p className="brief-live-message" role="status">{latest?.model && <strong>{latest.model} · </strong>}{latest?.detail || (failed ? 'The investigation stopped before a briefing was available.' : 'Preparing the product investigation…')}</p>
      {running && <div className="brief-skeleton" aria-hidden="true"><i/><i/><i/><i/></div>}
      {events.length > 0 && <ResearchActivity events={events}/>}
    </div><BriefingRail {...{events,running,failed}}/>
  </div>
}
