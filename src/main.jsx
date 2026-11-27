import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/spectral/latin-600.css'
import '@fontsource/spectral/latin-700.css'
import { Brand, Icon } from './icons.jsx'
import { Report } from './Report.jsx'
import { requestAssessment } from './research.js'
import { readHistory, saveHistory, SessionHistory } from './SessionHistory.jsx'
import './style.css'

const framework = [
  ['identity', 'Identity and domain', 40],
  ['independent', 'Independent corroboration', 30],
  ['operator', 'Operator transparency', 20],
  ['substance', 'Product substance', 10],
]
function Framework() {
  return <section className="framework" aria-labelledby="framework-title">
    <div className="framework-heading"><h2 id="framework-title">Evidence framework</h2><span>100 points possible</span></div>
    <ul>{framework.map(([id, title, weight]) => <li key={id}><Icon name={id}/><span>{title}</span><strong>{weight}</strong></li>)}</ul>
  </section>
}
function Workspace() {
  const [entries,setEntries] = useState(readHistory)
  const [active,setActive] = useState(entries[0] ?? null)
  const [url,setUrl] = useState(active?.report.inputUrl ?? '')
  const [fixture,setFixture] = useState(Boolean(active?.scenario))
  const [scenario,setScenario] = useState(active?.scenario ?? 'credible')
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const report = active?.report
  const reset = () => { setActive(null); setError('') }
  function openReport(entry) {
    setUrl(entry.report.inputUrl)
    setFixture(Boolean(entry.scenario))
    setScenario(entry.scenario ?? 'credible')
    setActive(entry)
    setError('')
  }
  async function investigate(event) {
    event?.preventDefault()
    if (busy) return
    reset()
    setBusy(true)
    try {
      const report = await requestAssessment(url.trim(), fixture ? scenario : null)
      const entry = { id: crypto.randomUUID(), savedAt: Date.now(), scenario: fixture ? scenario : null, report }
      const updated = [entry, ...entries]
      saveHistory(updated)
      setEntries(updated)
      setActive(entry)
    } catch (cause) {
      setError(cause.name === 'TimeoutError' ? 'The investigation timed out. Retry to start a new search.' : cause.message)
    } finally { setBusy(false) }
  }
  return <div className="shell">
    <header><Brand/><div className="mode-switch" role="group" aria-label="Research mode">
      {['Live research', 'Fixture mode'].map((name,i) => <button key={name} aria-pressed={fixture === Boolean(i)} disabled={busy}
        onClick={() => { if (fixture !== Boolean(i)) { reset(); setFixture(Boolean(i)) } }}>{name}</button>)}
    </div></header>
    <main>
      <section className="hero">
        <div><h1>Investigate a SaaS<br/> product.</h1><p>Trace a product to its operator and see what independent sources confirm.</p></div>
        <img className="engraving" src="/lens.webp" alt="" width="840" height="560"/>
      </section>
      <form onSubmit={investigate} aria-label="Product investigation">
        {fixture && <div className="fixture-controls">
          <div><label htmlFor="scenario">Fixture scenario</label><p>Explore synthetic evidence without credentials.</p></div>
          <select id="scenario" value={scenario} disabled={busy} onChange={event => { reset(); setScenario(event.target.value) }}>
            <option value="credible">Corroborated product</option><option value="contradiction">Material contradiction</option>
            <option value="timeout">Retrieval timeout</option><option value="fabricated">Fabricated citation</option>
          </select>
        </div>}
        <label htmlFor="product">Product URL</label>
        <div className="input-row">
          <div className="url-field"><Icon name="link"/><input id="product" name="url" type="url" placeholder="https://product.com" maxLength="2048" required autoComplete="url" autoCapitalize="none" spellCheck="false" disabled={busy}
            value={url} onChange={event => { reset(); setUrl(event.target.value) }}/></div>
          <button className="submit" disabled={busy}>{busy ? 'Investigating…' : 'Investigate'}{busy ? <span className="spinner"/> : <Icon name="arrow"/>}</button>
        </div>
      </form>
      <SessionHistory entries={entries} current={active?.id} busy={busy} onOpen={openReport}/>
      {busy && <div className="feedback" role="status"><span className="spinner"/> {fixture ? 'Checking fixture evidence…' : 'Researching the submitted domain and checking citations…'}</div>}
      {error && <section className="feedback error" role="alert"><div><strong>Investigation incomplete</strong><p>{error}</p></div><button className="retry" onClick={investigate}>Retry</button></section>}
      {report ? <><span className="sr-only" role="status">Assessment ready</span><Report report={report} fixture={fixture} retry={investigate}/></> : <Framework/>}
    </main>
    <footer><Brand/><span>Evidence score · 0–100</span></footer>
  </div>
}
createRoot(document.getElementById('root')).render(<Workspace/>)
