import { describe, it, expect } from 'vitest'
import {
  CUISINE_OPTIONS, FLAVOR_OPTIONS, PROTEIN_OPTIONS,
  COOKING_METHOD_OPTIONS, CARB_OPTIONS, DIETARY_OPTIONS,
  DAIRY_OPTIONS, VEGETABLE_OPTIONS, FRUIT_OPTIONS,
  PREP_TIME_BUCKETS, bucketForMinutes,
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

  it('declares prep_time_minutes as null-safe', () => {
    // PRD-002 P0.4: the prompt must allow the AI to return null when it
    // cannot estimate. The client treats null as "leave the chip unselected."
    expect(block).toMatch(/prep_time_minutes/)
    expect(block).toMatch(/null/)
  })
})

describe('PREP_TIME_BUCKETS', () => {
  it('has four entries with ascending storedValue and unique ids', () => {
    expect(PREP_TIME_BUCKETS).toHaveLength(4)

    const ids = PREP_TIME_BUCKETS.map(b => b.id)
    expect(new Set(ids).size).toBe(ids.length)

    const storedValues = PREP_TIME_BUCKETS.map(b => b.storedValue)
    for (let i = 1; i < storedValues.length; i++) {
      expect(storedValues[i]).toBeGreaterThan(storedValues[i - 1])
    }
  })

  it('every bucket has the required shape (id, label, storedValue)', () => {
    for (const bucket of PREP_TIME_BUCKETS) {
      expect(typeof bucket.id).toBe('string')
      expect(bucket.id.length).toBeGreaterThan(0)
      expect(typeof bucket.label).toBe('string')
      expect(bucket.label.length).toBeGreaterThan(0)
      expect(Number.isInteger(bucket.storedValue)).toBe(true)
      expect(bucket.storedValue).toBeGreaterThan(0)
    }
  })
})

describe('bucketForMinutes', () => {
  it.each([
    [0,    'lt15'],
    [14,   'lt15'],
    [15,   'lt15'],     // boundary — matches storedValue for lt15 so write-then-read keeps the chip
    [16,   '15to30'],
    [30,   '15to30'],   // boundary — matches storedValue for 15to30
    [45,   '30to60'],
    [60,   '30to60'],   // boundary — matches storedValue for 30to60
    [61,   'gt60'],
    [120,  'gt60'],
  ])('maps %i minutes → "%s"', (minutes, expected) => {
    expect(bucketForMinutes(minutes)).toBe(expected)
  })

  it('returns null when minutes is null', () => {
    expect(bucketForMinutes(null)).toBeNull()
  })
})
