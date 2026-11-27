import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/spectral/latin-600.css'
import '@fontsource/spectral/latin-700.css'
import { Brand, Icon } from './icons.jsx'
import { Report } from './Report.jsx'
import { requestAssessment } from './research.js'
import { readHistory, saveHistory, SessionHistory } from './SessionHistory.jsx'
import './style.css'

function Workspace() {
  const [entries, setEntries] = useState(readHistory)
  const [active, setActive] = useState(entries[0] ?? null)
  const [subject, setSubject] = useState(active?.report.subject ?? active?.report.inputUrl ?? '')
  const [question, setQuestion] = useState(active?.report.question ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function openReport(entry) {
    setSubject(entry.report.subject ?? entry.report.inputUrl)
    setQuestion(entry.report.question ?? '')
    setActive(entry)
    setError('')
  }

  async function investigate(event) {
    event.preventDefault()
    if (busy || !subject.trim()) return
    setError('')
    setActive(null)
    setBusy(true)
    try {
      const report = await requestAssessment(subject.trim(), question.trim())
      const entry = { id: crypto.randomUUID(), savedAt: Date.now(), report }
      const updated = [entry, ...entries]
      saveHistory(updated)
      setEntries(updated)
      setActive(entry)
    } catch (cause) {
      setError(cause.name === 'TimeoutError' ? 'The investigation timed out. Retry to start a new search.' : cause.message)
    } finally { setBusy(false) }
  }

  return <div className="shell">
    <header><Brand/></header>
    <main>
      <section className="intro">
        <div><h1>Research a product.</h1>
          <p>Find out what the software delivers, who it works for, and which conditions matter before you choose it.</p>
        </div>
        <img className="engraving" src="/lens.webp" alt="" width="840" height="560"/>
      </section>
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
        <button className="submit" disabled={busy || !subject.trim()}>{busy ? 'Investigating…' : 'Investigate'}
          {busy ? <span className="spinner"/> : <Icon name="arrow"/>}</button>
      </form>
      <SessionHistory entries={entries} current={active?.id} busy={busy} onOpen={openReport}/>
      {busy && <p className="feedback" role="status">Researching the product and checking citations…</p>}
      {error && <section className="feedback error" role="alert"><div><strong>Investigation incomplete</strong><p>{error}</p></div>
        <button className="retry" onClick={investigate}>Retry</button></section>}
      {active && <><span className="sr-only" role="status">Assessment ready</span>
        <Report key={active.id} report={active.report} simulated={Boolean(active.scenario)} retry={investigate}/></>}
    </main>
  </div>
}

createRoot(document.getElementById('root')).render(<Workspace/>)
