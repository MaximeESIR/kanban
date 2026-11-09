export type SearchDocument = { id: string; title: string; content: string }
const stopWords = new Set(
  'le la les un une des de du dans sur pour avec et ou est qui que quoi je tu il elle on nous vous mon ma mes ce cette ces au aux en a comment cherche chercher recherche trouver'.split(
    ' ',
  ),
)
const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
export function searchableText(text: string) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/data:[^\s)]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
}
function words(text: string) {
  return normalize(text).match(/[\p{L}\p{N}_]+/gu) || []
}
// A single insertion, deletion or substitution, only for words long enough to be useful.
function near(a: string, b: string) {
  if (a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 1) return false
  let i = 0,
    j = 0,
    errors = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++errors > 1) return false
    if (a.length >= b.length) i++
    if (b.length >= a.length) j++
  }
  return errors + Number(i < a.length || j < b.length) <= 1
}
export function createBrowserIndex(documents: SearchDocument[]) {
  const rows = documents.map((doc) => {
    const content = searchableText(doc.content)
    const title = new Set(words(doc.title))
    const terms = new Set([...title, ...words(content)])
    return { doc, content, title, terms }
  })
  const frequencies = new Map<string, number>()
  for (const row of rows)
    for (const term of row.terms) frequencies.set(term, (frequencies.get(term) || 0) + 1)
  return (query: string) => {
    const terms = [
      ...new Set(words(query.slice(0, 500)).filter((word) => !stopWords.has(word))),
    ].slice(0, 20)
    if (!terms.length) return []
    return rows
      .flatMap((row) => {
        let score = 0,
          matched = 0
        for (const term of terms) {
          let best = 0
          for (const word of row.terms) {
            const quality =
              word === term
                ? 1
                : term.length >= 3 && word.startsWith(term)
                  ? 0.7
                  : near(term, word)
                    ? 0.4
                    : 0
            if (quality)
              best = Math.max(
                best,
                quality *
                  (row.title.has(word) ? 3 : 1) *
                  (1 + Math.log(1 + rows.length / (frequencies.get(word) || 1))),
              )
          }
          if (best) {
            matched++
            score += best
          }
        }
        if (!matched) return []
        const normalized = normalize(row.content)
        const positions = terms.map((t) => normalized.indexOf(t)).filter((p) => p >= 0)
        const start = Math.max(0, (positions.length ? Math.min(...positions) : 0) - 60)
        const excerpt =
          (start ? '…' : '') +
          row.content.slice(start, start + 220) +
          (row.content.length > start + 220 ? '…' : '')
        return [
          {
            id: row.doc.id,
            title: row.doc.title,
            excerpt,
            score: (score * matched) / terms.length,
            matched,
          },
        ]
      })
      .sort((a, b) => b.matched - a.matched || b.score - a.score || a.id.localeCompare(b.id))
  }
}
