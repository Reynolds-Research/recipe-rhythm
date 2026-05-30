/**
 * Unit/integration tests for /api/grocery-list (PRD-003 P0.3 Bite B).
 *
 * Covers two layers:
 *   1. The shared request handler in api/_lib/groceryListHandler.js used
 *      by the Express proxy AND the Vercel serverless mirror (validation,
 *      success path, error mapping).
 *   2. The pure-logic generator in src/lib/groceryList.js (prompt
 *      contract, out-of-vocabulary section coercion, pantry-staple
 *      backstop, parse failure raises GroceryListError).
 *
 * Driven via mocked req/res — no Express server spun up, no Vercel runtime
 * invoked, no real Anthropic call made.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createGroceryListHandler } from '../../../api/_lib/groceryListHandler.js'
import { buildGroceryList, GroceryListError } from '../groceryList.js'
import { GROCERY_SECTIONS } from '../constants.js'

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    headers: {},
  }
  res.status = vi.fn(code => { res.statusCode = code; return res })
  res.json = vi.fn(payload => { res.body = payload; return res })
  res.setHeader = vi.fn((k, v) => { res.headers[k] = v })
  return res
}

const okClient = { messages: { create: vi.fn() } } // truthy "anthropic" stand-in

const validBody = () => ({
  recipes: [
    { name: 'Chicken Tacos', ingredients: ['chicken thighs', 'corn tortillas', 'lime'] },
    { name: 'Pasta Carbonara', ingredients: ['spaghetti', 'eggs', 'pancetta'] },
  ],
  pantryStaples: [],
})

// ---------- handler: validation + error mapping ----------

describe('createGroceryListHandler — validation', () => {
  it('returns 503 when no anthropic client is configured', async () => {
    const handler = createGroceryListHandler({ anthropic: null })
    const res = mockRes()
    await handler({ body: validBody() }, res)
    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual({ error: 'api_key_missing' })
  })

  it('rejects a missing recipes field with 400', async () => {
    const handler = createGroceryListHandler({ anthropic: okClient })
    const res = mockRes()
    await handler({ body: { pantryStaples: [] } }, res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('invalid_recipes')
  })

  it('rejects an empty recipes array with 400', async () => {
    const handler = createGroceryListHandler({ anthropic: okClient })
    const res = mockRes()
    await handler({ body: { recipes: [], pantryStaples: [] } }, res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('invalid_recipes')
  })

  it('rejects a recipe with no ingredients with 400', async () => {
    const handler = createGroceryListHandler({ anthropic: okClient })
    const res = mockRes()
    await handler({
      body: { recipes: [{ name: 'X', ingredients: [] }], pantryStaples: [] },
    }, res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('invalid_recipes')
  })

  it('rejects a recipe with non-string ingredients with 400', async () => {
    const handler = createGroceryListHandler({ anthropic: okClient })
    const res = mockRes()
    await handler({
      body: { recipes: [{ name: 'X', ingredients: ['ok', 42] }], pantryStaples: [] },
    }, res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('invalid_recipes')
  })

  it('rejects a recipe missing a name with 400', async () => {
    const handler = createGroceryListHandler({ anthropic: okClient })
    const res = mockRes()
    await handler({
      body: { recipes: [{ name: '   ', ingredients: ['ok'] }], pantryStaples: [] },
    }, res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('invalid_recipes')
  })

  it('rejects non-array pantryStaples with 400', async () => {
    const handler = createGroceryListHandler({ anthropic: okClient })
    const res = mockRes()
    await handler({
      body: { recipes: validBody().recipes, pantryStaples: 'salt, pepper' },
    }, res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('invalid_pantry_staples')
  })

  it('rejects pantryStaples containing non-string entries with 400', async () => {
    const handler = createGroceryListHandler({ anthropic: okClient })
    const res = mockRes()
    await handler({
      body: { recipes: validBody().recipes, pantryStaples: ['salt', 42] },
    }, res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('invalid_pantry_staples')
  })

  it('accepts an empty pantryStaples array (the v1 default)', async () => {
    const fakeOutput = { items: [{ name: 'lime', quantity: '2', section: 'Produce' }] }
    const buildImpl = vi.fn().mockResolvedValue(fakeOutput)
    const handler = createGroceryListHandler({ anthropic: okClient, buildImpl })

    const res = mockRes()
    await handler({ body: validBody() }, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual(fakeOutput)
    expect(buildImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        pantryStaples: [],
        anthropicClient: okClient,
      }),
    )
  })

  it('omits pantryStaples → defaults to []', async () => {
    const buildImpl = vi.fn().mockResolvedValue({ items: [] })
    const handler = createGroceryListHandler({ anthropic: okClient, buildImpl })

    const res = mockRes()
    await handler({ body: { recipes: validBody().recipes } }, res)

    expect(res.statusCode).toBe(200)
    expect(buildImpl).toHaveBeenCalledWith(
      expect.objectContaining({ pantryStaples: [] }),
    )
  })
})

describe('createGroceryListHandler — happy path', () => {
  it('passes through the generator output on the 200 path', async () => {
    const fakeOutput = {
      items: [
        { name: 'chicken thighs', quantity: '2 lbs', section: 'Meat & Seafood' },
        { name: 'lime',           quantity: '2',     section: 'Produce' },
        { name: 'spaghetti',      quantity: '1 lb',  section: 'Pantry' },
      ],
    }
    const buildImpl = vi.fn().mockResolvedValue(fakeOutput)
    const handler = createGroceryListHandler({ anthropic: okClient, buildImpl })

    const res = mockRes()
    await handler({
      body: {
        recipes: [
          { name: '  Chicken Tacos  ', ingredients: ['  chicken thighs  ', 'lime'] },
          { name: 'Pasta Carbonara',   ingredients: ['spaghetti', 'eggs'] },
        ],
        pantryStaples: ['  olive oil  ', 'salt'],
      },
    }, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual(fakeOutput)

    // Trims whitespace from names, ingredients, and staples before delegating.
    // servings defaults to null when omitted from the request body.
    expect(buildImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        recipes: [
          { name: 'Chicken Tacos',   ingredients: ['chicken thighs', 'lime'], servings: null },
          { name: 'Pasta Carbonara', ingredients: ['spaghetti', 'eggs'],      servings: null },
        ],
        pantryStaples: ['olive oil', 'salt'],
        anthropicClient: okClient,
      }),
    )
  })
})

describe('createGroceryListHandler — error mapping', () => {
  it('returns 502 with sanitized error when the generator throws GroceryListError', async () => {
    const buildImpl = vi.fn().mockRejectedValue(
      new GroceryListError('parse failure', { rawResponse: 'oops-raw-llm-text' }),
    )
    const handler = createGroceryListHandler({ anthropic: okClient, buildImpl })

    const res = mockRes()
    await handler({ body: validBody() }, res)

    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ error: 'parse_failed' })
    // Raw LLM response stays out of the client payload.
    expect(JSON.stringify(res.body)).not.toContain('oops-raw-llm-text')
  })

  it('returns 500 with sanitized error on any other generator failure', async () => {
    const buildImpl = vi.fn().mockRejectedValue(
      Object.assign(new Error('upstream 500'), { status: 500 }),
    )
    const handler = createGroceryListHandler({ anthropic: okClient, buildImpl })

    const res = mockRes()
    await handler({ body: validBody() }, res)

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'grocery_list_failed' })
  })
})

// ---------- buildGroceryList: prompt + parse + coercion ----------

function fakeAnthropic(returnText) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: returnText }] }),
    },
  }
}

describe('buildGroceryList — prompt contract', () => {
  it('interpolates GROCERY_SECTIONS into the prompt (single source of truth)', async () => {
    const client = fakeAnthropic(JSON.stringify({ items: [] }))
    await buildGroceryList({
      recipes: [{ name: 'X', ingredients: ['a'] }],
      pantryStaples: [],
      anthropicClient: client,
    })

    const promptText = client.messages.create.mock.calls[0][0].messages[0].content
    for (const section of GROCERY_SECTIONS) {
      expect(promptText, `prompt missing section "${section}"`).toContain(section)
    }
  })

  it('uses Haiku 4.5', async () => {
    const client = fakeAnthropic(JSON.stringify({ items: [] }))
    await buildGroceryList({
      recipes: [{ name: 'X', ingredients: ['a'] }],
      pantryStaples: [],
      anthropicClient: client,
    })
    expect(client.messages.create.mock.calls[0][0].model).toBe('claude-haiku-4-5-20251001')
  })

  it('renders pantry staples in the prompt; "None" when empty', async () => {
    const empty = fakeAnthropic(JSON.stringify({ items: [] }))
    await buildGroceryList({
      recipes: [{ name: 'X', ingredients: ['a'] }],
      pantryStaples: [],
      anthropicClient: empty,
    })
    expect(empty.messages.create.mock.calls[0][0].messages[0].content).toContain('None')

    const withStaples = fakeAnthropic(JSON.stringify({ items: [] }))
    await buildGroceryList({
      recipes: [{ name: 'X', ingredients: ['a'] }],
      pantryStaples: ['olive oil', 'salt'],
      anthropicClient: withStaples,
    })
    const text = withStaples.messages.create.mock.calls[0][0].messages[0].content
    expect(text).toContain('olive oil')
    expect(text).toContain('salt')
  })

  it('renders each recipe with its ingredients list', async () => {
    const client = fakeAnthropic(JSON.stringify({ items: [] }))
    await buildGroceryList({
      recipes: [
        { name: 'Chicken Tacos', ingredients: ['chicken thighs', 'corn tortillas'] },
      ],
      pantryStaples: [],
      anthropicClient: client,
    })
    const text = client.messages.create.mock.calls[0][0].messages[0].content
    expect(text).toContain('Chicken Tacos')
    expect(text).toContain('chicken thighs')
    expect(text).toContain('corn tortillas')
  })
})

describe('buildGroceryList — output parsing', () => {
  it('parses the happy path into {items}', async () => {
    const client = fakeAnthropic(JSON.stringify({
      items: [
        { name: 'chicken thighs', quantity: '2 lbs', section: 'Meat & Seafood' },
        { name: 'lime',           quantity: '2',     section: 'Produce' },
      ],
    }))
    const result = await buildGroceryList({
      recipes: [{ name: 'X', ingredients: ['a'] }],
      pantryStaples: [],
      anthropicClient: client,
    })
    expect(result.items).toEqual([
      { name: 'chicken thighs', quantity: '2 lbs', section: 'Meat & Seafood' },
      { name: 'lime',           quantity: '2',     section: 'Produce' },
    ])
  })

  it('coerces null / "null" / empty quantity to null', async () => {
    const client = fakeAnthropic(JSON.stringify({
      items: [
        { name: 'a', quantity: null,   section: 'Produce' },
        { name: 'b', quantity: 'null', section: 'Produce' },
        { name: 'c', quantity: '   ',  section: 'Produce' },
        { name: 'd', quantity: '1 lb', section: 'Produce' },
      ],
    }))
    const { items } = await buildGroceryList({
      recipes: [{ name: 'X', ingredients: ['a'] }],
      pantryStaples: [],
      anthropicClient: client,
    })
    expect(items.map(i => i.quantity)).toEqual([null, null, null, '1 lb'])
  })

  it('coerces an out-of-vocabulary section to "Other" and warns', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = fakeAnthropic(JSON.stringify({
      items: [
        { name: 'mystery jar', quantity: '1', section: 'International' },
        { name: 'bread',       quantity: '1 loaf', section: 'Bakery' },
      ],
    }))
    const { items } = await buildGroceryList({
      recipes: [{ name: 'X', ingredients: ['a'] }],
      pantryStaples: [],
      anthropicClient: client,
    })
    expect(items[0].section).toBe('Other')
    expect(items[1].section).toBe('Bakery')
    expect(warnSpy).toHaveBeenCalled()
    expect(warnSpy.mock.calls[0].join(' ')).toContain('International')
    warnSpy.mockRestore()
  })

  it('drops items whose name matches a pantry staple (case-insensitive substring)', async () => {
    const client = fakeAnthropic(JSON.stringify({
      items: [
        { name: 'Olive Oil',   quantity: '1 bottle', section: 'Pantry' },
        { name: 'Kosher Salt', quantity: '1 box',    section: 'Pantry' },
        { name: 'chicken thighs', quantity: '2 lbs', section: 'Meat & Seafood' },
      ],
    }))
    const { items } = await buildGroceryList({
      recipes: [{ name: 'X', ingredients: ['a'] }],
      pantryStaples: ['olive oil', 'salt'],
      anthropicClient: client,
    })
    expect(items).toEqual([
      { name: 'chicken thighs', quantity: '2 lbs', section: 'Meat & Seafood' },
    ])
  })

  it('drops entries with missing/empty name without failing', async () => {
    const client = fakeAnthropic(JSON.stringify({
      items: [
        { name: '',    quantity: '1', section: 'Produce' },
        { name: '   ', quantity: '1', section: 'Produce' },
        { name: 'lime', quantity: '2', section: 'Produce' },
      ],
    }))
    const { items } = await buildGroceryList({
      recipes: [{ name: 'X', ingredients: ['a'] }],
      pantryStaples: [],
      anthropicClient: client,
    })
    expect(items).toEqual([{ name: 'lime', quantity: '2', section: 'Produce' }])
  })

  it('extracts a JSON object embedded in surrounding prose', async () => {
    const client = fakeAnthropic(
      'Here is your grocery list:\n```json\n{"items":[{"name":"lime","quantity":"2","section":"Produce"}]}\n```',
    )
    const { items } = await buildGroceryList({
      recipes: [{ name: 'X', ingredients: ['a'] }],
      pantryStaples: [],
      anthropicClient: client,
    })
    expect(items).toEqual([{ name: 'lime', quantity: '2', section: 'Produce' }])
  })
})

describe('buildGroceryList — failure modes', () => {
  let errSpy
  beforeEach(() => { errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { errSpy.mockRestore() })

  it('throws GroceryListError when the response is not parseable JSON', async () => {
    const client = fakeAnthropic('I cannot help with that.')
    await expect(
      buildGroceryList({
        recipes: [{ name: 'X', ingredients: ['a'] }],
        pantryStaples: [],
        anthropicClient: client,
      }),
    ).rejects.toBeInstanceOf(GroceryListError)
  })

  it('throws GroceryListError when items is missing', async () => {
    const client = fakeAnthropic(JSON.stringify({ stuff: [] }))
    await expect(
      buildGroceryList({
        recipes: [{ name: 'X', ingredients: ['a'] }],
        pantryStaples: [],
        anthropicClient: client,
      }),
    ).rejects.toBeInstanceOf(GroceryListError)
  })

  it('throws TypeError on bad inputs', async () => {
    const client = fakeAnthropic(JSON.stringify({ items: [] }))
    await expect(
      buildGroceryList({ recipes: [], pantryStaples: [], anthropicClient: client }),
    ).rejects.toBeInstanceOf(TypeError)
    await expect(
      buildGroceryList({ recipes: [{ name: 'X', ingredients: ['a'] }], pantryStaples: 'salt', anthropicClient: client }),
    ).rejects.toBeInstanceOf(TypeError)
    await expect(
      buildGroceryList({ recipes: [{ name: 'X', ingredients: ['a'] }], pantryStaples: [], anthropicClient: null }),
    ).rejects.toBeInstanceOf(TypeError)
  })
})

// ---------- Bite γ — handler validation for householdSize + per-recipe servings ----------

describe('Bite γ — household scaling (handler)', () => {
  it('accepts a valid householdSize and passes it to buildImpl', async () => {
    const buildImpl = vi.fn().mockResolvedValue({ items: [] })
    const handler = createGroceryListHandler({ anthropic: okClient, buildImpl })
    const res = mockRes()
    await handler({
      body: {
        recipes: [{ name: 'Tacos', ingredients: ['chicken'], servings: 4 }],
        householdSize: 6,
      },
    }, res)
    expect(res.statusCode).toBe(200)
    expect(buildImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        householdSize: 6,
        recipes: [{ name: 'Tacos', ingredients: ['chicken'], servings: 4 }],
      }),
    )
  })

  it('rejects negative householdSize with 400', async () => {
    const handler = createGroceryListHandler({ anthropic: okClient })
    const res = mockRes()
    await handler({
      body: { recipes: validBody().recipes, householdSize: -1 },
    }, res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('invalid_household_size')
  })

  it('rejects non-integer householdSize with 400', async () => {
    const handler = createGroceryListHandler({ anthropic: okClient })
    const res = mockRes()
    await handler({
      body: { recipes: validBody().recipes, householdSize: 2.5 },
    }, res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('invalid_household_size')
  })

  it('accepts missing householdSize and passes undefined to buildImpl', async () => {
    const buildImpl = vi.fn().mockResolvedValue({ items: [] })
    const handler = createGroceryListHandler({ anthropic: okClient, buildImpl })
    const res = mockRes()
    await handler({ body: validBody() }, res)
    expect(res.statusCode).toBe(200)
    expect(buildImpl).toHaveBeenCalledWith(
      expect.objectContaining({ householdSize: undefined }),
    )
  })

  it('accepts servings: null on a recipe', async () => {
    const buildImpl = vi.fn().mockResolvedValue({ items: [] })
    const handler = createGroceryListHandler({ anthropic: okClient, buildImpl })
    const res = mockRes()
    await handler({
      body: { recipes: [{ name: 'X', ingredients: ['a'], servings: null }] },
    }, res)
    expect(res.statusCode).toBe(200)
    expect(buildImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        recipes: [{ name: 'X', ingredients: ['a'], servings: null }],
      }),
    )
  })

  it('rejects servings: 0 with 400 invalid_recipes', async () => {
    const handler = createGroceryListHandler({ anthropic: okClient })
    const res = mockRes()
    await handler({
      body: { recipes: [{ name: 'X', ingredients: ['a'], servings: 0 }] },
    }, res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('invalid_recipes')
  })

  it('accepts a recipe with no servings field and passes servings: null to buildImpl', async () => {
    const buildImpl = vi.fn().mockResolvedValue({ items: [] })
    const handler = createGroceryListHandler({ anthropic: okClient, buildImpl })
    const res = mockRes()
    await handler({
      body: { recipes: [{ name: 'X', ingredients: ['a'] }] },
    }, res)
    expect(res.statusCode).toBe(200)
    expect(buildImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        recipes: [{ name: 'X', ingredients: ['a'], servings: null }],
      }),
    )
  })
})

// ---------- Bite γ — buildGroceryList prompt interpolation ----------

describe('Bite γ — buildGroceryList scaling (prompt)', () => {
  it('interpolates householdSize and servings into the prompt', async () => {
    const client = fakeAnthropic(JSON.stringify({ items: [] }))
    await buildGroceryList({
      recipes: [{ name: 'Pasta', ingredients: ['spaghetti'], servings: 4 }],
      householdSize: 6,
      anthropicClient: client,
    })
    const prompt = client.messages.create.mock.calls[0][0].messages[0].content
    expect(prompt).toContain('household has 6 eaters')
    expect(prompt).toContain('yields 4 servings')
  })

  it('servings: null falls back to 4 in the prompt', async () => {
    const client = fakeAnthropic(JSON.stringify({ items: [] }))
    await buildGroceryList({
      recipes: [{ name: 'Pasta', ingredients: ['spaghetti'], servings: null }],
      householdSize: 2,
      anthropicClient: client,
    })
    const prompt = client.messages.create.mock.calls[0][0].messages[0].content
    expect(prompt).toContain('yields 4 servings')
  })

  it('servings: 0 falls back to 4 in the prompt', async () => {
    const client = fakeAnthropic(JSON.stringify({ items: [] }))
    await buildGroceryList({
      recipes: [{ name: 'Pasta', ingredients: ['spaghetti'], servings: 0 }],
      householdSize: 2,
      anthropicClient: client,
    })
    const prompt = client.messages.create.mock.calls[0][0].messages[0].content
    expect(prompt).toContain('yields 4 servings')
  })

  it('defaults to householdSize=2 when caller omits it', async () => {
    const client = fakeAnthropic(JSON.stringify({ items: [] }))
    await buildGroceryList({
      recipes: [{ name: 'Pasta', ingredients: ['spaghetti'] }],
      anthropicClient: client,
    })
    const prompt = client.messages.create.mock.calls[0][0].messages[0].content
    expect(prompt).toContain('household has 2 eaters')
  })
})

// ---------- Bite δ — provided-quantities prompt ----------

describe('Bite δ — provided-quantities prompt', () => {
  it('prompt instruction tells the AI to honor provided quantities', async () => {
    const client = fakeAnthropic(JSON.stringify({ items: [] }))
    await buildGroceryList({
      recipes: [{ name: 'X', ingredients: ['olive oil: 2 tbsp'], servings: 4 }],
      householdSize: 6,
      anthropicClient: client,
    })
    const prompt = client.messages.create.mock.calls[0][0].messages[0].content
    expect(prompt).toContain('use that quantity as the baseline for scaling')
  })

  it('provided ingredient strings flow through to the user message unchanged', async () => {
    const client = fakeAnthropic(JSON.stringify({ items: [] }))
    await buildGroceryList({
      recipes: [{ name: 'X', ingredients: ['olive oil: 2 tbsp'], servings: 4 }],
      householdSize: 6,
      anthropicClient: client,
    })
    const prompt = client.messages.create.mock.calls[0][0].messages[0].content
    expect(prompt).toContain('olive oil: 2 tbsp')
  })
})

describe('Bite γ — buildGroceryList scaling (prompt) — continued', () => {
  it('throws TypeError when householdSize is 0', async () => {
    const client = fakeAnthropic(JSON.stringify({ items: [] }))
    await expect(
      buildGroceryList({
        recipes: [{ name: 'Pasta', ingredients: ['spaghetti'] }],
        householdSize: 0,
        anthropicClient: client,
      }),
    ).rejects.toBeInstanceOf(TypeError)
  })
})

