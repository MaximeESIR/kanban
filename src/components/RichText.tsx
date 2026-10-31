import { useEffect, useRef, useState } from 'react'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { Modal } from './ui'

const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
// Never load remote images: pasted images are compressed and embedded in the private note.
md.renderer.rules.image = (tokens, idx) => {
  const src = String(tokens[idx].attrGet('src') || '')
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src))
    return '<em>[Image externe non chargée]</em>'
  return `<img src="${src}" alt="Image de la note" loading="lazy">`
}
md.inline.ruler.before('escape', 'math', (state, silent) => {
  if (state.src[state.pos] !== '$') return false
  const block = state.src[state.pos + 1] === '$',
    delim = block ? '$$' : '$'
  const end = state.src.indexOf(delim, state.pos + delim.length)
  if (end < 0) return false
  if (!silent) {
    const token = state.push('math', '', 0)
    token.content = state.src.slice(state.pos + delim.length, end)
    token.meta = { block }
  }
  state.pos = end + delim.length
  return true
})
md.renderer.rules.math = (tokens, i) =>
  katex.renderToString(tokens[i].content, {
    displayMode: !!tokens[i].meta?.block,
    throwOnError: false,
    trust: false,
    maxExpand: 1000,
  })
const fence = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, i, options, env, self) =>
  tokens[i].info.trim() === 'mermaid'
    ? `<pre class="diagram-source">${md.utils.escapeHtml(tokens[i].content)}</pre>`
    : fence(tokens, i, options, env, self)
export function renderMarkdown(text: string) {
  return DOMPurify.sanitize(md.render(text), {
    ADD_TAGS: ['annotation'],
    FORBID_TAGS: ['iframe', 'object', 'embed', 'form', 'input'],
  })
}
export function RichText({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [html, setHtml] = useState('')
  const [zoom, setZoom] = useState('')
  useEffect(() => {
    setHtml(renderMarkdown(text))
  }, [text])
  useEffect(() => {
    let stale = false
    const nodes = [...(ref.current?.querySelectorAll<HTMLElement>('.diagram-source') || [])]
    if (nodes.length)
      void import('mermaid').then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          maxTextSize: 20000,
          suppressErrorRendering: true,
          htmlLabels: false,
          flowchart: { htmlLabels: false },
        })
        for (const node of nodes) {
          if (stale) return
          try {
            const result = await mermaid.render(
              `diagram-${crypto.randomUUID()}`,
              node.textContent || '',
            )
            if (!stale)
              node.innerHTML = DOMPurify.sanitize(result.svg, {
                USE_PROFILES: { svg: true, svgFilters: true },
              })
          } catch {
            if (!stale) node.setAttribute('title', 'Diagramme invalide : source conservée')
          }
        }
      })
    return () => {
      stale = true
    }
  }, [html])
  return (
    <>
      <div
        ref={ref}
        className="rich-text"
        onClick={(e) => {
          const target = (e.target as Element).closest('img,svg')
          if (target) setZoom(DOMPurify.sanitize(target.outerHTML))
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {zoom && (
        <Modal title="Aperçu agrandi" wide onClose={() => setZoom('')}>
          <div className="rich-text image-zoom" dangerouslySetInnerHTML={{ __html: zoom }} />
        </Modal>
      )}
    </>
  )
}
export async function embeddedImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10000000)
    throw new Error('Choisissez une image PNG, JPEG ou WebP de moins de 10 Mo.')
  const bitmap = await createImageBitmap(file)
  if (bitmap.width * bitmap.height > 40000000) {
    bitmap.close()
    throw new Error('Image trop grande.')
  }
  const ratio = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * ratio)
  canvas.height = Math.round(bitmap.height * ratio)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const data = canvas.toDataURL('image/webp', 0.72)
  if (data.length > 400000) throw new Error('Image trop lourde après compression (300 Ko maximum).')
  return `\n![Image](${data})\n`
}
