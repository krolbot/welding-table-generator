export function downloadFile(content: BlobPart | Blob, filename: string, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type })
  const url = URL.createObjectURL(blob), anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  queueMicrotask(() => URL.revokeObjectURL(url))
}

export async function copyText(value: string) {
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return }
  const input = document.createElement('textarea')
  input.value = value
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.append(input)
  input.select()
  const copied = document.execCommand('copy')
  input.remove()
  if (!copied) throw new Error('Clipboard unavailable')
}
