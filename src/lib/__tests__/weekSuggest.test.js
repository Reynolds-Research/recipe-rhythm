import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { suggestForDays } from '../weekSuggest'

const vault = [
  { id: 'v1', name: 'Green curry', cuisine_type: 'Thai', proteins: ['Chicken'] },
  { id: 'v2', name: 'Tacos', cuisine_type: 'Mexican', proteins: ['Beef'] },
  { id: 'v3', name: 'Gnocchi', cuisine_type: 'Italian', proteins: ['None'] },
  { id: 'v4', name: 'Salmon bowls', cuisine_type: 'Japanese', proteins: ['Fish'] },
]

describe('suggestForDays', () => {
  beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.5))
  afterEach(() => vi.restoreAllMocks())

  it('proposes one different cookbook recipe per empty day', () => {
    const out = suggestForDays({ dates: ['2026-11-04', '2026-11-05'], vault })
    expect(Object.keys(out)).toEqual(['2026-11-04', '2026-11-05'])
    expect(out['2026-11-04'].id).not.toBe(out['2026-11-05'].id)
    expect(out['2026-11-04'].source).toBe('vault')
  })

  it("never repeats a recipe already in the week", () => {
    const weekMeals = [
      { vault_id: 'v1', name: 'Green curry', planned_on: '2026-11-02' },
      { vault_id: 'v2', name: 'Tacos', planned_on: '2026-11-03' },
    ]
    const out = suggestForDays({ dates: ['2026-11-04', '2026-11-05', '2026-11-06'], vault, weekMeals })
    const ids = Object.values(out).map((r) => r.id)
    expect(ids).not.toContain('v1')
    expect(ids).not.toContain('v2')
  })

  it('skips recipes she dismissed or that are already proposed', () => {
    const out = suggestForDays({ dates: ['2026-11-04'], vault, skipIds: ['v1', 'v2', 'v3'] })
    expect(out['2026-11-04'].id).toBe('v4')
  })

  it('leaves a day out when there is nothing left to propose', () => {
    const out = suggestForDays({ dates: ['2026-11-04', '2026-11-05'], vault, skipIds: ['v1', 'v2', 'v3'] })
    expect(Object.keys(out)).toEqual(['2026-11-04'])
  })

  it('respects preferences as a hard filter', () => {
    const out = suggestForDays({
      dates: ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'],
      vault,
      preferences: { excluded_cuisines: ['Thai', 'Mexican'], dietary_restrictions: [], excluded_ingredients: [] },
    })
    const ids = Object.values(out).map((r) => r.id)
    expect(ids).not.toContain('v1')
    expect(ids).not.toContain('v2')
  })

  it('returns nothing with no days or an empty cookbook', () => {
    expect(suggestForDays({ dates: [], vault })).toEqual({})
    expect(suggestForDays({ dates: ['2026-11-04'], vault: [] })).toEqual({})
  })
})
