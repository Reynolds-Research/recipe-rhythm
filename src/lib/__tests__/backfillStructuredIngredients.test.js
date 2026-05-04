/**
 * Unit tests for scripts/backfill-structured-ingredients.mjs.
 * Drives `collectCategoryHints`, `buildBackfillPrompt`, and `processRow`
 * with mocked dependencies — no network calls, no `main()` invoked.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  collectCategoryHints,
  buildBackfillPrompt,
  processRow,
} from '../../../scripts/backfill-structured-ingredients.mjs'

// Minimal Supabase mock covering `.from('vault').update({...}).eq('id', id)`.
function makeSupabaseMock({ updateError = null } = {}) {
  const eq = vi.fn().mockResolvedValue({ data: null, error: updateError })
  const update = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ update })
  return { from, _spies: { from, update, eq } }
}

function makeAnthropic(jsonPayload) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(jsonPayload) }],
      }),
    },
  }
}

const silentLogger = { log: vi.fn(), error: vi.fn() }

// ---------- collectCategoryHints ----------

describe('collectCategoryHints', () => {
  it('collects values from all category fields and dedupes case-insensitively', () => {
    const row = {
      proteins: ['Chicken', 'chicken '],
      main_carb: 'Pasta',
      vegetables: ['Tomato', 'Spinach/Greens'],
      fruits: null,
      dairy_components: ['Parmesan'],
    }
    expect(collectCategoryHints(row)).toEqual(['Chicken', 'Pasta', 'Tomato', 'Spinach/Greens', 'Parmesan'])
  })

  it('returns [] when all fields are empty or null', () => {
    expect(collectCategoryHints({})).toEqual([])
    expect(collectCategoryHints({ proteins: [], main_carb: null, vegetables: null })).toEqual([])
  })

  it('ignores non-string entries', () => {
    expect(collectCategoryHints({ proteins: ['Beef', 42, null, '  '] })).toEqual(['Beef'])
  })
})

// ---------- buildBackfillPrompt ----------

describe('buildBackfillPrompt', () => {
  it('includes the recipe name', () => {
    const prompt = buildBackfillPrompt({ name: 'Chicken Tikka Masala', proteins: ['Chicken'], main_carb: 'Rice', vegetables: [], fruits: [], dairy_components: [] })
    expect(prompt).toContain('Chicken Tikka Masala')
  })

  it('includes category hints joined as comma-separated line', () => {
    const prompt = buildBackfillPrompt({ name: 'Test', proteins: ['Beef'], main_carb: 'Bread', vegetables: ['Onion/Garlic'], fruits: [], dairy_components: ['Cheese'] })
    expect(prompt).toContain('Beef, Bread, Onion/Garlic, Cheese')
  })

  it('uses "none recorded" when all categories are empty', () => {
    const prompt = buildBackfillPrompt({ name: 'Mystery Dish', proteins: [], main_carb: null, vegetables: null, fruits: null, dairy_components: null })
    expect(prompt).toContain('none recorded')
  })

  it('includes cuisine_type when present', () => {
    const prompt = buildBackfillPrompt({ name: 'Pasta', cuisine_type: 'Italian', proteins: [], main_carb: 'Pasta', vegetables: [], fruits: [], dairy_components: [] })
    expect(prompt).toContain('Italian')
  })

  it('requests both servings and ingredients_structured', () => {
    const prompt = buildBackfillPrompt({ name: 'X', proteins: [], main_carb: null, vegetables: [], fruits: [], dairy_components: [] })
    expect(prompt).toContain('"servings"')
    expect(prompt).toContain('"ingredients_structured"')
  })
})

// ---------- processRow ----------

describe('processRow — happy path', () => {
  it('persists ingredients_structured and servings on success', async () => {
    const aiPayload = {
      servings: 4,
      ingredients_structured: [
        { name: 'chicken breast', quantity: '1 lb', unit: 'lb', notes: 'boneless' },
        { name: 'pasta',          quantity: '8 oz', unit: 'oz', notes: null },
      ],
    }
    const anthropicClient = makeAnthropic(aiPayload)
    const supabase = makeSupabaseMock()

    const result = await processRow({
      row: { id: 'r1', name: 'Chicken Pasta', proteins: ['Chicken'], main_carb: 'Pasta', vegetables: [], fruits: [], dairy_components: [] },
      anthropicClient,
      supabase,
      logger: silentLogger,
    })

    expect(result).toEqual({ ok: true, count: 2 })
    expect(supabase._spies.update).toHaveBeenCalledWith({
      ingredients_structured: aiPayload.ingredients_structured,
      servings: 4,
    })
    expect(supabase._spies.eq).toHaveBeenCalledWith('id', 'r1')
  })

  it('servings: null from AI is stored as null', async () => {
    const aiPayload = { servings: null, ingredients_structured: [{ name: 'flour', quantity: '1 cup', unit: 'cup', notes: null }] }
    const anthropicClient = makeAnthropic(aiPayload)
    const supabase = makeSupabaseMock()

    await processRow({ row: { id: 'r2', name: 'Bread', proteins: [], main_carb: 'Bread', vegetables: [], fruits: [], dairy_components: [] }, anthropicClient, supabase, logger: silentLogger })

    expect(supabase._spies.update).toHaveBeenCalledWith(expect.objectContaining({ servings: null }))
  })

  it('non-integer servings (float) is stored as null', async () => {
    const aiPayload = { servings: 3.5, ingredients_structured: [{ name: 'butter', quantity: '2 tbsp', unit: 'tbsp', notes: null }] }
    const anthropicClient = makeAnthropic(aiPayload)
    const supabase = makeSupabaseMock()

    await processRow({ row: { id: 'r3', name: 'Cookie', proteins: [], main_carb: null, vegetables: [], fruits: [], dairy_components: ['Butter'] }, anthropicClient, supabase, logger: silentLogger })

    expect(supabase._spies.update).toHaveBeenCalledWith(expect.objectContaining({ servings: null }))
  })
})

describe('processRow — AI / parse failures', () => {
  it('returns { ok: false, reason: "analyze" } when Anthropic throws', async () => {
    const anthropicClient = {
      messages: { create: vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { status: 503 })) },
    }
    const supabase = makeSupabaseMock()

    const result = await processRow({
      row: { id: 'r4', name: 'Pasta', proteins: [], main_carb: 'Pasta', vegetables: [], fruits: [], dairy_components: [] },
      anthropicClient,
      supabase,
      logger: silentLogger,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('analyze')
    expect(result.status).toBe(503)
    expect(supabase._spies.update).not.toHaveBeenCalled()
  })

  it('returns { ok: false, reason: "parse" } when AI returns non-JSON', async () => {
    const anthropicClient = {
      messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'Sorry, cannot help.' }] }) },
    }
    const supabase = makeSupabaseMock()

    const result = await processRow({
      row: { id: 'r5', name: 'Pasta', proteins: [], main_carb: 'Pasta', vegetables: [], fruits: [], dairy_components: [] },
      anthropicClient,
      supabase,
      logger: silentLogger,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('parse')
    expect(supabase._spies.update).not.toHaveBeenCalled()
  })

  it('returns { ok: false, reason: "parse" } when ingredients_structured is missing from AI response', async () => {
    const anthropicClient = makeAnthropic({ servings: 2 })
    const supabase = makeSupabaseMock()

    const result = await processRow({
      row: { id: 'r6', name: 'Pasta', proteins: [], main_carb: 'Pasta', vegetables: [], fruits: [], dairy_components: [] },
      anthropicClient,
      supabase,
      logger: silentLogger,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('parse')
  })
})

describe('processRow — Supabase update failure', () => {
  it('returns { ok: false, reason: "update" } when the DB write fails', async () => {
    const aiPayload = { servings: 2, ingredients_structured: [{ name: 'salt', quantity: null, unit: null, notes: null }] }
    const anthropicClient = makeAnthropic(aiPayload)
    const supabase = makeSupabaseMock({ updateError: { message: 'connection error' } })

    const result = await processRow({
      row: { id: 'r7', name: 'Soup', proteins: ['Chicken'], main_carb: null, vegetables: [], fruits: [], dairy_components: [] },
      anthropicClient,
      supabase,
      logger: silentLogger,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('update')
  })
})
