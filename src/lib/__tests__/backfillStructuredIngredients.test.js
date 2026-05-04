/**
 * Unit tests for scripts/backfill-structured-ingredients.mjs.
 * Drives `buildBackfillPrompt` and `processRow` with mocked dependencies —
 * no network calls, no `main()` invoked.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  buildBackfillPrompt,
  processRow,
} from '../../../scripts/backfill-structured-ingredients.mjs'

// Minimal Supabase mock that covers the `.from('vault').update({...}).eq('id', id)` chain.
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

// ---------- buildBackfillPrompt ----------

describe('buildBackfillPrompt', () => {
  it('includes the recipe name', () => {
    const prompt = buildBackfillPrompt({ name: 'Spaghetti Carbonara', ingredients: ['200g pasta', '3 eggs'] })
    expect(prompt).toContain('Spaghetti Carbonara')
  })

  it('joins ingredients as newline-separated lines', () => {
    const prompt = buildBackfillPrompt({ name: 'Test', ingredients: ['1 cup flour', '2 eggs', '1 tsp salt'] })
    expect(prompt).toContain('1 cup flour\n2 eggs\n1 tsp salt')
  })

  it('uses sentinel when ingredients is empty or null', () => {
    expect(buildBackfillPrompt({ name: 'Empty', ingredients: [] })).toContain('(no ingredients listed)')
    expect(buildBackfillPrompt({ name: 'Null', ingredients: null })).toContain('(no ingredients listed)')
  })

  it('requests both servings and ingredients_structured fields', () => {
    const prompt = buildBackfillPrompt({ name: 'X', ingredients: [] })
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
        { name: 'pasta', quantity: '200g', unit: 'g', notes: null },
        { name: 'eggs',  quantity: '3',    unit: null, notes: null },
      ],
    }
    const anthropicClient = makeAnthropic(aiPayload)
    const supabase = makeSupabaseMock()

    const result = await processRow({
      row: { id: 'r1', name: 'Carbonara', ingredients: ['200g pasta', '3 eggs'] },
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

    await processRow({ row: { id: 'r2', name: 'Bread', ingredients: ['1 cup flour'] }, anthropicClient, supabase, logger: silentLogger })

    expect(supabase._spies.update).toHaveBeenCalledWith(
      expect.objectContaining({ servings: null }),
    )
  })

  it('non-integer servings (float) is stored as null', async () => {
    const aiPayload = { servings: 3.5, ingredients_structured: [{ name: 'butter', quantity: '2 tbsp', unit: 'tbsp', notes: null }] }
    const anthropicClient = makeAnthropic(aiPayload)
    const supabase = makeSupabaseMock()

    await processRow({ row: { id: 'r3', name: 'Butter Cookie', ingredients: [] }, anthropicClient, supabase, logger: silentLogger })

    expect(supabase._spies.update).toHaveBeenCalledWith(
      expect.objectContaining({ servings: null }),
    )
  })
})

describe('processRow — AI / parse failures', () => {
  it('returns { ok: false, reason: "analyze" } when Anthropic throws', async () => {
    const anthropicClient = {
      messages: {
        create: vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { status: 503 })),
      },
    }
    const supabase = makeSupabaseMock()

    const result = await processRow({
      row: { id: 'r4', name: 'Pasta', ingredients: [] },
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
      messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'Sorry, I cannot help.' }] }) },
    }
    const supabase = makeSupabaseMock()

    const result = await processRow({
      row: { id: 'r5', name: 'Pasta', ingredients: [] },
      anthropicClient,
      supabase,
      logger: silentLogger,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('parse')
    expect(supabase._spies.update).not.toHaveBeenCalled()
  })

  it('returns { ok: false, reason: "parse" } when ingredients_structured is missing', async () => {
    const anthropicClient = makeAnthropic({ servings: 2 })
    const supabase = makeSupabaseMock()

    const result = await processRow({
      row: { id: 'r6', name: 'Pasta', ingredients: [] },
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
      row: { id: 'r7', name: 'Soup', ingredients: ['salt'] },
      anthropicClient,
      supabase,
      logger: silentLogger,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('update')
  })
})
