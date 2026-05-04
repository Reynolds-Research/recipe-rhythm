/**
 * Unit/integration tests for /api/analyze-recipe (PRD-006 P0.2).
 *
 * Tests the shared handler in api/_lib/analyzeRecipeHandler.js, which is used
 * by both api-server.mjs (local Express proxy) and api/analyze-recipe.js
 * (Vercel serverless mirror). Driven via mocked req/res — no Express server
 * spun up, no real Anthropic call made.
 *
 * Coverage:
 *   - Happy path: all fields present, servings_inferred = true
 *   - Servings fallback: AI null + caller default_servings → caller value used
 *   - Servings fallback: AI null + no default_servings → hardcoded 4
 *   - Ingredients with null quantity/unit/notes preserved (no items dropped)
 *   - Malformed AI JSON → 502 parse_failed
 *   - All pre-PRD-006 fields (cuisine, proteins, etc.) still present
 *   - 503 when no Anthropic client configured
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createAnalyzeRecipeHandler } from '../../../api/_lib/analyzeRecipeHandler.js'

// ---------- helpers ----------

function mockRes() {
  const res = { statusCode: 200, body: undefined, headers: {} }
  res.status = vi.fn(code => { res.statusCode = code; return res })
  res.json  = vi.fn(payload => { res.body = payload; return res })
  res.setHeader = vi.fn((k, v) => { res.headers[k] = v })
  return res
}

function fakeAnthropic(returnText) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: returnText }],
      }),
    },
  }
}

// A representative AI response containing all fields (pre-PRD-006 + new).
const FULL_AI_RESPONSE = {
  cuisine_type:     'Italian',
  flavor_profile:   'Savory',
  proteins:         ['Chicken'],
  cooking_method:   'Baked',
  main_carb:        'Pasta',
  dietary_tags:     [],
  dairy_components: ['Parmesan'],
  vegetables:       ['Tomato'],
  fruits:           [],
  prep_time_minutes: 30,
  servings: 4,
  ingredients_structured: [
    { name: 'chicken breasts', quantity: '2 lbs',  unit: 'lbs',  notes: 'boneless, skinless' },
    { name: 'pasta',           quantity: '1 lb',   unit: 'lb',   notes: null },
    { name: 'olive oil',       quantity: '2 tbsp', unit: 'tbsp', notes: null },
    { name: 'garlic cloves',   quantity: '4',      unit: null,   notes: 'minced' },
  ],
}

// ---------- tests ----------

describe('createAnalyzeRecipeHandler — 503 when no client', () => {
  it('returns 503 when no anthropic client is configured', async () => {
    const handler = createAnalyzeRecipeHandler({ anthropic: null })
    const res = mockRes()
    await handler({ body: { name: 'Pizza' } }, res)
    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual({ error: 'api_key_missing' })
  })
})

describe('createAnalyzeRecipeHandler — happy path', () => {
  it('returns components with all legacy fields intact', async () => {
    const client = fakeAnthropic(JSON.stringify(FULL_AI_RESPONSE))
    const handler = createAnalyzeRecipeHandler({ anthropic: client })
    const res = mockRes()

    await handler({ body: { name: 'Chicken Pasta' } }, res)

    expect(res.statusCode).toBe(200)
    const { components } = res.body
    // Pre-PRD-006 fields must all still be present.
    expect(components.cuisine_type).toBe('Italian')
    expect(components.flavor_profile).toBe('Savory')
    expect(components.proteins).toEqual(['Chicken'])
    expect(components.cooking_method).toBe('Baked')
    expect(components.main_carb).toBe('Pasta')
    expect(components.dietary_tags).toEqual([])
    expect(components.dairy_components).toEqual(['Parmesan'])
    expect(components.vegetables).toEqual(['Tomato'])
    expect(components.fruits).toEqual([])
    expect(components.prep_time_minutes).toBe(30)
  })

  it('AI returns servings integer → servings_inferred: true, value passed through', async () => {
    const client = fakeAnthropic(JSON.stringify(FULL_AI_RESPONSE)) // servings: 4
    const handler = createAnalyzeRecipeHandler({ anthropic: client })
    const res = mockRes()

    await handler({ body: { name: 'Chicken Pasta' } }, res)

    expect(res.body.components.servings).toBe(4)
    expect(res.body.components.servings_inferred).toBe(true)
  })

  it('ingredients_structured is present and contains all items from the AI response', async () => {
    const client = fakeAnthropic(JSON.stringify(FULL_AI_RESPONSE))
    const handler = createAnalyzeRecipeHandler({ anthropic: client })
    const res = mockRes()

    await handler({ body: { name: 'Chicken Pasta' } }, res)

    const items = res.body.components.ingredients_structured
    expect(Array.isArray(items)).toBe(true)
    expect(items).toHaveLength(4)
    expect(items[0]).toEqual({ name: 'chicken breasts', quantity: '2 lbs', unit: 'lbs', notes: 'boneless, skinless' })
    expect(items[3]).toEqual({ name: 'garlic cloves',   quantity: '4',     unit: null,  notes: 'minced' })
  })
})

describe('createAnalyzeRecipeHandler — servings fallback', () => {
  it('AI returns servings: null + caller supplies default_servings: 3 → servings: 3, servings_inferred: false', async () => {
    const aiResponse = { ...FULL_AI_RESPONSE, servings: null }
    const client = fakeAnthropic(JSON.stringify(aiResponse))
    const handler = createAnalyzeRecipeHandler({ anthropic: client })
    const res = mockRes()

    await handler({ body: { name: 'Pasta', default_servings: 3 } }, res)

    expect(res.body.components.servings).toBe(3)
    expect(res.body.components.servings_inferred).toBe(false)
  })

  it('AI returns servings: null + no default_servings in request → servings: 4, servings_inferred: false', async () => {
    const aiResponse = { ...FULL_AI_RESPONSE, servings: null }
    const client = fakeAnthropic(JSON.stringify(aiResponse))
    const handler = createAnalyzeRecipeHandler({ anthropic: client })
    const res = mockRes()

    await handler({ body: { name: 'Pasta' } }, res)

    expect(res.body.components.servings).toBe(4)
    expect(res.body.components.servings_inferred).toBe(false)
  })

  it('AI omits servings field entirely → falls back to 4', async () => {
    const { servings: _omit, ...aiResponseWithoutServings } = FULL_AI_RESPONSE
    const client = fakeAnthropic(JSON.stringify(aiResponseWithoutServings))
    const handler = createAnalyzeRecipeHandler({ anthropic: client })
    const res = mockRes()

    await handler({ body: { name: 'Pasta' } }, res)

    expect(res.body.components.servings).toBe(4)
    expect(res.body.components.servings_inferred).toBe(false)
  })

  it('AI returns servings as a non-integer (float) → treated as null, falls back', async () => {
    const aiResponse = { ...FULL_AI_RESPONSE, servings: 3.5 }
    const client = fakeAnthropic(JSON.stringify(aiResponse))
    const handler = createAnalyzeRecipeHandler({ anthropic: client })
    const res = mockRes()

    await handler({ body: { name: 'Pasta', default_servings: 6 } }, res)

    expect(res.body.components.servings).toBe(6)
    expect(res.body.components.servings_inferred).toBe(false)
  })

  it('default_servings is a float → ignored, hardcoded fallback 4 used', async () => {
    const aiResponse = { ...FULL_AI_RESPONSE, servings: null }
    const client = fakeAnthropic(JSON.stringify(aiResponse))
    const handler = createAnalyzeRecipeHandler({ anthropic: client })
    const res = mockRes()

    await handler({ body: { name: 'Pasta', default_servings: 2.5 } }, res)

    expect(res.body.components.servings).toBe(4)
    expect(res.body.components.servings_inferred).toBe(false)
  })

  it('default_servings is 0 or negative → ignored, hardcoded fallback 4 used', async () => {
    const aiResponse = { ...FULL_AI_RESPONSE, servings: null }
    const client = fakeAnthropic(JSON.stringify(aiResponse))
    const handler = createAnalyzeRecipeHandler({ anthropic: client })

    for (const bad of [0, -1, -10]) {
      const res = mockRes()
      await handler({ body: { name: 'Pasta', default_servings: bad } }, res)
      expect(res.body.components.servings, `default_servings=${bad} should fall back to 4`).toBe(4)
    }
  })
})

describe('createAnalyzeRecipeHandler — partial ingredients', () => {
  it('ingredients with null quantity/unit/notes are preserved as-is (no items dropped)', async () => {
    const aiResponse = {
      ...FULL_AI_RESPONSE,
      ingredients_structured: [
        { name: 'chicken',    quantity: '2 lbs', unit: 'lbs',  notes: null },
        { name: 'salt',       quantity: null,    unit: null,   notes: 'to taste' },
        { name: 'bay leaves', quantity: null,    unit: null,   notes: null },
      ],
    }
    const client = fakeAnthropic(JSON.stringify(aiResponse))
    const handler = createAnalyzeRecipeHandler({ anthropic: client })
    const res = mockRes()

    await handler({ body: { name: 'Stew' } }, res)

    const items = res.body.components.ingredients_structured
    expect(items).toHaveLength(3)
    expect(items[1]).toEqual({ name: 'salt',       quantity: null, unit: null, notes: 'to taste' })
    expect(items[2]).toEqual({ name: 'bay leaves', quantity: null, unit: null, notes: null })
  })

  it('ingredients_structured: null in AI response → null in components (graceful)', async () => {
    const aiResponse = { ...FULL_AI_RESPONSE, ingredients_structured: null }
    const client = fakeAnthropic(JSON.stringify(aiResponse))
    const handler = createAnalyzeRecipeHandler({ anthropic: client })
    const res = mockRes()

    await handler({ body: { name: 'Stew' } }, res)

    expect(res.body.components.ingredients_structured).toBeNull()
  })
})

describe('createAnalyzeRecipeHandler — parse failure', () => {
  let errSpy
  beforeEach(() => { errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { errSpy.mockRestore() })

  it('AI returns malformed JSON → 502 parse_failed', async () => {
    const client = fakeAnthropic('I cannot help with that.')
    const handler = createAnalyzeRecipeHandler({ anthropic: client })
    const res = mockRes()

    await handler({ body: { name: 'Pizza' } }, res)

    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ error: 'parse_failed' })
  })

  it('upstream Anthropic call throws → 502 upstream_failed', async () => {
    const client = {
      messages: { create: vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { status: 504 })) },
    }
    const handler = createAnalyzeRecipeHandler({ anthropic: client })
    const res = mockRes()

    await handler({ body: { name: 'Pizza' } }, res)

    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ error: 'upstream_failed' })
  })
})

// Helper used by the userChips tests below: capture the exact text prompt
// that was sent to Anthropic in the most recent call.
function getPromptText(client) {
  const content = client.messages.create.mock.calls[0][0].messages[0].content
  return Array.isArray(content)
    ? content.find(b => b.type === 'text')?.text ?? ''
    : String(content)
}

describe('createAnalyzeRecipeHandler — userChips grounding (PRD-006 D1)', () => {
  it('absent userChips → prompt is byte-for-byte identical to no-userChips baseline', async () => {
    // Establish the baseline first.
    const baselineClient = fakeAnthropic(JSON.stringify(FULL_AI_RESPONSE))
    const baselineHandler = createAnalyzeRecipeHandler({ anthropic: baselineClient })
    await baselineHandler({ body: { name: 'Pad Thai' } }, mockRes())
    const baselinePrompt = getPromptText(baselineClient)

    // Then run with userChips: undefined and userChips: null and {}.
    for (const variant of [undefined, null, {}]) {
      const client = fakeAnthropic(JSON.stringify(FULL_AI_RESPONSE))
      const handler = createAnalyzeRecipeHandler({ anthropic: client })
      const body = { name: 'Pad Thai' }
      if (variant !== undefined) body.userChips = variant
      await handler({ body }, mockRes())
      expect(getPromptText(client), `userChips=${JSON.stringify(variant)} should produce baseline prompt`).toBe(baselinePrompt)
    }
  })

  it('userChips with all-empty arrays + null scalars → no chip block, prompt identical to baseline', async () => {
    const baselineClient = fakeAnthropic(JSON.stringify(FULL_AI_RESPONSE))
    const baselineHandler = createAnalyzeRecipeHandler({ anthropic: baselineClient })
    await baselineHandler({ body: { name: 'Test' } }, mockRes())
    const baselinePrompt = getPromptText(baselineClient)

    const client = fakeAnthropic(JSON.stringify(FULL_AI_RESPONSE))
    const handler = createAnalyzeRecipeHandler({ anthropic: client })
    await handler({
      body: {
        name: 'Test',
        userChips: {
          protein: null, cooking_method: null, main_carb: null,
          dietary_tags: [], dairy_components: [], vegetables: [],
          fruit: [], prep_time: null,
        },
      },
    }, mockRes())
    expect(getPromptText(client)).toBe(baselinePrompt)
  })

  it('userChips with values → chip-grounding block is present, lists user values, includes ground-truth instruction', async () => {
    const client = fakeAnthropic(JSON.stringify(FULL_AI_RESPONSE))
    const handler = createAnalyzeRecipeHandler({ anthropic: client })
    await handler({
      body: {
        name: 'Pad Thai',
        userChips: {
          protein:        ['Chicken', 'Tofu'],
          cooking_method: 'Stir-Fried',
          main_carb:      'Rice Noodles',
          dietary_tags:   ['Gluten-Free'],
          fruit:          [],          // empty array → omitted
          prep_time:      30,
        },
      },
    }, mockRes())

    const prompt = getPromptText(client)
    // Block heading and instruction.
    expect(prompt).toContain('USER-CONFIRMED CHIPS:')
    expect(prompt).toContain('Use them as ground truth when extracting ingredients')
    expect(prompt).toContain('should not contradict any chip the user explicitly set')
    // Each populated value appears.
    expect(prompt).toContain('Protein: Chicken, Tofu')
    expect(prompt).toContain('Cooking method: Stir-Fried')
    expect(prompt).toContain('Main carb: Rice Noodles')
    expect(prompt).toContain('Dietary tags: Gluten-Free')
    expect(prompt).toContain('Prep time: 30')
    // Empty/absent fields are omitted (no "Fruit:" line).
    expect(prompt).not.toContain('Fruit:')
    expect(prompt).not.toContain('Dairy components:')
    // The chip-grounding block precedes the analyze instruction.
    expect(prompt.indexOf('USER-CONFIRMED CHIPS:'))
      .toBeLessThan(prompt.indexOf('Analyze this meal/recipe'))
  })

  it('userChips with only one populated field → block contains only that field', async () => {
    const client = fakeAnthropic(JSON.stringify(FULL_AI_RESPONSE))
    const handler = createAnalyzeRecipeHandler({ anthropic: client })
    await handler({
      body: { name: 'Test', userChips: { protein: ['Beef'] } },
    }, mockRes())

    const prompt = getPromptText(client)
    expect(prompt).toContain('USER-CONFIRMED CHIPS:')
    expect(prompt).toContain('Protein: Beef')
    expect(prompt).not.toContain('Main carb:')
    expect(prompt).not.toContain('Cooking method:')
  })
})

describe('createAnalyzeRecipeHandler — prompt contract', () => {
  it('calls Anthropic with claude-sonnet-4-6 and max_tokens: 1500', async () => {
    const client = fakeAnthropic(JSON.stringify(FULL_AI_RESPONSE))
    const handler = createAnalyzeRecipeHandler({ anthropic: client })
    const res = mockRes()

    await handler({ body: { name: 'Pizza' } }, res)

    const call = client.messages.create.mock.calls[0][0]
    expect(call.model).toBe('claude-sonnet-4-6')
    expect(call.max_tokens).toBe(1500)
  })

  it('includes the recipe name in the prompt', async () => {
    const client = fakeAnthropic(JSON.stringify(FULL_AI_RESPONSE))
    const handler = createAnalyzeRecipeHandler({ anthropic: client })
    const res = mockRes()

    await handler({ body: { name: 'Spaghetti Bolognese' } }, res)

    const textContent = client.messages.create.mock.calls[0][0].messages[0].content
    const textBlock = Array.isArray(textContent)
      ? textContent.find(b => b.type === 'text')?.text ?? ''
      : String(textContent)
    expect(textBlock).toContain('Spaghetti Bolognese')
  })

  it('includes ingredients_structured and servings in the prompt', async () => {
    const client = fakeAnthropic(JSON.stringify(FULL_AI_RESPONSE))
    const handler = createAnalyzeRecipeHandler({ anthropic: client })
    const res = mockRes()

    await handler({ body: { name: 'Test' } }, res)

    const textContent = client.messages.create.mock.calls[0][0].messages[0].content
    const textBlock = Array.isArray(textContent)
      ? textContent.find(b => b.type === 'text')?.text ?? ''
      : String(textContent)
    expect(textBlock).toContain('ingredients_structured')
    expect(textBlock).toContain('servings')
  })
})
