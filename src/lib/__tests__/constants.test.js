import { describe, it, expect } from 'vitest'
import {
  CUISINE_OPTIONS, FLAVOR_OPTIONS, PROTEIN_OPTIONS,
  COOKING_METHOD_OPTIONS, CARB_OPTIONS, DIETARY_OPTIONS,
  DAIRY_OPTIONS, VEGETABLE_OPTIONS, FRUIT_OPTIONS,
  buildAnalyzeRecipePromptBlock,
} from '../constants'

const ALL_LISTS = {
  CUISINE_OPTIONS,
  FLAVOR_OPTIONS,
  PROTEIN_OPTIONS,
  COOKING_METHOD_OPTIONS,
  CARB_OPTIONS,
  DIETARY_OPTIONS,
  DAIRY_OPTIONS,
  VEGETABLE_OPTIONS,
  FRUIT_OPTIONS,
}

describe('constants — enum lists', () => {
  for (const [name, list] of Object.entries(ALL_LISTS)) {
    it(`${name} is a non-empty array of unique non-empty strings`, () => {
      expect(Array.isArray(list)).toBe(true)
      expect(list.length).toBeGreaterThan(0)
      for (const value of list) {
        expect(typeof value).toBe('string')
        expect(value.length).toBeGreaterThan(0)
      }
      expect(new Set(list).size).toBe(list.length)
    })
  }
})

describe('buildAnalyzeRecipePromptBlock', () => {
  const block = buildAnalyzeRecipePromptBlock()

  it('returns a non-empty string', () => {
    expect(typeof block).toBe('string')
    expect(block.length).toBeGreaterThan(0)
  })

  it('includes every value from every enum list', () => {
    // Drift guard: deleting/renaming a value in constants.js without
    // updating this test (and vice versa) fails CI. The AI prompt must
    // continue to advertise the same vocabulary as the chip pickers.
    for (const [name, list] of Object.entries(ALL_LISTS)) {
      for (const value of list) {
        expect(block, `${name} value "${value}" missing from prompt block`).toContain(value)
      }
    }
  })

  it('starts with the JSON opening brace and ends with the closing brace', () => {
    expect(block.startsWith('{')).toBe(true)
    expect(block.endsWith('}')).toBe(true)
  })
})
