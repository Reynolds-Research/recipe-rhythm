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
})
