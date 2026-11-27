const key = 'saaslens.batches.v1'
const compressed = 'gzip:'

export async function readBatches(storage) {
  try {
    let data = (storage || window.sessionStorage).getItem(key)
    if (!data) return []
    if (data.startsWith(compressed)) {
      const bytes = Uint8Array.from(atob(data.slice(compressed.length)), ch => ch.charCodeAt(0))
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
      data = await new Response(stream).text()
    }
    const saved = JSON.parse(data)
    if (!Array.isArray(saved)) return []
    return saved.filter(batch => batch?.id && Array.isArray(batch.items)).map(batch => ({
      ...batch, items: batch.items.map(item => item.status === 'queued' ? {...item, status:'interrupted',
        error:'The tab disconnected before this result arrived.'} : item),
    }))
  } catch { return [] }
}

export async function saveBatches(batches, current, storage) {
  try { storage ??= window.sessionStorage } catch { return 0 }
  for (let count = batches.length; count && current(); count--) {
    const data = JSON.stringify(batches.slice(0, count))
    try {
      storage.setItem(key, data)
      return count
    } catch (error) { if (error.name !== 'QuotaExceededError') return 0 }
    // Full evidence reports can exceed the per-tab quota together. Try lossless compression
    // before omitting any older batch from the saved copy.
    if (typeof CompressionStream === 'undefined') continue
    try {
      const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'))
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
      if (!current()) return 0
      storage.setItem(key, compressed + btoa(binary))
      return count
    } catch (error) { if (error.name !== 'QuotaExceededError') return 0 }
  }
  return 0
}
