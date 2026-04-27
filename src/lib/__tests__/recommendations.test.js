import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getRecommendations,
  FAMILY_RATING_WEIGHT,
  PREP_TIME_PENALTY,
  DEFAULT_MAX_PREP_TIME_MINUTES,
} from '../recommendations'

describe('recommendations', () => {
  it('should return empty list if given empty inputs', () => {
    const result = getRecommendations([], [])
    expect(result).to.deep.equal([])
  })

  it('should appropriately score combinations based on variety', () => {
    const vault = [
      { id: '1', name: 'Meal A', cuisine_type: 'Mexican', flavor_profile: 'Spicy', proteins: ['Beef'] },
      { id: '2', name: 'Meal B', cuisine_type: 'Italian', flavor_profile: 'Savory', proteins: ['Chicken'] },
    ]
    const recentMeals = []
    
    const result = getRecommendations(vault, recentMeals, [], 2)
    expect(result.length).toBe(2)
    expect(result.map(r => r.name)).toContain('Meal A')
    expect(result.map(r => r.name)).toContain('Meal B')
  })

  it('should penalize and exclude meals eaten within recency window', () => {
    const vault = [
      { id: 'v1', name: 'Burger', cuisine_type: 'American', proteins: ['Beef'] },
      { id: 'v2', name: 'Tacos', cuisine_type: 'Mexican', proteins: ['Pork'] },
    ]
    const recentMeals = [
      { vault_id: 'v1', eaten_on: new Date().toISOString() } // eaten today!
    ]

    const result = getRecommendations(vault, recentMeals, [], 2)
    // Should exclude v1 because it was just eaten
    expect(result.length).toBe(1)
    expect(result[0].name).toBe('Tacos')
  })

  it('mixes wildcards in alongside vault picks when provided', () => {
    const vault = [
      { id: 'v1', name: 'Vault A', cuisine_type: 'Italian',  proteins: ['Chicken'] },
      { id: 'v2', name: 'Vault B', cuisine_type: 'Mexican',  proteins: ['Beef']    },
      { id: 'v3', name: 'Vault C', cuisine_type: 'Japanese', proteins: ['Fish']    },
      { id: 'v4', name: 'Vault D', cuisine_type: 'Indian',   proteins: ['Lamb']    },
      { id: 'v5', name: 'Vault E', cuisine_type: 'Thai',     proteins: ['Pork']    },
    ]
    const wildcards = [
      { id: 'w1', name: 'Wildcard X' },
      { id: 'w2', name: 'Wildcard Y' },
    ]

    const result = getRecommendations(vault, [], wildcards, 5)

    // floor(5 * 0.2) === 1, capped by wildcards.length=2 → 1 wildcard slot.
    expect(result.length).toBe(5)
    const wildcardEntries = result.filter(r => r.is_wildcard === true)
    expect(wildcardEntries.length).toBeGreaterThanOrEqual(1)
    const wildcardNames = wildcardEntries.map(r => r.name)
    expect(wildcardNames.every(n => ['Wildcard X', 'Wildcard Y'].includes(n))).toBe(true)
  })

  it('caps wildcards at ~20% of count even when many are provided', () => {
    const vault = Array.from({ length: 10 }, (_, i) => ({
      id: `v${i}`,
      name: `Vault ${i}`,
      cuisine_type: 'Italian',
      proteins: ['Chicken'],
    }))
    const wildcards = Array.from({ length: 10 }, (_, i) => ({
      id: `w${i}`,
      name: `Wildcard ${i}`,
    }))

    const result = getRecommendations(vault, [], wildcards, 5)

    expect(result.length).toBe(5)
    // floor(5 * 0.2) === 1 — at most one wildcard slot.
    const wildcardEntries = result.filter(r => r.is_wildcard === true)
    expect(wildcardEntries.length).toBe(1)
  })

  it('returns 100% vault picks when wildcards is empty (regression)', () => {
    const vault = [
      { id: 'v1', name: 'Vault A', cuisine_type: 'Italian',  proteins: ['Chicken'] },
      { id: 'v2', name: 'Vault B', cuisine_type: 'Mexican',  proteins: ['Beef']    },
      { id: 'v3', name: 'Vault C', cuisine_type: 'Japanese', proteins: ['Fish']    },
      { id: 'v4', name: 'Vault D', cuisine_type: 'Indian',   proteins: ['Lamb']    },
      { id: 'v5', name: 'Vault E', cuisine_type: 'Thai',     proteins: ['Pork']    },
    ]

    const result = getRecommendations(vault, [], [], 5)

    expect(result.length).toBe(5)
    expect(result.every(r => r.is_wildcard !== true)).toBe(true)
  })
})

