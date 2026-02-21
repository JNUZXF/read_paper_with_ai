import { marked } from 'marked'
import DOMPurify from 'dompurify'

let configured = false

export function renderMarkdown(raw) {
  if (!raw) return ''
  if (!configured) {
    marked.setOptions({ gfm: true, breaks: true })
    configured = true
  }
  const html = marked.parse(raw)
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}

export function cleanText(raw) {
  if (!raw) return ''
  let text = String(raw).replace(/^\s+/, '')
  const prefixes = ['好的', '当然', '可以', '下面开始分析', '以下是', '我将', '我会']
  let changed = true
  while (changed) {
    changed = false
    for (const p of prefixes) {
      if (text.startsWith(p)) {
        text = text.slice(p.length).replace(/^[：:，,。\s]+/, '')
        changed = true
      }
    }
  }
  return text || raw
}
