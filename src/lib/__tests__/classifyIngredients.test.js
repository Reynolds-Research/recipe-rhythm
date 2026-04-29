import { describe, it, expect, vi } from 'vitest'
import { classifyIngredients, ClassifyIngredientsError } from '../classifyIngredients.js'

function makeMockClient(textResponse) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: textResponse }],
      }),
    },
  }
}

describe('classifyIngredients', () => {
  it('returns parsed classifications with source: "ai" added to every entry', async () => {
    const anthropicClient = makeMockClient(
      JSON.stringify({
        classifications: [
          { name: 'beef',  essentiality: 'essential' },
          { name: 'onion', essentiality: 'omittable' },
        ],
      }),
    )

    const result = await classifyIngredients({
      ingredients: ['1 lb ground beef', '1 onion, diced'],
      recipeName: 'Cheeseburgers',
      cuisine: 'American',
      anthropicClient,
    })

    expect(result).toEqual({
      classifications: [
        { name: 'beef',  essentiality: 'essential', source: 'ai' },
        { name: 'onion', essentiality: 'omittable', source: 'ai' },
      ],
    })
  })

  it('uses Haiku 4.5 and includes recipeName, cuisine, and each ingredient line in the user message', async () => {
    const anthropicClient = makeMockClient(
      JSON.stringify({
        classifications: [{ name: 'flour', essentiality: 'essential' }],
      }),
    )

    await classifyIngredients({
      ingredients: ['2 cups flour', 'pinch of salt'],
      recipeName: 'Sourdough',
      cuisine: 'European',
      anthropicClient,
    })

    expect(anthropicClient.messages.create).toHaveBeenCalledTimes(1)
    const call = anthropicClient.messages.create.mock.calls[0][0]
    expect(call.model).toBe('claude-haiku-4-5-20251001')
    expect(typeof call.system).toBe('string')
    expect(call.system).toMatch(/essential/i)
    expect(call.system).toMatch(/omittable/i)
    // PRD-004 Phase B: prompt must instruct the model to preserve input
    // names verbatim (no more splitting "onion/garlic" → "onion"+"garlic").
    expect(call.system).toMatch(/exactly|verbatim/i)
    // PRD-004 Phase B: "with X" in recipe name should be treated as
    // descriptive, not contractual.
    expect(call.system).toMatch(/with X|substitut/i)
    // PRD-004 Phase B: chip-picker placeholder "none" should be skipped.
    expect(call.system).toMatch(/none/i)
    expect(call.messages).toHaveLength(1)
    expect(call.messages[0].role).toBe('user')

    const userText = call.messages[0].content
    expect(userText).toContain('Recipe: Sourdough')
    expect(userText).toContain('Cuisine: European')
    expect(userText).toContain('- 2 cups flour')
    expect(userText).toContain('- pinch of salt')
  })

  it('uses "unknown" for cuisine when null/empty', async () => {
    const anthropicClient = makeMockClient(
      JSON.stringify({
        classifications: [{ name: 'x', essentiality: 'essential' }],
      }),
    )

    await classifyIngredients({
      ingredients: ['x'],
      recipeName: 'Mystery Dish',
      cuisine: null,
      anthropicClient,
    })

    const userText = anthropicClient.messages.create.mock.calls[0][0].messages[0].content
    expect(userText).toContain('Cuisine: unknown')
  })

  it('throws ClassifyIngredientsError on malformed JSON, attaching the raw response', async () => {
    const anthropicClient = makeMockClient('not even close to json')

    await expect(
      classifyIngredients({
        ingredients: ['salt'],
        recipeName: 'X',
        anthropicClient,
      }),
    ).rejects.toMatchObject({
      name: 'ClassifyIngredientsError',
      rawResponse: 'not even close to json',
    })
  })

  it('throws ClassifyIngredientsError when JSON is valid but missing the `classifications` array', async () => {
    const anthropicClient = makeMockClient(JSON.stringify({ something_else: [] }))

    await expect(
      classifyIngredients({
        ingredients: ['salt'],
        recipeName: 'X',
        anthropicClient,
      }),
    ).rejects.toBeInstanceOf(ClassifyIngredientsError)
  })

  it('throws ClassifyIngredientsError when an entry has an invalid essentiality value', async () => {
    const anthropicClient = makeMockClient(
      JSON.stringify({
        classifications: [{ name: 'beef', essentiality: 'maybe' }],
      }),
    )

    await expect(
      classifyIngredients({
        ingredients: ['beef'],
        recipeName: 'X',
        anthropicClient,
      }),
    ).rejects.toBeInstanceOf(ClassifyIngredientsError)
  })

  it('rejects empty ingredients arrays + missing recipeName at the helper boundary', async () => {
    const anthropicClient = makeMockClient('{}')

    await expect(
      classifyIngredients({ ingredients: [], recipeName: 'X', anthropicClient }),
    ).rejects.toThrow(/non-empty array/i)

    await expect(
      classifyIngredients({ ingredients: ['x'], recipeName: '   ', anthropicClient }),
    ).rejects.toThrow(/non-empty string/i)
  })
})
