import { describe, it, expect } from 'vitest'
import { friendlyAmount, sameAmount, showRecipeLine, matchesStaple, splitList } from '../groceryAmounts'

describe('friendlyAmount', () => {
  it('turns the decimals from her first list into kitchen fractions', () => {
    expect(friendlyAmount('1.125 lbs')).toBe('1⅛ lbs')
    expect(friendlyAmount('0.75 tsp')).toBe('¾ tsp')
    expect(friendlyAmount('2.25 cups')).toBe('2¼ cups')
    expect(friendlyAmount('1.5 avocados')).toBe('1½ avocados')
    expect(friendlyAmount('0.5 bunch')).toBe('½ bunch')
    expect(friendlyAmount('0.33 cup')).toBe('⅓ cup')
  })
  it('leaves whole numbers, real fractions and odd decimals alone', () => {
    expect(friendlyAmount('12 tortillas')).toBe('12 tortillas')
    expect(friendlyAmount('1 1/2 lbs')).toBe('1 1/2 lbs')
    expect(friendlyAmount('2.4 kg')).toBe('2.4 kg')
    expect(friendlyAmount(null)).toBe(null)
  })
})

describe('sameAmount / showRecipeLine', () => {
  it('treats "1.5 lbs" and "1½ lb" as the same, so no extra line', () => {
    expect(sameAmount('1.5 lbs', '1½ lb')).toBe(true)
    expect(showRecipeLine({ quantity: '1½ lb', recipe_quantity: '1.5 lbs' })).toBe(false)
  })
  it('shows the recipe line when buying more than the recipes use', () => {
    expect(showRecipeLine({ quantity: '2', recipe_quantity: '1½' })).toBe(true)
    expect(showRecipeLine({ quantity: '1¼ lb', recipe_quantity: '1⅛ lb' })).toBe(true)
  })
  it('shows nothing extra for old lists with no recipe total', () => {
    expect(showRecipeLine({ quantity: '2 lbs', recipe_quantity: null })).toBe(false)
  })
})

describe('matchesStaple', () => {
  it('uses the server rule: a staple covers longer names', () => {
    expect(matchesStaple('kosher salt', ['salt'])).toBe(true)
    expect(matchesStaple('Cumin', ['cumin'])).toBe(true)
    expect(matchesStaple('cumin', ['salt', ''])).toBe(false)
  })
})

describe('splitList', () => {
  const items = [
    { id: 'a', name: 'Avocados', assumed: false },
    { id: 'c', name: 'Cumin', assumed: true },
    { id: 's', name: 'Soy sauce', assumed: true },
  ]
  it('puts assumed items in their own group', () => {
    const r = splitList(items, [])
    expect(r.onList.map((i) => i.id)).toEqual(['a'])
    expect(r.assumed.map((i) => i.id)).toEqual(['c', 's'])
  })
  it('hides an assumed item once it is in her pantry list', () => {
    expect(splitList(items, ['cumin']).assumed.map((i) => i.id)).toEqual(['s'])
  })
  it('an item she just added is on the list AND stays in the group (for Undo)', () => {
    const added = items.map((i) => (i.id === 's' ? { ...i, assumed: false } : i))
    const r = splitList(added, [], ['s'])
    expect(r.onList.map((i) => i.id)).toEqual(['a', 's'])
    expect(r.assumed.map((i) => i.id)).toEqual(['c', 's'])
  })
  it('keeps one she just set to Always have on screen (for Undo)', () => {
    expect(splitList(items, ['cumin'], ['c']).assumed.map((i) => i.id)).toEqual(['c', 's'])
  })
})
