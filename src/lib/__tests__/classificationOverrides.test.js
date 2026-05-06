import { describe, it, expect } from 'vitest'
import { mergeWithUserOverrides, applyOverride } from '../classificationOverrides'

describe('mergeWithUserOverrides', () => {
  it('returns newAi unchanged when existing is null', () => {
    const newAi = [{ name: 'onion', essentiality: 'omittable', source: 'ai' }]
    expect(mergeWithUserOverrides(newAi, null)).toBe(newAi)
  })

  it('returns newAi unchanged when existing is not an array', () => {
    const newAi = [{ name: 'onion', essentiality: 'omittable', source: 'ai' }]
    expect(mergeWithUserOverrides(newAi, undefined)).toBe(newAi)
    expect(mergeWithUserOverrides(newAi, {})).toBe(newAi)
  })

  it('returns newAi unchanged when existing has no user-source entries', () => {
    const newAi = [{ name: 'onion', essentiality: 'omittable', source: 'ai' }]
    const existing = [{ name: 'onion', essentiality: 'essential', source: 'ai' }]
    expect(mergeWithUserOverrides(newAi, existing)).toBe(newAi)
  })

  it('preserves a user override on a matched name (case-insensitive)', () => {
    const newAi = [
      { name: 'Onion',  essentiality: 'omittable', source: 'ai' },
      { name: 'garlic', essentiality: 'essential', source: 'ai' },
    ]
    const existing = [
      { name: 'onion', essentiality: 'essential', source: 'user' },
    ]
    const merged = mergeWithUserOverrides(newAi, existing)

    expect(merged).toEqual([
      { name: 'onion',  essentiality: 'essential', source: 'user' },
      { name: 'garlic', essentiality: 'essential', source: 'ai' },
    ])
  })

  it('keeps newAi order stable when overrides apply', () => {
    const newAi = [
      { name: 'a', essentiality: 'essential', source: 'ai' },
      { name: 'b', essentiality: 'omittable', source: 'ai' },
      { name: 'c', essentiality: 'essential', source: 'ai' },
    ]
    const existing = [
      { name: 'b', essentiality: 'essential', source: 'user' },
      { name: 'c', essentiality: 'omittable', source: 'user' },
    ]
    const merged = mergeWithUserOverrides(newAi, existing)
    expect(merged.map(c => c.name)).toEqual(['a', 'b', 'c'])
  })

  it('drops orphan user overrides (existing names that newAi removed)', () => {
    const newAi = [{ name: 'onion', essentiality: 'omittable', source: 'ai' }]
    const existing = [
      { name: 'onion',         essentiality: 'essential', source: 'user' },
      { name: 'removed-thing', essentiality: 'essential', source: 'user' },
    ]
    const merged = mergeWithUserOverrides(newAi, existing)
    expect(merged.map(c => c.name)).toEqual(['onion'])
  })

  it('returns [] when newAi is not an array', () => {
    expect(mergeWithUserOverrides(null, [])).toEqual([])
    expect(mergeWithUserOverrides(undefined, [])).toEqual([])
  })

  it('ignores malformed user overrides (missing essentiality, etc.)', () => {
    const newAi = [{ name: 'onion', essentiality: 'omittable', source: 'ai' }]
    const existing = [
      { name: 'onion', essentiality: 'mystery', source: 'user' },
      null,
      { source: 'user' },
    ]
    expect(mergeWithUserOverrides(newAi, existing)).toEqual([
      { name: 'onion', essentiality: 'omittable', source: 'ai' },
    ])
  })
})

describe('applyOverride', () => {
  it('flips essentiality and stamps source=user on a matched name', () => {
    const before = [
      { name: 'onion',  essentiality: 'omittable', source: 'ai' },
      { name: 'garlic', essentiality: 'essential', source: 'ai' },
    ]
    const after = applyOverride(before, 'onion', 'essential')
    expect(after).toEqual([
      { name: 'onion',  essentiality: 'essential', source: 'user' },
      { name: 'garlic', essentiality: 'essential', source: 'ai' },
    ])
    expect(after).not.toBe(before)
  })

  it('returns input unchanged when name does not match any entry', () => {
    const before = [{ name: 'onion', essentiality: 'omittable', source: 'ai' }]
    const after = applyOverride(before, 'cilantro', 'essential')
    expect(after).toBe(before)
  })

  it('matches case-insensitively', () => {
    const before = [{ name: 'Garlic', essentiality: 'essential', source: 'ai' }]
    const after = applyOverride(before, 'GARLIC', 'omittable')
    expect(after[0]).toEqual({ name: 'Garlic', essentiality: 'omittable', source: 'user' })
  })

  it('rejects unknown essentiality values', () => {
    const before = [{ name: 'onion', essentiality: 'omittable', source: 'ai' }]
    expect(applyOverride(before, 'onion', 'mystery')).toBe(before)
  })

  it('handles non-array input defensively', () => {
    expect(applyOverride(null, 'onion', 'essential')).toBe(null)
    expect(applyOverride(undefined, 'onion', 'essential')).toBe(undefined)
  })
})
