/**
 * Unit tests for classifyIngredientsCached — the cache-aware wrapper around
 * classifyIngredients (ADR-004).
 *
 * Lives under src/lib/__tests__/ to match Vitest's `src/**\/*.test.js`
 * include glob, even though the SUT lives in api/_lib/. Same convention as
 * classifyIngredientsHandler.test.js in this directory.
 *
 * No real Anthropic, no real Supabase. We mock src/lib/classifyIngredients.js
 * directly via vi.mock and inject a tiny Supabase chain mock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock factories run before the imports below. The factory must be
// self-contained — no closure over outer variables.
vi.mock('../classifyIngredients.js', () => ({
  classifyIngredients: vi.fn(),
  ClassifyIngredientsError: class extends Error {},
}))

import { classifyIngredients } from '../classifyIngredients.js'
import { classifyIngredientsCached } from '../../../api/_lib/classifyIngredientsCached.js'

/**
 * Build a mock Supabase client supporting:
 *   .from(t).select().eq(c, v).in(c, vals) → { data, error }
 *   .from(t).upsert(rows, opts)            → { error }
 */
function makeSupabaseMock({ readData = [], readError = null, writeError = null } = {}) {
  const upsertSpy = vi.fn(async () => ({ error: writeError }))
  const inSpy = vi.fn(async () => ({ data: readData, error: readError }))

  const fromSpy = vi.fn(() => {
    const eqChain = { in: inSpy }
    const selectChain = { eq: vi.fn(() => eqChain) }
    return { select: vi.fn(() => selectChain), upsert: upsertSpy }
  })

  return { from: fromSpy, _spies: { fromSpy, inSpy, upsertSpy } }
}

const fakeAnthropic = {} // not actually called because we mock classifyIngredients

beforeEach(() => {
  classifyIngredients.mockReset()
})

