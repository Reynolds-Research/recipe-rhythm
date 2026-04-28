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
    // PRD-002 P0.9: every vault pick is now tagged source='vault'.
    expect(result.every(r => r.source === 'vault')).toBe(true)
  })
})

// PRD-002 P0.9 — AI candidates are merged into the same sorted list as vault
// hits (instead of taking a fixed 20% slot allocation), tagged with source,
// deduped against the vault batch by exact name match, and assigned the
// median of the vault batch's scores so they participate in the sort.
describe('recommendations — PRD-002 P0.9 AI candidate merging', () => {
  beforeEach(() => {
    // Pin the random jitter so score-based ranking is deterministic.
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('tags vault items source="vault" and AI items source="ai" when both are present', () => {
    const vault = [
      { id: 'v1', name: 'Vault A', cuisine_type: 'Italian',  proteins: ['Chicken'] },
      { id: 'v2', name: 'Vault B', cuisine_type: 'Mexican',  proteins: ['Beef']    },
      { id: 'v3', name: 'Vault C', cuisine_type: 'Japanese', proteins: ['Fish']    },
    ]
    const wildcards = [
      { id: 'ai-1', name: 'AI Pick 1' },
      { id: 'ai-2', name: 'AI Pick 2' },
      { id: 'ai-3', name: 'AI Pick 3' },
    ]

    const result = getRecommendations(vault, [], wildcards, 3)

    const ai = result.filter(r => r.source === 'ai')
    const vaultTagged = result.filter(r => r.source === 'vault')
    expect(ai).toHaveLength(3)
    expect(vaultTagged).toHaveLength(3)
    // Legacy is_wildcard flag still set on AI items for older render paths.
    expect(ai.every(r => r.is_wildcard === true)).toBe(true)
    expect(vaultTagged.every(r => r.is_wildcard !== true)).toBe(true)
  })

  it('drops an AI item whose name exact-matches a vault batch item (case-insensitive)', () => {
    const vault = [
      { id: 'v1', name: 'Pad Thai',     cuisine_type: 'Thai',     proteins: ['Shrimp/Seafood'] },
      { id: 'v2', name: 'Beef Tacos',   cuisine_type: 'Mexican',  proteins: ['Beef']           },
      { id: 'v3', name: 'Chicken Soup', cuisine_type: 'American', proteins: ['Chicken']        },
    ]
    const wildcards = [
      { id: 'ai-1', name: '  pad thai  ' },     // dup of v1 (case + whitespace)
      { id: 'ai-2', name: 'Lobster Roll' },     // unique
      { id: 'ai-3', name: 'BEEF TACOS' },       // dup of v2 (case)
    ]

    const result = getRecommendations(vault, [], wildcards, 3)

    const ai = result.filter(r => r.source === 'ai')
    expect(ai).toHaveLength(1)
    expect(ai[0].name).toBe('Lobster Roll')
  })

  it('returns vault-only results without throwing when wildcards is empty / undefined', () => {
    const vault = [
      { id: 'v1', name: 'Vault A', cuisine_type: 'Italian', proteins: ['Chicken'] },
      { id: 'v2', name: 'Vault B', cuisine_type: 'Mexican', proteins: ['Beef']    },
    ]

    // The brainstorm-load path falls through to wildcards=[] when the
    // /api/swap-suggestions fetch fails — it must not throw.
    expect(() => getRecommendations(vault, [], [],         2)).not.toThrow()
    expect(() => getRecommendations(vault, [], undefined,  2)).not.toThrow()

    const result = getRecommendations(vault, [], [], 2)
    expect(result).toHaveLength(2)
    expect(result.every(r => r.source === 'vault')).toBe(true)
  })

  it('AI items participate in the sorted output (in score order, not appended)', () => {
    // Build vault with a wide score spread driven by family_rating (+10/star,
    // P0.5). With recentMeals=[] every cuisine clears the diversity check the
    // same way, so family_rating is the cleanest deterministic differentiator.
    const vault = [
      // 5★ → +50 family bonus.
      { id: 'high1', name: 'High Score 1', cuisine_type: 'Thai',     proteins: ['Shrimp/Seafood'], family_rating: 5 },
      { id: 'high2', name: 'High Score 2', cuisine_type: 'Japanese', proteins: ['Fish'],           family_rating: 5 },
      // 3★ → +30 family bonus (this is where the median sits).
      { id: 'mid1',  name: 'Mid Score 1',  cuisine_type: 'Italian',  proteins: ['Chicken'],        family_rating: 3 },
      { id: 'mid2',  name: 'Mid Score 2',  cuisine_type: 'Mexican',  proteins: ['Beef'],           family_rating: 3 },
      // Unrated → no family bonus, lowest rank.
      { id: 'low1',  name: 'Low Score 1',  cuisine_type: 'Indian',   proteins: ['Lamb'] },
      { id: 'low2',  name: 'Low Score 2',  cuisine_type: 'French',   proteins: ['Duck'] },
    ]
    const wildcards = [
      { id: 'ai-1', name: 'AI Pick A' },
      { id: 'ai-2', name: 'AI Pick B' },
    ]

    const result = getRecommendations(vault, [], wildcards, 6)

    // Sanity: AI items show up.
    const aiIndices = result.map((r, i) => (r.source === 'ai' ? i : -1)).filter(i => i >= 0)
    expect(aiIndices.length).toBe(2)

    // Acceptance criterion #4: AI items are not all clumped at the end —
    // there's at least one vault item ranked below an AI item.
    const lastAiIndex = Math.max(...aiIndices)
    expect(lastAiIndex).toBeLessThan(result.length - 1)
    expect(result[result.length - 1].source).toBe('vault')

    // Result is sorted by score descending throughout.
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]._score).toBeGreaterThanOrEqual(result[i]._score)
    }
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

// PRD-002 P0.3 — household preferences hard-filter. The recommender drops any
// vault candidate that fails `passesPreferences` BEFORE scoring, and AI items
// returned via `wildcards` are post-filtered the same way (belt-and-suspenders
// on top of the AI prompt the proxy already gave).
describe('recommendations — PRD-002 P0.3 preference hard filter', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('drops vault items that violate dietary_restrictions before scoring', () => {
    const vault = [
      { id: 'v1', name: 'Beef Tacos',     cuisine_type: 'Mexican', proteins: ['Beef']    },
      { id: 'v2', name: 'Chicken Curry',  cuisine_type: 'Indian',  proteins: ['Chicken'] },
      { id: 'v3', name: 'Tofu Stir Fry',  cuisine_type: 'Chinese', proteins: ['Tofu']    },
      { id: 'v4', name: 'Lentil Stew',    cuisine_type: 'Indian',  proteins: ['Beans/Lentils'] },
    ]
    const result = getRecommendations(vault, [], [], 4, [], {
      preferences: {
        dietary_restrictions: ['vegetarian'],
        excluded_cuisines: [],
        excluded_ingredients: [],
        max_prep_time_minutes: null,
      },
    })

    const names = result.map(r => r.name)
    expect(names).not.toContain('Beef Tacos')
    expect(names).not.toContain('Chicken Curry')
    expect(names).toContain('Tofu Stir Fry')
    expect(names).toContain('Lentil Stew')
  })

  it('drops vault items by excluded_cuisines + excluded_ingredients combined', () => {
    const vault = [
      { id: 'v1', name: 'Pizza',     cuisine_type: 'Italian',  proteins: ['Cheese'] },
      { id: 'v2', name: 'Pad Thai',  cuisine_type: 'Thai',     proteins: ['Shrimp/Seafood'] },
      { id: 'v3', name: 'Burrito',   cuisine_type: 'Mexican',  proteins: ['Beef'], vegetables: ['Tomato'] },
      { id: 'v4', name: 'Yakisoba',  cuisine_type: 'Japanese', proteins: ['Pork'] },
    ]
    const result = getRecommendations(vault, [], [], 4, [], {
      preferences: {
        dietary_restrictions: [],
        excluded_cuisines: ['Italian'],
        excluded_ingredients: ['tomato'],
        max_prep_time_minutes: null,
      },
    })

    const names = result.map(r => r.name)
    expect(names).not.toContain('Pizza')        // excluded cuisine
    expect(names).not.toContain('Burrito')      // excluded ingredient (tomato)
    expect(names).toContain('Pad Thai')
    expect(names).toContain('Yakisoba')
  })

  it('omitting preferences (or passing null) preserves pre-P0.3 behavior byte-for-byte', () => {
    const vault = [
      { id: 'v1', name: 'Vault A', cuisine_type: 'Italian',  proteins: ['Chicken'] },
      { id: 'v2', name: 'Vault B', cuisine_type: 'Mexican',  proteins: ['Beef']    },
      { id: 'v3', name: 'Vault C', cuisine_type: 'Japanese', proteins: ['Fish']    },
    ]
    const without = getRecommendations(vault, [], [], 3)
    const withNull = getRecommendations(vault, [], [], 3, [], { preferences: null })

    // Math.random pinned to 0.5 → identical jitter; identical names, order, scores.
    expect(withNull.map(r => r.name)).toEqual(without.map(r => r.name))
    expect(withNull.map(r => r._score)).toEqual(without.map(r => r._score))
  })

  it('drops AI candidates returned by the swap-suggestions response when their name violates preferences', () => {
    const vault = [
      { id: 'v1', name: 'Tofu Stir Fry', cuisine_type: 'Chinese', proteins: ['Tofu']          },
      { id: 'v2', name: 'Lentil Stew',   cuisine_type: 'Indian',  proteins: ['Beans/Lentils'] },
    ]
    // Two AI candidates — one would survive (Veggie Burrito), one would not
    // (Cilantro Lime Rice — name contains the excluded ingredient).
    const wildcards = [
      { id: 'ai-1', name: 'Cilantro Lime Rice' },
      { id: 'ai-2', name: 'Veggie Burrito' },
    ]
    const result = getRecommendations(vault, [], wildcards, 2, [], {
      preferences: {
        dietary_restrictions: [],
        excluded_cuisines: [],
        excluded_ingredients: ['cilantro'],
        max_prep_time_minutes: null,
      },
    })

    const aiNames = result.filter(r => r.source === 'ai').map(r => r.name)
    expect(aiNames).not.toContain('Cilantro Lime Rice')
    expect(aiNames).toContain('Veggie Burrito')
  })

  it('returns [] (no soft fallback) when every vault item violates preferences', () => {
    const vault = [
      { id: 'v1', name: 'Beef Tacos',    proteins: ['Beef']    },
      { id: 'v2', name: 'Chicken Curry', proteins: ['Chicken'] },
    ]
    const result = getRecommendations(vault, [], [], 2, [], {
      preferences: {
        dietary_restrictions: ['vegetarian'],
        excluded_cuisines: [],
        excluded_ingredients: [],
        max_prep_time_minutes: null,
      },
    })
    expect(result).toEqual([])
  })
})
