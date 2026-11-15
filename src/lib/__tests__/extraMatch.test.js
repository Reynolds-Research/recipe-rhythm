import { describe, it, expect } from 'vitest'
import { isOnList, mainWord } from '../extraMatch'

// Is an add-on on the grocery list? (2026-11-15: "Italian sausage" wasn't, and nothing noticed.)
describe('mainWord — the thing an add-on names', () => {
  it.each([
    ['Italian sausage', 'sausage'], ['chicken sausage', 'sausage'], ['shrimp', 'shrimp'],
    ['1 lb shrimp', 'shrimp'], ['garlic bread', 'bread'], ['meatballs', 'meatball'],
    ['cherry tomatoes', 'tomato'], ['fresh berries', 'berry'], ['a side of rice', 'rice'],
  ])('"%s" → %s', (name, word) => expect(mainWord(name)).toBe(word))

  it('nothing to look for → null', () => expect(mainWord('1 lb')).toBeNull())
})

describe('isOnList', () => {
  const list = ['penne pasta', 'heavy cream', 'Italian seasoning', 'shrimp', 'sausage links']
  it('finds the add-on by its main word, singular or plural', () => {
    expect(isOnList('Italian sausage', list)).toBe(true)
    expect(isOnList('shrimps', list)).toBe(true)
  })
  it('a shared first word is not enough ("Italian seasoning" is not sausage)', () => {
    expect(isOnList('Italian sausage', ['penne pasta', 'Italian seasoning'])).toBe(false)
  })
  it('her Nov 15 list: no sausage on it', () => {
    expect(isOnList('Italian sausage', ['penne pasta', 'vodka', 'tomato paste', 'heavy cream', 'parmesan cheese'])).toBe(false)
  })
  it('an empty list has nothing', () => expect(isOnList('shrimp', [])).toBe(false))
})
