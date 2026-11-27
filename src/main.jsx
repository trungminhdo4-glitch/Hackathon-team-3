import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/spectral/latin-600.css'
import '@fontsource/spectral/latin-700.css'
import { Brand, Icon } from './icons.jsx'
import { Report } from './Report.jsx'
import { BulkResearch } from './BulkResearch.jsx'
import { PendingBriefing } from './Briefing.jsx'
import { requestAssessment, respondToReview } from './research.js'
import { readHistory, saveHistory, SessionHistory } from './SessionHistory.jsx'
import './style.css'

const viewTitles = { single: 'Research a product.', bulk: 'Research a list of products.', history: 'Session history' }

function Workspace() {
  const [mode, setMode] = useState(() => {
    try {
      const saved = sessionStorage.getItem('saaslens.view')
      return ['bulk', 'history'].includes(saved) ? saved : 'single'
    } catch { return 'single' }
  })
  function chooseMode(value) {
    setMode(value)
    try { sessionStorage.setItem('saaslens.view', value) } catch { /* Keep the selection in memory. */ }
  }
  const [entries, setEntries] = useState(readHistory)
  const [active, setActive] = useState(entries[0] ?? null)
  const [subject, setSubject] = useState(active?.report.subject ?? active?.report.inputUrl ?? '')
  const [question, setQuestion] = useState(active?.report.question ?? '')
  const [busy, setBusy] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [activity, setActivity] = useState([])
  const [error, setError] = useState('')
  const [catalog, setCatalog] = useState(null)
  const [catalogError, setCatalogError] = useState(false)
  const [catalogAttempt, setCatalogAttempt] = useState(0)
  const [model, setModel] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/model', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) })
      .then(async response => {
        if (!response.ok) throw new Error()
        const data = await response.json()
        if (!Array.isArray(data.models)) throw new Error()
        if (controller.signal.aborted) return
        const models = data.models.filter(option => ['OpenAI', 'Meta'].includes(option.provider))
        const available = models.filter(option => option.available)
        setCatalog({ models, inventory: data.openAIInventory, defaultId: data.model, tavilyConfigured: data.tavilyConfigured === true })
        setModel(previous => available.find(option => option.id === previous)?.id ||
          available.find(option => option.id === data.model)?.id || available[0]?.id || '')
      })
      .catch(() => { if (!controller.signal.aborted) setCatalogError(true) })
    return () => controller.abort()
  }, [catalogAttempt])

  const selected = catalog?.models.find(option => option.id === model && option.available)
  const canInvestigate = !busy && !!subject.trim() && !!selected

  function reloadModels() {
    setCatalog(null)
    setCatalogError(false)
    setCatalogAttempt(attempt => attempt + 1)
  }

  function openReport(entry) {
    setSubject(entry.report.subject ?? entry.report.inputUrl)
    setQuestion(entry.report.question ?? '')
    setActive(entry)
    setError('')
    chooseMode('single')
  }

  function updateActive(changes) {
    const updatedEntry = { ...active, ...changes }
    const updated = entries.map(entry => entry.id === active.id ? updatedEntry : entry)
    saveHistory(updated)
    setEntries(updated)
    setActive(updatedEntry)
  }

  async function review(action) {
    if (busy || !active?.report.review) return
    const guidance = (active.guidance || '').trim()
    if (action === 'research' && !guidance) return
    setError('')
    setBusy(true)
    setActivity(active.report.activity || [])
    try {
      const report = await respondToReview(active.report.review.id, action, guidance,
        event => setActivity(previous => [...previous, event]))
      updateActive({ report, savedAt: Date.now(), guidance: undefined, expired: undefined })
    } catch (cause) {
      if (cause.status === 410) updateActive({ expired: true })
      setError(cause.name === 'TimeoutError' ? 'The review request timed out. Reopen this review to check its status.' : cause.message)
    } finally { setBusy(false) }
  }

  async function investigate(event) {
    event.preventDefault()
    if (!canInvestigate) return
    setError('')
    setActive(null)
    setBusy(true)
    setActivity([])
    try {
      const report = await requestAssessment(subject.trim(), question.trim(), model,
        event => setActivity(previous => [...previous, event]))
      const entry = { id: crypto.randomUUID(), savedAt: Date.now(), report }
      const updated = [entry, ...entries]
      saveHistory(updated)
      setEntries(updated)
      setActive(entry)
    } catch (cause) {
      setError(cause.name === 'TimeoutError' ? 'The investigation timed out. Retry to start a new search.' : cause.message)
    } finally { setBusy(false) }
  }

  const modelPicker = <div className="field model-field">
    <label htmlFor="model">Assessment model</label>
    <select id="model" name="model" disabled={busy || bulkBusy || !selected} value={selected?.id || ''} aria-describedby="model-details"
      onChange={event => { setModel(event.target.value); setError('') }}>
      {!selected && <option value="">{catalogError || catalog ? 'No models available' : 'Loading models…'}</option>}
      {['OpenAI', 'Meta'].map(provider => {
        const options = catalog?.models.filter(option => option.provider === provider) || []
        return options.length > 0 && <optgroup key={provider} label={provider}>{options.map(option =>
          <option key={option.id} value={option.id} disabled={!option.available}>
            {option.label}{!option.available && ' (unavailable)'}
          </option>)}</optgroup>
      })}
    </select>
    <div id="model-details">
      {selected?.description && <p className="model-label">{selected.description}</p>}
      {selected && catalog.tavilyConfigured && <p className="model-label">Search tools · OpenAI web search and Tavily</p>}
      {selected?.helperModel && <p className="model-label">{selected.label} assesses the evidence. {catalog.models.find(option => option.id === selected.helperModel)?.label || selected.helperModel} can search for missing sources.</p>}
      {selected?.provider === 'Meta' && <p className="model-label">OpenAI web search · {selected.searchModel}. Meta assesses the retrieved passages via Groq.</p>}
      {catalog?.models.filter(option => !option.available && option.reason).map(option =>
        <p key={option.id} className="model-label">{option.label} · {option.reason}</p>)}
    </div>
    {catalog && <details className="model-guide"><summary>Compare models and see account access</summary>
      <dl>{catalog.models.filter(option => option.description).map(option => <React.Fragment key={option.id}>
        <dt>{option.label}{option.id === catalog.defaultId && ' · Demo default'}</dt>
        <dd>{option.description}</dd>
      </React.Fragment>)}</dl>
      {Array.isArray(catalog.inventory) ? <details><summary>OpenAI account model IDs ({catalog.inventory.length})</summary>
        <p>The selector includes models configured for this research workflow.</p>
        <ul className="model-ids">{catalog.inventory.map(id => <li key={id}><code>{id}</code></li>)}</ul>
      </details> : <p>OpenAI account inventory is unavailable.</p>}
    </details>}
    {(catalogError || (catalog && !selected)) && <div className="model-retry">
      {catalogError && <p role="alert">The model list could not be loaded.</p>}
      <button className="retry" type="button" onClick={reloadModels}>Reload models</button>
    </div>}
  </div>

  return <div className="shell">
    <header><Brand/></header>
    <main>
      <section className="intro">
        <div><h1>{viewTitles[mode]}</h1>
          <p>{mode === 'history' ? 'Reopen reports, pending reviews, and batches saved in this browser tab.' :
            'Find out what the software delivers, who it works for, and which conditions matter before you choose it.'}</p>
        </div>
        <img className="engraving" src="/lens.webp" alt="" width="840" height="560"/>
      </section>
      <nav className="research-modes" aria-label="Workspace views">
        <button type="button" aria-pressed={mode === 'single'} disabled={bulkBusy} onClick={() => chooseMode('single')}>Single product</button>
        <button type="button" aria-pressed={mode === 'bulk'} disabled={busy} onClick={() => chooseMode('bulk')}>Bulk URLs</button>
        <button type="button" aria-pressed={mode === 'history'} onClick={() => chooseMode('history')}>Session history</button>
      </nav>
      {mode === 'history' && <>
        {(busy || bulkBusy) && <p role="status">Your investigation is still running in {bulkBusy ? 'Bulk URLs' : 'Single product'}.</p>}
        <SessionHistory entries={entries} current={active?.id} busy={busy || bulkBusy} onOpen={openReport}/>
      </>}
      <BulkResearch visible={mode !== 'single'} historyOnly={mode === 'history'} onOpenBatch={() => chooseMode('bulk')}
        selected={selected} modelPicker={mode === 'bulk' ? modelPicker : null} busy={busy || bulkBusy} onBusyChange={setBulkBusy}/>
      {mode === 'single' && <>
      <form onSubmit={investigate} aria-label="Product investigation">
        <div className="field"><label htmlFor="product">Product, company, or URL</label>
          <input id="product" name="subject" type="text" placeholder="Product name, company name, or website" maxLength={2048}
            required autoComplete="off" disabled={busy} value={subject}
            onChange={event => { setSubject(event.target.value); setActive(null); setError('') }}/>
        </div>
        <div className="field"><div className="field-label"><label htmlFor="question">Product question</label>
          <span id="question-hint">Optional</span></div>
          <textarea id="question" name="question" rows={2} maxLength={1000} disabled={busy} aria-describedby="question-hint"
            placeholder="Which edition includes the features I need?" value={question}
            onChange={event => { setQuestion(event.target.value); setActive(null); setError('') }}/>
        </div>
        {modelPicker}
        <div className="form-actions"><button className="submit" disabled={!canInvestigate}>{busy ? 'Investigating…' : 'Investigate'}
          {busy ? <span className="spinner"/> : <Icon name="arrow"/>}</button>
        </div>
      </form>
      {(busy || (error && !active)) && <PendingBriefing subject={subject} running={busy} failed={!busy && !!error} events={activity}/>}
      {error && <section className="feedback error" role="alert"><div><strong>Investigation incomplete</strong><p>{error}</p></div>
        {!active?.report.review && <button className="retry" disabled={!canInvestigate} onClick={investigate}>Retry</button>}</section>}
      {active && !busy && <><span className="sr-only" role="status">{active.report.review ? 'Research paused for your input' : 'Assessment ready'}</span>
        <Report key={active.id} report={active.report} simulated={Boolean(active.scenario)} retry={canInvestigate ? investigate : null}
          onReview={review} expired={active.expired} guidance={active.guidance || ''} onGuidanceChange={guidance => updateActive({guidance})}
          notes={active.reviewerNotes ?? active.report.reviewer_notes_original ?? ''} onNotesChange={notes => updateActive({reviewerNotes:notes})}/></>}
      </>}
    </main>
  </div>
}

createRoot(document.getElementById('root')).render(<Workspace/>)
