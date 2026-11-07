import { describe, it, expect } from 'vitest'
import { addUpAmount, showRecipeLine } from '../groceryAmounts'
import { buildGroceryList } from '../groceryList'

// Her Nov 8 list had these three, straight from the AI.
describe('addUpAmount — adds what the AI left as "+"', () => {
  it('adds the same unit: 1½ tsp + ½ tsp → 2 tsp (cumin)', () => {
    expect(addUpAmount('1½ tsp + ½ tsp')).toBe('2 tsp')
  })

  it('adds tbsp and tsp, kept in tsp when tbsp would be an awkward fraction (chili powder)', () => {
    expect(addUpAmount('1 tbsp + 1 tsp')).toBe('4 tsp')
  })

  it('adds counts of the same thing, whatever their size words (onion)', () => {
    expect(addUpAmount('1 yellow onion + ½ small onion')).toBe('1½')
  })

  it('moves up to the bigger unit when it comes out even', () => {
    expect(addUpAmount('1 tbsp + 3 tsp')).toBe('2 tbsp')
    expect(addUpAmount('2 tbsp + 2 tbsp')).toBe('¼ cup')
    expect(addUpAmount('½ cup + ½ cup')).toBe('1 cup')
    expect(addUpAmount('1 cup + 1 cup')).toBe('2 cups')
    expect(addUpAmount('1½ tsp + 3 tsp')).toBe('1½ tbsp')
  })

  it('reads slash fractions, decimals and spelled-out units', () => {
    expect(addUpAmount('1 1/2 teaspoons + 1/2 teaspoon')).toBe('2 tsp')
    expect(addUpAmount('0.5 tablespoon + 1 tablespoon')).toBe('1½ tbsp')
  })

  it('adds weights: 1 lb + 8 oz → 1½ lb; 4 oz + 4 oz → 8 oz', () => {
    expect(addUpAmount('1 lb + 8 oz')).toBe('1½ lb')
    expect(addUpAmount('4 oz + 4 oz')).toBe('8 oz')
  })

  it('leaves alone what it cannot add for certain', () => {
    expect(addUpAmount('1 can + 2 tbsp')).toBe('1 can + 2 tbsp') // different kinds
    expect(addUpAmount('1 lemon + 1 lime')).toBe('1 lemon + 1 lime') // different things
    expect(addUpAmount('1 can + 1 can')).toBe('1 can + 1 can') // would lose "can"
    expect(addUpAmount('2 cloves + 1 clove')).toBe('2 cloves + 1 clove')
    expect(addUpAmount('1 cup + 2 tbsp')).toBe('1 cup + 2 tbsp') // 18 tbsp isn't tidier
    expect(addUpAmount('to taste + 1 tsp')).toBe('to taste + 1 tsp')
  })

  // Found by the independent review: each of these used to give a wrong
  // number or drop the unit. Leaving them as written is always safe.
  it.each([
    '1 lb 8 oz + 8 oz', // a second amount inside one part
    '6 oz + 1 lb 4 oz',
    '1 to 2 tsp + 1 to 2 tsp', // a range
    '2 tsp or to taste + 1 tsp',
    '1 heaping tbsp + 1 heaping tbsp', // can't be added exactly
    '1 scant cup + 1 scant cup',
    '1 T + 1 t', // too short to know the unit
    '1 fl oz + 1 fl oz',
    '1 (15 oz) can + 1 (28 oz) can', // can sizes
    '1 (14 oz) can + 1 (14 oz) can',
    '2 slices bacon + 1 slice bacon',
    '1 onion + 1 red onion', // a different variety
    '1 tbsp each + 1 tbsp', // a multiplier
    '8 oz per person + 8 oz',
  ])('leaves "%s" as written', (text) => {
    expect(addUpAmount(text)).toBe(text)
  })

  it('still adds the plain cases the review checked', () => {
    expect(addUpAmount('1 tbs + 1 tbs')).toBe('2 tbsp')
    expect(addUpAmount('1 tbsp + 1½ tsp')).toBe('1½ tbsp')
    expect(addUpAmount('2 tbsp + 1 tbsp, divided')).toBe('3 tbsp')
    expect(addUpAmount('1 lb trimmed + 8 oz')).toBe('1½ lb')
    expect(addUpAmount('2 large eggs + 1 egg')).toBe('3')
    expect(addUpAmount('2 + 1')).toBe('3')
  })

  it('passes ordinary amounts and empty values through untouched', () => {
    expect(addUpAmount('2¼ tsp')).toBe('2¼ tsp')
    expect(addUpAmount(null)).toBe(null)
    expect(addUpAmount(undefined)).toBe(null)
  })
})

describe('the grocery list is saved already added up', () => {
  it('buildGroceryList adds a "+" recipe amount before it is stored', async () => {
    const text = JSON.stringify({ items: [
      { name: 'cumin', quantity: '1 container', recipe_quantity: '1½ tsp + ½ tsp', section: 'Pantry', assumed: true },
    ] })
    // A stand-in for the AI that answers with the "+" amount it gave on Nov 8.
    const anthropicClient = { messages: { create: async () => ({ content: [{ text }] }) } }
    const { items } = await buildGroceryList({
      recipes: [{ name: 'Skillet', ingredients: ['ground cumin: 1½ tsp'], servings: 4 }],
      anthropicClient,
    })
    expect(items[0].recipe_quantity).toBe('2 tsp')
  })

  it('tells the AI to give one total, never "+"', async () => {
    let prompt = ''
    const anthropicClient = { messages: { create: async (req) => {
      prompt = req.messages[0].content
      return { content: [{ text: '{"items": []}' }] }
    } } }
    await buildGroceryList({ recipes: [{ name: 'Skillet', ingredients: ['cumin'], servings: 4 }], anthropicClient })
    expect(prompt).toContain('never "1½ tsp + ½ tsp"')
  })
})

describe('showRecipeLine compares against the added-up total', () => {
  it('hides the line when the total matches what to buy', () => {
    expect(showRecipeLine({ quantity: '1 lb', recipe_quantity: '8 oz + 8 oz' })).toBe(false)
    expect(showRecipeLine({ quantity: '2', recipe_quantity: '1 yellow onion + ½ small onion' })).toBe(true)
  })
})
