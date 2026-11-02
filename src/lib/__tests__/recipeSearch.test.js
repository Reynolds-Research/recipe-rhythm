import { describe, it, expect } from 'vitest'
import { searchRecipes } from '../recipeSearch'

const r = (id, name, extra = {}) => ({ id, name, ...extra })

describe('searchRecipes', () => {
  it('ranks name-prefix matches above other name matches', () => {
    const recipes = [r(1, 'Fish Tacos'), r(2, 'Tacos al Pastor')]
    expect(searchRecipes(recipes, 'taco').map(x => x.id)).toEqual([2, 1])
  })

  it('returns [] for an empty or whitespace-only query', () => {
    const recipes = [r(1, 'Roast'), r(2, 'Curry')]
    expect(searchRecipes(recipes, '')).toEqual([])
    expect(searchRecipes(recipes, '   \t ')).toEqual([])
    expect(searchRecipes(recipes, null)).toEqual([])
  })

  it('is case- and accent-insensitive in both directions', () => {
    const recipes = [r(1, 'Jalapeño Poppers'), r(2, 'Roast')]
    expect(searchRecipes(recipes, 'JALAPENO').map(x => x.id)).toEqual([1])
    expect(searchRecipes([r(3, 'Jalapeno Dip')], 'jalapeño').map(x => x.id)).toEqual([3])
  })

  it('collapses extra whitespace in the query', () => {
    const recipes = [r(1, 'Tacos al Pastor')]
    expect(searchRecipes(recipes, '  tacos    al  ').map(x => x.id)).toEqual([1])
  })

  it('requires every word to match (AND), across fields', () => {
    const recipes = [
      r(1, 'Chicken Tacos', { cuisine_type: 'Mexican', proteins: ['Chicken'] }),
      r(2, 'Green Curry', { cuisine_type: 'Thai', proteins: ['Chicken'] }),
    ]
    expect(searchRecipes(recipes, 'chicken thai').map(x => x.id)).toEqual([2])
  })

  it('matches on an array tag and on notes', () => {
    const recipes = [
      r(1, 'Weeknight Bowl', { proteins: ['Salmon'] }),
      r(2, 'Grandma special', { notes: 'Use the cast-iron pan' }),
      r(3, 'Roast'),
    ]
    expect(searchRecipes(recipes, 'salmon').map(x => x.id)).toEqual([1])
    expect(searchRecipes(recipes, 'cast-iron').map(x => x.id)).toEqual([2])
  })

  it("ignores null and 'None' field values", () => {
    const recipes = [
      r(1, 'Plain Rice', { main_carb: 'None', proteins: null, dietary_tags: ['None'] }),
    ]
    expect(searchRecipes(recipes, 'none')).toEqual([])
    expect(searchRecipes(recipes, 'rice').map(x => x.id)).toEqual([1])
  })

  it('ranks: name prefix, then all words in name, then tag/notes-only matches', () => {
    const recipes = [
      r(1, 'Quesadillas', { notes: 'Leftover filling works for tacos too' }),
      r(2, 'Fish Tacos'),
      r(3, 'Tacos al Pastor'),
    ]
    expect(searchRecipes(recipes, 'taco').map(x => x.id)).toEqual([3, 2, 1])
  })

  it('keeps input order on ties', () => {
    const recipes = [r(1, 'Beef Tacos'), r(2, 'Fish Tacos'), r(3, 'Pork Tacos')]
    expect(searchRecipes(recipes, 'tacos').map(x => x.id)).toEqual([1, 2, 3])
  })

  it('does not mutate the input array or its items', () => {
    const recipes = [r(1, 'Fish Tacos'), r(2, 'Tacos al Pastor', { proteins: ['Pork'] })]
    const snapshot = JSON.parse(JSON.stringify(recipes))
    const result = searchRecipes(recipes, 'taco')
    expect(recipes).toEqual(snapshot)
    expect(result).not.toBe(recipes)
    // Same object references are returned, so callers can render them as-is.
    expect(result[0]).toBe(recipes[1])
  })
})
