import React, { useEffect, useRef } from 'react'
import { Icon } from './icons.jsx'

const verdictLabels = {
  green: 'Credible based on available evidence',
  yellow: 'Not enough or mixed evidence',
  red: 'Material red flags found',
}

function Citation({source, quote, compact}) {
  if (!source) return null
  let url
  try { url = new URL(source.url) } catch { return null }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
  return <div className="citation">
    <a href={url.href} target="_blank" rel="noopener noreferrer">{source.title || url.hostname}<Icon name="external" /></a>
    {quote && (compact ? <details className="excerpt"><summary>Quoted passage</summary><blockquote>“{quote}”</blockquote></details> :
      <blockquote>“{quote}”</blockquote>)}
  </div>
}

function CitedFinding({finding, sources}) {
  return <div className="signal"><p>{finding.text}</p>
    {finding.evidence.map(({sourceId, quote}, i) =>
      <Citation compact key={sourceId + '-' + i} source={sources.get(sourceId)}
        quote={finding.text.includes(quote) ? null : quote}/>)}
  </div>
}

const flagLabels = { green: 'Strengths', yellow: 'Cautions', red: 'Red flags' }

export function Report({report, simulated, retry}) {
  const title = useRef(null)
  useEffect(() => { title.current?.focus() }, [report])
  const sources = new Map(report.sources.map(source => [source.id, source]))
  return <section className="report" aria-labelledby="report-title">
    <div className="report-top">
      <div>
        {simulated && <span className="section-label">Saved simulated report</span>}
        <h2 id="report-title" tabIndex="-1" ref={title}>{report.productName || 'Investigation result'}</h2>
        {report.vendor !== undefined && <p className="operator">Operator · {report.vendor || 'Unverified'}</p>}
        {report.vendor && report.vendorEvidence?.map(({sourceId, quote}, i) =>
          <Citation compact key={sourceId + '-' + i} source={sources.get(sourceId)} quote={quote}/>)}
        <span className="report-url">{report.inputUrl}</span>
      </div>
      {report.score !== null && <div className="score"><span className="section-label">Evidence score</span><strong>{report.score}<small> / 100</small></strong></div>}
    </div>
    <div className={'badge ' + (report.verdict || 'yellow')}><Icon name={report.verdict === 'green' ? 'check' : 'alert'} />{verdictLabels[report.verdict] || 'Investigation incomplete'}</div>
    <p className="interpretation">{report.interpretation}</p>
    {(report.question || report.answer) && <section className="answer"><h3>{report.question || 'Product overview'}</h3>
      {report.answer ? <CitedFinding finding={report.answer} sources={sources}/> :
        <p>The retrieved sources did not establish an answer to this question.</p>}
    </section>}
    {Array.isArray(report.flags) && <div className="signals">
      {Object.entries(flagLabels).map(([kind, label]) => {
        const flags = report.flags.filter(flag => flag.kind === kind)
        return flags.length > 0 && <section key={kind}>
          <h3><span className={'marker ' + kind} aria-hidden="true"/>{label}</h3>
          {flags.map((flag, i) => <CitedFinding key={i} finding={flag} sources={sources}/>)}
        </section>
      })}
      {report.flags.length === 0 && <p>No product-specific strengths, cautions, or red flags were verified in this search.</p>}
    </div>}
    <details className="evidence-details"><summary>Evidence and scoring</summary>
    {report.score !== null && <p className="score-note">Only confirmed checks earn points.</p>}
    {sources.size === 0 && <p>No source passages met the citation checks for this report.</p>}
    <div className="findings">
      {report.checks.map(check => <article className="finding" key={check.id}>
        <div className="finding-title"><Icon name={check.id} /><h3>{check.label}</h3><span className="points">{check.points} / {check.maxPoints}</span></div>
        <div className="finding-body"><span className={'status ' + check.status}>{check.status}</span><p>{check.summary}</p>
          {check.evidence.map(({sourceId,quote}, i) => <Citation key={sourceId + '-' + i} source={sources.get(sourceId)} quote={quote}/>)}
        </div>
      </article>)}
    </div>
    {report.limitations.length > 0 && <div className="unknowns"><h3>Unknowns and limitations</h3><ul>{report.limitations.map((item,i) => <li key={i}>{item}</li>)}</ul></div>}
    </details>
    {report.score === null && <button className="retry" onClick={retry}>Retry</button>}
  </section>
}
