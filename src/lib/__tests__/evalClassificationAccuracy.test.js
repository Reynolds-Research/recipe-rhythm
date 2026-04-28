/**
 * Unit test for the pure metric-computation pieces of
 * scripts/eval-classification-accuracy.js. No I/O, no Anthropic, no fs.
 */
import { describe, it, expect } from 'vitest'
import {
  validateTruthSet,
  compareRecipe,
  computeMetrics,
} from '../../../scripts/eval-classification-accuracy.js'

describe('validateTruthSet', () => {
  it('accepts a fully-filled truth set', () => {
    const truth = {
      recipes: [{
        recipe_name: 'Cheeseburgers',
        ingredients: [
          { name: 'beef',  essentiality: 'essential' },
          { name: 'onion', essentiality: 'omittable' },
        ],
      }],
    }
    expect(validateTruthSet(truth)).toEqual({ ok: true, unfilled: [] })
  })

  it('rejects a truth set with any null essentialities, listing each one', () => {
    const truth = {
      recipes: [
        {
          recipe_name: 'Cheeseburgers',
          ingredients: [
            { name: 'beef',  essentiality: 'essential' },
            { name: 'onion', essentiality: null },
          ],
        },
        {
          recipe_name: 'Tacos',
          ingredients: [
            { name: 'tortilla', essentiality: 'essential' },
            { name: 'cilantro', essentiality: null },
          ],
        },
      ],
    }
    const result = validateTruthSet(truth)
    expect(result.ok).toBe(false)
    expect(result.unfilled).toEqual([
      { recipe: 'Cheeseburgers', ingredient: 'onion' },
      { recipe: 'Tacos',         ingredient: 'cilantro' },
    ])
  })

  it('rejects unrecognized essentiality values, not just null', () => {
    const truth = {
      recipes: [{
        recipe_name: 'X',
        ingredients: [{ name: 'salt', essentiality: 'maybe' }],
      }],
    }
    const result = validateTruthSet(truth)
    expect(result.ok).toBe(false)
    expect(result.unfilled).toHaveLength(1)
  })

  it('returns a fatal error when the file has no `recipes` array', () => {
    expect(validateTruthSet({}).fatal).toMatch(/recipes/)
    expect(validateTruthSet(null).fatal).toMatch(/recipes/)
  })
})

describe('compareRecipe', () => {
  it('matches truth and AI by case-insensitive trimmed name', () => {
    const records = compareRecipe({
      truthRecipe: {
        recipe_name: 'Cheeseburgers',
        vault_id: 'r1',
        ingredients: [
          { name: 'Beef',  essentiality: 'essential' },
          { name: 'onion', essentiality: 'omittable' },
        ],
      },
      aiClassifications: [
        { name: 'beef ',  essentiality: 'essential', source: 'ai' },
        { name: 'ONION',  essentiality: 'essential', source: 'ai' },
      ],
    })
    expect(records).toEqual([
      { recipe_name: 'Cheeseburgers', vault_id: 'r1', ingredient: 'Beef',  truth: 'essential', ai: 'essential', agree: true  },
      { recipe_name: 'Cheeseburgers', vault_id: 'r1', ingredient: 'onion', truth: 'omittable', ai: 'essential', agree: false },
    ])
  })

  it('records truth-only ingredients with ai = null', () => {
    const records = compareRecipe({
      truthRecipe: {
        recipe_name: 'X', vault_id: 'r2',
        ingredients: [{ name: 'salt', essentiality: 'essential' }],
      },
      aiClassifications: [],
    })
    expect(records).toEqual([
      { recipe_name: 'X', vault_id: 'r2', ingredient: 'salt', truth: 'essential', ai: null, agree: null },
    ])
  })

  it('records AI-only ingredients with truth = null', () => {
    const records = compareRecipe({
      truthRecipe: {
        recipe_name: 'X', vault_id: 'r3',
        ingredients: [{ name: 'salt', essentiality: 'essential' }],
      },
      aiClassifications: [
        { name: 'salt',   essentiality: 'essential', source: 'ai' },
        { name: 'pepper', essentiality: 'omittable', source: 'ai' },
      ],
    })
    expect(records).toContainEqual({
      recipe_name: 'X', vault_id: 'r3', ingredient: 'pepper', truth: null, ai: 'omittable', agree: null,
    })
  })
})

