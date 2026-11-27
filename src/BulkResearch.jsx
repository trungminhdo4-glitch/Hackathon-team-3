import React, { useEffect, useState } from 'react'
import { Report } from './Report.jsx'
import { columns, csvReports, datasetRow } from './datasetReport.js'
import { verdictLabel } from './research.js'
import './bulk.css'

const storageKey = 'saaslens.batches.v1'

function readBatches() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey))
    if (!Array.isArray(saved)) return []
    return saved.filter(batch => batch.id && Array.isArray(batch.items)).map(batch => ({
      ...batch, items: batch.items.map(item => item.status === 'queued' ? {...item, status:'interrupted',
        error:'The tab disconnected before this result arrived.'} : item),
    }))
  } catch { return [] }
}

function downloadBatch(batch) {
  const rows = batch.items.map(item => {
    if (item.report) return datasetRow(item.report, item.notes || '')
    const row = Object.fromEntries(columns.map(key => [key, '']))
    return {...row, product:item.inputUrl, overall:'Investigation incomplete', reasoning:item.error}
  })
  const href = URL.createObjectURL(new Blob(['\uFEFF', csvReports(rows)], {type:'text/csv;charset=utf-8'}))
  const link = document.createElement('a')
  link.href = href
  link.download = 'SaaSLens-bulk-' + new Date(batch.at).toISOString().slice(0, 10) + '.csv'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

async function streamBatch(urls, model, receive) {
  const response = await fetch('/api/investigate/bulk', {
    method:'POST', headers:{'Content-Type':'application/json', Accept:'application/x-ndjson'},
    body:JSON.stringify({urls, model}),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error || 'The research server could not start this batch.')
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let done = false
  function line(text) {
    if (!text.trim()) return
    const event = JSON.parse(text)
    if (event.type === 'error') throw new Error(event.error)
    if (event.type === 'done') done = true
    else receive(event)
  }
  try {
    while (!done) {
      const chunk = await reader.read()
      if (chunk.done) { line(buffer); break }
      const lines = (buffer + chunk.value).split('\n')
      buffer = lines.pop()
      lines.forEach(line)
    }
    if (!done) throw new Error('The connection ended before the batch finished.')
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export function BulkResearch({ selected, modelPicker, busy, onBusyChange }) {
  const [batches, setBatches] = useState(readBatches)
  const [activeId, setActiveId] = useState(batches[0]?.id)
  const [urls, setUrls] = useState(batches[0]?.items.map(item => item.inputUrl).join('\n') || '')
  const [details, setDetails] = useState(null)
  const [progress, setProgress] = useState({})
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(true)
  const active = batches.find(batch => batch.id === activeId)
  const open = active?.items[details]
  const list = urls.split(/\r?\n/).map(url => url.trim()).filter(Boolean)

  useEffect(() => {
    if (!batches.length) return
    for (let count = batches.length; count; count--) {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(batches.slice(0, count)))
        setSaved(true)
        return
      } catch (cause) { if (cause.name !== 'QuotaExceededError') break }
    }
    setSaved(false)
  }, [batches])

  function updateBatch(id, change) {
    setBatches(previous => previous.map(batch => batch.id === id ? {...batch, items:change(batch.items)} : batch))
  }
  async function start(event) {
    event.preventDefault()
    if (busy || !selected || !list.length || list.length > 10) return
    const id = crypto.randomUUID()
    const batch = {id, at:Date.now(), model:selected.id, items:list.map(inputUrl => ({inputUrl, status:'queued'}))}
    setBatches(previous => [batch, ...previous])
    setActiveId(id)
    setDetails(null)
    setProgress({})
    setError('')
    onBusyChange(true)
    try {
      await streamBatch(list, selected.id, event => {
        if (event.type === 'progress') setProgress(previous => ({...previous, [event.index]:event.detail}))
        if (event.type === 'item') updateBatch(id, items => items.map((item, index) => index === event.index ? event.item : item))
      })
    } catch (cause) {
      const message = cause.message || 'The batch could not finish.'
      setError(message)
      updateBatch(id, items => items.map(item => item.status === 'queued' ? {...item, status:'interrupted', error:message} : item))
    } finally { onBusyChange(false) }
  }
  const received = active?.items.filter(item => item.status !== 'queued').length ?? 0
  const counts = new Map()
  for (const item of active?.items || []) {
    if (item.status === 'queued') continue
    const label = item.status === 'completed' ? verdictLabel(item.report) : 'Incomplete'
    counts.set(label, (counts.get(label) || 0) + 1)
  }
  return <>
    <form onSubmit={start} aria-label="Bulk investigation">
      <div className="field"><label htmlFor="product-urls">Product URLs</label>
        <span className="bulk-hint" id="bulk-hint">Enter up to 10 public URLs, one per line.</span>
        <textarea id="product-urls" rows={4} maxLength={22000} required value={urls} disabled={busy}
          aria-describedby="bulk-hint" placeholder={'https://sentry.io/\nhttps://example.com/'}
          onChange={event => setUrls(event.target.value)}/></div>
      {modelPicker}
      <div className="form-actions"><button className="submit" disabled={busy || !selected || !list.length || list.length > 10}>
        {busy ? 'Investigating batch…' : 'Investigate URLs'}</button>
        {list.length > 10 && <span role="alert">Remove {list.length - 10} URLs to run this batch.</span>}
      </div>
    </form>
    {batches.length > 0 && <details className="session-history"><summary>Batch history ({batches.length})</summary>
      <ol>{batches.map(batch => <li key={batch.id}><button type="button" disabled={busy} aria-current={batch.id === activeId}
        onClick={() => { setActiveId(batch.id); setDetails(null); setUrls(batch.items.map(item => item.inputUrl).join('\n')); setError('') }}>
        <span>{batch.items.length} URLs · {batch.items[0].inputUrl}</span><small>{new Date(batch.at).toLocaleString()}</small>
      </button></li>)}</ol>
    </details>}
    {error && <p role="alert" className="feedback error">{error}</p>}
    {!saved && <p role="status">This batch exceeds the available tab storage. Download the CSV before closing the tab.</p>}
    {active && <section className="bulk-results" aria-labelledby="batch-result-title">
      <header><div><h2 id="batch-result-title">Batch results</h2>
        <p role="status">{received} of {active.items.length} processed · {active.model}</p></div>
        {received === active.items.length && <button type="button" className="retry" onClick={() => downloadBatch(active)}>Download batch CSV</button>}
      </header>
      {counts.size > 0 && <dl className="bulk-counts" aria-label="Verdict totals">{[...counts].map(([label, count]) =>
        <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>}
      <ol>{active.items.map((item, index) => <li key={index}>
        <div className="bulk-item-heading"><strong>{item.report?.productName || item.inputUrl}</strong>
          <span className={'bulk-verdict ' + (item.report?.verdict ?? '')}>
            {item.status === 'completed' ? verdictLabel(item.report) : item.status === 'queued'
              ? (progress[index] ? 'Researching' : 'Queued') : 'Incomplete'}
          </span></div>
        {item.report && <small>{item.inputUrl}</small>}
        <p>{item.report?.interpretation || item.error || progress[index]}</p>
        {item.report && <button className="bulk-open" type="button" aria-expanded={details === index}
          onClick={() => setDetails(details === index ? null : index)}>{details === index ? 'Close' : 'View'} report for {item.report.productName || item.inputUrl}</button>}
        {details === index && open?.report && <Report key={active.id + '-' + index} report={open.report} simulated={false}
          retry={null} notes={open.notes || ''} onNotesChange={notes => updateBatch(active.id, items =>
            items.map((entry, i) => i === index ? {...entry, notes} : entry))}/>}
      </li>)}</ol>
    </section>}
  </>
}
