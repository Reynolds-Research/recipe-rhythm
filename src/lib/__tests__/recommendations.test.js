import { describe, it, expect } from 'vitest'
import { getRecommendations } from '../recommendations'

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
