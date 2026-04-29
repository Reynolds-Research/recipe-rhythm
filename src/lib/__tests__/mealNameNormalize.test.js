import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { toTitleCase, normalizeMealName } from '../mealNameNormalize'

describe('toTitleCase', () => {
  it('returns empty string for non-string input', () => {
    expect(toTitleCase(null)).toBe('')
    expect(toTitleCase(undefined)).toBe('')
    expect(toTitleCase(42)).toBe('')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(toTitleCase('   ')).toBe('')
  })

  it('capitalizes a single word', () => {
    expect(toTitleCase('spaghetti')).toBe('Spaghetti')
  })

  it('capitalizes every meaningful word', () => {
    expect(toTitleCase('chicken parmesan')).toBe('Chicken Parmesan')
  })

  it('lowercases stop-words mid-name', () => {
    expect(toTitleCase('mac and cheese')).toBe('Mac and Cheese')
    expect(toTitleCase('chicken with rice')).toBe('Chicken with Rice')
    expect(toTitleCase('pasta in tomato sauce')).toBe('Pasta in Tomato Sauce')
  })

  it('always capitalizes the first and last word, even if a stop-word', () => {
    expect(toTitleCase('the godfather')).toBe('The Godfather')
    expect(toTitleCase('cake to go')).toBe('Cake to Go')
  })

  it('handles excessive whitespace by collapsing it', () => {
    expect(toTitleCase('  chicken    parmesan  ')).toBe('Chicken Parmesan')
  })

  it('lowercases SHOUTING input', () => {
    expect(toTitleCase('CHICKEN PARMESAN')).toBe('Chicken Parmesan')
  })

  it('preserves all-caps acronyms (≥2 chars)', () => {
    expect(toTitleCase('BBQ pulled pork')).toBe('BBQ Pulled Pork')
    expect(toTitleCase('BLT sandwich')).toBe('BLT Sandwich')
  })

  it('title-cases hyphenated words on each side of the hyphen', () => {
    expect(toTitleCase('stir-fry beef')).toBe('Stir-Fry Beef')
    expect(toTitleCase('slow-cooked brisket')).toBe('Slow-Cooked Brisket')
  })

  it('handles mixed casing input', () => {
    expect(toTitleCase('cHiCkEn PaRmEsAn')).toBe('Chicken Parmesan')
  })

  it('handles single-letter stop-words mid-name', () => {
    expect(toTitleCase('peanut butter and jelly')).toBe('Peanut Butter and Jelly')
  })
})

describe('normalizeMealName', () => {
  let originalFetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('returns empty result for empty input', async () => {
    const r = await normalizeMealName('')
    expect(r).toEqual({ corrected: '', hasChanges: false })
  })

  it('returns empty result for whitespace input', async () => {
    const r = await normalizeMealName('   ')
    expect(r).toEqual({ corrected: '', hasChanges: false })
  })

  it('uses the API-corrected name and reports changes', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ corrected: 'Spaghetti Carbonara' }),
    })
    const r = await normalizeMealName('spagheti carbonera')
    expect(r.corrected).toBe('Spaghetti Carbonara')
    expect(r.hasChanges).toBe(true)
  })

  it('reports hasChanges=false when corrected matches the trimmed input', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ corrected: 'Chicken Parmesan' }),
    })
    const r = await normalizeMealName('Chicken Parmesan')
    expect(r.hasChanges).toBe(false)
  })

  it('falls back to local title-case when fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await normalizeMealName('chicken parmesan')
    expect(r.corrected).toBe('Chicken Parmesan')
    expect(r.hasChanges).toBe(true)
    expect(r.error).toBe('network')
  })

  it('falls back to local title-case on non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })
    const r = await normalizeMealName('chicken parmesan')
    expect(r.corrected).toBe('Chicken Parmesan')
    expect(r.error).toBe('upstream')
  })

  it('falls back to local title-case when API returns malformed JSON', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new Error('bad json') },
    })
    const r = await normalizeMealName('chicken parmesan')
    expect(r.corrected).toBe('Chicken Parmesan')
    expect(r.error).toBe('parse')
  })

  it('falls back to local title-case when API returns no corrected field', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ corrected: '' }),
    })
    const r = await normalizeMealName('chicken parmesan')
    expect(r.corrected).toBe('Chicken Parmesan')
  })
})
