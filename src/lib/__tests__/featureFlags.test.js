import { describe, it, expect, afterEach, vi } from 'vitest'
import { isNewPrepTableEnabled } from '../featureFlags'

describe('isNewPrepTableEnabled', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('is on only for the exact string "true"', () => {
    expect(isNewPrepTableEnabled('true')).toBe(true)
  })

  it('stays off when unset, empty, or anything else', () => {
    for (const v of [undefined, '', 'false', 'TRUE', '1', 'yes']) {
      expect(isNewPrepTableEnabled(v)).toBe(false)
    }
  })

  it('reads the build setting by default', () => {
    vi.stubEnv('VITE_NEW_PREP_TABLE', 'true')
    expect(isNewPrepTableEnabled()).toBe(true)
    vi.stubEnv('VITE_NEW_PREP_TABLE', '')
    expect(isNewPrepTableEnabled()).toBe(false)
  })
})
