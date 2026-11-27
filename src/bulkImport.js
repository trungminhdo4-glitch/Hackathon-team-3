import { MAX_BULK_URLS } from '../shared/bulkLimits.js'

export function splitUrlLines(text) {
  return text.split(/\r\n|[\r\n]/).map(line => line.trim()).filter(Boolean)
}

export function listError(urls) {
  if (urls.length > MAX_BULK_URLS) return `This list has ${urls.length} URLs. Use up to ${MAX_BULK_URLS} per batch.`
  const invalid = urls.findIndex(value => {
    if (value.length > 2048 || !/^https?:\/\//i.test(value) || /[\s\\]/.test(value)) return true
    try {
      const url = new URL(value)
      return Boolean(url.username || url.password || url.port)
    } catch { return true }
  })
  return invalid < 0 ? '' : `Check URL ${invalid + 1}. Enter a public HTTP or HTTPS URL without credentials or a custom port (up to 2,048 characters).`
}

// Quoted dataset cells can contain embedded commas, newlines and doubled quotes.
function csvRows(text) {
  const rows = []
  let row = [], field = '', quoted = false, closed = false
  function endField() {
    row.push(field.trim())
    field = ''
    closed = false
  }
  function endRow() {
    endField()
    if (row.some(Boolean)) rows.push(row)
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch !== '"') field += ch
      else if (text[i + 1] === '"') { field += '"'; i++ }
      else { quoted = false; closed = true }
    } else if (ch === ',') endField()
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      endRow()
    } else if (ch === '"' && !field && !closed) quoted = true
    else if (ch === '"' || (closed && ch.trim())) throw new Error('The CSV contains an unexpected quote or text after a quoted cell.')
    else field += ch
  }
  if (quoted) throw new Error('The CSV ends inside a quoted cell.')
  endRow()
  return rows
}

export async function importUrls(file) {
  if (file.size > 1024 * 1024) throw new Error('Choose a TXT or CSV file no larger than 1 MiB.')
  if (!/\.(txt|csv)$/i.test(file.name)) throw new Error('Choose a TXT or CSV file.')
  const text = (await file.text()).replace(/^\uFEFF/, '')
  let urls
  if (/\.txt$/i.test(file.name)) urls = splitUrlLines(text)
  else {
    const [first = [], ...rest] = csvRows(text)
    const column = first.findIndex(cell => /^(url|product[ _]url)$/i.test(cell))
    if (column !== -1) {
      urls = rest.map((row, i) => {
        if (!row[column]) throw new Error(`CSV record ${i + 2} is missing its URL.`)
        return row[column]
      })
    } else if (first.length === 1 && rest.every(row => row.length === 1)) urls = [first[0], ...rest.map(row => row[0])]
    else if (!first.length) urls = []
    else throw new Error('Add a URL column header to the CSV, or use a single column of URLs.')
  }
  if (!urls.length) throw new Error('The file contains no product URLs.')
  const issue = listError(urls)
  if (issue) throw new Error(issue)
  return urls
}
