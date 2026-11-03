import { describe, it, expect } from 'vitest'
import { isNewPrepTableEnabled } from '../featureFlags'

describe('isNewPrepTableEnabled', () => {
  it('is on only for the exact string "true"', () => {
    expect(isNewPrepTableEnabled({ VITE_NEW_PREP_TABLE: 'true' })).toBe(true)
  })

  it('stays off when unset, empty, or anything else', () => {
    for (const v of [undefined, '', 'false', 'TRUE', '1', 'yes']) {
      expect(isNewPrepTableEnabled({ VITE_NEW_PREP_TABLE: v })).toBe(false)
    }
    expect(isNewPrepTableEnabled({})).toBe(false)
    expect(isNewPrepTableEnabled(undefined)).toBe(false)
  })
})