describe('classifyIngredientsCached', () => {
  describe('pass-through behavior (caching disabled)', () => {
    it('falls through to classifyIngredients when supabaseClient is null', async () => {
      const expected = { classifications: [{ name: 'beef', essentiality: 'essential', source: 'ai' }] }
      classifyIngredients.mockResolvedValueOnce(expected)

      const result = await classifyIngredientsCached({
        ingredients: ['beef'],
        recipeName: 'Beef Stew',
        cuisine: null,
        anthropicClient: fakeAnthropic,
        supabaseClient: null,
      })

      expect(result).toEqual(expected)
      expect(classifyIngredients).toHaveBeenCalledOnce()
    })

    it('falls through when ingredients is empty (delegates validation)', async () => {
      const expected = { classifications: [] }
      classifyIngredients.mockResolvedValueOnce(expected)
      const supabase = makeSupabaseMock()

      await classifyIngredientsCached({
        ingredients: [],
        recipeName: 'X',
        anthropicClient: fakeAnthropic,
        supabaseClient: supabase,
      })

      expect(classifyIngredients).toHaveBeenCalledOnce()
      expect(supabase._spies.fromSpy).not.toHaveBeenCalled()
    })
  })

  describe('full cache hit', () => {
    it('returns synthesized results from cache without calling AI', async () => {
      const supabase = makeSupabaseMock({
        readData: [
          { ingredient_name_norm: 'beef',  essentiality: 'essential' },
          { ingredient_name_norm: 'onion', essentiality: 'omittable' },
        ],
      })

      const result = await classifyIngredientsCached({
        ingredients: ['Beef', 'Onion'],
        recipeName: 'Beef Stew',
        anthropicClient: fakeAnthropic,
        supabaseClient: supabase,
      })

      expect(classifyIngredients).not.toHaveBeenCalled()
      expect(result.classifications).toEqual([
        { name: 'Beef',  essentiality: 'essential', source: 'ai' },
        { name: 'Onion', essentiality: 'omittable', source: 'ai' },
      ])
      expect(supabase._spies.upsertSpy).not.toHaveBeenCalled()
    })

    it('preserves input order in the result', async () => {
      const supabase = makeSupabaseMock({
        readData: [
          { ingredient_name_norm: 'rice',    essentiality: 'omittable' },
          { ingredient_name_norm: 'chicken', essentiality: 'omittable' },
        ],
      })

      const result = await classifyIngredientsCached({
        ingredients: ['Chicken', 'Rice'],
        recipeName: 'Mediterranean Chicken Bowls',
        anthropicClient: fakeAnthropic,
        supabaseClient: supabase,
      })

      expect(result.classifications.map(c => c.name)).toEqual(['Chicken', 'Rice'])
    })
  })

  describe('full cache miss', () => {
    it('calls AI for the full list and writes new entries to cache', async () => {
      classifyIngredients.mockResolvedValueOnce({
        classifications: [
          { name: 'Beef',  essentiality: 'essential', source: 'ai' },
          { name: 'Onion', essentiality: 'omittable', source: 'ai' },
        ],
      })
      const supabase = makeSupabaseMock({ readData: [] })

      const result = await classifyIngredientsCached({
        ingredients: ['Beef', 'Onion'],
        recipeName: 'Beef Stew',
        anthropicClient: fakeAnthropic,
        supabaseClient: supabase,
      })

      expect(classifyIngredients).toHaveBeenCalledOnce()
      expect(supabase._spies.upsertSpy).toHaveBeenCalledOnce()
      const [rows, opts] = supabase._spies.upsertSpy.mock.calls[0]
      expect(rows).toEqual([
        { recipe_name_norm: 'beef stew', ingredient_name_norm: 'beef',  essentiality: 'essential' },
        { recipe_name_norm: 'beef stew', ingredient_name_norm: 'onion', essentiality: 'omittable' },
      ])
      expect(opts).toEqual({
        onConflict:       'recipe_name_norm,ingredient_name_norm',
        ignoreDuplicates: true,
      })
      expect(result.classifications).toHaveLength(2)
    })
  })

  describe('partial cache hit', () => {
    it('uses cache for hits, AI for misses, writes only the misses', async () => {
      const supabase = makeSupabaseMock({
        readData: [{ ingredient_name_norm: 'beef', essentiality: 'essential' }],
      })
      classifyIngredients.mockResolvedValueOnce({
        classifications: [
          { name: 'Beef',  essentiality: 'essential', source: 'ai' },
          { name: 'Onion', essentiality: 'omittable', source: 'ai' },
        ],
      })

      const result = await classifyIngredientsCached({
        ingredients: ['Beef', 'Onion'],
        recipeName: 'Beef Stew',
        anthropicClient: fakeAnthropic,
        supabaseClient: supabase,
      })

      expect(classifyIngredients).toHaveBeenCalledOnce()
      const aiCallArgs = classifyIngredients.mock.calls[0][0]
      expect(aiCallArgs.ingredients).toEqual(['Beef', 'Onion'])

      expect(result.classifications).toEqual([
        { name: 'Beef',  essentiality: 'essential', source: 'ai' },
        { name: 'Onion', essentiality: 'omittable', source: 'ai' },
      ])

      // Only 'onion' (the miss) is written back. 'beef' stays untouched
      // → first-answer-wins.
      expect(supabase._spies.upsertSpy).toHaveBeenCalledOnce()
      const [rows] = supabase._spies.upsertSpy.mock.calls[0]
      expect(rows).toEqual([
        { recipe_name_norm: 'beef stew', ingredient_name_norm: 'onion', essentiality: 'omittable' },
      ])
    })

    it('first-answer-wins: cached value is returned even when AI would disagree', async () => {
      const supabase = makeSupabaseMock({
        readData: [{ ingredient_name_norm: 'beef', essentiality: 'essential' }],
      })
      classifyIngredients.mockResolvedValueOnce({
        classifications: [
          { name: 'Beef',  essentiality: 'omittable', source: 'ai' }, // would-be disagreement
          { name: 'Onion', essentiality: 'omittable', source: 'ai' },
        ],
      })

      const result = await classifyIngredientsCached({
        ingredients: ['Beef', 'Onion'],
        recipeName: 'Beef Stew',
        anthropicClient: fakeAnthropic,
        supabaseClient: supabase,
      })

      const beef = result.classifications.find(c => c.name === 'Beef')
      expect(beef.essentiality).toBe('essential') // cache wins
    })
  })

  describe('error tolerance', () => {
    it('degrades to all-miss when cache READ errors out', async () => {
      const supabase = makeSupabaseMock({ readError: new Error('boom') })
      classifyIngredients.mockResolvedValueOnce({
        classifications: [{ name: 'Beef', essentiality: 'essential', source: 'ai' }],
      })

      const result = await classifyIngredientsCached({
        ingredients: ['Beef'],
        recipeName: 'Beef Stew',
        anthropicClient: fakeAnthropic,
        supabaseClient: supabase,
      })

      expect(classifyIngredients).toHaveBeenCalledOnce()
      expect(result.classifications).toHaveLength(1)
    })

    it('returns AI result successfully even when cache WRITE errors out', async () => {
      const supabase = makeSupabaseMock({ readData: [], writeError: { message: 'write boom' } })
      classifyIngredients.mockResolvedValueOnce({
        classifications: [{ name: 'Beef', essentiality: 'essential', source: 'ai' }],
      })

      const result = await classifyIngredientsCached({
        ingredients: ['Beef'],
        recipeName: 'Beef Stew',
        anthropicClient: fakeAnthropic,
        supabaseClient: supabase,
      })

      expect(result.classifications).toEqual([
        { name: 'Beef', essentiality: 'essential', source: 'ai' },
      ])
    })
  })

  describe('normalization', () => {
    it('normalizes recipe + ingredient names for cache lookup (case + whitespace)', async () => {
      const supabase = makeSupabaseMock({
        readData: [{ ingredient_name_norm: 'beef', essentiality: 'essential' }],
      })

      await classifyIngredientsCached({
        ingredients: ['  BEEF  '],
        recipeName: '  Beef   Stew  ',
        anthropicClient: fakeAnthropic,
        supabaseClient: supabase,
      })

      // Full hit means the cache lookup correctly normalized 'BEEF' → 'beef'
      // and 'Beef   Stew' → 'beef stew' to match the stub data.
      expect(classifyIngredients).not.toHaveBeenCalled()
    })
  })
})
