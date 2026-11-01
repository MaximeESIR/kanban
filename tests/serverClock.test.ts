import { expect, it } from 'vitest'
import { createServerClock, recentlySeen } from '../src/lib/serverClock'

const stamp = Date.parse('2026-11-01T13:30:00Z')

it.each([-180000, 180000])('uses server time despite a device offset of %i ms', (offset) => {
  let elapsed = 100
  let wall = stamp + offset
  const clock = createServerClock(
    () => elapsed,
    () => wall,
  )
  clock.observe(new Date(stamp).toUTCString())
  expect(recentlySeen(new Date(stamp - 10000).toISOString(), clock.now())).toBe(true)
  wall += 86400000 // A device clock correction must not change presence age.
  elapsed += 35000
  expect(recentlySeen(new Date(stamp - 10000).toISOString(), clock.now())).toBe(false)
})

it('ignores absent/invalid headers and recalibrates after reconnecting', () => {
  let elapsed = 0
  const clock = createServerClock(
    () => elapsed,
    () => stamp + 180000,
  )
  clock.observe(new Date(stamp).toUTCString())
  clock.observe(null)
  clock.observe('not a date')
  elapsed = 5000
  expect(clock.now()).toBe(stamp + 5000)
  clock.observe(new Date(stamp + 60000).toUTCString())
  expect(clock.now()).toBe(stamp + 60000)
})

it('rejects stale, missing, invalid and implausibly future heartbeats', () => {
  expect(recentlySeen(null, stamp)).toBe(false)
  expect(recentlySeen('invalid', stamp)).toBe(false)
  expect(recentlySeen(new Date(stamp - 45000).toISOString(), stamp)).toBe(false)
  expect(recentlySeen(new Date(stamp + 60000).toISOString(), stamp)).toBe(false)
  expect(recentlySeen(new Date(stamp + 500).toISOString(), stamp)).toBe(true)
})
