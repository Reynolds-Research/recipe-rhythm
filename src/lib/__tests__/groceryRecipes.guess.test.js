import { describe, it, expect } from 'vitest'
import { amountsAreGuess, guessedRecipeNames } from '../groceryRecipes'

// Her first real week (2026-11-06): the list said chili powder 1 tsp; the
// recipe says 1 tbsp. The recipe's list was the AI's guess. These decide
// which recipes the grocery sheet names as "estimates".
describe('amountsAreGuess', () => {
  it('her screenshots and the recipe page count as the real amounts', () => {
    expect(amountsAreGuess({ ingredients_source: 'screenshot' })).toBe(false)
    expect(amountsAreGuess({ ingredients_source: 'page' })).toBe(false)
  })

  it("'estimated', the May backfill's unlabelled lists and no list at all are guesses", () => {
    expect(amountsAreGuess({ ingredients_source: 'estimated' })).toBe(true)
    expect(amountsAreGuess({ ingredients_source: null })).toBe(true)
    expect(amountsAreGuess({})).toBe(true)
  })
})

describe('guessedRecipeNames', () => {
  const VAULT = [
    { id: 'skillet', name: 'One Pan Turkey Sweet Potato Skillet', ingredients_source: 'estimated' },
    { id: 'mac', name: 'Butternut Squash Mac n Cheese', ingredients_source: 'estimated' },
    { id: 'meatballs', name: 'Scallion Meatballs', ingredients_source: null },
    { id: 'salmon', name: 'Salmon Teriyaki Rice Bowls', ingredients_source: 'screenshot' },
  ]
  const meal = (vault_id, name = 'x') => ({ vault_id, name })

  it("names the week's guessed recipes once each, in planned order", () => {
    const meals = [meal('mac'), meal('skillet'), meal('salmon'), meal('meatballs'), meal('skillet')]
    expect(guessedRecipeNames(meals, VAULT)).toEqual([
      'Butternut Squash Mac n Cheese', 'One Pan Turkey Sweet Potato Skillet', 'Scallion Meatballs',
    ])
  })

  it('a week of screenshot recipes, one-off meals or unknown recipes names nothing', () => {
    expect(guessedRecipeNames([meal('salmon'), meal(null, 'Pizza out'), meal('gone')], VAULT)).toEqual([])
    expect(guessedRecipeNames([], VAULT)).toEqual([])
  })
})
