import { describe, it, expect, vi } from 'vitest'
import { boundedRequest, RequestDeadline } from '../src/lib/boundedRequest'
describe('bounded requests', () => {
  it('returns a successful response without aborting', async () => {
    let signal: AbortSignal | undefined
    expect(
      await boundedRequest((s) => {
        signal = s
        return Promise.resolve('ok')
      }, 30),
    ).toBe('ok')
    expect(signal?.aborted).toBe(false)
  })
  it('releases the UI even if the transport or auth lock ignores abort', async () => {
    vi.useFakeTimers()
    try {
      let signal: AbortSignal | undefined
      const request = boundedRequest((s) => {
        signal = s
        return new Promise(() => {})
      }, 15000)
      const assertion = expect(request).rejects.toBeInstanceOf(RequestDeadline)
      await vi.advanceTimersByTimeAsync(15001)
      await assertion
      expect(signal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
  it('preserves immediate errors and cancels the timeout', async () => {
    const error = new Error('conflict')
    await expect(boundedRequest(() => Promise.reject(error), 20)).rejects.toBe(error)
  })
})
