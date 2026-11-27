import React, { useEffect, useRef } from 'react'
import { Icon } from './icons.jsx'
import { isEarlierReport, verdictLabel } from './research.js'

const claimStatuses = {
  supported: 'Supported',
  partly_supported: 'Partly supported',
  contradicted: 'Contradicted',
  unverified: 'Unverified',
}
const flagLabels = { green: 'Strengths', yellow: 'Cautions', red: 'Red flags' }

function sourceUrl(source) {
  try {
    const url = new URL(source?.url)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : null
  } catch { return null }
}

function Citation({source, item, shownText = '', explanation = ''}) {
  const url = sourceUrl(source)
  if (!url) return null
  const attribution = item.attribution || url.hostname
  return <div className="citation">
    <div className="citation-source">
      {item.sourceType && <span className="source-role">{item.sourceType}</span>}
      <span>{attribution}</span>
      <a href={url.href} target="_blank" rel="noopener noreferrer">
        {source.title || url.hostname}<Icon name="external"/>
      </a>
    </div>
    {item.quote && !shownText.includes(item.quote) && <blockquote>“{item.quote}”</blockquote>}
    {item.weight && !explanation.includes(item.weight) && <p className="evidence-weight">{item.weight}</p>}
  </div>
}

function Evidence({items = [], sources, shownText, explanation}) {
  return items.map((item, i) => <Citation key={item.sourceId + '-' + i}
    source={sources.get(item.sourceId)} item={item} shownText={shownText} explanation={explanation}/>)
}

function CitedFinding({finding, sources}) {
  return <div className="signal">
    {finding.topic && <strong className="signal-topic">{finding.topic}</strong>}
    <p>{finding.text}</p>
    {finding.explanation && <p className="finding-reason">{finding.explanation}</p>}
    <Evidence items={finding.evidence} sources={sources} shownText={finding.text}/>
  </div>
}

function CustomerTestimony({accounts, sources}) {
  return <section className="testimony report-section" aria-labelledby="testimony-title">
    <h3 id="testimony-title" className="report-heading">Customer reviews and testimony</h3>
    {accounts?.length ? accounts.map((account, i) => <figure key={i}>
      <blockquote>“{account.text}”</blockquote>
      <figcaption>
        <Evidence items={account.evidence} sources={sources} shownText={account.text} explanation={account.explanation}/>
        {account.explanation && <p className="finding-reason">{account.explanation}</p>}
      </figcaption>
    </figure>) : <p className="empty-evidence">{Array.isArray(accounts)
      ? 'No first-hand customer account met the evidence checks for this report.'
      : 'This saved report did not record a separate customer-review assessment.'}</p>}
  </section>
}

function EarlierBreakdown({report, sources}) {
  return <section className="report-section" aria-labelledby="breakdown-title">
    <h3 id="breakdown-title" className="report-heading">Original score breakdown</h3>
    <div className="findings">{report.checks.map(check => <article className="finding" key={check.id}>
      <div className="finding-title"><Icon name={check.id}/><h4>{check.label}</h4>
        {report.score !== null && <span className="points" aria-label={check.points + ' of ' + check.maxPoints + ' points'}>{check.points} / {check.maxPoints}</span>}
      </div>
      <div className="finding-body">
        <span className={'status ' + check.status}>{check.status}</span>
        <p>{check.explanation || check.summary}</p>
        <Evidence items={check.evidence} sources={sources} shownText={check.explanation || check.summary}/>
        {check.diagnostics?.length > 0 && <ul className="diagnostics">
          {check.diagnostics.map((reason, i) => <li key={i}>{reason}</li>)}
        </ul>}
      </div>
    </article>)}</div>
  </section>
}

