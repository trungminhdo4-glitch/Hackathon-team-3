import React, { useEffect, useState } from 'react'
import { Report } from './Report.jsx'
import { columns, csvReports, datasetRow } from './datasetReport.js'
import { verdictLabel } from './research.js'
import { MAX_BULK_URLS } from '../shared/bulkLimits.js'
import { importUrls, listError, splitUrlLines } from './bulkImport.js'
import { readBatches, saveBatches } from './batchStorage.js'
import './bulk.css'

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

export function BulkResearch({ selected, modelPicker, busy, onBusyChange, visible = true, historyOnly, onOpenBatch }) {
  const [batches, setBatches] = useState([])
  const [restored, setRestored] = useState(false)
  const [activeId, setActiveId] = useState(null)
  const [urls, setUrls] = useState('')
  const [details, setDetails] = useState(null)
  const [progress, setProgress] = useState({})
  const [error, setError] = useState('')
  const [storageNotice, setStorageNotice] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [importNote, setImportNote] = useState('')
  const active = batches.find(batch => batch.id === activeId)
  const open = active?.items[details]
  const list = splitUrlLines(urls)
  const issue = listError(list)
  const locked = busy || importing || !restored

  useEffect(() => {
    let current = true
    readBatches().then(saved => {
      if (!current) return
      setBatches(saved)
      setActiveId(saved[0]?.id)
      setUrls(saved[0]?.items.map(item => item.inputUrl).join('\n') || '')
      setRestored(true)
    })
    return () => { current = false }
  }, [])

  useEffect(() => {
    if (!batches.length) return
    let current = true
    saveBatches(batches, () => current).then(count => {
      if (!current) return
      setStorageNotice(count === batches.length ? '' : count
        ? `Only the latest ${count} of ${batches.length} batches fit in tab storage. Download older batches before reloading.`
        : 'The latest batch could not be saved in tab storage. Download its CSV before reloading or closing the tab.')
    })
    return () => { current = false }
  }, [batches])

  async function upload(event) {
    const file = event.target.files[0]
    if (!file) return
    event.target.value = ''
    setImporting(true)
    setImportNote('')
    setImportError('')
    try {
      const imported = await importUrls(file)
      setUrls(imported.join('\n'))
      setImportNote(`Imported ${imported.length} ${imported.length === 1 ? 'URL' : 'URLs'} from ${file.name}.`)
    } catch (cause) { setImportError(cause.message || 'The file could not be read.') }
    finally { setImporting(false) }
  }

  function updateBatch(id, change) {
    setBatches(previous => previous.map(batch => batch.id === id ? {...batch, items:change(batch.items)} : batch))
  }
  async function start(event) {
    event.preventDefault()
    if (locked || !selected || !list.length || issue) return
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
  if (!visible) return null
  if (historyOnly) return <section className="session-history bulk-history" aria-label="Batch history">
    <h2>Batches <span>({batches.length})</span></h2>
    {storageNotice && <p role="status">{storageNotice}</p>}
    {batches.length ? <ol>{batches.map(batch => <li key={batch.id}><button type="button" disabled={busy}
      onClick={() => {
        setActiveId(batch.id)
        setDetails(null)
        setUrls(batch.items.map(item => item.inputUrl).join('\n'))
        setError('')
        setImportError('')
        setImportNote('')
        onOpenBatch()
      }}>
      <span>{batch.items.length} URLs · {batch.items[0]?.inputUrl}</span><small>{new Date(batch.at).toLocaleString()}</small>
    </button></li>)}</ol> : <p>{restored ? 'No batches in this tab yet.' : 'Loading batches…'}</p>}
  </section>
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
        <span className="bulk-hint" id="bulk-hint">Enter up to {MAX_BULK_URLS} public URLs, one per line.</span>
        <textarea id="product-urls" rows={4} required value={urls} disabled={locked}
          aria-describedby="bulk-hint" placeholder={'https://sentry.io/\nhttps://example.com/'}
          onChange={event => { setUrls(event.target.value); setImportError(''); setImportNote('') }}/>
        {issue && <p role="alert" className="bulk-input-error">{issue}</p>}
      </div>
      <div className="bulk-upload">
        <label htmlFor="bulk-file">Import URLs from file</label>
        <span className="bulk-hint" id="bulk-file-hint">TXT with one link per line, or CSV with a URL column. Importing replaces the list above.</span>
        <input id="bulk-file" type="file" accept=".txt,.csv,text/plain,text/csv" disabled={locked}
          aria-describedby="bulk-file-hint" onChange={upload}/>
        {importError && <p role="alert" className="bulk-input-error">{importError}</p>}
        {(importing || importNote) && <p role="status" className="bulk-hint">{importing ? 'Reading the file…' : importNote}</p>}
      </div>
      {modelPicker}
      <div className="form-actions"><button className="submit" disabled={locked || !selected || !list.length || Boolean(issue)}>
        {busy ? 'Investigating batch…' : 'Investigate URLs'}</button>
      </div>
    </form>
    {error && <p role="alert" className="feedback error">{error}</p>}
    {storageNotice && <p role="status">{storageNotice}</p>}
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