// PRD-002 P0.5 + P0.8 — family_rating boost, prep_time penalty, excludeIds.
//
// The base score is jittered by Math.random()*15. To make ranking
// assertions deterministic we pin Math.random to a constant.
describe('recommendations — PRD-002 P0.5 / P0.8 scoring', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Helper: paired items differing only by the field under test, so the
  // random-jitter term (mocked to 0.5 → +7.5) cancels in the score delta.
  const pair = (overrideA, overrideB) => [
    { id: 'a', name: 'A', cuisine_type: 'Italian', proteins: ['Chicken'], ...overrideA },
    { id: 'b', name: 'B', cuisine_type: 'Italian', proteins: ['Chicken'], ...overrideB },
  ]
  const scoreOf = (result, name) => result.find(r => r.name === name)._score

  it('boosts vault items by +FAMILY_RATING_WEIGHT per family_rating star (P0.5)', () => {
    // Two items with identical attributes — only family_rating differs.
    // The 5-star item should outrank the unrated one.
    const vault = [
      { id: 'unrated', name: 'Unrated meal', cuisine_type: 'Italian', proteins: ['Chicken'], family_rating: null },
      { id: 'rated',   name: 'Rated meal',   cuisine_type: 'Italian', proteins: ['Chicken'], family_rating: 5 },
    ]

    const result = getRecommendations(vault, [], [], 2)

    expect(result.length).toBe(2)
    expect(result[0].name).toBe('Rated meal')
    expect(result[1].name).toBe('Unrated meal')
  })

  it('family_rating delta is exactly FAMILY_RATING_WEIGHT × stars vs. null (P0.5)', () => {
    for (const stars of [5, 3, 1]) {
      const vault = pair({ family_rating: stars }, { family_rating: null })
      const result = getRecommendations(vault, [], [], 2)
      expect(scoreOf(result, 'A') - scoreOf(result, 'B')).toBe(FAMILY_RATING_WEIGHT * stars)
    }
  })

  it('applies the prep-time penalty above the default cap (max=90 → >45 penalized) (P0.5)', () => {
    // Default cap is 90; half-cap = 45. prep=46 is over → -PREP_TIME_PENALTY.
    // A null prep_time_minutes is the unpenalized baseline.
    const vault = pair({ prep_time_minutes: 46 }, { prep_time_minutes: null })
    const result = getRecommendations(vault, [], [], 2)
    expect(scoreOf(result, 'B') - scoreOf(result, 'A')).toBe(PREP_TIME_PENALTY)
  })

  it('does NOT penalize at the boundary prep_time = max/2 (P0.5)', () => {
    // prep=45 with default max=90: 45 is NOT > 45, so no penalty.
    const vault = pair({ prep_time_minutes: 45 }, { prep_time_minutes: null })
    const result = getRecommendations(vault, [], [], 2)
    expect(scoreOf(result, 'A')).toBe(scoreOf(result, 'B'))
  })

  it('respects a custom maxPrepTimeMinutes via preferences (P0.5)', () => {
    // With max=60, half=30. prep=31 is over → penalty; prep=30 is exactly the
    // boundary → no penalty.
    const overVault = pair({ prep_time_minutes: 31 }, { prep_time_minutes: null })
    const overResult = getRecommendations(overVault, [], [], 2, [], {
      preferences: { max_prep_time_minutes: 60 },
    })
    expect(scoreOf(overResult, 'B') - scoreOf(overResult, 'A')).toBe(PREP_TIME_PENALTY)

    const boundaryVault = pair({ prep_time_minutes: 30 }, { prep_time_minutes: null })
    const boundaryResult = getRecommendations(boundaryVault, [], [], 2, [], {
      preferences: { max_prep_time_minutes: 60 },
    })
    expect(scoreOf(boundaryResult, 'A')).toBe(scoreOf(boundaryResult, 'B'))
  })

  it('combines family_rating boost and prep-time penalty additively (P0.5)', () => {
    // Default cap 90; 5-star + prep=60 → +50 (rating) -15 (prep) = +35 vs null/null baseline.
    const vault = pair(
      { family_rating: 5, prep_time_minutes: 60 },
      { family_rating: null, prep_time_minutes: null },
    )
    const result = getRecommendations(vault, [], [], 2)
    expect(scoreOf(result, 'A') - scoreOf(result, 'B')).toBe(
      FAMILY_RATING_WEIGHT * 5 - PREP_TIME_PENALTY,
    )
  })

  it('exposes DEFAULT_MAX_PREP_TIME_MINUTES = 90 (P0.5)', () => {
    expect(DEFAULT_MAX_PREP_TIME_MINUTES).toBe(90)
  })

  it('hard-excludes vault items listed in options.excludeIds (P0.8)', () => {
    const vault = [
      { id: 'v1', name: 'Vault A', cuisine_type: 'Italian',  proteins: ['Chicken'] },
      { id: 'v2', name: 'Vault B', cuisine_type: 'Mexican',  proteins: ['Beef']    },
      { id: 'v3', name: 'Vault C', cuisine_type: 'Japanese', proteins: ['Fish']    },
    ]

    const result = getRecommendations(vault, [], [], 3, [], { excludeIds: ['v2'] })

    // v2 was excluded — only v1 and v3 should appear.
    expect(result.length).toBe(2)
    const names = result.map(r => r.name)
    expect(names).not.toContain('Vault B')
    expect(names).toContain('Vault A')
    expect(names).toContain('Vault C')
  })

  it('excludeIds = [] is byte-for-byte identical to omitting the option (P0.8)', () => {
    const vault = [
      { id: 'v1', name: 'Vault A', cuisine_type: 'Italian',  proteins: ['Chicken'] },
      { id: 'v2', name: 'Vault B', cuisine_type: 'Mexican',  proteins: ['Beef']    },
      { id: 'v3', name: 'Vault C', cuisine_type: 'Japanese', proteins: ['Fish']    },
    ]

    const without = getRecommendations(vault, [], [], 3)
    const withEmpty = getRecommendations(vault, [], [], 3, [], { excludeIds: [] })

    // Math.random is pinned to 0.5 in beforeEach, so jitter is identical
    // across calls — names, order, and scores must match exactly.
    expect(withEmpty.map(r => r.name)).toEqual(without.map(r => r.name))
    expect(withEmpty.map(r => r._score)).toEqual(without.map(r => r._score))
  })

  it('returns [] when excludeIds covers every eligible vault item (P0.8)', () => {
    const vault = [
      { id: 'v1', name: 'Vault A', cuisine_type: 'Italian',  proteins: ['Chicken'] },
      { id: 'v2', name: 'Vault B', cuisine_type: 'Mexican',  proteins: ['Beef']    },
      { id: 'v3', name: 'Vault C', cuisine_type: 'Japanese', proteins: ['Fish']    },
    ]

    const result = getRecommendations(vault, [], [], 3, [], {
      excludeIds: ['v1', 'v2', 'v3'],
    })

    // All eligible items excluded — no fallback that re-includes them.
    expect(result).toEqual([])
  })
})