function RubricFindings({checks, sources}) {
  const criteria = Map.groupBy(checks, check => check.id)
  const covered = [...criteria.values()].filter(claims => claims.some(claim => claim.evidence?.length)).length
  return <section className="report-section" aria-labelledby="criteria-title">
    <h3 id="criteria-title" className="report-heading">Evaluation criteria</h3>
    <p className="coverage">Evidence coverage · {covered} of {criteria.size} criteria have cited passages.</p>
    <div className="findings">{[...criteria].map(([id, claims]) =>
      <article className="finding" key={id}>
        <h4>{claims[0].label}</h4>
        {claims.map((finding, i) => <div className="claim-finding" key={i}>
          <span className={'status ' + finding.status}>{claimStatuses[finding.status]}</span>
          {finding.claim && <p className="claim">{finding.claim}</p>}
          {finding.explanation !== finding.claim && <p>{finding.explanation}</p>}
          {finding.consequence && <p className="consequence"><strong>What this means </strong>{finding.consequence}</p>}
          <Evidence items={finding.evidence} sources={sources}/>
        </div>)}
      </article>
    )}</div>
  </section>
}

export function Report({report, simulated, retry}) {
  const title = useRef(null)
  useEffect(() => { title.current?.focus() }, [report])
  const sources = new Map(report.sources.map(source => [source.id, source]))
  const verdictSources = (report.verdictEvidenceIds ?? []).map(id => sources.get(id)).filter(sourceUrl)
  const historical = isEarlierReport(report)
  return <section className="report" aria-labelledby="report-title">
    <div className="report-top">
      <div>
        {simulated && <span className="section-label">Saved simulated report</span>}
        <h2 id="report-title" tabIndex="-1" ref={title}>{report.productName || 'Investigation result'}</h2>
        {report.vendor !== undefined && <p className="operator">Operator · {report.vendor || 'Unverified'}</p>}
        <span className="report-url">{report.inputUrl}</span>
        {report.vendor && report.vendorEvidence?.length > 0 && <details className="operator-source">
          <summary>Operator source</summary><Evidence items={report.vendorEvidence} sources={sources}/>
        </details>}
      </div>
      {historical && typeof report.score === 'number' && <div className="score"><span className="section-label">Previous rubric score</span><strong>{report.score}<small> / 100</small></strong></div>}
    </div>
    <div className={'badge ' + (report.verdict || 'insufficient')}><Icon name={report.verdict === 'green' ? 'check' : 'alert'}/>{verdictLabel(report)}</div>
    <p className="interpretation">{report.interpretation}</p>
    {verdictSources.length > 0 && <div className="verdict-sources citation-source">
      <strong>Verdict sources</strong>
      {verdictSources.map(source => <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">
        {source.title || sourceUrl(source).hostname}<Icon name="external"/>
      </a>)}
    </div>}
    {historical && <div className="historical-notice"><p>This saved report used the previous points-based rubric.</p>
      <button type="button" className="retry" onClick={retry}>Evaluate with current rubric</button></div>}
    {(report.question || report.answer) && <section className="answer"><h3>{report.question || 'Product overview'}</h3>
      {report.answer ? <CitedFinding finding={report.answer} sources={sources}/> :
        <p>The retrieved sources did not establish an answer to this question.</p>}
    </section>}
    {historical && report.flags?.length > 0 && <div className="signals">
      {Object.entries(flagLabels).map(([kind, label]) => {
        const flags = report.flags.filter(flag => flag.kind === kind)
        return flags.length > 0 && <section key={kind}>
          <h3><span className={'marker ' + kind} aria-hidden="true"/>{label}</h3>
          {flags.map((flag, i) => <CitedFinding key={i} finding={flag} sources={sources}/>)}
        </section>
      })}
    </div>}
    {historical ? <EarlierBreakdown report={report} sources={sources}/> :
      report.checks.length > 0 && <RubricFindings checks={report.checks} sources={sources}/>}
    <CustomerTestimony accounts={report.testimony} sources={sources}/>
    {report.limitations.length > 0 && <details className="unknowns">
      <summary>Unknowns and limitations ({report.limitations.length})</summary>
      <ul>{report.limitations.map((item,i) => <li key={i}>{item}</li>)}</ul></details>}
    {!historical && report.verdict === null && <button className="retry" onClick={retry}>Retry</button>}
  </section>
}
