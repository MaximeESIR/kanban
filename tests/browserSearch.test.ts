import { describe, expect, it } from 'vitest'
import { createBrowserIndex } from '../src/lib/browserSearch'
const docs = [
  {
    id: 'jetson',
    title: 'Déploiement Jetson',
    content: 'Installer le code de navigation sur le drone.',
  },
  { id: 'other', title: 'Navigation', content: 'Réunion sur le déploiement.' },
  {
    id: 'image',
    title: 'Photo',
    content: '![Vue du terrain](data:image/png;base64,jetsonsecret)\nFin.',
  },
]
describe('browser-only search', () => {
  it('ranks matching titles and coverage, ignoring accents and case', () => {
    expect(createBrowserIndex(docs)('DEPLOIEMENT jetson')[0].id).toBe('jetson')
  })
  it('supports prefixes and one-character typos without fuzzy short identifiers', () => {
    const search = createBrowserIndex(docs)
    expect(search('jetsn')[0].id).toBe('jetson')
    expect(search('deploi')[0].id).toBe('jetson')
    expect(search('ux')).toEqual([])
  })
  it('omits conversational filler and rejects empty or unrelated queries', () => {
    const search = createBrowserIndex(docs)
    expect(search('je cherche le code du drone')[0].id).toBe('jetson')
    expect(search('le la et')).toEqual([])
    expect(search('astrophysique')).toEqual([])
  })
  it('indexes text after large images but never their data payload', () => {
    const search = createBrowserIndex([
      {
        id: 'a',
        title: 'Image',
        content: `![Terrain](data:image/png;base64,${'X'.repeat(100000)})\nJetson`,
      },
    ])
    expect(search('jetson')[0].excerpt).toContain('Jetson')
    expect(search('xxxxx')).toEqual([])
    expect(search('terrain')[0].excerpt).not.toContain('base64')
  })
  it('does not retain removed documents or documents from another workspace', () => {
    expect(createBrowserIndex(docs.slice(1))('jetson')).toEqual([])
    expect(createBrowserIndex([])('jetson')).toEqual([])
  })
})