describe('computeMetrics', () => {
  function rec(truth, ai) {
    return {
      recipe_name: 'X', vault_id: 'r', ingredient: 'i',
      truth, ai, agree: truth === ai,
    }
  }

  it('computes correct precision/recall/accuracy on a hand-verifiable mixed set', () => {
    // Confusion (rows = AI, cols = truth):
    //                  truth=E  truth=O
    //   ai=E              3        1     -> precision_E = 3/4 = 0.75
    //   ai=O              2        4     -> precision_O = 4/6 = 0.667
    // recall_E    = 3/(3+2) = 0.6
    // recall_O    = 4/(4+1) = 0.8
    // accuracy    = (3+4) / 10 = 0.7
    const records = [
      rec('essential', 'essential'), rec('essential', 'essential'), rec('essential', 'essential'),
      rec('omittable', 'essential'),
      rec('essential', 'omittable'), rec('essential', 'omittable'),
      rec('omittable', 'omittable'), rec('omittable', 'omittable'), rec('omittable', 'omittable'), rec('omittable', 'omittable'),
    ]
    const m = computeMetrics(records)
    expect(m.matrix).toEqual({ aiE_truthE: 3, aiE_truthO: 1, aiO_truthE: 2, aiO_truthO: 4 })
    expect(m.matched).toBe(10)
    expect(m.unmatched).toBe(0)
    expect(m.precisionEssential).toBeCloseTo(0.75, 5)
    expect(m.recallEssential).toBeCloseTo(0.6, 5)
    expect(m.precisionOmittable).toBeCloseTo(2 / 3, 5)
    expect(m.recallOmittable).toBeCloseTo(0.8, 5)
    expect(m.accuracy).toBeCloseTo(0.7, 5)
    expect(m.passes).toBe(false) // 0.75 < 0.85
  })

  it('confusion matrix counts all-correct correctly (precision_E = 1.0, passes)', () => {
    const records = [
      rec('essential', 'essential'),
      rec('essential', 'essential'),
      rec('omittable', 'omittable'),
    ]
    const m = computeMetrics(records)
    expect(m.matrix).toEqual({ aiE_truthE: 2, aiE_truthO: 0, aiO_truthE: 0, aiO_truthO: 1 })
    expect(m.precisionEssential).toBe(1)
    expect(m.recallEssential).toBe(1)
    expect(m.accuracy).toBe(1)
    expect(m.passes).toBe(true)
  })

  it('confusion matrix counts all-wrong correctly', () => {
    const records = [
      rec('essential', 'omittable'),
      rec('essential', 'omittable'),
      rec('omittable', 'essential'),
    ]
    const m = computeMetrics(records)
    expect(m.matrix).toEqual({ aiE_truthE: 0, aiE_truthO: 1, aiO_truthE: 2, aiO_truthO: 0 })
    expect(m.precisionEssential).toBe(0)
    expect(m.recallEssential).toBe(0)
    expect(m.accuracy).toBe(0)
    expect(m.passes).toBe(false)
  })

  it('returns null (not NaN) precision/recall when a denominator is zero', () => {
    // AI never says 'essential' -> precision_E denominator is 0
    const records = [
      rec('essential', 'omittable'),
      rec('omittable', 'omittable'),
    ]
    const m = computeMetrics(records)
    expect(m.precisionEssential).toBe(null)
    expect(m.passes).toBe(false) // null treated as failure
  })

  it('counts unmatched (null on either side) separately, excludes from confusion matrix', () => {
    const records = [
      rec('essential', 'essential'),
      rec('essential', null),       // truth-only
      rec(null, 'omittable'),       // AI-only
    ]
    const m = computeMetrics(records)
    expect(m.matched).toBe(1)
    expect(m.unmatched).toBe(2)
    expect(m.matrix).toEqual({ aiE_truthE: 1, aiE_truthO: 0, aiO_truthE: 0, aiO_truthO: 0 })
  })
})
