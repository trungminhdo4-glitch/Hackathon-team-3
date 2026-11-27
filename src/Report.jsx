import React, { useEffect, useRef, useState } from 'react'
import { Icon } from './icons.jsx'
import { DatasetReport } from './DatasetReport.jsx'
import { ResearchActivity } from './ResearchActivity.jsx'
import { EvidenceDossier, ReviewBrief } from './EvidenceDossier.jsx'
import { groupHighlights, operatorGap, savedGapDetail } from './datasetReport.js'
import { isEarlierReport, verdictLabel } from './research.js'
import { reportLimitations } from '../shared/retrieval.js'

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

function Highlights({checks, sources}) {
  const groups = groupHighlights(checks)
  return Object.entries(groups).map(([kind, findings]) => findings.length > 0 && <section className="highlights"
    key={kind} aria-label={flagLabels[kind] || 'Other documented findings'}>
    <h3>{kind !== 'context' && <span className={'marker ' + kind} aria-hidden="true"/>}{flagLabels[kind] || 'Other documented findings'}</h3>
    <ul>{findings.map(finding => <li key={finding.anchor}>
      {finding.status === 'contradicted' && <strong className="dossier-contradiction">Contradicted claim · </strong>}
      <a href={'#' + finding.anchor}>{finding.claim || finding.consequence}</a>
      {finding.explanation !== finding.claim && <p className="finding-reason">{finding.explanation}</p>}
      <div className="citation-source">{(finding.evidenceIds || []).map(id => {
        const source = sources.get(id)
        const url = sourceUrl(source)
        return url && <a key={id} href={url.href} target="_blank" rel="noopener noreferrer">{source.title || url.hostname}</a>
      })}</div>
    </li>)}</ul>
  </section>)
}

function RubricFindings({checks, sources, observations = []}) {
  const criteria = Map.groupBy(checks, check => check.id)
  const covered = [...criteria.values()].filter(claims => claims.some(claim => claim.evidence?.length)).length
  return <section className="report-section" aria-labelledby="criteria-title">
    <h3 id="criteria-title" className="report-heading">Evaluation criteria</h3>
    <p className="coverage">Evidence coverage · {covered} of {criteria.size} criteria have cited passages.</p>
    <div className="findings">{[...criteria].map(([id, claims]) =>
      <article className="finding" key={id}>
        <h4>{claims[0].label}</h4>
        {claims.map(finding => <div className="claim-finding" key={finding.anchor} id={finding.anchor} tabIndex="-1">
          <span className={'status ' + finding.status}>{claimStatuses[finding.status]}</span>
          {finding.claim && <p className="claim">{finding.claim}</p>}
          {finding.explanation !== finding.claim && <p>{finding.explanation}</p>}
          {finding.consequence && <p className="consequence"><strong>What this means </strong>{finding.consequence}</p>}
          <Evidence items={finding.evidence} sources={sources}/>
        </div>)}
        {claims.every(claim => claim.status === 'unverified') && observations.some(item => item.criterion === id) &&
          <details className="criterion-context"><summary>Related source passages</summary>
            {observations.filter(item => item.criterion === id).map((item, i) => <div key={i}>
              <blockquote>{item.quote}</blockquote>
              <span>{item.kind} · </span>{sourceUrl(item) && <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title || sourceUrl(item).hostname}</a>}
            </div>)}
          </details>}
      </article>
    )}</div>
  </section>
}

function ReviewQuestion({report, expired, guidance, onGuidanceChange, onReview, retry}) {
  const {review} = report
  const end = new Date(review.expiresAt).getTime()
  const [timedOut, setTimedOut] = useState(() => end <= Date.now())
  useEffect(() => {
    if (!Number.isFinite(end)) return
    const timer = setTimeout(() => setTimedOut(true), Math.max(0, end - Date.now()))
    return () => clearTimeout(timer)
  }, [end])
  return <section className="review-question" aria-labelledby="review-heading">
    <h3 id="review-heading">{timedOut || expired ? 'Review expired' : 'Your input can guide the research'}</h3>
    {timedOut || expired ? <>
      <p>The saved findings are available below. Start a new investigation to continue researching this product.</p>
      <button className="retry" type="button" onClick={retry} disabled={!retry}>Restart investigation</button>
    </> : <>
      <p className="model-label">{review.mode === 'sdk' ? (report.searchModel || report.model) + ' requests your input' : 'Evidence check'}</p>
      <ReviewBrief brief={review.brief}/>
      <p>{review.prompt}</p>
      {review.brief?.request && review.brief.request !== review.prompt && <p>{review.brief.request}</p>}
      <label htmlFor="research-guidance">Research task or public source</label>
      <textarea id="research-guidance" rows={2} maxLength={1000} value={guidance}
        placeholder="Suggest a product edition, customer deployment or public guide to check."
        onChange={event => onGuidanceChange(event.target.value)}/>
      <div className="review-actions">
        <button className="submit" type="button" disabled={!guidance.trim()} onClick={() => onReview('research')}>Research my lead</button>
        <button className="retry" type="button" onClick={() => onReview('finalize')}>Finish with current evidence</button>
      </div>
    </>}
  </section>
}

