import React from 'react'
import { coverageLabels, findingLabels, sourceAddress } from './datasetReport.js'
import './evidenceDossier.css'

function SourceLink({url, title}) {
  const address = sourceAddress(url)
  return address ? <a href={address.href} target="_blank" rel="noopener noreferrer">{title || address.hostname}</a> : title
}

export function EvidenceDossier({dossier, interpretation}) {
  if (!dossier) return null
  const observations = dossier.observations || []
  const coverage = dossier.coverage || []
  if (!observations.length && !coverage.length) return null
  const bySource = Map.groupBy(observations, item => item.url)
  return <section className="report-section dossier" aria-labelledby="source-findings">
    <h3 className="report-heading" id="source-findings">What the sources say</h3>
    {observations.length > 0 && <p className="coverage">{observations.length} source observations across {bySource.size} {bySource.size === 1 ? 'page' : 'pages'}.</p>}
    {[...bySource].map(([url, findings], index) => <details key={url} className="dossier-source" open={index === 0}>
      <summary>{findings[0].title || sourceAddress(url)?.hostname || 'Source'} <small>({findings.length})</small></summary>
      <div className="dossier-records">{findings.map((item, i) => <article className="dossier-record" key={i}>
        <div className="dossier-meta"><span>{item.kind}</span><span className={item.status === 'contradicted' ? 'dossier-contradiction' : undefined}>{findingLabels[item.status] || item.status}</span></div>
        {item.finding !== item.quote && <p className="claim">{item.finding}</p>}
        <blockquote>{item.quote}</blockquote>
        {item.reason && <p>{item.reason === interpretation ? <a href="#verdict-reason">See how this passage determined the verdict</a> : item.reason}</p>}
        <SourceLink url={item.url}/>
      </article>)}</div>
    </details>)}
    {coverage.length > 0 && <details className="source-coverage">
      <summary>Pages checked ({coverage.length})</summary>
      <ul>{coverage.map((page, i) => <li key={i}>
        <SourceLink url={page.url} title={page.title}/>
        <strong>{coverageLabels[page.status] || page.status}</strong>
        {page.reason && <span>{page.reason}</span>}
      </li>)}</ul>
    </details>}
  </section>
}

export function ReviewBrief({brief}) {
  if (!brief) return null
  const details = [['known','Evidence so far'], ['obstacle','What is unresolved'],
    ['green','What would support Green'], ['yellow','What warrants Yellow'], ['red','What would support Red']]
  return <div className="review-brief"><dl>{details.filter(([key]) => brief[key]).map(([key, label]) =>
    <div key={key}><dt>{label}</dt><dd>{brief[key]} {key === 'known' && brief.knownUrl &&
      <SourceLink url={brief.knownUrl} title={brief.knownTitle}/>}</dd></div>
  )}</dl></div>
}
