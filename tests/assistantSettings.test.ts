import { describe, expect, it } from 'vitest'
import {
  assistantReady,
  parseAssistantSettings,
  type AssistantSettings,
} from '../src/lib/assistantSettings'

const now = Date.parse('2026-11-01T14:00:00Z')
const settings: AssistantSettings = {
  provider: 'groq',
  revision: 2,
  pcs: [
    {
      label: 'PC',
      last_seen: new Date(now).toISOString(),
      provider: 'groq',
      revision: 2,
      state: 'ready',
      groq_configured: true,
      local_models_unloaded: true,
      error: null,
    },
  ],
}
describe('assistant provider acknowledgement', () => {
  it('requires a current, matching PC acknowledgement and released local models before Groq is usable', () => {
    expect(assistantReady(settings, now)).toBe(true)
    for (const difference of [
      { revision: 1 },
      { provider: 'local' as const },
      { state: 'pending' as const },
      { state: 'blocked' as const },
      { groq_configured: false },
      { local_models_unloaded: false },
      { last_seen: new Date(now - 60000).toISOString() },
    ])
      expect(
        assistantReady({ ...settings, pcs: [{ ...settings.pcs[0], ...difference }] }, now),
      ).toBe(false)
  })
  it('local mode does not require a Groq key or a loaded model', () => {
    expect(
      assistantReady(
        {
          ...settings,
          provider: 'local',
          pcs: [
            {
              ...settings.pcs[0],
              provider: 'local',
              groq_configured: false,
              local_models_unloaded: true,
            },
          ],
        },
        now,
      ),
    ).toBe(true)
  })
  it('rejects malformed configuration instead of choosing a provider implicitly', () => {
    for (const bad of [
      null,
      {},
      { ...settings, provider: 'unknown' },
      { ...settings, pcs: [{}] },
      { ...settings, revision: -1 },
      { ...settings, pcs: [{ ...settings.pcs[0], groq_configured: 'yes' }] },
    ])
      expect(() => parseAssistantSettings(bad)).toThrow()
    expect(parseAssistantSettings(settings)).toEqual(settings)
  })
})
