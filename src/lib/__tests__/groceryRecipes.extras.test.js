import { describe, it, expect } from 'vitest'
import { estimatedExtraNames, extrasStatus, isNotCooking, nightsOffNames, recipesFromMeals } from '../groceryRecipes'

// Meal shapes (2026-11-14). A planned meal is a name + an optional link to one
// recipe. What the grocery list can't read from a recipe, it estimates:
// add-ons ("shrimp" on Penne alla Vodka) and meals with no recipe.

const penne = (over = {}) => ({
  name: 'Penne alla Vodka', vault_id: 'v2', add_on: null,
  vault: { name: 'Penne alla Vodka', servings: 4, ingredients_structured: [{ name: 'penne', quantity: '1', unit: 'lb' }] },
  ...over,
})

describe('recipesFromMeals — extras', () => {
  it('a recipe + add-on: the recipe keeps its own ingredients, the add-on is an extra tied to it', () => {
    const out = recipesFromMeals([penne({ add_on: 'shrimp' })])
    expect(out.recipes).toEqual([{ name: 'Penne alla Vodka', ingredients: ['penne: 1 lb'], servings: 4 }])
    expect(out.extras).toEqual([{ name: 'shrimp', with: 'Penne alla Vodka', servings: 4 }])
  })

  it('a recipe with no add-on adds no extra', () => {
    expect(recipesFromMeals([penne()]).extras).toEqual([])
  })

  it('an add-on still goes when the recipe has no ingredients of its own', () => {
    const bare = penne({ add_on: 'shrimp', vault: { name: 'Penne alla Vodka', servings: null } })
    const out = recipesFromMeals([bare])
    expect(out.noIngredients).toEqual(['Penne alla Vodka'])
    expect(out.extras).toEqual([{ name: 'shrimp', with: 'Penne alla Vodka', servings: null }])
  })

  it('a meal with no recipe is an extra to estimate (and still named as not in the cookbook)', () => {
    const out = recipesFromMeals([{ name: 'Pork Loin with sweet potato and broccoli', vault_id: null, vault: null }])
    expect(out.extras).toEqual([{ name: 'Pork Loin with sweet potato and broccoli', with: null, servings: null }])
    expect(out.notInCookbook).toEqual(['Pork Loin with sweet potato and broccoli'])
  })

  it('a night out adds nothing to buy', () => {
    const out = recipesFromMeals([
      { name: 'Pizza out', vault_id: null, vault: null },
      { name: 'Takeout', vault_id: null, vault: null },
      { name: 'Leftovers', vault_id: null, vault: null },
    ])
    expect(out.extras).toEqual([])
  })

  it('two meals with the same add-on stay two (each dinner needs its own)', () => {
    const out = recipesFromMeals([penne({ add_on: 'shrimp' }), penne({ add_on: 'shrimp' })])
    expect(out.extras).toHaveLength(2)
  })
})

describe('isNotCooking', () => {
  const nightsOff = ['Pizza out', 'Eat out', 'sushi out', 'Takeout', 'take-out sushi', 'Leftovers', 'Delivery', 'Ordering in']
  // From the review: real dishes with those words inside must stay meals.
  const cooked = ['Trout with lemon', 'Shrimp Tacos', 'Pork Tenderloin with squash and kale salad', 'Sprouts and rice',
    'Inside-Out Burgers', 'Restaurant-Style Salsa', 'Takeout-Style Orange Chicken', 'Leftover Turkey Pot Pie',
    'Leftover ham fried rice', 'Cook-out burgers', 'Fake-out fried rice', 'Takeout-style lo mein']
  it.each(nightsOff)('"%s" is a night off', (name) => expect(isNotCooking(name)).toBe(true))
  it.each(cooked)('"%s" is cooked at home', (name) => expect(isNotCooking(name)).toBe(false))
})

describe('nightsOffNames — "Not shopped for"', () => {
  it('names nights off once each; never a recipe or a cooked one-off', () => {
    expect(nightsOffNames([
      { name: 'Pizza out', vault_id: null },
      { name: 'Pizza out', vault_id: null },
      { name: 'Pork loin and broccoli', vault_id: null },
      { name: 'Eat out', vault_id: 'v9' }, // linked to a recipe: not a night off
    ])).toEqual(['Pizza out'])
  })
})

describe('estimatedExtraNames — the sheet\'s note', () => {
  it('names add-ons and meals with no recipe once each, in plan order; never recipes or nights out', () => {
    expect(estimatedExtraNames([
      { name: 'Penne alla Vodka', vault_id: 'v2', add_on: 'shrimp' },
      { name: 'Chicken Enchiladas', vault_id: 'v1', add_on: null },
      { name: 'Pork Tenderloin with squash and kale salad', vault_id: null },
      { name: 'Pizza out', vault_id: null },
      { name: 'Shrimp Tacos', vault_id: 'v3', add_on: 'shrimp' },
    ])).toEqual(['shrimp', 'Pork Tenderloin with squash and kale salad'])
  })
})

describe('extrasStatus — the sheet only names what the list has (2026-11-15)', () => {
  const meals = [
    { name: 'Penne alla Vodka', vault_id: 'v2', add_on: 'Italian sausage' },
    { name: 'Pork Tenderloin with squash and kale salad', vault_id: null },
  ]
  it('her Nov 15 list (no sausage): the add-on is "not on this list yet", not "an estimate"', () => {
    expect(extrasStatus(meals, ['penne pasta', 'heavy cream'])).toEqual({
      estimated: ['Pork Tenderloin with squash and kale salad'],
      notOnList: ['Italian sausage'],
    })
  })
  it('once the list has it, it is named as an estimate', () => {
    expect(extrasStatus(meals, ['penne pasta', 'Italian sausage'])).toEqual({
      estimated: ['Italian sausage', 'Pork Tenderloin with squash and kale salad'],
      notOnList: [],
    })
  })
})
