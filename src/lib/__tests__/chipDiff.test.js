/**
 * PRD-006 D1: chip-diff helper for the vault edit flow.
 *
 * `chipsRequireReExtraction(oldChips, newChips)` returns true when any
 * structural chip category (proteins, main_carb, dairy_components,
 * vegetables, fruits) changed between snapshots. It must NOT trigger on
 * cosmetic-only changes like prep_time_minutes, notes, or family_rating.
 */
import { describe, it, expect } from 'vitest'
import { chipsRequireReExtraction } from '../chipDiff'

describe('chipsRequireReExtraction — true cases (structural change)', () => {
  it('returns true when main_carb changed (scalar)', () => {
    const before = { proteins: ['Chicken'], main_carb: 'Rice', dairy_components: [], vegetables: [], fruits: [] }
    const after  = { proteins: ['Chicken'], main_carb: 'Pasta', dairy_components: [], vegetables: [], fruits: [] }
    expect(chipsRequireReExtraction(before, after)).toBe(true)
  })

  it('returns true when proteins added (array gained an item)', () => {
    const before = { proteins: ['Chicken'], main_carb: null, dairy_components: [], vegetables: [], fruits: [] }
    const after  = { proteins: ['Chicken', 'Beef'], main_carb: null, dairy_components: [], vegetables: [], fruits: [] }
    expect(chipsRequireReExtraction(before, after)).toBe(true)
  })

  it('returns true when proteins removed (array lost an item)', () => {
    const before = { proteins: ['Chicken', 'Beef'], main_carb: null, dairy_components: [], vegetables: [], fruits: [] }
    const after  = { proteins: ['Chicken'], main_carb: null, dairy_components: [], vegetables: [], fruits: [] }
    expect(chipsRequireReExtraction(before, after)).toBe(true)
  })

  it('returns true when vegetables array gains an item', () => {
    const before = { proteins: [], main_carb: null, dairy_components: [], vegetables: [], fruits: [] }
    const after  = { proteins: [], main_carb: null, dairy_components: [], vegetables: ['Spinach'], fruits: [] }
    expect(chipsRequireReExtraction(before, after)).toBe(true)
  })

  it('returns true when vegetables array loses an item', () => {
    const before = { proteins: [], main_carb: null, dairy_components: [], vegetables: ['Spinach', 'Carrot'], fruits: [] }
    const after  = { proteins: [], main_carb: null, dairy_components: [], vegetables: ['Spinach'], fruits: [] }
    expect(chipsRequireReExtraction(before, after)).toBe(true)
  })

  it('returns true when array values swap (same length, different members)', () => {
    const before = { proteins: ['Chicken'], main_carb: null, dairy_components: [], vegetables: [], fruits: [] }
    const after  = { proteins: ['Beef'],    main_carb: null, dairy_components: [], vegetables: [], fruits: [] }
    expect(chipsRequireReExtraction(before, after)).toBe(true)
  })

  it('returns true when main_carb goes from null to a value', () => {
    const before = { proteins: [], main_carb: null,    dairy_components: [], vegetables: [], fruits: [] }
    const after  = { proteins: [], main_carb: 'Bread', dairy_components: [], vegetables: [], fruits: [] }
    expect(chipsRequireReExtraction(before, after)).toBe(true)
  })

  it('returns true when dairy_components changes', () => {
    const before = { proteins: [], main_carb: null, dairy_components: [],          vegetables: [], fruits: [] }
    const after  = { proteins: [], main_carb: null, dairy_components: ['Cheese'],  vegetables: [], fruits: [] }
    expect(chipsRequireReExtraction(before, after)).toBe(true)
  })

  it('returns true when fruits changes', () => {
    const before = { proteins: [], main_carb: null, dairy_components: [], vegetables: [], fruits: [] }
    const after  = { proteins: [], main_carb: null, dairy_components: [], vegetables: [], fruits: ['Apple'] }
    expect(chipsRequireReExtraction(before, after)).toBe(true)
  })
})

describe('chipsRequireReExtraction — false cases (cosmetic / no change)', () => {
  it('returns false when chips are identical (deep equal arrays + scalars)', () => {
    const a = { proteins: ['Chicken'], main_carb: 'Rice', dairy_components: ['Butter'], vegetables: ['Onion'], fruits: [] }
    const b = { proteins: ['Chicken'], main_carb: 'Rice', dairy_components: ['Butter'], vegetables: ['Onion'], fruits: [] }
    expect(chipsRequireReExtraction(a, b)).toBe(false)
  })

  it('returns false when only prep_time_minutes changes', () => {
    const before = { proteins: ['Chicken'], main_carb: 'Rice', dairy_components: [], vegetables: [], fruits: [], prep_time_minutes: 30 }
    const after  = { proteins: ['Chicken'], main_carb: 'Rice', dairy_components: [], vegetables: [], fruits: [], prep_time_minutes: 60 }
    expect(chipsRequireReExtraction(before, after)).toBe(false)
  })

  it('returns false when only notes / cuisine_type / flavor_profile change', () => {
    const before = { proteins: [], main_carb: null, dairy_components: [], vegetables: [], fruits: [], notes: 'old', cuisine_type: 'Thai',    flavor_profile: 'Savory' }
    const after  = { proteins: [], main_carb: null, dairy_components: [], vegetables: [], fruits: [], notes: 'new', cuisine_type: 'Italian', flavor_profile: 'Spicy'  }
    expect(chipsRequireReExtraction(before, after)).toBe(false)
  })

  it('returns false when only cooking_method changes (cooking_method is NOT a structural ingredient driver)', () => {
    const before = { proteins: ['Chicken'], main_carb: 'Rice', dairy_components: [], vegetables: [], fruits: [], cooking_method: 'Baked' }
    const after  = { proteins: ['Chicken'], main_carb: 'Rice', dairy_components: [], vegetables: [], fruits: [], cooking_method: 'Grilled' }
    expect(chipsRequireReExtraction(before, after)).toBe(false)
  })

  it('returns false when array order differs but contents are the same', () => {
    const before = { proteins: ['Chicken', 'Beef'], main_carb: null, dairy_components: [], vegetables: ['Onion', 'Carrot'], fruits: [] }
    const after  = { proteins: ['Beef', 'Chicken'], main_carb: null, dairy_components: [], vegetables: ['Carrot', 'Onion'], fruits: [] }
    expect(chipsRequireReExtraction(before, after)).toBe(false)
  })

  it('treats missing fields as null/empty (so no spurious change)', () => {
    expect(chipsRequireReExtraction({}, {})).toBe(false)
    expect(chipsRequireReExtraction({ proteins: [] }, {})).toBe(false)
    expect(chipsRequireReExtraction({}, { proteins: [], main_carb: null })).toBe(false)
  })

  it('handles null inputs gracefully', () => {
    expect(chipsRequireReExtraction(null, null)).toBe(false)
    expect(chipsRequireReExtraction(null, { proteins: ['Chicken'] })).toBe(true)
    expect(chipsRequireReExtraction({ proteins: ['Chicken'] }, null)).toBe(true)
  })
})