export function Report({report, simulated, retry, notes, onNotesChange, onReview, guidance, onGuidanceChange, expired}) {
  const limitations = reportLimitations(report)
  const title = useRef(null)
  useEffect(() => { title.current?.focus() }, [report])
  const sources = new Map(report.sources.map(source => [source.id, source]))
  const verdictSources = (report.verdictEvidenceIds ?? []).map(id => sources.get(id)).filter(sourceUrl)
  const historical = isEarlierReport(report)
  const savedGap = savedGapDetail(report)
  const gap = report.evidenceGap || savedGap
  const gapSource = sourceUrl({url:gap?.sourceUrl})
  const findings = historical ? [] : report.checks.map((check, i) => ({ ...check, anchor: 'finding-' + (i + 1) }))
  const answer = report.answer ? <CitedFinding finding={report.answer} sources={sources}/> :
    <p>The retrieved sources did not establish an answer to this question.</p>
  return <section className="report" aria-labelledby="report-title">
    <div className="report-top">
      <div>
        {simulated && <span className="section-label">Saved simulated report</span>}
        <h2 id="report-title" tabIndex="-1" ref={title}>{report.productName || 'Investigation result'}</h2>
        {report.vendor !== undefined && <p className="operator">Operator · {report.vendor || 'Unverified'}</p>}
        {operatorGap(report) && <p className="model-label">{operatorGap(report)}</p>}
        <span className="report-url">{report.inputUrl}</span>
        {!simulated && <p className="model-label">Assessment model · {report.model || 'Not recorded'}</p>}
        {!simulated && report.searchModel && report.searchModel !== report.model &&
          <p className="model-label">OpenAI web search · {report.searchModel}</p>}
        {!simulated && report.helperModel && <p className="model-label">Follow-up search · {report.helperModel}</p>}
        {report.vendor && report.vendorEvidence?.length > 0 && <details className="operator-source">
          <summary>Operator source</summary><Evidence items={report.vendorEvidence} sources={sources}/>
        </details>}
      </div>
      {historical && typeof report.score === 'number' && <div className="score"><span className="section-label">Previous rubric score</span><strong>{report.score}<small> / 100</small></strong></div>}
    </div>
    {report.review ? <ReviewQuestion {...{report, expired, guidance, onGuidanceChange, onReview, retry}}/> : <>
      {!historical && <h3 className="overall-verdict report-heading">Overall verdict</h3>}
      <div className={'badge ' + (report.verdict || 'insufficient')}><Icon name={report.verdict === 'green' ? 'check' : 'alert'}/>{verdictLabel(report)}</div>
    </>}
    <p className="interpretation" id="verdict-reason">{report.interpretation}</p>
    {savedGap && <p><strong>What the evidence could not verify</strong><br/>
      {[savedGap.summary, savedGap.reason, savedGap.missing].filter(Boolean).join(' ')}</p>}
    {gapSource && <p className="citation-source">Passage behind the open question · <a href={gapSource.href}
      target="_blank" rel="noopener noreferrer">{gap.sourceTitle || gapSource.hostname}<Icon name="external"/></a></p>}
    {!historical && !report.review && !report.dossier && !report.checks.some(c => c.status !== 'unverified' && c.evidence?.length) &&
      <p className="coverage">This saved assessment predates the source dossier. Start a new investigation to collect passages for {report.productName || 'this product'}.</p>}
    {verdictSources.length > 0 && <div className="verdict-sources citation-source">
      <strong>{report.review ? 'Sources checked so far' : 'Verdict sources'}</strong>
      {verdictSources.map(source => <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">
        {source.title || sourceUrl(source).hostname}<Icon name="external"/>
      </a>)}
    </div>}
    {report.reviewOutcome?.guidance && <p className="human-guidance"><strong>Your research lead</strong> {report.reviewOutcome.guidance}</p>}
    {!report.review && <DatasetReport report={report} notes={notes} onNotesChange={onNotesChange} simulated={simulated}/>}
    <ResearchActivity events={report.activity} savedGap={savedGap}/>
    <EvidenceDossier dossier={report.dossier} interpretation={report.interpretation}/>
    {!historical && <Highlights checks={findings} sources={sources}/>}
    {historical && <div className="historical-notice"><p>This saved report used the previous points-based rubric.</p>
      <button type="button" className="retry" disabled={!retry} onClick={retry}>Evaluate with current rubric</button></div>}
    {historical && (report.question || report.answer) && <section className="answer"><h3>{report.question || 'Product overview'}</h3>
      {answer}
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
      findings.length > 0 && <RubricFindings checks={findings} sources={sources} observations={report.dossier?.observations}/>}
    <CustomerTestimony accounts={report.testimony} sources={sources}/>
    {!historical && report.question && <section className="answer" aria-labelledby="question-title">
      <h3 id="question-title">Your product question</h3><p className="question-text">{report.question}</p>
      {answer}
    </section>}
    {limitations.length > 0 && <details className="unknowns">
      <summary>Unknowns and limitations ({limitations.length})</summary>
      <ul>{limitations.map((item,i) => <li key={i}>{item}</li>)}</ul>
      {!!report.dossier?.coverage?.length && <a href="#retrieval-log" onClick={event => {
        const log = event.currentTarget.closest('.report')?.querySelector('.source-coverage')
        if (log) log.open = true
      }}>See the URLs checked, passages found and next search suggestions</a>}</details>}
    {!historical && !report.review && report.verdict === null && <button className="retry" disabled={!retry} onClick={retry}>Retry</button>}
  </section>
}
